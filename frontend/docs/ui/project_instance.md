# Frontend: Project Instance

## Purpose
<!-- MANUAL:BEGIN -->
Project instance workspace for browsing one project's reserving-class paths and dataset types.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.project_instance.entry_points -->
- `ui/project_instance/project_instance.html`: external scripts `/ui/project_instance/project_instance.js?v=20260521a`; inline imports _none_.

Detected `fetch(...)` targets in key JS files:
- `/reserving_class_combinations?project_name=${encodeURIComponent(projectName)}`
- `/reserving_class_filter_spec`
- `/reserving_class_filter_spec?project_name=${encodeURIComponent(projectName)}`
- `/reserving_class_hidden_paths`
- `/reserving_class_hidden_paths?project_name=${encodeURIComponent(projectName)}`
- `/reserving_class_types?project_name=${encodeURIComponent(projectName)}`

Detected `arcrho:*` message types in key JS files:
- `arcrho:set-zoom`
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN frontend.project_instance.key_files -->
- [`ui/project_instance/project_instance.html`](../../ui/project_instance/project_instance.html) - Project instance tab layout.
- [`ui/project_instance/project_instance.js`](../../ui/project_instance/project_instance.js) - Project instance path selector, dataset table, and in-tab dataset viewer windows.
- [`ui/dataset/dataset_viewer.html`](../../ui/dataset/dataset_viewer.html) - Reused dataset viewer page for floating dataset windows.
- [`ui/dataset/dataset_types_source.js`](../../ui/dataset/dataset_types_source.js) - Shared dataset type payload loader and normalizer.
- [`ui/shared/reserving_class_lazy_picker.js`](../../ui/shared/reserving_class_lazy_picker.js) - Shared reserving-class lookup, filter, shortcut, and favorite-folder picker.
- [`ui/shared/path_tree_picker.js`](../../ui/shared/path_tree_picker.js) - Shared path tree body renderer used by the embedded reserving-class picker.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Opened by shell as a `project_instance` iframe tab after Project Settings posts `arcrho:open-project-instance`.
- Calls shared dataset-types and reserving-class picker helpers.
- Embeds the same lazy reserving-class picker body used by Dataset/DFM/Workflow, so the project instance left panel loads the same hierarchy, filters, hidden-path preferences, Shortcut section, favorites, and user-defined favorite folders.
- The embedded reserving-class path tree uses tight horizontal padding with a small left inset and does not reserve two-sided scrollbar gutters, so more path text fits in the left panel.
- Project instance loading shows one centered page-level loading card with the same blue sweep spinner style used by Dataset loading while the reserving-class path tree and dataset table load.
- Embeds the existing Dataset Viewer page in draggable in-tab windows.
- Double-clicking a dataset that already has an open or hidden floating window activates or restores the existing window instead of creating a duplicate for the same selected path and dataset.
- New floating dataset windows default to about 80% of the project-instance frame and reuse the most recent floating dataset window size for subsequent dataset windows in the same project instance page.
- Floating dataset window titlebars show the full reserving-class path plus dataset name; minimized toolbar tabs use the dataset name.
- Floating dataset window titlebars include shell-matching minimize, maximize/restore, and close icon buttons; minimize sends the window into the toolbar hidden-tab strip.
- Dataset viewer windows follow the shell's existing Windows 11 frame flag, using rounded frame corners on Windows 11 and square corners otherwise.
- Dataset viewer windows can be resized from all corners and edges, with the southeast handle using the same dotted resize glyph as the main shell and shell floating tabs.
- Double-clicking a floating dataset window titlebar toggles maximize/restore within the project-instance frame; dragging a maximized titlebar restores the prior size under the pointer before moving.
- Dataset viewer windows are clamped below the project-instance toolbar; they may be dragged partially off the left, right, or bottom edge as long as a side grab area and the titlebar remain reachable.
- `Ctrl+W` closes the active floating dataset window, including when keyboard focus is inside the embedded Dataset Viewer iframe or when the shell/Electron close-tab shortcut reaches the parent shell first; the project instance tab closes only when no floating dataset window can consume the shortcut.
- The toolbar includes a hidden-tab collection area to the right of the selected path; dragging a floating dataset window titlebar anywhere above the main project-instance layout highlights the dragged window, shows a release-to-minimize banner, and hides the window with a slower dock-style minimize animation that moves to its minimized toolbar tab. Hidden windows appear as large-radius minimized tabs on the toolbar that show dataset names only plus a styled hover tooltip with the full window title, and hovering or clicking the hidden-tabs button opens a wider content-fitting dropdown that lists full hidden window titles with a one-second hover grace period, per-item close controls, Resume all tabs, Close all tabs, and a matching restore animation that starts from the matching minimized tab.
- Dataset viewer windows add a transparent parent-page drag shield during move/resize so embedded iframes do not interrupt fast mouse movement.
- The project instance toolbar is compact, shows only the currently selected reserving-class path, omits the duplicate selected path above the tree, and sizes the path label to its content with a capped width so minimized toolbar tabs get the remaining space.
- The left and right panel title bars are omitted so the reserving-class tree and dataset table start directly below the toolbar.
- Right-clicking dataset table header cells opens a context menu with `Group by ...` choices for `Data Format` and `Category` plus a placeholder `Reset Columns` option; choosing both grouping fields creates nested compact collapsible group headers inside the same table instead of rendering separate grouped tables. Top-level group headers show record counts as low-contrast circular badges, while subgroup headers omit counts. Every table header still supports per-column filter dropdowns, drag-to-reorder column labels, and drag-to-resize header edges. Per-column filters match the Project Settings Dataset Types table: no checked values means the filter is not applied, checked values narrow results, and selecting all values is treated as unfiltered. Resizing a column changes only that column and updates the total table width instead of redistributing space across other columns.
- Dataset table initial column widths are measured from the loaded header and cell contents, with each startup width capped at `460px` so a single long value cannot create an oversized column; manual resize can still expand a column beyond the startup cap.
- Right-clicking a dataset table group header opens `Collapse all` and `Expand all` actions for nested subgroup headers within that group.
- Dataset table renders precompute row cell values, filter option lists, and active filter selections once per render before grouping and sorting, keeping filter/group changes responsive on larger project dataset lists.
- Dataset table headers remain opaque while scrolling, so row contents do not show through sticky header cells.
- Dataset table body cells wrap long text and clamp display to two lines per cell.
- Clicking a dataset table column label sorts rows by that column, toggles ascending/descending order, and shows an up/down SVG sort indicator on the active sorted column.
- The left reserving-class panel defaults to 400px and has a draggable splitter constrained to 200px-600px; collapse/expand is animated, live drag updates are frame-throttled with transitions disabled for responsiveness, dragging the panel to 200px or smaller collapses it, and double-clicking the splitter toggles collapse/expand.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Uses the shell-persisted project name/folder/table path as tab inputs.
- Loads the project's last selected reserving-class path from project-user preferences when the tab opens; if no last path exists, it selects the first Shortcut item when available, otherwise leaving the path empty.
- Keeps the selected reserving-class path in page memory, saves user selections back to project-user preferences, and passes it into new dataset viewer windows.
- Left and right panels own their scroll areas so overflowing path trees and dataset tables scroll inside the project instance tab frame.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Change project instance launch behavior: update Project Settings sender and shell message/tab routing together.
2. Change dataset-window behavior: update `project_instance.js` while preserving the reused Dataset Viewer page contract.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Nested dataset iframes post messages to the project instance page before reaching the shell.
- Dataset viewer query parameters must remain compatible with normal top-level dataset tabs.
<!-- MANUAL:END -->
