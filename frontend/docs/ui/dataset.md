# Frontend: Dataset

## Purpose
<!-- MANUAL:BEGIN -->
Dataset editing and analysis page used inside shell tabs.
It owns the Dataset workflow across Details, Data, Chart, Notes, and Audit Log views, with `Data` as the default tab.
The page validates Project Name, Reserving Class, and Dataset Type before running ArcRhoTri, renders/caches the resulting triangle data, and publishes status/history updates back to the shell.
Dataset Notes uses the shared notes editor behavior: detected file paths render as underlined links when not editing, and right-clicking a rendered path opens a small menu with `Open File` and `Copy File Path`.
Implementation details should stay in the generated entrypoint/key-file sections or the focused behavior sections below, not in this overview.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.dataset.entry_points -->
- `ui/dataset/dataset_viewer.html`: external scripts _none_; inline imports `/ui/dataset/dataset_main.js?v=2026022002`, `/ui/dataset/dataset_shared.js`.

Detected `fetch(...)` targets in key JS files:
- `${config.API_BASE}/dataset/${dsId}/patch`
- `${config.API_BASE}/dataset/${dsId}?start_year=${encodeURIComponent(startYear)}`
- `${config.API_BASE}/dataset/notes/load`
- `${config.API_BASE}/dataset/notes/save`
- `${config.API_BASE}/excel/active_selection`
- `${config.API_BASE}/excel/open_workbook`
- `${config.API_BASE}/excel/read_cell`
- `${config.API_BASE}/excel/read_cells_batch`
- `${config.API_BASE}/excel/wait_for_enter`
- `/arcrho/tri/precheck`

Detected `arcrho:*` message types in key JS files:
- `arcrho:browsing-history-updated`
- `arcrho:close-active-tab`
- `arcrho:close-shell-menus`
- `arcrho:dataset-settings-changed`
- `arcrho:hotkey`
- `arcrho:status`
- `arcrho:update-active-tab-title`
- `arcrho:zoom`
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN frontend.dataset.key_files -->
- [`ui/dataset/dataset_viewer.html`](../../ui/dataset/dataset_viewer.html) - Dataset page HTML entrypoint.
- [`ui/dataset/dataset_main.js`](../../ui/dataset/dataset_main.js) - Dataset grid, calculations, and API calls.
- [`ui/dataset/dataset_shared.js`](../../ui/dataset/dataset_shared.js) - Shared dataset markup helpers.
- [`ui/dataset/dataset_shared.css`](../../ui/dataset/dataset_shared.css) - Shared dataset/DFM visual styles.
- [`ui/shared/api.js`](../../ui/shared/api.js) - Client wrappers for dataset endpoints.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Calls app-server dataset/arcrho endpoints plus valid-value list endpoints (`/dataset_types`, `/reserving_class_*`, `/arcrho/projects`).
- Uses `/scripting/preferences` to persist and restore the last resolved Project + Reserving Class pair in APPDATA.
- Sends status/hotkey/close signals to parent shell.
- Publishes dataset input updates and browsing-history updates to shell via `arcrho:dataset-settings-changed` and `arcrho:browsing-history-updated`.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Uses in-page mutable state for active dataset and selection.
- Reads and caches valid value lists via `valid_value_list_provider.js` for:
  - project names from project map
  - dataset names by project
  - reserving class paths by project
- Reserving-class path normalization preserves literal `/` characters inside a class name; only `\` is treated as the segment delimiter for validation/history keys.
- Dataset-side reserving path list loading does not auto-crawl `/reserving_class_path_tree/children`; child-path hydration is opt-in to avoid background request storms.
- Caches reserving-class type names from `/reserving_class_types` and validates input paths by segment membership in the Name column.
- Reserving-class tree view toggle preferences (auto-expand/auto-close/double-click) are shared globally across projects.
- On project switch, current Reserving Class input is revalidated against the new project's reserving-class type names; valid paths are retained and invalid paths are cleared.
- Stores last resolved Project + Reserving Class defaults in APPDATA and reuses them as fallback when no scoped/query/workflow values exist.
- Persists last-viewed dataset inputs globally and restores them when opening a new Dataset tab.
- Stores latest browsing history entries via `browsing_history.js` (project + reserving class + dataset).
- Rejects invalid typed values on change/Enter and blocks ArcRhoTri requests until all 3 inputs are valid.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add a new app-server call: update fetch call and API wrappers.
2. Change table behavior: update `dataset_main.js` render + patch flow together.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Formula or patch changes can cause silent data drift.
- Endpoint mismatches break runtime flows without compile-time safety.
<!-- MANUAL:END -->
