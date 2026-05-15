"""Path and filename helpers shared by the ArcRho API package."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

DFM_INDEX_FILE_NAME = "dfm_method_index.json"
DFM_JSON_FORMAT = "arcrho-dfm-method-by-tab-v1"


def clean_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def sanitize_project_dir_name(value: Any, fallback: str = "UnknownProject") -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", clean_text(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or fallback


def sanitize_file_name_part(value: Any, fallback: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", clean_text(value))
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def sanitize_dfm_reserving_class_part(value: Any, fallback: str = "ReservingClass") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "^", clean_text(value))
    cleaned = re.sub(r"[. ]+$", lambda match: "^" * len(match.group(0)), cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def dfm_filename(reserving_class: Any, method_name: Any) -> str:
    rc_part = sanitize_dfm_reserving_class_part(reserving_class, "ReservingClass")
    name_part = sanitize_file_name_part(method_name, "Name")
    return f"DFM@{rc_part}@{name_part}.json"


def parse_dfm_filename(filename: str) -> tuple[str, str] | None:
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


def project_dir_case_insensitive(projects_dir: Path, project_name: str) -> Path | None:
    wanted = clean_text(project_name)
    if not wanted or not projects_dir.exists():
        return None
    direct = projects_dir / wanted
    if direct.is_dir():
        return direct
    wanted_lower = wanted.lower()
    for item in projects_dir.iterdir():
        if item.is_dir() and item.name.lower() == wanted_lower:
            return item
    sanitized = sanitize_project_dir_name(wanted)
    direct = projects_dir / sanitized
    if direct.is_dir():
        return direct
    sanitized_lower = sanitized.lower()
    for item in projects_dir.iterdir():
        if item.is_dir() and item.name.lower() == sanitized_lower:
            return item
    return None

