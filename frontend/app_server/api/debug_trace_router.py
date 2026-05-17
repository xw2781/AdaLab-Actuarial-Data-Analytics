from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app_server.schemas.debug_trace import DebugTraceAppendRequest
from app_server.services import debug_trace_service

router = APIRouter()


@router.post("/debug_trace")
def append_debug_trace(req: DebugTraceAppendRequest) -> Dict[str, Any]:
    return debug_trace_service.append_debug_trace(
        source=req.source,
        session_id=req.session_id,
        project_name=req.project_name,
        events=req.events,
    )
