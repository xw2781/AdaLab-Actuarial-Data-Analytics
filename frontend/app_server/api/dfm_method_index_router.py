from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app_server.schemas.dfm_method_index import DfmMethodIndexRefreshRequest
from app_server.services import dfm_method_index_service

router = APIRouter()


@router.get("/dfm/method-index")
def get_dfm_method_index(project_name: str, refresh: bool = False) -> Dict[str, Any]:
    return dfm_method_index_service.get_index(project_name, refresh=refresh)


@router.post("/dfm/method-index/refresh")
def refresh_dfm_method_index(req: DfmMethodIndexRefreshRequest) -> Dict[str, Any]:
    return dfm_method_index_service.rebuild_index(req.project_name)
