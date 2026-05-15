"""Migration helper for legacy reserve-review notebooks."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .client import ArcRhoClient
from .exceptions import ArcRhoApiError
from .project import Project
from .reserving_class import ReservingClass


class ArcRhoSession:
    """Context-bound helper that mimics legacy notebook access style."""

    def __init__(self, server_root: str | Path, *, read_only: bool = False) -> None:
        self.client = ArcRhoClient(server_root, read_only=read_only)
        self._project: Project | None = None
        self._reserving_class: ReservingClass | None = None

    def set_project(self, name: str) -> Project:
        self._project = self.client.project(name)
        self._reserving_class = None
        return self._project

    def set_reserving_class(self, path: str) -> ReservingClass:
        if self._project is None:
            raise ArcRhoApiError("set_project(...) must be called before set_reserving_class(...).")
        self._reserving_class = self._project.reserving_class(path)
        return self._reserving_class

    @property
    def project(self) -> Project:
        if self._project is None:
            raise ArcRhoApiError("No active project. Call set_project(...) first.")
        return self._project

    @property
    def reserving_class(self) -> ReservingClass:
        if self._reserving_class is None:
            raise ArcRhoApiError("No active reserving class. Call set_reserving_class(...) first.")
        return self._reserving_class

    def DFM(self, name: str):
        return self.reserving_class.dfm(name)

    def new_DFM(self, name: str, **details: Any):
        return self.reserving_class.new_dfm(name, **details)

