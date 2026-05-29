"""Reserving-class scoped method index cache for method-backed datasets."""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List

from fastapi import HTTPException

from app_server import config
from app_server.helpers import sanitize_dataset_file_name, sanitize_reserving_class_folder

INDEX_FILE_NAME = "method_index.json"
DFM_METHOD_TYPE = "DFM"


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


def _data_dir(project_name: str) -> str:
    return os.path.join(_require_project_dir(project_name), config.PROJECT_DATA_DIR, config.MANUAL_DATA_DIR)


def _reserving_class_dir(project_name: str, reserving_class: str) -> str:
    rc_part = sanitize_reserving_class_folder(reserving_class, "ReservingClass")
    return os.path.join(_data_dir(project_name), rc_part)


def _index_path(project_name: str, reserving_class: str) -> str:
    return os.path.join(_reserving_class_dir(project_name, reserving_class), INDEX_FILE_NAME)


def _safe_read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _safe_load_required_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as err:
        raise HTTPException(422, f"DFM method JSON is invalid: {str(err)}")
    except OSError as err:
        raise HTTPException(500, f"Failed to read DFM method JSON: {str(err)}")
    if not isinstance(data, dict):
        raise HTTPException(422, "DFM method JSON must be an object.")
    return data


def _method_json_path(project_name: str, reserving_class: str, method_name: str) -> str:
    rc_dir = _reserving_class_dir(project_name, reserving_class)
    name_part = sanitize_dataset_file_name(method_name, "Name")
    return os.path.join(rc_dir, f"DFM@{name_part}.json")


def _json_tab(source: Dict[str, Any], key: str) -> Dict[str, Any]:
    value = source.get(key) if isinstance(source, dict) else None
    return value if isinstance(value, dict) else {}


def _number_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def _selected_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = _clean_text(value).lower()
    return text in {"1", "true", "yes", "y", "selected"}


def _parse_dev_month(label: Any) -> float | None:
    nums = [
        float(match.group(0))
        for match in re.finditer(r"\d*\.?\d+", str(label or ""))
        if match.group(0)
    ]
    if not nums:
        return None
    return nums[-1]


def _matrix_width(matrix: Any) -> int:
    if not isinstance(matrix, list):
        return 0
    width = 0
    for row in matrix:
        if isinstance(row, list):
            width = max(width, len(row))
    return width


def _method_parts_from_filename(filename: str) -> tuple[str, str] | None:
    if not filename.startswith("DFM@") or not filename.endswith(".json"):
        return None
    stem = filename[:-5]
    parts = stem.split("@")
    if len(parts) < 2:
        return None
    method_name = "@".join(parts[1:]).strip()
    if not method_name:
        return None
    return "", method_name


def _method_entry(path: str, filename: str) -> Dict[str, Any] | None:
    if not _method_parts_from_filename(filename):
        return None
    payload = _safe_load_required_json(path)
    details_tab = _json_tab(payload, "details tab")
    dataset_name = _clean_text(details_tab.get("output type"))
    if not dataset_name:
        return None
    return {
        "dataset_name": dataset_name,
        "method_type": DFM_METHOD_TYPE,
    }


def _is_current_index(data: Dict[str, Any]) -> bool:
    methods = data.get("methods") if isinstance(data, dict) else None
    if not isinstance(methods, list):
        return False
    for item in methods:
        if not isinstance(item, dict):
            return False
        keys = set(item.keys())
        if keys != {"dataset_name", "method_type"}:
            return False
    return True


def rebuild_index(project_name: str, reserving_class: str) -> Dict[str, Any]:
    project = _clean_text(project_name)
    rc = _clean_text(reserving_class)
    if not rc:
        raise HTTPException(400, "reserving_class is required.")
    rc_dir = _reserving_class_dir(project, rc)
    os.makedirs(rc_dir, exist_ok=True)
    methods: List[Dict[str, Any]] = []
    try:
        for filename in os.listdir(rc_dir):
            path = os.path.join(rc_dir, filename)
            if not os.path.isfile(path):
                continue
            entry = _method_entry(path, filename)
            if not entry:
                continue
            methods.append(entry)
    except OSError as err:
        raise HTTPException(500, f"Failed to scan DFM methods: {str(err)}")

    methods.sort(key=lambda item: (
        str(item.get("dataset_name") or "").lower(),
        str(item.get("method_type") or "").lower(),
    ))
    data = {
        "methods": methods,
    }
    temp_path = f"{_index_path(project, rc)}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(temp_path, _index_path(project, rc))
    except OSError as err:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise HTTPException(500, f"Failed to write method index: {str(err)}")
    return data


def get_index(project_name: str, reserving_class: str, refresh: bool = False) -> Dict[str, Any]:
    project = _clean_text(project_name)
    rc = _clean_text(reserving_class)
    if not rc:
        raise HTTPException(400, "reserving_class is required.")
    path = _index_path(project, rc)
    if refresh or not os.path.exists(path):
        return rebuild_index(project, rc)
    data = _safe_read_json(path)
    if not data or not _is_current_index(data):
        return rebuild_index(project, rc)
    return data


def get_percent_developed_curve(project_name: str, reserving_class: str, method_name: str) -> Dict[str, Any]:
    project = _clean_text(project_name)
    path = _method_json_path(project, reserving_class, method_name)
    if not os.path.exists(path):
        raise HTTPException(
            404,
            (
                "DFM instance not found for project "
                f"'{project}', path '{_clean_text(reserving_class)}', method '{_clean_text(method_name)}'."
            ),
        )

    payload = _safe_load_required_json(path)
    data_tab = _json_tab(payload, "data tab")
    ratios_tab = _json_tab(payload, "ratios tab")
    ratio_triangle = _json_tab(ratios_tab, "ratio triangle")
    average = _json_tab(ratios_tab, "average formulas")
    data_labels = data_tab.get("development labels")
    data_labels = data_labels if isinstance(data_labels, list) else []
    ratio_labels = ratio_triangle.get("development labels")
    ratio_labels = ratio_labels if isinstance(ratio_labels, list) else []
    formulas = average.get("label")
    selected = average.get("selected")
    values = average.get("values")
    formulas = formulas if isinstance(formulas, list) else []
    selected = selected if isinstance(selected, list) else []
    values = values if isinstance(values, list) else []
    col_count = max(len(data_labels), len(ratio_labels), _matrix_width(selected), _matrix_width(values))
    if not col_count or not formulas or not selected or not values:
        raise HTTPException(422, "DFM instance does not contain average formula selections and values.")

    selected_values: List[float | None] = [None] * col_count
    selected_formula_labels: List[str] = [""] * col_count
    for col in range(col_count):
        selected_row_index = -1
        for row_index, row in enumerate(selected):
            if isinstance(row, list) and col < len(row) and _selected_value(row[col]):
                selected_row_index = row_index
                break
        if selected_row_index < 0:
            continue
        row_values = values[selected_row_index] if selected_row_index < len(values) else []
        value = row_values[col] if isinstance(row_values, list) and col < len(row_values) else None
        parsed = _number_or_none(value)
        if parsed is None:
            continue
        selected_values[col] = parsed
        selected_formula_labels[col] = str(formulas[selected_row_index] if selected_row_index < len(formulas) else "")

    cumulative_values: List[float | None] = [None] * col_count
    running: float | None = None
    for col in range(col_count - 1, -1, -1):
        selected_value = selected_values[col]
        if selected_value is None:
            running = None
            continue
        if col == col_count - 1:
            running = selected_value
        elif running is not None:
            running = selected_value * running
        else:
            running = None
            continue
        cumulative_values[col] = round(running, 6)

    points: List[Dict[str, Any]] = []
    for col, cumulative_value in enumerate(cumulative_values):
        if cumulative_value is None or cumulative_value == 0:
            continue
        label = str(ratio_labels[col] if col < len(ratio_labels) else f"Dev {col + 1}")
        x_label = data_labels[col] if col < len(data_labels) else label
        month = _parse_dev_month(x_label)
        if month is None:
            continue
        points.append({
            "x": month,
            "y": round(1 / cumulative_value, 6),
            "label": label,
            "col": col,
            "formula": selected_formula_labels[col],
        })

    points.sort(key=lambda item: float(item.get("x") or 0))
    if not points:
        raise HTTPException(422, "DFM instance did not contain enough % Developed values to plot.")
    return {
        "ok": True,
        "project_name": project,
        "reserving_class": _clean_text(reserving_class),
        "method_name": _clean_text(method_name),
        "points": points,
    }
