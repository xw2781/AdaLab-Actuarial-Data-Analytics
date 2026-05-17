from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class DebugTraceAppendRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=80)
    session_id: str = Field(..., min_length=1, max_length=120)
    project_name: str = ""
    events: List[Dict[str, Any]] = Field(default_factory=list)
