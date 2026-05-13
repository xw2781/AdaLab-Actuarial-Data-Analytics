"""Per-project, per-Windows-user preferences stored on the server root."""
from __future__ import annotations

import getpass
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import HTTPException

from app_server import config

USER_PREFS_FILE = "preferences.json"


def _clean_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _safe_folder_name(value: str, fallback: str = "unknown") -> str:
    cleaned = _clean_text(value)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or fallback


def _current_user_name() -> str:
    return _safe_folder_name(getpass.getuser() or "unknown")


def _require_project_dir(project_name: str) -> str:
    project = _clean_text(project_name)
    if not project:
        raise HTTPException(400, "project_name is required.")
    project_dir = config._find_existing_project_dir(project)
    if not project_dir:
        raise HTTPException(404, f"Project folder not found under projects: {project}")
    return project_dir


def _prefs_path(project_name: str) -> str:
    project_dir = _require_project_dir(project_name)
    return os.path.join(project_dir, "users", _current_user_name(), USER_PREFS_FILE)


def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def get_preferences(project_name: str) -> Dict[str, Any]:
    path = _prefs_path(project_name)
    data = _read_json(path)
    return {
        "ok": True,
        "project_name": _clean_text(project_name),
        "user_name": _current_user_name(),
        "path": path,
        "data": data,
    }


def update_preferences(project_name: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(patch, dict):
        raise HTTPException(400, "data must be an object.")
    path = _prefs_path(project_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    current = _read_json(path)
    next_data = _deep_merge(current, patch)
    next_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    temp_path = f"{path}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(next_data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(temp_path, path)
    except OSError as err:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise HTTPException(500, f"Failed to write project user preferences: {str(err)}")
    return {
        "ok": True,
        "project_name": _clean_text(project_name),
        "user_name": _current_user_name(),
        "path": path,
        "data": next_data,
    }
