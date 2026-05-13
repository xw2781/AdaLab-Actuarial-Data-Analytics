from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app_server.schemas.project_user_preferences import ProjectUserPreferencesUpdateRequest
from app_server.services import project_user_preferences_service

router = APIRouter()


@router.get("/project-user-preferences")
def get_project_user_preferences(project_name: str) -> Dict[str, Any]:
    return project_user_preferences_service.get_preferences(project_name)


@router.post("/project-user-preferences")
def update_project_user_preferences(req: ProjectUserPreferencesUpdateRequest) -> Dict[str, Any]:
    return project_user_preferences_service.update_preferences(req.project_name, req.data)
