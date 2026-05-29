from __future__ import annotations

from pydantic import BaseModel, Field


class DfmMethodIndexRefreshRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    reserving_class: str = Field(..., min_length=1)
