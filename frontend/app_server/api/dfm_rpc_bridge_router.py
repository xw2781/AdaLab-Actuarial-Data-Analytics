from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app_server.schemas.dfm_rpc_bridge import (
    DfmRpcBridgeApplyRequest,
    DfmRpcBridgeKeepLocalRequest,
    DfmRpcBridgeRequest,
    DfmRpcBridgeUpdateRemoteRequest,
)
from app_server.services import dfm_rpc_bridge_service

router = APIRouter()


@router.post("/dfm/rpc-bridge/sync")
def sync_dfm_rpc_bridge(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    return dfm_rpc_bridge_service.send_sync_request(req)


@router.post("/dfm/rpc-bridge/compare")
def compare_dfm_rpc_bridge(req: DfmRpcBridgeRequest) -> Dict[str, Any]:
    return dfm_rpc_bridge_service.compare(req)


@router.post("/dfm/rpc-bridge/apply")
def apply_dfm_rpc_bridge(req: DfmRpcBridgeApplyRequest) -> Dict[str, Any]:
    return dfm_rpc_bridge_service.apply_remote_to_local(req)


@router.post("/dfm/rpc-bridge/keep-local")
def keep_local_dfm_rpc_bridge(req: DfmRpcBridgeKeepLocalRequest) -> Dict[str, Any]:
    return dfm_rpc_bridge_service.keep_local(req)


@router.post("/dfm/rpc-bridge/update-remote")
def update_remote_dfm_rpc_bridge(req: DfmRpcBridgeUpdateRemoteRequest) -> Dict[str, Any]:
    return dfm_rpc_bridge_service.update_remote(req)
