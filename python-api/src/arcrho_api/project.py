"""Project object implementation."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from .exceptions import ProjectNotFoundError
from .io import read_json, write_json_atomic
from .models import DfmMethodRef, ProjectSettings
from .paths import DFM_INDEX_FILE_NAME, clean_text, dfm_filename, parse_dfm_filename, project_dir_case_insensitive

if TYPE_CHECKING:
    from .client import ArcRhoClient
    from .dfm import DfmMethod
    from .reserving_class import ReservingClass


class Project:
    """ArcRho project folder under an ArcRho Server root."""

    def __init__(self, client: "ArcRhoClient", name: str) -> None:
        self.client = client
        self.name = clean_text(name)
        self.path = self._require_path()
        self.methods_dir = self.path / "methods"
        self.data_dir = self.path / "data"
        self.users_dir = self.path / "users"

    def _require_path(self) -> Path:
        project_path = project_dir_case_insensitive(self.client.projects_dir, self.name)
        if project_path is None:
            raise ProjectNotFoundError(f"Project folder not found under projects: {self.name}")
        return project_path

    @property
    def read_only(self) -> bool:
        return self.client.read_only

    def settings(self) -> ProjectSettings:
        general_path = self.path / "general_settings.json"
        general: dict[str, Any] = {}
        if general_path.exists():
            general = read_json(general_path)
        return ProjectSettings(project_name=self.name, project_path=self.path, general_settings=general)

    def reload_settings(self) -> ProjectSettings:
        return self.settings()

    def reserving_class(self, path: str) -> "ReservingClass":
        from .reserving_class import ReservingClass

        return ReservingClass(self, path)

    def dfm(self, reserving_class: str, name: str) -> "DfmMethod":
        return self.reserving_class(reserving_class).dfm(name)

    def new_dfm(self, reserving_class: str, name: str, **details: Any) -> "DfmMethod":
        return self.reserving_class(reserving_class).new_dfm(name, **details)

    def dfm_exists(self, reserving_class: str, name: str) -> bool:
        return self.dfm_path(reserving_class, name).exists()

    def dfm_path(self, reserving_class: str, name: str) -> Path:
        return self.methods_dir / dfm_filename(reserving_class, name)

    def list_dfm_methods(self, refresh: bool = False) -> list[DfmMethodRef]:
        if refresh:
            return self.rebuild_dfm_index()
        if not self.methods_dir.exists():
            return []
        refs: list[DfmMethodRef] = []
        for path in self.methods_dir.iterdir():
            if not path.is_file():
                continue
            parsed = parse_dfm_filename(path.name)
            if parsed is None:
                continue
            reserving_class, method_name = parsed
            refs.append(DfmMethodRef(path=reserving_class, name=method_name, file_path=path))
        refs.sort(key=lambda item: (item.path.lower(), item.name.lower()))
        return refs

    def rebuild_dfm_index(self) -> list[DfmMethodRef]:
        refs = self.list_dfm_methods(refresh=False)
        payload = {
            "methods": [
                {
                    "path": item.path,
                    "name": item.name,
                }
                for item in refs
            ]
        }
        write_json_atomic(self.methods_dir / DFM_INDEX_FILE_NAME, payload, read_only=self.read_only)
        return refs

