"""JSON IO helpers with explicit errors and atomic writes."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .exceptions import ArcRhoApiError, InvalidDfmJsonError, ReadOnlyError


def read_json(path: Path, *, required_object: bool = True) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as err:
        raise InvalidDfmJsonError(f"Invalid JSON in {path}: {err}") from err
    except OSError as err:
        raise ArcRhoApiError(f"Failed to read JSON file {path}: {err}") from err
    if required_object and not isinstance(data, dict):
        raise InvalidDfmJsonError(f"JSON file must contain an object: {path}")
    return data


def write_json_atomic(path: Path, data: dict[str, Any], *, read_only: bool = False) -> Path:
    if read_only:
        raise ReadOnlyError(f"Cannot write {path}; client is read-only.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(temp_path, path)
    except OSError as err:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise ArcRhoApiError(f"Failed to write JSON file {path}: {err}") from err
    return path

