"""Dataset / triangle data operations."""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app_server import config
from app_server.helpers import atomic_write_csv, sanitize_dataset_file_name, sanitize_reserving_class_folder


def make_annual_labels(start_year: int, n_origin: int, n_dev: int) -> Tuple[List[str], List[str]]:
    origin_labels = [str(start_year + i) for i in range(n_origin)]
    dev_labels = [str(12 * (j + 1)) for j in range(n_dev)]
    return origin_labels, dev_labels


def infer_shape(path: str) -> Tuple[int, int]:
    df = pd.read_csv(path, header=None)
    return int(df.shape[0]), int(df.shape[1])


def load_triangle_values(path: str) -> pd.DataFrame:
    return pd.read_csv(path, header=None, dtype="float64")


def triangle_mask(n_origin: int, n_dev: int) -> np.ndarray:
    r = np.arange(n_origin)[:, None]
    c = np.arange(n_dev)[None, :]
    return (c <= r)


def diagonal_indices(n_origin: int, n_dev: int, k: int = 0) -> List[Tuple[int, int]]:
    mask = triangle_mask(n_origin, n_dev)
    out = []
    for r in range(n_origin):
        c = r - k
        if 0 <= c < n_dev and mask[r, c]:
            out.append((r, c))
    return out


def list_datasets() -> List[Dict[str, Any]]:
    out = []
    for ds_id, path in config.DATASETS.items():
        if not os.path.exists(path):
            continue
        n_origin, n_dev = infer_shape(path)
        st = os.stat(path)
        out.append({
            "id": ds_id,
            "path": path,
            "shape": {"n_origin": n_origin, "n_dev": n_dev},
            "mtime": st.st_mtime,
        })
    return out


def get_dataset(ds_id: str, start_year: int = 2016) -> Dict[str, Any]:
    path = config.DATASETS.get(ds_id)
    if not path or not os.path.exists(path):
        return None

    df = pd.read_csv(path, header=None, dtype="float64", keep_default_na=True)
    n_origin, n_dev = df.shape

    origin_labels = [str(start_year + i) for i in range(n_origin)]
    dev_labels = [str(12 * (j + 1)) for j in range(n_dev)]

    values = df.to_numpy()
    mask = ~np.isnan(values)

    st = os.stat(path)
    return {
        "id": ds_id,
        "origin_labels": origin_labels,
        "dev_labels": dev_labels,
        "values": np.where(np.isnan(values), None, values).tolist(),
        "mask": mask.tolist(),
        "mtime": st.st_mtime,
    }


def get_diagonal(ds_id: str, k: int = 0, start_year: int = 2016) -> Dict[str, Any]:
    path = config.DATASETS.get(ds_id)
    if not path or not os.path.exists(path):
        return None

    df = load_triangle_values(path)
    n_origin, n_dev = df.shape
    origin_labels, dev_labels = make_annual_labels(start_year, n_origin, n_dev)

    idx = diagonal_indices(n_origin, n_dev, k=k)
    items = []
    for r, c in idx:
        v = df.iat[r, c]
        items.append({
            "r": r,
            "c": c,
            "origin": origin_labels[r],
            "dev": dev_labels[c],
            "value": None if pd.isna(v) else float(v),
        })

    return {"id": ds_id, "k": k, "items": items}


def _build_notes_dataset_id(project_name: str, reserving_class: str, dataset_name: str) -> str:
    _ = project_name
    ds_component = sanitize_dataset_file_name(dataset_name)
    return f"ArcRhoTriNotes@{ds_component}"


def _require_notes_fields(project_name: str, reserving_class: str, dataset_name: str) -> Tuple[str, str, str]:
    p = str(project_name if project_name is not None else "")
    rc = str(reserving_class if reserving_class is not None else "")
    ds = str(dataset_name if dataset_name is not None else "")
    if not p.strip() or not rc.strip() or not ds.strip():
        raise HTTPException(400, "project_name, reserving_class, and dataset_name are required.")
    return p, rc, ds


def _get_notes_file_path(project_name: str, reserving_class: str, dataset_id: str) -> str:
    try:
        data_dir = config.get_project_data_dir(project_name)
    except ValueError as err:
        raise HTTPException(404, str(err))
    rc_folder = sanitize_reserving_class_folder(reserving_class)
    return os.path.join(data_dir, rc_folder, f"{dataset_id}.json")


def load_dataset_notes(project_name: str, reserving_class: str, dataset_name: str) -> Dict[str, Any]:
    p, rc, ds = _require_notes_fields(project_name, reserving_class, dataset_name)
    dataset_id = _build_notes_dataset_id(p, rc, ds)
    path = _get_notes_file_path(p, rc, dataset_id)

    if not os.path.exists(path):
        return {
            "ok": True,
            "exists": False,
            "dataset_id": dataset_id,
            "project_name": p,
            "reserving_class": rc,
            "dataset_name": ds,
            "notes": "",
            "path": path,
        }

    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except PermissionError:
        raise HTTPException(423, "Notes file is locked or inaccessible.")
    except OSError as err:
        raise HTTPException(500, f"Failed to read notes file: {str(err)}")
    except json.JSONDecodeError as err:
        raise HTTPException(500, f"Invalid notes JSON format: {str(err)}")

    notes = payload.get("notes", "")
    return {
        "ok": True,
        "exists": True,
        "dataset_id": str(payload.get("dataset_id") or dataset_id),
        "project_name": str(payload.get("project_name") or p),
        "reserving_class": str(payload.get("reserving_class") or rc),
        "dataset_name": str(payload.get("dataset_name") or ds),
        "notes": str(notes if notes is not None else ""),
        "updated_at": str(payload.get("updated_at") or ""),
        "path": path,
    }


def save_dataset_notes(project_name: str, reserving_class: str, dataset_name: str, notes: str) -> Dict[str, Any]:
    p, rc, ds = _require_notes_fields(project_name, reserving_class, dataset_name)
    dataset_id = _build_notes_dataset_id(p, rc, ds)
    path = _get_notes_file_path(p, rc, dataset_id)
    data_dir = os.path.dirname(path)
    payload = {
        "dataset_id": dataset_id,
        "project_name": p,
        "reserving_class": rc,
        "dataset_name": ds,
        "notes": str(notes if notes is not None else ""),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }

    tmp_path = f"{path}.tmp"
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except PermissionError:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise HTTPException(423, "Notes file is locked or inaccessible.")
    except OSError as err:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise HTTPException(500, f"Failed to write notes file: {str(err)}")

    return {
        "ok": True,
        "dataset_id": dataset_id,
        "project_name": p,
        "reserving_class": rc,
        "dataset_name": ds,
        "notes": payload["notes"],
        "updated_at": payload["updated_at"],
        "path": path,
    }


def patch_dataset(ds_id: str, items: list, file_mtime: float = None) -> Dict[str, Any]:
    path = config.DATASETS.get(ds_id)
    if not path or not os.path.exists(path):
        return None

    st = os.stat(path)
    if file_mtime is not None and abs(st.st_mtime - file_mtime) > 1e-6:
        return {"conflict": True}

    df = load_triangle_values(path)
    n_origin, n_dev = df.shape
    mask = triangle_mask(n_origin, n_dev)

    applied = 0
    rejected: List[Dict[str, Any]] = []

    for it in items:
        r, c = it.r, it.c
        if r >= n_origin or c >= n_dev:
            rejected.append({"r": r, "c": c, "reason": "out_of_range"})
            continue
        if not mask[r, c]:
            rejected.append({"r": r, "c": c, "reason": "outside_triangle"})
            continue

        df.iat[r, c] = np.nan if it.value is None else float(it.value)
        applied += 1

    atomic_write_csv(df, path)
    st2 = os.stat(path)

    return {"ok": True, "applied": applied, "rejected": rejected, "mtime": st2.st_mtime}
