# App Server Domain: debug_trace

## Purpose
<!-- MANUAL:BEGIN -->
Best-effort local debug trace logging for diagnosing UI startup and interaction timing.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN app_server.debug_trace.entry_points -->
| Method | Path | Handler | Request Model | Schema | Service Calls |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/debug_trace` | `append_debug_trace` | `DebugTraceAppendRequest` | [`app_server/schemas/debug_trace.py`](../../../app_server/schemas/debug_trace.py) | `debug_trace_service.append_debug_trace` |
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN app_server.debug_trace.key_files -->
- [`app_server/api/debug_trace_router.py`](../../../app_server/api/debug_trace_router.py) - Debug trace append route.
- [`app_server/services/debug_trace_service.py`](../../../app_server/services/debug_trace_service.py) - Local JSONL debug trace writer.
- [`app_server/schemas/debug_trace.py`](../../../app_server/schemas/debug_trace.py) - Debug trace append request schema.
- [`app_server/config.py`](../../../app_server/config.py) - AppData root path helper used for local debug logs.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Called by frontend pages when temporary diagnostics are needed.
- The project instance page uses it to record startup, fetch, and render timing.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Appends JSONL trace files under `%APPDATA%\ArcRho\debug_logs`.
- Trace writes do not affect project data or cache state.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add a new trace source: keep payloads small, sanitized, and best-effort.
2. Change log location: update `debug_trace_service.py` and docs together.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Debug logs may grow over time and can include endpoint URLs, timing metadata, and row counts.
<!-- MANUAL:END -->
