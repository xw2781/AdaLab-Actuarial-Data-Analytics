"""Reserving-class scoped API object."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .exceptions import DfmDataError
from .models import DfmMethodRef
from .paths import clean_text, dataset_filename, sanitize_reserving_class_folder

if TYPE_CHECKING:
    from .dfm import DfmMethod
    from .project import Project


class ReservingClass:
    """Project-scoped reserving class path."""

    def __init__(self, project: "Project", path: str) -> None:
        self.project = project
        self.path = clean_text(path)

    @property
    def name(self) -> str:
        return self.path

    @property
    def read_only(self) -> bool:
        return self.project.read_only

    def dfm(self, name: str) -> "DfmMethod":
        from .dfm import DfmMethod

        return DfmMethod.load_existing(self, name)

    def new_dfm(self, name: str, **details: Any) -> "DfmMethod":
        from .dfm import DfmMethod

        return DfmMethod.new(self, name, **details)

    def dfm_exists(self, name: str) -> bool:
        return self.project.dfm_exists(self.path, name)

    def list_dfm_methods(self, refresh: bool = False) -> list[DfmMethodRef]:
        refs = self.project.list_dfm_methods(refresh=refresh)
        expected = sanitize_reserving_class_folder(self.path).lower()
        return [item for item in refs if item.path.lower() == expected]

    @property
    def data_dir(self) -> Path:
        return self.project.reserving_class_data_dir(self.path)

    def dataset_path(self, name: str) -> Path:
        wanted = dataset_filename(name)
        direct = self.data_dir / wanted
        if direct.exists():
            return direct
        wanted_lower = wanted.lower()
        if self.data_dir.exists():
            for item in self.data_dir.iterdir():
                if item.is_file() and item.name.lower() == wanted_lower:
                    return item
        return direct

    def dataset_exists(self, name: str) -> bool:
        return self.dataset_path(name).is_file()

    def list_datasets(self) -> list[str]:
        if not self.data_dir.exists():
            return []
        names = [item.stem for item in self.data_dir.iterdir() if item.is_file() and item.suffix.lower() == ".csv"]
        return sorted(names, key=str.lower)

    def read_dataset(self, name: str) -> list[list[Any]]:
        return _read_csv_matrix(self.dataset_path(name))

    def read_triangle(self, name: str) -> list[list[Any]]:
        return self.read_dataset(name)


def _parse_csv_cell(value: str) -> Any:
    text = str(value if value is not None else "").strip()
    if text == "":
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return text


def _read_csv_matrix(path: Path) -> list[list[Any]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            return [[_parse_csv_cell(cell) for cell in row] for row in csv.reader(fh)]
    except OSError as err:
        raise DfmDataError(f"Failed to read CSV file {path}: {err}") from err
