from __future__ import annotations

from pydantic import BaseModel, Field


class DfmRpcBridgeRequest(BaseModel):
    project_name: str = Field(..., min_length=1)
    reserving_class: str = Field(..., min_length=1)
    method_name: str = Field(..., min_length=1)
    output_vector: str = Field(..., min_length=1)
    input_triangle: str = Field(..., min_length=1)
    origin_length: int = Field(..., ge=1)
    development_length: int = Field(..., ge=1)
    decimal_places: int = Field(4, ge=0, le=6)
    timeout_sec: float = Field(8.0, gt=0)


class DfmRpcBridgeApplyRequest(DfmRpcBridgeRequest):
    pass


class DfmRpcBridgeKeepLocalRequest(DfmRpcBridgeRequest):
    pass


class DfmRpcBridgeUpdateRemoteRequest(DfmRpcBridgeRequest):
    pass
