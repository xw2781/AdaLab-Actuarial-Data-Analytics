"""ArcRho runtime request operations."""
from __future__ import annotations

import os
import hashlib
import json
from datetime import datetime
from typing import Any, Dict

from fastapi import HTTPException

from app_server import config
from app_server.helpers import set_data_path_like_vba, send_request_like_vba, wait_for_file
from app_server.services import book_service


def _pair_value(pairs: list, key: str) -> str:
    key_l = key.strip().lower()
    for pair_key, pair_value in pairs:
        if str(pair_key or "").strip().lower() == key_l:
            return str(pair_value or "").strip()
    return ""


def _write_dataset_sidecar(data_path: str, pairs: list) -> None:
    dataset_name = _pair_value(pairs, "DatasetName") or _pair_value(pairs, "TriangleName")
    if not dataset_name:
        return
    origin_length = _pair_value(pairs, "OriginLength")
    development_length = _pair_value(pairs, "DevelopmentLength")
    payload = {
        "dataset_name": dataset_name,
        "dataset_type": dataset_name,
        "instance_name": dataset_name,
        "reserving_class": _pair_value(pairs, "Path"),
        "project_name": _pair_value(pairs, "ProjectName"),
        "origin_length": origin_length,
        "development_length": development_length,
        "storage": "generated",
        "csv_file": os.path.basename(data_path),
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    sidecar_path = os.path.splitext(data_path)[0] + ".json"
    tmp_path = f"{sidecar_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp_path, sidecar_path)


def arcrho_tri_cache_matches(data_path: str, pairs: list) -> bool:
    if not os.path.exists(data_path):
        return False
    sidecar_path = os.path.splitext(data_path)[0] + ".json"
    if not os.path.exists(sidecar_path):
        return False
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return False
    if not isinstance(payload, dict):
        return False
    checks = {
        "dataset_name": _pair_value(pairs, "DatasetName") or _pair_value(pairs, "TriangleName"),
        "reserving_class": _pair_value(pairs, "Path"),
        "project_name": _pair_value(pairs, "ProjectName"),
        "origin_length": _pair_value(pairs, "OriginLength"),
        "development_length": _pair_value(pairs, "DevelopmentLength"),
    }
    return all(str(payload.get(key) or "").strip() == value for key, value in checks.items())


def arcrho_headers(pairs: list, timeout_sec: float) -> Dict[str, Any]:
    data_path = set_data_path_like_vba(pairs)
    request_file = None

    if not os.path.exists(data_path):
        try:
            os.makedirs(os.path.dirname(data_path), exist_ok=True)
        except OSError as err:
            raise HTTPException(500, f"Failed to create ArcRho headers data folder: {str(err)}")
        request_info = "#".join([f"{k} = {v}" for k, v in pairs] + [f"DataPath = {data_path}"])
        request_file = send_request_like_vba(request_info)

        ok = wait_for_file(data_path, timeout_sec=max(0.1, float(timeout_sec)))
        if not ok:
            return {
                "ok": False,
                "status": "timeout",
                "request_file": request_file,
                "data_path": data_path,
            }

    with open(data_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()

    parts = [x.strip() for x in raw.replace("\n", ",").split(",") if x.strip()]

    return {
        "ok": True,
        "labels": parts,
        "request_file": request_file,
        "data_path": data_path,
    }


def clear_arcrho_headers_cache(project_name: str) -> Dict[str, Any]:
    project_name_clean = str(project_name or "").strip()
    if not project_name_clean:
        raise HTTPException(400, "ProjectName is required")

    try:
        data_dir = config.get_project_generated_data_dir(project_name_clean)
    except ValueError as e:
        raise HTTPException(404, str(e))

    cleared_files = []
    if not os.path.isdir(data_dir):
        return {
            "ok": True,
            "project_name": project_name_clean,
            "data_dir": data_dir,
            "cleared_count": 0,
            "cleared_files": [],
        }

    try:
        with os.scandir(data_dir) as it:
            for entry in it:
                if not entry.is_file():
                    continue
                name_l = entry.name.strip().lower()
                if not name_l.endswith(".csv"):
                    continue
                if not name_l.startswith("arcrhoheaders"):
                    continue
                os.remove(entry.path)
                cleared_files.append(entry.name)
    except PermissionError:
        raise HTTPException(423, "Cannot clear ArcRhoHeaders cache files because the project data folder is locked.")
    except OSError as e:
        raise HTTPException(500, f"Failed to clear ArcRhoHeaders cache files: {str(e)}")

    return {
        "ok": True,
        "project_name": project_name_clean,
        "data_dir": data_dir,
        "cleared_count": len(cleared_files),
        "cleared_files": cleared_files,
    }


def arcrho_projects() -> Dict[str, Any]:
    if not os.path.exists(config.PROJECT_BOOK):
        raise HTTPException(404, f"Project map file not found: {config.PROJECT_BOOK}")

    data = book_service._load_project_map_data(config.PROJECT_BOOK)
    sheet_names = book_service._project_map_sheet_names(data)
    if not sheet_names:
        raise HTTPException(400, "No sheet data found in project map JSON.")
    first_sheet = sheet_names[0]

    values = book_service._read_project_map_sheet_matrix(config.PROJECT_BOOK, first_sheet, max_rows=5000, max_cols=50)

    vals = []
    for row in values:
        if not row:
            continue
        v = row[0]
        if v is None:
            continue
        s = str(v).strip()
        if s:
            vals.append(s)

    if vals and vals[0].strip().lower() in ("project name", "projectname"):
        vals = vals[1:]

    seen = set()
    out = []
    for x in vals:
        if x not in seen:
            out.append(x)
            seen.add(x)

    return {"sheet": first_sheet, "projects": out}


def run_arcrho_tri(pairs: list, data_path: str, timeout_sec: float, force_refresh: bool = False) -> Dict[str, Any]:
    request_file = None
    cache_cleared = False

    cache_matches = arcrho_tri_cache_matches(data_path, pairs)
    if (force_refresh or not cache_matches) and os.path.exists(data_path):
        try:
            os.remove(data_path)
            sidecar_path = os.path.splitext(data_path)[0] + ".json"
            if os.path.exists(sidecar_path):
                os.remove(sidecar_path)
            cache_cleared = True
        except OSError as e:
            raise HTTPException(423, f"Cannot clear cached ArcRho tri file: {str(e)}")

    need_request = force_refresh or (not cache_matches)
    if need_request:
        try:
            os.makedirs(os.path.dirname(data_path), exist_ok=True)
        except OSError as err:
            raise HTTPException(500, f"Failed to create ArcRho tri data folder: {str(err)}")
        request_info = "#".join([f"{k} = {v}" for k, v in pairs] + [f"DataPath = {data_path}"])
        request_file = send_request_like_vba(request_info)

        ok = wait_for_file(data_path, timeout_sec=max(0.1, float(timeout_sec)))
        if not ok:
            timeout_out: Dict[str, Any] = {
                "ok": False,
                "status": "timeout",
                "need_request": True,
                "request_file": request_file,
                "data_path": data_path,
            }
            if force_refresh:
                timeout_out["cache_cleared"] = cache_cleared
            return timeout_out

    try:
        _write_dataset_sidecar(data_path, pairs)
    except OSError as err:
        raise HTTPException(500, f"Failed to write ArcRho tri dataset metadata: {str(err)}")

    ds_id = "arcrhotri_" + hashlib.sha1(data_path.encode("utf-8")).hexdigest()[:16]
    config.DATASETS[ds_id] = data_path

    out: Dict[str, Any] = {
        "ok": True,
        "need_request": need_request,
        "ds_id": ds_id,
        "request_file": request_file,
        "data_path": data_path,
    }
    if force_refresh:
        out["cache_cleared"] = cache_cleared
    return out
