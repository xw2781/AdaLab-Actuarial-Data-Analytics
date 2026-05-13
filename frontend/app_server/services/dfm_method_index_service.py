"""DFM method index cache for startup object selection."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
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


def _json_tab(payload: Dict[str, Any], tab_name: str) -> Dict[str, Any]:
    tab = payload.get(tab_name) if isinstance(payload, dict) else None
    return tab if isinstance(tab, dict) else {}


def _method_entry(methods_dir: str, filename: str) -> Dict[str, Any] | None:
    parsed = _method_parts_from_filename(filename)
    if not parsed:
        return None
    reserving_class, fallback_name = parsed
    path = os.path.join(methods_dir, filename)
    payload = _safe_read_json(path)
    details = _json_tab(payload, "details tab")
    metadata = _json_tab(payload, "method metadata")
    stat = os.stat(path)
    method_name = _clean_text(details.get("name")) or fallback_name
    return {
        "project": "",
        "reservingClass": reserving_class,
        "methodName": method_name,
        "outputVector": _clean_text(details.get("output type")),
        "inputTriangle": _clean_text(details.get("input triangle")),
        "originLength": details.get("origin length"),
        "developmentLength": details.get("development length"),
        "decimalPlaces": details.get("decimal places"),
        "lastModified": _clean_text(metadata.get("last modified")),
        "fileModified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "filename": filename,
        "path": path,
    }


def _build_tree(methods: List[Dict[str, Any]]) -> Dict[str, Any]:
    root = {"name": "DFM Methods", "children": []}
    by_class: Dict[str, Dict[str, Any]] = {}
    for item in methods:
        rc = _clean_text(item.get("reservingClass")) or "Unassigned"
        node = by_class.get(rc)
        if not node:
            node = {"name": rc, "path": rc, "children": []}
            by_class[rc] = node
            root["children"].append(node)
        node["children"].append({
            "name": item.get("methodName") or item.get("filename") or "DFM",
            "path": item.get("path") or "",
            "method": item,
        })
    root["children"].sort(key=lambda item: str(item.get("name") or "").lower())
    for node in root["children"]:
        node["children"].sort(key=lambda item: str(item.get("name") or "").lower())
    return root


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
            entry = _method_entry(methods_dir, filename)
            if not entry:
                continue
            entry["project"] = project
            methods.append(entry)
    except OSError as err:
        raise HTTPException(500, f"Failed to scan DFM methods: {str(err)}")

    methods.sort(key=lambda item: (
        str(item.get("reservingClass") or "").lower(),
        str(item.get("methodName") or "").lower(),
    ))
    data = {
        "project": project,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "methodsDir": methods_dir,
        "methods": methods,
        "tree": _build_tree(methods),
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
    if not data:
        return rebuild_index(project)
    return data
