"""Reserving-class scoped API object."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .models import DfmMethodRef
from .paths import clean_text

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
        expected = self.path.lower()
        return [item for item in refs if item.path.lower() == expected]

