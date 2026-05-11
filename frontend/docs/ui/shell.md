# Frontend: Shell

## Purpose
<!-- MANUAL:BEGIN -->
Shell-level tab/iframe host for all feature pages.
It owns the main desktop frame, home view, docked/floating tab layout, scoped menus, hotkeys, shell preferences, iframe message routing, and Electron host bridge coordination.
The shell keeps one active top-level tab across docked and floating tabs while preserving iframe sessions as tabs move between layouts.
The desktop shell also hosts ArcBot, a bottom-right floating Codex CLI assistant panel.
The floating window minimize control docks that window back to the end of the main tab strip without activating the docked tab; focus remains on the prior docked tab unless another floating window is still present, in which case the top layered floating window becomes active.
Detailed menu, floating-window, lifecycle, and bridge behavior belongs in focused sections or source-specific docs, not this overview.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.shell.entry_points -->
- `ui/index.html`: external scripts `/ui/shell/ui_shell.js?v=20260510a`; inline imports _none_.

Detected `fetch(...)` targets in key JS files:
- `/`
- `/app/restart`
- `/app/restart_electron`
- `/app/shutdown`
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
- `arcrho:server-connection-updated`
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
- Uses Electron host bridge and explicit shell commands for shutdown/clear-cache actions; ordinary document unloads and reloads do not send app shutdown.
- Clear Cache & Reload reloads the shell with a fresh timestamped UI URL after clearing Electron cache/storage, and Project Settings iframes include the shell UI version query parameter so reloads fetch the current Project Settings HTML/module graph consistently.
- App-server startup is host-managed with retry on transient launch failures.
- The home sidebar brand reads the Windows username from the Electron host bridge when available, then renders the username and a generated SVG initial mark; plain browser sessions keep the default ArcRho brand.
- Uses Electron host bridge for Server Connection folder browsing and first-time `ArcRho Server` drive detection.
- Uses Electron host bridge for desktop-only ArcBot Codex CLI status, install, login, and `codex exec` requests; for Edit Mode, the host writes the active page JSON into a local ArcBot session folder, lets Codex edit only that temporary copy, then validates the target path against the configured Server Connection root, backs up the original JSON under the method `history` folder or the active page snapshot when direct read is denied, applies the edited temp copy, and can revert the latest ArcBot edit from that backup.
- Saving Server Connection updates `/workspace_paths` without restarting the app, then broadcasts `arcrho:server-connection-updated` to open feature iframes so page-local path caches can refresh.
- Consumes dataset-page browsing updates (`arcrho:dataset-settings-changed`, `arcrho:browsing-history-updated`) and forwards updates to any open Browsing History tab.
- Receives `arcrho:open-dataset-from-history` from Browsing History tab to open dataset tabs with selected inputs.
- OS-level detached tab pop-out windows are not supported; floating tabs stay inside the main shell and reuse the same iframe/message contracts as docked tabs.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Persists tab state, docked/floating layout, floating window position/size/z-order, zoom, and toggles in `localStorage`.
- Persists dataset browsing history entries (latest 15) via `browsing_history.js`.
- Keeps ArcBot messages in memory for the current app session only; local ArcBot edit-session JSON copies are written under the user `Documents\ArcRho\ArcBot\sessions` folder, and latest ArcBot edit metadata is stored under Electron user data so a later `revert latest` request can restore the backed-up method JSON when the file has not changed again.
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
