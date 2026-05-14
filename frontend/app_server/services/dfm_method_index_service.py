"""DFM method index cache for project/path-scoped method name selection."""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from fastapi import HTTPException

from app_server import config

INDEX_FILE_NAME = "dfm_method_index.json"


def _clean_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _require_project_dir(project_name: str) -> str:
    project = _clean_text(project_name)
    if not project:
        raise HTTPException(400, "project_name is required.")
    project_dir = config._find_existing_project_dir(project)
    if not project_dir:
        raise HTTPException(404, f"Project folder not found under projects: {project}")
    return project_dir


def _methods_dir(project_name: str) -> str:
    return os.path.join(_require_project_dir(project_name), "methods")


def _index_path(project_name: str) -> str:
    return os.path.join(_methods_dir(project_name), INDEX_FILE_NAME)


def _safe_read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _method_parts_from_filename(filename: str) -> tuple[str, str] | None:
    if not filename.startswith("DFM@") or not filename.endswith(".json"):
        return None
    stem = filename[:-5]
    parts = stem.split("@")
    if len(parts) < 3:
        return None
    reserving_class = parts[1]
    method_name = "@".join(parts[2:]).strip()
    if not reserving_class or not method_name:
        return None
    return reserving_class, method_name


def _method_entry(filename: str) -> Dict[str, Any] | None:
    parsed = _method_parts_from_filename(filename)
    if not parsed:
        return None
    reserving_class, method_name = parsed
    return {
        "path": reserving_class,
        "name": method_name,
    }


def _is_current_index(data: Dict[str, Any]) -> bool:
    methods = data.get("methods") if isinstance(data, dict) else None
    if not isinstance(methods, list):
        return False
    for item in methods:
        if not isinstance(item, dict):
            return False
        keys = set(item.keys())
        if keys != {"path", "name"}:
            return False
    return True


def rebuild_index(project_name: str) -> Dict[str, Any]:
    project = _clean_text(project_name)
    methods_dir = _methods_dir(project)
    os.makedirs(methods_dir, exist_ok=True)
    methods: List[Dict[str, Any]] = []
    try:
        for filename in os.listdir(methods_dir):
            path = os.path.join(methods_dir, filename)
            if not os.path.isfile(path):
                continue
            entry = _method_entry(filename)
            if not entry:
                continue
            methods.append(entry)
    except OSError as err:
        raise HTTPException(500, f"Failed to scan DFM methods: {str(err)}")

    methods.sort(key=lambda item: (
        str(item.get("path") or "").lower(),
        str(item.get("name") or "").lower(),
    ))
    data = {
        "methods": methods,
    }
    temp_path = f"{_index_path(project)}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(temp_path, _index_path(project))
    except OSError as err:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise HTTPException(500, f"Failed to write DFM method index: {str(err)}")
    return data


def get_index(project_name: str, refresh: bool = False) -> Dict[str, Any]:
    project = _clean_text(project_name)
    path = _index_path(project)
    if refresh or not os.path.exists(path):
        return rebuild_index(project)
    data = _safe_read_json(path)
    if not data or not _is_current_index(data):
        return rebuild_index(project)
    return data
