# Frontend: Dfm

## Purpose
<!-- MANUAL:BEGIN -->
DFM feature (details/ratios/results/notes) on top of dataset context, including method metadata in Details.
DFM Notes tab now reuses the shared `notes_editor_interactions.js` behavior layer (dataset-style path highlighting with a right-click file menu, `Tab`/`Shift+Tab` indentation, `Esc` to exit editing, spellcheck off, top whole-note display formatting toolbar for font family/size/color and bold/italic/underline/strikethrough) while preserving DFM's existing persistence/save flow in `dfm_persistence.js`; file paths render as deep-blue underlined non-bold text, right-clicking a rendered path shows `Open File` and `Copy File Path`, while focused the editor shows plain text only (rich/path-highlight layer hidden), toolbar interactions do not end editing mode, and rich rendering returns after focus leaves both the textarea and toolbar.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.dfm.entry_points -->
- `ui/dfm/dfm.html`: external scripts _none_; inline imports `/ui/dataset/dataset_main.js?v=2026022002`, `/ui/dfm/dfm_main.js?v=20260129165558`.

Detected `fetch(...)` targets in key JS files:
- `/arcrho/tri`
- `/dataset_types?project_name=${encodeURIComponent(projectName)}`
- `/template/default_dir`

Detected `arcrho:*` message types in key JS files:
- `arcrho:dfm-settings`
- `arcrho:dfm-tab-changed`
- `arcrho:status`
- `arcrho:update-active-tab-title`
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN frontend.dfm.key_files -->
- [`ui/dfm/dfm.html`](../../ui/dfm/dfm.html) - DFM container page with tab slots.
- [`ui/dfm/dfm_main.js`](../../ui/dfm/dfm_main.js) - DFM bootstrapping and orchestrator loader.
- [`ui/dfm/dfm_tabs_orchestrator.js`](../../ui/dfm/dfm_tabs_orchestrator.js) - DFM tabs orchestration and message handling.
- [`ui/dfm/dfm_details.js`](../../ui/dfm/dfm_details.js) - Details tab logic and title syncing.
- [`ui/dfm/dfm_ratios_tab.js`](../../ui/dfm/dfm_ratios_tab.js) - Ratios tab calculations and controls.
- [`ui/dfm/dfm_results_tab.js`](../../ui/dfm/dfm_results_tab.js) - Results table rendering and CSV export.
- [`ui/dfm/dfm_persistence.js`](../../ui/dfm/dfm_persistence.js) - DFM template/pattern persistence.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Exchanges `arcrho:*` messages with shell and workflow iframe.
- Reuses dataset APIs and reserving class selectors.
- DFM Data grid reuses shared dataset `#tableWrap` frame/border rendering (native square `border` stroke with no outline/pseudo overlay to keep corners stable and avoid border paint overlapping grid cells after table render at non-integer zoom/scaling).
- Shared dataset/DFM table keeps native smooth scrolling inside `#tableWrap`; after scroll idle, viewport position auto-snaps to nearest row/column grid boundaries to reduce sticky-header partial-overlap artifacts from sub-cell offsets.
- DFM Ratios tab now uses a dedicated framed scroll host (`#ratioWrapHost` -> `#ratioWrap`) so sticky headers/first-column overlays are contained within the ratio grid viewport instead of page-level scrolling.
- DFM Data tab now wraps `#tableWrap` inside `#tableWrapHost`, so shared dataset sticky header/first-column behavior remains pinned inside the table viewport during Data-tab scrolling.
- DFM Results tab table now shows per-origin columns in this order: `Latest <Input Triangle Name>` (latest observed value from DFM Data-tab triangle row), `Reserve` (`Ultimate - Latest`), and `Ultimate`; Results header cells allow wrapped text so long input triangle names are readable instead of truncating to one line.
- DFM Results tab adds a `Ratio Basis` selector above the table (typed input + `...` dataset picker window backed by shared `dataset_name_picker.js`). The picker/datalist now expose all dataset names from current-project `dataset_types` (including calculated and non-triangle/vector types), while Result-column extraction currently supports only `Triangle`/`Vector` selections; unsupported types show a clear error status. Results also includes a dedicated `Ultimate Ratio Decimals` input (default `2`) used only for the `Ultimate Ratio` percent column formatting. After selection, Results appends `Ratio Basis: <dataset>` and `Ultimate Ratio` columns after `Ultimate`; the ratio-basis column uses values from the selected dataset at the current DFM `Origin Length` basis (triangle basis datasets contribute the latest diagonal value per row), and `Ultimate Ratio = Ultimate / Ratio Basis`. Results also appends a `Total` row that sums numeric columns; `Ultimate Ratio` total is computed as `Total Ultimate / Total Ratio Basis`.
- DFM method save writes Results CSV under project `data` using ArcRhoTri-compatible naming: `ArcRhoTri@Path@DatasetName@Cumulative@False@False@OriginLength@DevelopmentLength.csv`; `DatasetName` uses Details `Name` and missing inputs fall back to ArcRhoTri defaults (`Cumulative=true`, lengths=`12`). When source period is Monthly/Quarterly, save also emits aggregated variants (Monthly -> Quarterly/Half-Year/Year, Quarterly -> Half-Year/Year) to support standard Dataset Viewer refresh at broader periods.
- DFM path bar includes a `Sync` button for the RPC bridge workflow. Clicking Sync prompts the user to save first when the current DFM tab is dirty, sends a backend `Function = DFM` request containing Details page fields plus `DataPath`, waits up to 8 seconds for the returned remote DFM JSON under `methods/RPC bridge`, then shows a taller draggable, resizable `Compare DFM Versions` window with local/remote `last modified` timestamps from the JSON plus Local/Remote Server cards without showing JSON file paths. Resizing the window also resizes the comparison cards, with snapshot content scrolling inside the cards when space is tight and the Notes preview expanding vertically from its 42px minimum height up to 300px when extra space is available, then scrolling inside the notes box instead of truncating long notes. The local version always appears on the left and the remote server version always appears on the right, with the source label in the card's top-left corner framed by a dark blue border and light blue fill. The newer card displays a `NEW` seal instead of a warning banner. Each version card snapshots the full ratio selection pattern as a masked triangle with rectangular cells that compact for large matrices; cells with value `2` outside the inferred active diagonal are masked, while value-`2` cells inside the active diagonal are shown with a light yellow fill for missing data. The active diagonal is inferred from the latest row containing data and that row's last non-`2` cell. Commonly excluded ratio cells are dark grey, exclusions added in the new version are green only on the new card, and exclusions removed from the old version are red only on the old card. The green `Newly excluded` legend appears only on the new card, the red `No longer excluded` legend appears only on the old card, and a yellow `Missing inside triangle` legend appears only when those cells exist. Hovering a ratio cell shows the same origin/development labels used by the Ratios triangle table. Notes snapshots compare the full `notes` text, highlight deleted old-version text with a red background, and highlight newly added new-version text with a green background. Selecting `Keep Using Local` keeps the local JSON unchanged and deletes the remote RPC JSON without sending `Function = SyncDFM`; selecting the remote version overwrites the local method JSON and reloads the current DFM tab. After either version action is selected, the comparison window closes and a smaller same-style DFM Sync message box shows waiting/final status with short final messages; when not busy, the message box can also close with `Esc` or by clicking outside it. Equal `last modified` timestamps show `Local and remote are already in sync` with no primary action, and missing remote JSON is informational only.
- DFM template save is triggered from shell `File -> Save as Template` (relabel of `Save As...`) only when DFM `Details` tab is active; the Details page button `Save as Template` is removed.
- DFM Details page is organized into three framed sections to match the app style: `Object Path` (`Project`, `Reserving Class`), `Input & Output` (`Name`, `Output Vector`, `Input Triangle`), and `Method Settings` (remaining DFM settings such as lengths/decimal places). The `Load Settings From Template` action is placed at the bottom-right of the Details page (outside the framed sections). The Details form content also uses added top spacing.
- Shared dataset/DFM table shows light square arrow buttons with minimal SVG icons at scrollbar ends in the Data grid viewport; each click advances one grid unit (one row or one data column), with disabled states at scroll boundaries.
- Shared dataset/DFM table renderer always displays all `values` columns; when development header labels are fewer than data columns, remaining header cells are intentionally blank rather than truncating tail data.
- Shared dataset/DFM table uses a single thin grid divider between the last data row and `Total` footer row (avoids doubled/thick separator rendering), and when `Total` is hidden the last body row keeps its bottom grid border so the bottom grid remains visible.
- Shared dataset/DFM table hides the `Total` footer row when current Dataset Type `Formula` (from `dataset_types`) contains `*` or `/`.
- Shared dataset input layer validates selected Dataset Type dependency resolvability (project `dataset_types` formulas + direct Dataset entries in `field_mapping`) before generation requests; when dependency resolution fails, it performs an ArcRhoTri-style `/arcrho/tri/precheck` local CSV existence check and allows refresh only if that local CSV is already present, otherwise unresolved prerequisites still trigger a blocking popup/status message. In this fallback path, clear-cache refresh is blocked and execution is limited to local-CSV-only load attempts.
- Shared dataset input/status layer does not append Dataset Type `Formula` to app status text; after successful dataset render, status is `Ready`.
- Shared Dataset Type picker `Picker Preferences` (`Double Click to Select`, `Close Window after Selection`) are stored as user-global APPDATA preferences via `/scripting/preferences` and apply across projects.
- Reserving Class tree picker highlights only one active node at a time: the deepest visible node on the active path (if deeper levels are collapsed, highlight falls back to the nearest visible ancestor), and shows the selected path text in the picker title (fallback title remains `Reserving Class` when no path is selected).
- Shared reserving-class path normalization preserves literal `/` characters inside a class name; only `\` is treated as the path segment delimiter.
- Reads `/dataset_types?project_name=...` to drive the Details `Output Vector` picker (filtered to `Data Format = Vector`, including calculated datasets).
- Reads `/dataset_types?project_name=...` to drive the `Input Triangle` picker (filtered to `Data Format = Triangle`, including calculated datasets).
- DFM `Output Vector` and `Input Triangle` `...` buttons now reuse the shared `dataset_name_picker.js` window picker with DFM-specific dataset-format filters (`Vector`/`Triangle`) while including calculated datasets; the existing typed dropdown behavior remains available on the inputs themselves and now matches the same inclusion rule. The shared picker also includes header-level `Name Search`, `Data Format`, `Category`, and `Calculated` filter popups to narrow large dataset lists without changing DFM-specific save/load behavior. In the shared picker, long `Name` values wrap within the first column instead of truncating, header column widths reserve space for sort/filter controls so labels remain readable, sort direction indicators use filled SVG triangles to match Project Settings table semantics, internal column boundaries can be drag-resized from the header grid lines (the dragged left column changes width while the last column auto-compensates to keep total table width constant), the `Calculated` column renders disabled checkboxes in rows (while its filter options remain `Yes` / `No`), titlebar tools include a category-group collapse/expand toggle plus `Clear all filters` (left of picker preferences), the picker opens at an initial height of about two-thirds of the host app viewport height, and the picker window's resize max bounds are refreshed when the host app window is resized so enlarging the app window also expands the picker's available resize range (vertical resize max is based on host-window height, not the picker's current top position). During dragging, the picker may move beyond the host window's left/right/bottom edges (top edge remains constrained so the title bar stays reachable). `Data Format`/`Category`/`Calculated` filter popups use `(All)` as the explicit no-filter state (default = only `(All)` checked), clicking a specific option clears `(All)`, clicking `(All)` clears specific checks, and right-clicking an option row inverts all non-`(All)` selections.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Persists ratio selection/templates via DFM persistence modules.
- Tracks dirty flags and active DFM tab state.
- Caches eligible output-type names per project for the Details picker and enforces selection-only input.
- Selecting a Details `Output Vector` auto-synchronizes the Details `Name` field to the same string.
- Details `Output Vector` supports type-to-filter dropdown search; empty input shows all available output-vector options.
- During async project-scoped `Output Vector` option refresh/load (for example immediately after page refresh with prefilled Project), the picker does not clear the field while the `Output Vector` input is actively focused/being typed in.
- Reuses shared dataset input boot logic (`dataset_main.js`) to restore last Project + Reserving Class defaults from APPDATA when no scoped/query/workflow values are available.
- For new DFM pages, `Name`, `Output Vector`, and `Input Triangle` start empty instead of prefilled defaults.
- DFM method JSON identity/save naming uses `projects/<project>/methods/DFM@<ReservingClass>@<Name>.json`; within a project/reserving-class pair, the DFM `Name` is the sole instance identity and must be unique. A single Name cannot represent multiple DFM instances with different period lengths or input triangles. The project is represented by the containing folder, not repeated in the JSON filename. The `ReservingClass` filename component replaces Windows-invalid filename characters with `^`.
- DFM no longer creates, reads, updates, or deletes `dfm_method_names.json` or the browser-local cached DFM Name key; local method lookup uses only the current Details fields and the standard local DFM JSON path.
- DFM method JSON save/load persists the selected Results `Ratio Basis` dataset name (`ratio basis dataset`) so reopening the same DFM method restores the Ratio Basis selection automatically.
- DFM method JSON also persists Details `Name` (`name`), `Output Vector` (`output type`), `Input Triangle` (`input triangle`), Origin Length (`origin length`), and Development Length (`development length`) and restores them on local method load; users may manually change these Details inputs afterward and the changes follow normal DFM dirty/save behavior.
- While DFM loads saved local method settings, the page shows a centered `Loading DFM Settings` popup using the same spinner/card style as Dataset loading and hides it after the JSON read/apply finishes.
- DFM Details `Decimal Places` (default `4`) controls ratio number formatting across the Ratios tab display (main ratio grid, summary/selected rows, and ratio chart labels/tooltips) and is persisted in DFM method JSON as `decimal places` so reopening the method restores the same Ratios formatting.
- DFM method JSON also persists the Results tab `Ultimate Ratio Decimals` control as `ultimate ratio decimal places` (default `2`) so reopening the method restores `Ultimate Ratio` percentage formatting independently of Ratios-page decimal formatting.
- DFM method JSON persists the ratio selection matrix under `ratio pattern`, persists ratio-tooltip labels under `origin labels` and `development labels`, persists the Results output under `ultimate vector`, writes average-selection formulas under the canonical `average formulas` key, and records GUI save time under `last modified`.
- DFM method/template JSON persists the average formula row list under `summary rows`; `summary hidden` is not used. The average formula table delete action is disabled when only one row remains, so the table always keeps at least one row.
- When loading DFM JSON from RPC/template/local method payloads, DFM can infer standard average formula rows from `average formulas` labels when `summary rows` contains only hard-coded `User Entry` rows. Supported inferred labels are `Volume - all`, `Volume - <n>`, `Simple - all`, `Simple - <n>`, and the same labels with `Ex hi/lo` or `Ex hi/lo x<n>` suffixes; unresolved labels are skipped.
- DFM template files use `.arc-dfm` extension only (`DFM_Template@<Project>@<ReservingClass>.arc-dfm`); legacy `.arcdfm` suffix is not accepted.
- After required Details inputs are all populated, DFM checks whether the instance JSON exists at the standard local save path; if missing, it does not show the former inline warning/`Confirm` action beside `Name` (new-object guidance is status-bar only).
- On the same local instance-file lookup, once DFM Details has committed values for `Project`, `Reserving Class`, and `Name`, DFM automatically checks for a matching local method JSON. If found, it auto-loads the file and reports the loaded file path in the status bar. If not found, it reports a yellow status-bar warning (via shell status `tone=warn`) with the exact text `This method object has not been created yet, changes will be saved to a new container.` The lookup does not wait for `Input Triangle` / `Output Vector` / period lengths.
- Details `Input Triangle`, `Origin Length`, and `Development Length` are saved properties of the current DFM instance, not local instance lookup keys; changing them marks the current DFM dirty and follows the normal dataset refresh behavior without reloading a different local method JSON.
- DFM Details `Name` is a plain text input; it no longer has a saved-name dropdown or delete action.
- Temporary debug aid: DFM local-method lookup currently emits short status-bar debug messages (for trigger/skip/checking-path) prefixed with `Debug: DFM local method lookup ...` to help verify the frontend lookup flow during Details input changes.
- DFM local-method lookup scheduling is debounced and reason-coalesced; higher-priority `details-change` lookups are not downgraded by later `tab-activated` triggers (avoids false `dirty + tab-activated` skips immediately after Details edits).
- Shell tab activation/state-request messages refresh DFM edit-state reporting only; they do not trigger local method lookup or the DFM settings loading popup.
- Existence checks run on committed input changes (`change`/selection/blur`) rather than every typing keystroke.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add a DFM tab capability: update orchestrator + tab module.
2. Modify ratio/result behavior: sync `dfm_ratios_tab.js` and `dfm_results_tab.js`.
3. Adjust Details output-type rules: update filter logic in `dfm_details.js` and keep workflow DFM settings compatibility.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Cross-tab sync is message-driven and easy to desynchronize.
- Persistence schema changes can break saved templates.
- If dataset type definitions drift from expected columns, Details output-type options may appear empty.
<!-- MANUAL:END -->
