"""Project settings and folder structure CRUD."""
from __future__ import annotations

import os
import re
import json
import shutil
import subprocess
import sys
from datetime import datetime
from typing import Any, Dict, List

from fastapi import HTTPException

from app_server import config
from app_server.helpers import (
    _sanitize_project_dir_name,
    _norm_tree_path,
    _split_project_tree_path,
    _add_folder_with_parents,
    _normalize_folder_structure_entry,
)
from app_server.services.audit_service import safe_append_project_audit_log


def _folder_structure_path() -> str:
    return os.path.join(config.PROJECT_SETTINGS_DIR, config.FOLDER_STRUCTURE_FILE)


def _normalize_integer_like_text(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    compact = raw.replace(",", "")
    m = re.match(r"^(-?\d+)(?:\.0+)?$", compact)
    if not m:
        return raw
    int_part = str(m.group(1) or "")
    sign = "-" if int_part.startswith("-") else ""
    digits = int_part[1:] if sign else int_part
    digits = re.sub(r"^0+(?=\d)", "", digits)
    return sign + digits


def _normalize_ci(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_bool_like(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value or "").strip().lower()
    if s in {"1", "true", "yes", "y", "on"}:
        return True
    if s in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _normalize_general_settings_payload(
    payload: Any,
    project_name: str = "",
    default_auto_generated: bool = False,
) -> Dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    return {
        "project_name": str(data.get("project_name", project_name) or project_name or "").strip(),
        "origin_start_date": _normalize_integer_like_text(data.get("origin_start_date", "")),
        "origin_end_date": _normalize_integer_like_text(data.get("origin_end_date", "")),
        "development_end_date": _normalize_integer_like_text(data.get("development_end_date", "")),
        "auto_generated": _normalize_bool_like(data.get("auto_generated", default_auto_generated), default_auto_generated),
    }


def _open_folder_in_explorer(folder_path: str) -> None:
    if os.name == "nt":
        os.startfile(folder_path)  # type: ignore[attr-defined]
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", folder_path], close_fds=True)
        return
    subprocess.Popen(["xdg-open", folder_path], close_fds=True)


def get_project_folders(source: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    filepath = _folder_structure_path()
    folders: List[str] = []
    project_paths: List[str] = []
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                folders, project_paths = _normalize_folder_structure_entry(data.get(source))
        except Exception:
            folders = []
            project_paths = []

    return {"ok": True, "source": source, "folders": folders, "project_paths": project_paths}


def update_project_folders(source: str, folders_input: List[str], project_paths_input: List[str]) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    filepath = _folder_structure_path()
    data: Dict[str, Any] = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    if not isinstance(data, dict):
        data = {}

    folders, _ = _normalize_folder_structure_entry({"folders": list(folders_input) if folders_input else []})
    _, project_paths = _normalize_folder_structure_entry({"project_paths": list(project_paths_input) if project_paths_input else []})
    folder_set: set = set(folders)
    for full in project_paths:
        folder, _proj = _split_project_tree_path(full)
        _add_folder_with_parents(folder_set, folder)
    folders_final = sorted(folder_set)

    data[source] = {
        "folders": folders_final,
        "project_paths": project_paths,
    }

    try:
        os.makedirs(config.PROJECT_SETTINGS_DIR, exist_ok=True)
        tmp_path = filepath + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, filepath)
        return {"ok": True, "source": source, "folders_count": len(folders_final), "project_paths_count": len(project_paths)}
    except PermissionError:
        raise HTTPException(423, "File is locked. Another user may have it open.")
    except Exception as e:
        raise HTTPException(500, f"Failed to save folder structure: {str(e)}")


def rename_project_folder(source: str, old_name: str, new_name: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    old_folder = _sanitize_project_dir_name(old_name)
    new_folder = _sanitize_project_dir_name(new_name)
    if not old_folder or not new_folder:
        raise HTTPException(400, "Old name and new name must not be empty.")
    if old_folder == new_folder:
        return {"ok": True, "message": "Names are the same, no rename needed."}

    old_path = os.path.join(config.PROJECT_SETTINGS_DIR, old_folder)
    new_path = os.path.join(config.PROJECT_SETTINGS_DIR, new_folder)

    if not os.path.isdir(old_path):
        return {"ok": True, "message": f"Source folder does not exist: {old_folder}. Nothing to rename."}

    if os.path.exists(new_path):
        raise HTTPException(409, f"Target folder already exists: {new_folder}")

    try:
        os.rename(old_path, new_path)
        safe_append_project_audit_log(
            project_name=new_folder,
            action=f"Renamed project folder from '{old_folder}' to '{new_folder}'",
        )
        return {"ok": True, "old_folder": old_folder, "new_folder": new_folder}
    except PermissionError:
        raise HTTPException(423, "Folder is locked or in use. Cannot rename.")
    except Exception as e:
        raise HTTPException(500, f"Failed to rename folder: {str(e)}")


def duplicate_project_folder(source: str, old_name: str, new_name: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    old_folder = _sanitize_project_dir_name(old_name)
    new_folder = _sanitize_project_dir_name(new_name)
    if not old_folder or not new_folder:
        raise HTTPException(400, "Old name and new name must not be empty.")
    if old_folder.lower() == new_folder.lower():
        raise HTTPException(400, "Old name and new name must be different.")

    old_path = os.path.join(config.PROJECT_SETTINGS_DIR, old_folder)
    new_path = os.path.join(config.PROJECT_SETTINGS_DIR, new_folder)

    if not os.path.isdir(old_path):
        return {"ok": True, "message": f"Source folder does not exist: {old_folder}. Nothing to copy."}
    if os.path.exists(new_path):
        raise HTTPException(409, f"Target folder already exists: {new_folder}")

    root_norm = os.path.normcase(os.path.normpath(old_path))

    def ignore_data_in_root(current_dir: str, names: List[str]) -> List[str]:
        current_norm = os.path.normcase(os.path.normpath(current_dir))
        if current_norm != root_norm:
            return []
        return [name for name in names if name.strip().lower() == "data"]

    try:
        shutil.copytree(old_path, new_path, ignore=ignore_data_in_root)
        old_manual_path = os.path.join(old_path, config.PROJECT_DATA_DIR, config.MANUAL_DATA_DIR)
        new_data_path = os.path.join(new_path, config.PROJECT_DATA_DIR)
        new_generated_path = os.path.join(new_data_path, config.GENERATED_DATA_DIR)
        new_manual_path = os.path.join(new_data_path, config.MANUAL_DATA_DIR)
        os.makedirs(new_generated_path, exist_ok=True)
        if os.path.isdir(old_manual_path):
            shutil.copytree(old_manual_path, new_manual_path, dirs_exist_ok=True)
            manual_action = "copied"
        else:
            os.makedirs(new_manual_path, exist_ok=True)
            manual_action = "created"
        safe_append_project_audit_log(
            project_name=new_folder,
            action=f"Duplicated project folder from '{old_folder}'",
        )
        created = [f"{config.PROJECT_DATA_DIR}/{config.GENERATED_DATA_DIR}"]
        if manual_action == "created":
            created.append(f"{config.PROJECT_DATA_DIR}/{config.MANUAL_DATA_DIR}")
        return {
            "ok": True,
            "old_folder": old_folder,
            "new_folder": new_folder,
            "skipped": [f"{config.PROJECT_DATA_DIR}/{config.GENERATED_DATA_DIR}"],
            "created": created,
            "copied": [f"{config.PROJECT_DATA_DIR}/{config.MANUAL_DATA_DIR}"] if manual_action == "copied" else [],
        }
    except FileExistsError:
        raise HTTPException(409, f"Target folder already exists: {new_folder}")
    except PermissionError:
        if os.path.isdir(new_path):
            try:
                shutil.rmtree(new_path)
            except Exception:
                pass
        raise HTTPException(423, "Folder is locked or in use. Cannot duplicate.")
    except Exception as e:
        if os.path.isdir(new_path):
            try:
                shutil.rmtree(new_path)
            except Exception:
                pass
        raise HTTPException(500, f"Failed to duplicate folder: {str(e)}")


def create_project_folder(source: str, name: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    folder = _sanitize_project_dir_name(name)
    if not folder:
        raise HTTPException(400, "Project name must not be empty.")

    folder_path = os.path.join(config.PROJECT_SETTINGS_DIR, folder)
    generated_data_path = os.path.join(folder_path, config.PROJECT_DATA_DIR, config.GENERATED_DATA_DIR)
    manual_data_path = os.path.join(folder_path, config.PROJECT_DATA_DIR, config.MANUAL_DATA_DIR)
    base_dir = os.path.normcase(os.path.abspath(config.PROJECT_SETTINGS_DIR))
    target_dir = os.path.normcase(os.path.abspath(folder_path))
    if not (target_dir == base_dir or target_dir.startswith(base_dir + os.sep)):
        raise HTTPException(400, "Invalid project folder path.")

    if os.path.exists(folder_path):
        if os.path.isdir(folder_path):
            raise HTTPException(409, f"Target folder already exists: {folder}")
        raise HTTPException(409, f"Target path is not a folder: {folder}")

    try:
        os.makedirs(generated_data_path, exist_ok=False)
        os.makedirs(manual_data_path, exist_ok=False)
        safe_append_project_audit_log(
            project_name=folder,
            action="Created empty project folder",
        )
        return {
            "ok": True,
            "created_folder": folder,
            "created": [
                f"{config.PROJECT_DATA_DIR}/{config.GENERATED_DATA_DIR}",
                f"{config.PROJECT_DATA_DIR}/{config.MANUAL_DATA_DIR}",
            ],
        }
    except FileExistsError:
        raise HTTPException(409, f"Target folder already exists: {folder}")
    except PermissionError:
        if os.path.isdir(folder_path):
            try:
                shutil.rmtree(folder_path)
            except Exception:
                pass
        raise HTTPException(423, "Folder is locked or in use. Cannot create project folder.")
    except Exception as e:
        if os.path.isdir(folder_path):
            try:
                shutil.rmtree(folder_path)
            except Exception:
                pass
        raise HTTPException(500, f"Failed to create project folder: {str(e)}")


def delete_project_folder(source: str, name: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    folder = _sanitize_project_dir_name(name)
    if not folder:
        raise HTTPException(400, "Project name must not be empty.")

    folder_path = os.path.join(config.PROJECT_SETTINGS_DIR, folder)
    base_dir = os.path.normcase(os.path.abspath(config.PROJECT_SETTINGS_DIR))
    target_dir = os.path.normcase(os.path.abspath(folder_path))
    if not (target_dir == base_dir or target_dir.startswith(base_dir + os.sep)):
        raise HTTPException(400, "Invalid project folder path.")

    if not os.path.exists(folder_path):
        return {"ok": True, "message": f"Folder does not exist: {folder}. Nothing to delete."}
    if not os.path.isdir(folder_path):
        raise HTTPException(409, f"Target path is not a folder: {folder}")

    try:
        shutil.rmtree(folder_path)
        return {"ok": True, "deleted_folder": folder}
    except FileNotFoundError:
        return {"ok": True, "message": f"Folder does not exist: {folder}. Nothing to delete."}
    except PermissionError:
        raise HTTPException(423, "Folder is locked or in use. Cannot delete.")
    except Exception as e:
        raise HTTPException(500, f"Failed to delete folder: {str(e)}")


def open_project_folder(source: str, project_name: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    project_name_clean = str(project_name or "").strip()
    if not project_name_clean:
        raise HTTPException(400, "project_name is required.")

    try:
        project_dir = os.path.dirname(config.get_general_settings_path(project_name_clean))
    except ValueError as e:
        raise HTTPException(404, str(e))

    if not os.path.isdir(project_dir):
        raise HTTPException(404, f"Project folder not found under projects: {project_name_clean}")

    try:
        _open_folder_in_explorer(project_dir)
        return {
            "ok": True,
            "project_name": project_name_clean,
            "path": project_dir,
        }
    except PermissionError:
        raise HTTPException(423, "Project folder is locked or inaccessible.")
    except FileNotFoundError:
        raise HTTPException(500, "File explorer command is not available on this system.")
    except Exception as e:
        raise HTTPException(500, f"Failed to open project folder: {str(e)}")


def get_project_settings(source: str) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    filename = config.PROJECT_SETTINGS_SOURCES[source]
    filepath = os.path.join(config.PROJECT_SETTINGS_DIR, filename)

    if not os.path.exists(filepath):
        raise HTTPException(404, f"Settings file not found: {filepath}")

    st = os.stat(filepath)
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    return {
        "ok": True,
        "source": source,
        "path": filepath,
        "mtime": st.st_mtime,
        "data": data,
    }


def update_project_settings(source: str, data: Dict[str, Any], file_mtime: float = None) -> Dict[str, Any]:
    if source not in config.PROJECT_SETTINGS_SOURCES:
        raise HTTPException(404, f"Unknown source: {source}")

    filename = config.PROJECT_SETTINGS_SOURCES[source]
    filepath = os.path.join(config.PROJECT_SETTINGS_DIR, filename)

    if os.path.exists(filepath):
        st = os.stat(filepath)
        if file_mtime is not None and abs(st.st_mtime - file_mtime) > 0.001:
            raise HTTPException(409, "File was modified by another user. Please refresh and try again.")

    try:
        tmp_path = filepath + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, filepath)

        st2 = os.stat(filepath)
        return {
            "ok": True,
            "source": source,
            "path": filepath,
            "mtime": st2.st_mtime,
        }
    except PermissionError:
        raise HTTPException(423, "File is locked. Another user may have it open.")
    except Exception as e:
        raise HTTPException(500, f"Failed to save: {str(e)}")


def get_general_settings(project_name: str) -> Dict[str, Any]:
    project_name_clean = str(project_name or "").strip()
    if not project_name_clean:
        raise HTTPException(400, "project_name is required")

    try:
        filepath = config.get_general_settings_path(project_name_clean)
    except ValueError as e:
        raise HTTPException(404, str(e))
    project_folder_name = os.path.basename(os.path.dirname(filepath))

    if not os.path.exists(filepath):
        data = _normalize_general_settings_payload({}, project_folder_name, default_auto_generated=True)
        data["project_folder_name"] = project_folder_name
        data["project_name_mismatch"] = False
        return {
            "ok": True,
            "exists": False,
            "path": filepath,
            "data": data,
        }

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw = json.load(f)
        data = _normalize_general_settings_payload(raw, project_folder_name, default_auto_generated=False)
        data["project_folder_name"] = project_folder_name
        data["project_name_mismatch"] = _normalize_ci(data.get("project_name")) != _normalize_ci(project_folder_name)
        if isinstance(raw, dict):
            updated_at = str(raw.get("updated_at", "") or "").strip()
            if updated_at:
                data["updated_at"] = updated_at
        return {"ok": True, "exists": True, "path": filepath, "data": data}
    except Exception as e:
        raise HTTPException(500, f"Failed to read general settings: {str(e)}")


def update_general_settings(
    project_name: str,
    origin_start_date: str = "",
    origin_end_date: str = "",
    development_end_date: str = "",
    auto_generated: bool = False,
) -> Dict[str, Any]:
    project_name_clean = str(project_name or "").strip()
    if not project_name_clean:
        raise HTTPException(400, "project_name is required")

    try:
        filepath = config.get_general_settings_path(project_name_clean)
    except ValueError as e:
        raise HTTPException(404, str(e))
    project_folder_name = os.path.basename(os.path.dirname(filepath))

    payload = _normalize_general_settings_payload(
        {
            "project_name": project_folder_name,
            "origin_start_date": origin_start_date,
            "origin_end_date": origin_end_date,
            "development_end_date": development_end_date,
            "auto_generated": auto_generated,
        },
        project_folder_name,
        default_auto_generated=_normalize_bool_like(auto_generated, False),
    )
    payload["updated_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        tmp_path = filepath + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, filepath)
        safe_append_project_audit_log(
            project_name=project_name_clean,
            action="Saved General Settings (Origin/Development date boundaries)",
        )
        response_data = dict(payload)
        response_data["project_folder_name"] = project_folder_name
        response_data["project_name_mismatch"] = False
        return {"ok": True, "path": filepath, "data": response_data}
    except PermissionError:
        raise HTTPException(423, "General settings file is locked. Another user may have it open.")
    except Exception as e:
        raise HTTPException(500, f"Failed to save general settings: {str(e)}")


def list_project_settings_sources() -> Dict[str, Any]:
    sources = []
    for key, filename in config.PROJECT_SETTINGS_SOURCES.items():
        filepath = os.path.join(config.PROJECT_SETTINGS_DIR, filename)
        exists = os.path.exists(filepath)
        sources.append({
            "key": key,
            "filename": filename,
            "path": filepath,
            "exists": exists,
        })
    return {"sources": sources}
