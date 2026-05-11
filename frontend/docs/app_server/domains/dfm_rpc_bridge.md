# App Server Domain: DFM RPC Bridge

## Purpose
<!-- MANUAL:BEGIN -->
DFM RPC bridge routes create request files for remote data-engine DFM method sync, compare local and returned remote DFM JSON `last modified` timestamps, apply newer remote JSON locally, and finalize keeping local JSON without sending a `SyncDFM` request.
<!-- MANUAL:END -->

## Entry Points
<!-- MANUAL:BEGIN -->
Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/dfm/rpc-bridge/sync` | Write `Function = DFM` request, wait up to the requested timeout for remote DFM JSON, and return comparison metadata plus local/remote JSON snapshots. |
| `POST` | `/dfm/rpc-bridge/compare` | Compare current local and remote DFM JSON file metadata without sending a request, returning the same snapshot fields. |
| `POST` | `/dfm/rpc-bridge/apply` | Copy the remote DFM JSON over the local DFM JSON after `Update Local DFM`, return payload for frontend reload, and delete the remote RPC JSON. |
| `POST` | `/dfm/rpc-bridge/keep-local` | Keep the local DFM JSON unchanged after `Keep Using Local` and delete the remote RPC JSON without writing a `SyncDFM` request. |
| `POST` | `/dfm/rpc-bridge/update-remote` | Write `Function = SyncDFM` request, wait for the `SyncDFM...json` status response, return pass/fail message, and delete the stale remote RPC JSON. |
<!-- MANUAL:END -->

## Key Files
<!-- MANUAL:BEGIN -->
- `app_server/api/dfm_rpc_bridge_router.py` - Thin API routes.
- `app_server/schemas/dfm_rpc_bridge.py` - Request schemas.
- `app_server/services/dfm_rpc_bridge_service.py` - Path resolution, request-file writes, wait/compare/apply/update-remote behavior.
- `ui/dfm/dfm_rpc_bridge_client.js` - Frontend route calls and sync flow.
- `ui/dfm/dfm_rpc_bridge_dialog.js` - Floating comparison/status UI.
- `ui/dfm/dfm_rpc_bridge_pathbar.js` - DFM path-bar Sync button.
<!-- MANUAL:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- `Function = DFM` request files contain Details page fields plus `DataPath`, where `DataPath` points to the expected returned remote DFM method JSON under `projects/<project>/methods/RPC bridge`.
- `Function = SyncDFM` request files contain the same Details page fields plus `DataPath`, where `DataPath` points to an expected `SyncDFM...json` status file.
- `SyncDFM` status JSON must include fields that let the frontend report final result, for example `ok`, `status`, and `message`.
- Compare responses include snapshots read from local and remote JSON files: `last modified`, ratio pattern dimensions/excluded count/full preview with `0`/`1`/`2` values preserved, preview `origin_labels` and `development_labels` for ratio-cell tooltips, average formula names, and notes preview.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Local DFM method JSON path: `projects/<project>/methods/DFM@<ReservingClass>@<Name>.json`.
- Remote DFM method JSON path: `projects/<project>/methods/RPC bridge/DFM@<ReservingClass>@<Name>@<OriginLength>@<DevelopmentLength>.json`.
- Remote update status JSON path: `projects/<project>/methods/RPC bridge/SyncDFM@<ReservingClass>@<Name>@<OriginLength>@<DevelopmentLength>.json`.
- Request files are kept for audit/debug. Returned RPC bridge JSON files are deleted after the user completes the final action.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Change DFM request-file contract: update schema/service, frontend client payloads, and this domain doc.
2. Change comparison actions: update `dfm_rpc_bridge_dialog.js`, `dfm_rpc_bridge_client.js`, and route behavior.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Request and return-path filename rules must match data-engine expectations exactly.
- Timestamp comparison uses the canonical `last modified` value inside each DFM JSON file.
- Sync waits are intentionally short; timeout handling must remain clear to users.
<!-- MANUAL:END -->
