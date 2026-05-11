"""DFM RPC bridge request and comparison operations."""
from __future__ import annotations

import getpass
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, Iterable

from fastapi import HTTPException

from app_server import config
from app_server.helpers import wait_for_file
from app_server.schemas.dfm_rpc_bridge import DfmRpcBridgeRequest

RPC_BRIDGE_DIR_NAME = "RPC bridge"
DFM_FUNCTION_NAME = "DFM"
SYNC_DFM_FUNCTION_NAME = "SyncDFM"


def _clean_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _sanitize_project_dir_name(value: str) -> str:
    return config._sanitize_project_dir_name(_clean_text(value))


def _sanitize_method_name_part(value: str, fallback: str) -> str:
    cleaned = _clean_text(value)
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or fallback


def _sanitize_reserving_class_part(value: str, fallback: str) -> str:
    cleaned = _clean_text(value)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "^", cleaned)
    cleaned = re.sub(r"[. ]+$", lambda match: "^" * len(match.group(0)), cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or fallback


def _require_project_dir(project_name: str) -> str:
    project = _clean_text(project_name)
    if not project:
        raise HTTPException(400, "project_name is required.")
    project_dir = config._find_existing_project_dir(project)
    if project_dir:
        return project_dir
    sanitized = _sanitize_project_dir_name(project)
    if not sanitized:
        raise HTTPException(400, "project_name is required.")
    return os.path.join(config.PROJECT_SETTINGS_DIR, sanitized)


def _build_method_filename(
    req: DfmRpcBridgeRequest,
    prefix: str = DFM_FUNCTION_NAME,
    *,
    include_lengths: bool = True,
) -> str:
    reserving_class = _sanitize_reserving_class_part(req.reserving_class, "ReservingClass")
    method_name = _sanitize_method_name_part(req.method_name, "Name")
    if not include_lengths:
        return f"{prefix}@{reserving_class}@{method_name}.json"
    origin = _sanitize_method_name_part(str(req.origin_length), "Origin")
    development = _sanitize_method_name_part(str(req.development_length), "Dev")
    return f"{prefix}@{reserving_class}@{method_name}@{origin}@{development}.json"


def build_paths(req: DfmRpcBridgeRequest) -> Dict[str, str]:
    project_dir = _require_project_dir(req.project_name)
    methods_dir = os.path.join(project_dir, "methods")
    rpc_methods_dir = os.path.join(methods_dir, RPC_BRIDGE_DIR_NAME)
    request_dir = os.path.join(config.REQUEST_DIR, RPC_BRIDGE_DIR_NAME)
    local_path = os.path.join(methods_dir, _build_method_filename(req, DFM_FUNCTION_NAME, include_lengths=False))
    remote_path = os.path.join(rpc_methods_dir, _build_method_filename(req, DFM_FUNCTION_NAME))
    sync_status_path = os.path.join(rpc_methods_dir, _build_method_filename(req, SYNC_DFM_FUNCTION_NAME))
    return {
        "project_dir": project_dir,
        "methods_dir": methods_dir,
        "rpc_methods_dir": rpc_methods_dir,
        "request_dir": request_dir,
        "local_path": local_path,
        "remote_path": remote_path,
        "sync_status_path": sync_status_path,
    }


def _request_lines(req: DfmRpcBridgeRequest, function_name: str, data_path: str) -> Iterable[str]:
    yield f"Function = {function_name}"
    yield f"ProjectName = {req.project_name}"
    yield f"Path = {req.reserving_class}"
    yield f"MethodName = {req.method_name}"
    yield f"OutputVector = {req.output_vector}"
    yield f"InputTriangle = {req.input_triangle}"
    yield f"OriginLength = {req.origin_length}"
    yield f"DevelopmentLength = {req.development_length}"
    yield f"DecimalPlaces = {req.decimal_places}"
    yield f"DataPath = {data_path}"
    yield f"UserName = {getpass.getuser()}"


def _write_request_file(req: DfmRpcBridgeRequest, function_name: str, data_path: str, request_dir: str) -> str:
    os.makedirs(request_dir, exist_ok=True)
    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S") + f".{int(now.microsecond / 1000):03d}"
    stem = f"request-{function_name}-{timestamp}"
    temp_path = os.path.join(request_dir, f"{stem}.tmp")
    final_path = os.path.join(request_dir, f"{stem}.txt")

    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as fh:
            for line in _request_lines(req, function_name, data_path):
                fh.write(line.rstrip("\r\n") + "\n")
        if os.path.exists(final_path):
            raise HTTPException(409, "Request file name collision and cannot overwrite.")
        os.replace(temp_path, final_path)
    except HTTPException:
        _try_remove(temp_path)
        raise
    except PermissionError:
        _try_remove(temp_path)
        raise HTTPException(423, "Request folder is locked or inaccessible.")
    except OSError as err:
        _try_remove(temp_path)
        raise HTTPException(500, f"Failed to write request file: {str(err)}")
    return final_path


def _try_remove(path: str) -> bool:
    if not path:
        return False
    try:
        if os.path.exists(path):
            os.remove(path)
            return True
    except OSError:
        return False
    return False


def _parse_last_modified_timestamp(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        raw_number = float(value)
        return raw_number if raw_number > 0 else None
    raw = _clean_text(value)
    if not raw:
        return None
    try:
        raw_number = float(raw)
    except ValueError:
        raw_number = None
    if raw_number is not None:
        return raw_number if raw_number > 0 else None

    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except ValueError:
        return None


def _json_last_modified_meta(path: str) -> Dict[str, Any]:
    try:
        payload = _read_json(path)
    except HTTPException as err:
        return {
            "last_modified": "",
            "last_modified_timestamp": None,
            "last_modified_error": _clean_text(err.detail),
        }
    raw = payload.get("last modified")
    return {
        "last_modified": _clean_text(raw),
        "last_modified_timestamp": _parse_last_modified_timestamp(raw),
        "last_modified_error": "",
    }


def _file_meta(path: str) -> Dict[str, Any]:
    exists = os.path.exists(path)
    out: Dict[str, Any] = {
        "path": path,
        "exists": exists,
        "mtime": None,
        "mtime_iso": "",
        "size": None,
        "last_modified": "",
        "last_modified_timestamp": None,
        "last_modified_error": "",
    }
    if not exists:
        return out
    try:
        st = os.stat(path)
    except PermissionError:
        raise HTTPException(423, f"File is locked or inaccessible: {path}")
    except OSError as err:
        raise HTTPException(500, f"Failed to stat file: {str(err)}")
    out["mtime"] = st.st_mtime
    out["mtime_iso"] = datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")
    out["size"] = st.st_size
    out.update(_json_last_modified_meta(path))
    return out


def _extract_pattern_snapshot(payload: Dict[str, Any]) -> Dict[str, Any]:
    pattern = payload.get("ratio pattern")
    origin_labels = payload.get("origin labels")
    development_labels = payload.get("development labels")
    preview_origin_labels = [
        _clean_text(label)
        for label in origin_labels
    ] if isinstance(origin_labels, list) else []
    preview_development_labels = [
        _clean_text(label)
        for label in development_labels
    ] if isinstance(development_labels, list) else []
    if not isinstance(pattern, list):
        return {
            "exists": False,
            "rows": 0,
            "columns": 0,
            "selected_count": 0,
            "preview": [],
            "origin_labels": [],
            "development_labels": [],
        }
    rows = len(pattern)
    columns = 0
    selected_count = 0
    preview = []
    for row_index, row in enumerate(pattern):
        if isinstance(row, list):
            columns = max(columns, len(row))
            normalized_row = []
            for cell in row:
                if cell in (1, True, "1", "true", "True"):
                    value = 1
                elif cell in (2, "2"):
                    value = 2
                else:
                    value = 0
                if value == 1:
                    selected_count += 1
                normalized_row.append(value)
            preview.append(normalized_row)
        else:
            preview.append([])
    return {
        "exists": True,
        "rows": rows,
        "columns": columns,
        "selected_count": selected_count,
        "preview": preview,
        "origin_labels": preview_origin_labels,
        "development_labels": preview_development_labels,
    }


def _build_json_snapshot(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {
            "available": False,
            "error": "",
            "ratio_pattern": _extract_pattern_snapshot({}),
            "notes": "",
            "notes_preview": "",
            "average_formulas": [],
            "last_modified": "",
        }
    try:
        payload = _read_json(path)
    except HTTPException as err:
        return {
            "available": False,
            "error": _clean_text(err.detail),
            "ratio_pattern": _extract_pattern_snapshot({}),
            "notes": "",
            "notes_preview": "",
            "average_formulas": [],
            "last_modified": "",
        }
    notes = _clean_text(payload.get("notes"))
    formulas = payload.get("average formulas", [])
    if not isinstance(formulas, list):
        formulas = []
    return {
        "available": True,
        "error": "",
        "ratio_pattern": _extract_pattern_snapshot(payload),
        "notes": notes,
        "notes_preview": notes[:600],
        "average_formulas": [str(item) for item in formulas],
        "last_modified": _clean_text(payload.get("last modified")),
    }


def _compare_state(local_meta: Dict[str, Any], remote_meta: Dict[str, Any]) -> str:
    local_exists = bool(local_meta.get("exists"))
    remote_exists = bool(remote_meta.get("exists"))
    if local_exists and remote_exists:
        local_modified = float(local_meta.get("last_modified_timestamp") or 0)
        remote_modified = float(remote_meta.get("last_modified_timestamp") or 0)
        if abs(local_modified - remote_modified) <= 1e-6:
            return "same_time"
        return "remote_latest" if remote_modified > local_modified else "local_latest"
    if local_exists:
        return "remote_missing"
    if remote_exists:
        return "local_missing"
    return "both_missing"


def compare(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    paths = build_paths(req)
    local_meta = _file_meta(paths["local_path"])
    remote_meta = _file_meta(paths["remote_path"])
    return {
        "ok": True,
        "status": "compared",
        "comparison": _compare_state(local_meta, remote_meta),
        "local": local_meta,
        "remote": remote_meta,
        "snapshots": {
            "local": _build_json_snapshot(paths["local_path"]),
            "remote": _build_json_snapshot(paths["remote_path"]),
        },
        "paths": paths,
    }


def send_sync_request(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    paths = build_paths(req)
    os.makedirs(paths["rpc_methods_dir"], exist_ok=True)
    request_file = _write_request_file(req, DFM_FUNCTION_NAME, paths["remote_path"], paths["request_dir"])
    ok = wait_for_file(paths["remote_path"], timeout_sec=max(0.1, float(req.timeout_sec)))
    result = compare(req)
    result.update({
        "request_file": request_file,
        "data_path": paths["remote_path"],
        "timeout_sec": req.timeout_sec,
    })
    if not ok:
        result["ok"] = False
        result["status"] = "timeout"
    return result


def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise HTTPException(404, f"JSON file not found: {path}")
    except PermissionError:
        raise HTTPException(423, f"JSON file is locked or inaccessible: {path}")
    except json.JSONDecodeError as err:
        raise HTTPException(500, f"Invalid JSON format in {path}: {str(err)}")
    except OSError as err:
        raise HTTPException(500, f"Failed to read JSON file: {str(err)}")
    if not isinstance(data, dict):
        raise HTTPException(500, f"Expected JSON object in {path}.")
    return data


def _atomic_write_json(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(temp_path, path)
    except PermissionError:
        _try_remove(temp_path)
        raise HTTPException(423, f"JSON file is locked or inaccessible: {path}")
    except OSError as err:
        _try_remove(temp_path)
        raise HTTPException(500, f"Failed to write JSON file: {str(err)}")


def apply_remote_to_local(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    paths = build_paths(req)
    if not os.path.exists(paths["remote_path"]):
        raise HTTPException(404, "Remote DFM JSON is missing.")
    payload = _read_json(paths["remote_path"])
    _atomic_write_json(paths["local_path"], payload)
    deleted = _try_remove(paths["remote_path"])
    local_meta = _file_meta(paths["local_path"])
    return {
        "ok": True,
        "status": "applied",
        "payload": payload,
        "local": local_meta,
        "remote_deleted": deleted,
        "paths": paths,
    }


def keep_local(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    paths = build_paths(req)
    remote_deleted = _try_remove(paths["remote_path"])
    return {
        "ok": True,
        "status": "kept_local",
        "message": "Kept local DFM JSON. Remote RPC JSON was removed." if remote_deleted else "Kept local DFM JSON. No remote RPC JSON was found to remove.",
        "remote_deleted": remote_deleted,
        "paths": paths,
    }


def update_remote(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    paths = build_paths(req)
    os.makedirs(paths["rpc_methods_dir"], exist_ok=True)
    _try_remove(paths["sync_status_path"])
    request_file = _write_request_file(
        req,
        SYNC_DFM_FUNCTION_NAME,
        paths["sync_status_path"],
        paths["request_dir"],
    )
    status_found = wait_for_file(paths["sync_status_path"], timeout_sec=max(0.1, float(req.timeout_sec)))
    remote_deleted = _try_remove(paths["remote_path"])
    if not status_found:
        return {
            "ok": False,
            "status": "timeout",
            "message": "Timed out waiting for SyncDFM status JSON.",
            "request_file": request_file,
            "status_path": paths["sync_status_path"],
            "remote_deleted": remote_deleted,
            "paths": paths,
        }
    status_payload = _read_json(paths["sync_status_path"])
    raw_ok = status_payload.get("ok")
    raw_status = _clean_text(status_payload.get("status"))
    if isinstance(raw_ok, bool):
        status_ok = raw_ok
    else:
        status_ok = raw_status.strip().lower() in {"passed", "success", "ok", "true"}
    status_text = raw_status or ("passed" if status_ok else "failed")
    message = _clean_text(status_payload.get("message")) or status_text
    _try_remove(paths["sync_status_path"])
    return {
        "ok": status_ok,
        "status": status_text,
        "message": message,
        "payload": status_payload,
        "request_file": request_file,
        "status_path": paths["sync_status_path"],
        "remote_deleted": remote_deleted,
        "paths": paths,
    }
