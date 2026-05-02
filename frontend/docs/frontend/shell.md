# Frontend: Shell

## Purpose
<!-- MANUAL:BEGIN -->
Shell-level tab/iframe host for all feature pages. The shell entrypoint is split into focused modules under `ui/shell/`: `ui_shell.js` bootstraps the controllers, while state persistence, tab actions, tab strip rendering, iframe/floating content hosting, menus, hotkeys, preferences, app lifecycle, host titlebar controls, and workflow host helpers live in separate files.
Home view includes a Browsing History entry card that opens a dedicated Browsing History tab.
Top menubar supports mixed-scope actions: global actions are always shown, shared actions remain visible but dispatch based on active tab, and page-exclusive actions are hidden when their target page type is not active (for example, `View -> Hide/Show Navigation Panel` only on Workflow and `View -> Toggle Line Numbers` only on Scripting). Page-exclusive visibility is declarative via `data-page-scopes="<tabType>[,<tabType>...]"` on menu items in `index.html`, and shell-side filtering in `ui_shell.js` applies the scopes on every render/open so DFM/workflow/scripting-only actions do not leak into other page types. `Edit` and `View` dropdowns are marked with `data-requires-page-scope`, so newly added items in those menus stay hidden unless they explicitly declare `data-page-scopes` (use `data-page-scopes="*"` for always-visible entries). When any top menu dropdown is open, clicking in shell or inside an iframe page, or pressing `Esc`, closes all shell dropdown menus.
When Project Settings is active and its `Dataset Types` ribbon is selected, `File -> Save` / `Save As...` are relabeled and dispatched as `Save Dataset Types` / `Load Dataset Types` to the Project Settings iframe while keeping the same keyboard shortcuts. When Project Settings is active and its `Reserving Class Types` ribbon is selected, those same File actions are relabeled/dispatched as `Save Reserving Class Types As...` / `Load Reserving Class Types From...`.
When DFM is active and the internal DFM tab is `Details`, `File -> Save As...` is relabeled to `Save as Template` and dispatches DFM template save; on other DFM internal tabs, `Save As...` keeps normal DFM method Save-As behavior.
Dataset and DFM iframe URLs include a shell `v` token so reopening tabs picks up the latest static page assets instead of stale cached HTML/CSS.
Electron host bridge exposes local path open support; shell relays iframe `arcrho:open-path` requests to host and replies with `arcrho:open-path-result` so Dataset Notes click-to-open works from iframe pages.
Main tabs can be dragged downward out of the tab strip into in-shell floating windows. The drag stays in tab arrangement mode until the pointer moves about 30px below the tab strip, then switches to a floating-window preview; moving back near the strip hides the preview and returns to tab arrangement mode before release. Floating tabs are removed from the main tab strip while floated, get a shell-owned title bar using the tab name, keep their existing iframe/session without DOM reparenting, and can be moved, resized, minimized to their title bar, closed, docked with the title-bar square/max icon, or docked by double-clicking the floating title bar. Floating iframe bodies and title-bar chrome use paired z-layers so overlapped foreground windows cover background floating windows without reparenting iframes. The shell keeps exactly one active top-level tab across docked and floating tabs; when a floating tab is active, the last docked tab remains visible behind it as inactive background content. Clicking inside any visible inactive iframe content activates that tab/window and suppresses that first click before page controls receive it, so a background floating or docked page can be brought forward from its page body without accidentally toggling a control. Floating windows reuse the host Windows-version frame signal: Windows 11 gets rounded floating corners matching the main app frame, while Windows 10 keeps square floating corners with the existing extra app-frame border.
New floating windows created by tab pop-out use a 16:10 default aspect ratio while still targeting about 80% of the available shell space.
After the user manually resizes any floating window, newly created floating windows in the same app session reuse that last adjusted floating size.
Floating windows may be moved partially outside the app shell horizontally; up to 80% of the floating window width can sit beyond the left or right shell edge, leaving a reachable strip inside the app frame.
Dragging a floating window to the left or right shell edge shows a half-frame snap preview; releasing at the edge resizes and positions the floating window into that half of the app frame.
After a floating window snaps to a half frame, the shell remembers its previous floating size and restores it automatically once the user drags the snapped title bar beyond a small movement threshold.
Dragging a floating window title bar to roughly the midpoint-height of the tab strip highlights the strip as a dock target and shows a tab-order placeholder; releasing there docks the window back into the main tab bar at the previewed order.
Floating and docking transitions use a short scale/fade animation on the paired floating frame and iframe body without recreating the iframe.
The desktop shell includes a bottom-right ArcBot launcher. ArcBot opens as an in-shell floating chat panel that can be moved by dragging its header, checks the local Codex CLI install and `codex login status`, offers an explicit first-time install action that runs `npm install -g @openai/codex`, and launches `codex login` when local credentials are missing. Users can type into ArcBot immediately, while sending stays gated until Codex CLI is installed and signed in. ArcBot shows compact dropdowns below the input for mode and model selection: Review Mode is active, Edit Mode is visible but disabled, Codex is the default model, and Claude/Copilot entries show a not-available popup while leaving Codex selected. Host IPC rejects non-review or non-Codex assistant requests. Review Mode requests prefer the npm-installed or bundled `codex.cmd` over WindowsApps helper executables, pass the prompt through stdin to `codex exec`, run with the read-only sandbox, resolve mapped drive roots such as `E:\...` to their UNC network target when Windows exposes one, and use the configured Server Connection root path as the default project folder context. If the configured project folder resolves to a UNC network path, ArcBot creates `%USERPROFILE%\Documents\ArcRho` when needed and starts Codex from that local folder instead of using the network path as `--cd` to avoid Windows/Codex working-directory startup failures. When using the bundled Codex CLI, ArcBot launches the bundled Node entrypoint directly so Windows `.cmd` quoting does not split paths that contain spaces. ArcBot does not edit files by default.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.shell.entry_points -->
- `ui/index.html`: external scripts `/ui/shell/ui_shell.js?v=20260430r`; inline imports _none_.

Detected `fetch(...)` targets in key JS files:
- `/`
- `/app/restart`
- `/app/restart_electron`
- `/app/shutdown`
- `/restart`
- `/workflow/default_dir`
- `/workflow/load`
- `/workspace_paths`

Detected `arcrho:*` message types in key JS files:
- `arcrho:autosave-toggle`
- `arcrho:browsing-history-updated`
- `arcrho:close-active-tab`
- `arcrho:dfm-tab-activated`
- `arcrho:force-rebuild-toggle`
- `arcrho:hotkey`
- `arcrho:open-path-result`
- `arcrho:set-app-font`
- `arcrho:set-zoom`
- `arcrho:tab-activated`
- `arcrho:workflow-load`
- `arcrho:zoom`
- `arcrho:zoom-reset`
- `arcrho:zoom-step`
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN frontend.shell.key_files -->
- [`ui/index.html`](../../ui/index.html) - Main desktop shell page and menu structure.
- [`ui/shell/ui_shell.js`](../../ui/shell/ui_shell.js) - Shell bootstrap and controller composition.
- [`ui/shell/shell_state.js`](../../ui/shell/shell_state.js) - Shell tab state persistence and invariants.
- [`ui/shell/tab_actions.js`](../../ui/shell/tab_actions.js) - Tab open/close/activate/float/dock actions.
- [`ui/shell/tab_strip.js`](../../ui/shell/tab_strip.js) - Docked tab strip rendering, reordering, plus menu, and tab context menu.
- [`ui/shell/shell_content.js`](../../ui/shell/shell_content.js) - Home, iframe host, and floating content layout orchestration.
- [`ui/shell/iframe_host.js`](../../ui/shell/iframe_host.js) - Iframe creation, URL construction, and iframe event bridge.
- [`ui/shell/floating_tabs.js`](../../ui/shell/floating_tabs.js) - In-shell floating tab window movement, resize, chrome, and layering.
- [`ui/shell/shell_menus.js`](../../ui/shell/shell_menus.js) - Shell menubar state, command dispatch, and scoped menu visibility.
- [`ui/shell/shell_hotkeys.js`](../../ui/shell/shell_hotkeys.js) - Global shell hotkey routing.
- [`ui/shell/shell_messages.js`](../../ui/shell/shell_messages.js) - Cross-frame shell message handling.
- [`ui/shell/shell_preferences.js`](../../ui/shell/shell_preferences.js) - Zoom, autosave, app font, force rebuild, and tooltip preferences.
- [`ui/shell/root_path_settings.js`](../../ui/shell/root_path_settings.js) - Server Connection root path settings modal.
- [`ui/shell/workflow_host_actions.js`](../../ui/shell/workflow_host_actions.js) - Workflow import and shell-side workflow helpers.
- [`ui/shell/app_lifecycle.js`](../../ui/shell/app_lifecycle.js) - Refresh, restart, shutdown, and app confirmation flows.
- [`ui/shell/titlebar_controls.js`](../../ui/shell/titlebar_controls.js) - Electron titlebar and resize-handle controls.
- [`ui/shell/status_bar.js`](../../ui/shell/status_bar.js) - Status bar text, clock, and timestamp helpers.
- [`ui/shell/shell_context.js`](../../ui/shell/shell_context.js) - Shared shell dependency registry.
- [`electron/preload.js`](../../electron/preload.js) - Renderer-safe host bridge APIs.
- [`electron/main.js`](../../electron/main.js) - Window lifecycle and shell-to-host wiring.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Communicates with child iframes via `arcrho:*` postMessage events.
- Invokes app-server endpoints for workflow import helpers and configuration endpoints.
- Uses Electron host bridge for shutdown/clear-cache actions; app-server startup is host-managed with retry on transient launch failures.
- Uses Electron host bridge for Server Connection folder browsing and first-time `ArcRho Server` drive detection.
- Uses Electron host bridge for desktop-only ArcBot Codex CLI status, install, login, and read-only `codex exec` requests.
- Consumes dataset-page browsing updates (`arcrho:dataset-settings-changed`, `arcrho:browsing-history-updated`) and forwards updates to any open Browsing History tab.
- Receives `arcrho:open-dataset-from-history` from Browsing History tab to open dataset tabs with selected inputs.
- OS-level detached tab pop-out windows are not supported; floating tabs stay inside the main shell and reuse the same iframe/message contracts as docked tabs.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Persists tab state, docked/floating layout, floating window position/size/z-order, zoom, and toggles in `localStorage`.
- Persists dataset browsing history entries (latest 15) via `browsing_history.js`.
- Keeps ArcBot messages in memory for the current app session only.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Add a new tab type: update `tab_actions.js`, `iframe_host.js`, relevant menu/hotkey dispatch modules, and any state persistence in `shell_state.js`.
2. Add shell menu action: wire menu item + action handler in `shell_menus.js` and hotkey mapping in `shell_hotkeys.js`; for `Edit`/`View` items, always set `data-page-scopes` (`*` for global visibility) because those dropdowns require explicit scope declarations.
3. Change tab layout behavior: update `tab_strip.js`, `floating_tabs.js`, `shell_content.js`, active-tab dispatch in `tab_actions.js`, localStorage migration in `shell_state.js`, and close/dirty-state flows together.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- DOM replacement in shell can invalidate iframe references.
- Unsaved-state handling must stay consistent for close/close-all flows.
- Floating/docking must reposition existing iframes without recreating or reparenting them, or feature pages can lose in-memory state.
- Active-tab styling and menu dispatch must stay single-source through `state.activeId` so docked background content does not behave as active while a floating window is focused.
- Host/app-server startup races can surface as blank shell or startup timeout if lifecycle flags/process teardown are not coordinated.
<!-- MANUAL:END -->
