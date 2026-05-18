# App Server Domain: DFM Method Index

## Purpose
<!-- MANUAL:BEGIN -->
DFM method index routes maintain a project-scoped cache of existing local DFM method JSON files so the DFM Details `Name` selector can list names for the currently selected Reserving Class path without scanning the project data folders from the UI.
<!-- MANUAL:END -->

## Entry Points
<!-- MANUAL:BEGIN -->
Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dfm/method-index?project_name=<name>&refresh=false` | Return the cached DFM method index for a project, rebuilding it if the cache file is missing or `refresh=true`. |
| `GET` | `/dfm/percent-developed-curve?project_name=<name>&reserving_class=<path>&method_name=<name>` | Read the matching local DFM method JSON from a project and return computed `% Developed` curve points for prior-project comparison overlays. |
| `POST` | `/dfm/method-index/refresh` | Rebuild the project DFM method index after a DFM method save or an explicit chooser refresh. |
<!-- MANUAL:END -->

## Key Files
<!-- MANUAL:BEGIN -->
- `app_server/api/dfm_method_index_router.py` - Thin API routes.
- `app_server/schemas/dfm_method_index.py` - Refresh request schema.
- `app_server/services/dfm_method_index_service.py` - Project path resolution, reserving-class data-folder scan, filename parsing, and cache write.
- `ui/dfm/dfm_details.js` - Details `Name` selector UI that consumes the index.
- `ui/dfm/dfm_startup_state.js` - Last-opened DFM object project-user preference state and index refresh helper.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Cache file path: `projects/<project>/data/dfm_method_index.json`.
- Indexed method files must match local DFM method storage: `projects/<project>/data/<ReservingClassFolder>/DFM@<Name>.json`.
- The index stores only method entries with `path` and `name`. `path` is the filename-safe Reserving Class folder under `data`, and `name` is the DFM method name component.
- Normal DFM saves request an index refresh for the current project after the JSON file is written, so newly created DFM objects are available in the Details `Name` selector.
- `% Developed` curve lookup is read-only. It uses the same local DFM filename convention, reads `data tab`.`development labels` for x-axis month indexes, reads `ratios tab`.`ratio triangle`.`development labels` for displayed ratio period labels, reads `ratios tab`.`average formulas`.`selected` and `values`, derives selected/cumulative/% developed values, and returns only plot points and request metadata. Missing or incomplete DFM methods return explicit API errors so the frontend does not add a comparison line.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Filename parsing assumes the local DFM method filename convention. If method filenames are renamed, update the parser and chooser together.
- The cache lives in the shared project data folder; locked or inaccessible project folders surface as API errors in the chooser status area.
<!-- MANUAL:END -->
