# App Server Domain: DFM Method Index

## Purpose
<!-- MANUAL:BEGIN -->
DFM method index routes maintain a project-scoped cache of existing local DFM method JSON files so the DFM startup chooser can browse existing objects without scanning the methods folder from the UI.
<!-- MANUAL:END -->

## Entry Points
<!-- MANUAL:BEGIN -->
Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dfm/method-index?project_name=<name>&refresh=false` | Return the cached DFM method index for a project, rebuilding it if the cache file is missing or `refresh=true`. |
| `POST` | `/dfm/method-index/refresh` | Rebuild the project DFM method index after a DFM method save or an explicit chooser refresh. |
<!-- MANUAL:END -->

## Key Files
<!-- MANUAL:BEGIN -->
- `app_server/api/dfm_method_index_router.py` - Thin API routes.
- `app_server/schemas/dfm_method_index.py` - Refresh request schema.
- `app_server/services/dfm_method_index_service.py` - Project path resolution, methods-folder scan, filename parsing, JSON detail extraction, and cache write.
- `ui/dfm/dfm_startup_dialog.js` - Startup chooser UI that consumes the index.
- `ui/dfm/dfm_startup_state.js` - Last-opened DFM object project-user preference state and index refresh helper.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Cache file path: `projects/<project>/methods/dfm_method_index.json`.
- Indexed method files must match local DFM method naming: `DFM@<ReservingClass>@<Name>.json`.
- The index groups methods by reserving class and includes Details-tab fields when present: method name, output vector, input triangle, origin/development lengths, decimal places, and timestamps.
- Normal DFM saves request an index refresh for the current project after the JSON file is written, so newly created DFM objects are available in the next startup selector.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Filename parsing assumes the local DFM method filename convention. If method filenames are renamed, update the parser and chooser together.
- The cache lives in the shared project methods folder; locked or inaccessible project folders surface as API errors in the chooser status area.
<!-- MANUAL:END -->
