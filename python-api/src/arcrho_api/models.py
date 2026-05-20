"""Small public data models."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DfmMethodRef:
    """Reference to a DFM method stored under a project."""

    path: str
    name: str
    file_path: Path


@dataclass(frozen=True)
class DatasetTypeInfo:
    """Project dataset-type table row."""

    name: str
    data_format: str = ""
    category: str = ""
    calculated: bool = False
    formula: str = ""
    source: str = ""


@dataclass(frozen=True)
class ProjectSettings:
    """Project-level settings loaded from known ArcRho JSON files."""

    project_name: str
    project_path: Path
    general_settings: dict[str, Any] = field(default_factory=dict)
