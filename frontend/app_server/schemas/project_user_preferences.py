from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field


class ProjectUserPreferencesUpdateRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    data: Dict[str, Any] = Field(default_factory=dict)
