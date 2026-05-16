# Frontend: Scripting Console

## Purpose
<!-- MANUAL:BEGIN -->
Notebook-style scripting workspace for code, markdown, raw cells, execution output, and sidebar panels.
<!-- MANUAL:END -->

## Entry Points
<!-- AUTO-GEN:BEGIN frontend.scripting_console.entry_points -->
- `ui/scripting_console/scripting_console.html`: external scripts `/ui/libs/monaco-editor/min/vs/loader.js`, `/ui/scripting_console/scripting_console.js`, `/ui/scripting_console/scripting_console_cells.js`, `/ui/scripting_console/scripting_console_core.js`, `/ui/scripting_console/scripting_console_execution.js`, `/ui/scripting_console/scripting_console_notebook_io.js`, `/ui/scripting_console/scripting_console_panels.js`, `/ui/scripting_console/scripting_console_shortcuts.js`; inline imports _none_.

Detected `fetch(...)` targets in key JS files:
- `${API_BASE}${path}`

Detected `arcrho:*` message types in key JS files:
- `arcrho:assistant-context-result`
- `arcrho:hotkey`
- `arcrho:scripting-dirty`
- `arcrho:status`
- `arcrho:update-active-tab-title`
<!-- AUTO-GEN:END -->

## Key Files
<!-- AUTO-GEN:BEGIN frontend.scripting_console.key_files -->
- [`ui/scripting_console/scripting_console.html`](../../ui/scripting_console/scripting_console.html) - Notebook-style scripting console page layout.
- [`ui/scripting_console/scripting_console.js`](../../ui/scripting_console/scripting_console.js) - Scripting console bootstrap and shell integration.
- [`ui/scripting_console/scripting_console_core.js`](../../ui/scripting_console/scripting_console_core.js) - Notebook state, cell model, and command-mode helpers.
- [`ui/scripting_console/scripting_console_cells.js`](../../ui/scripting_console/scripting_console_cells.js) - Cell rendering, selection, markdown, and drag/drop behavior.
- [`ui/scripting_console/scripting_console_execution.js`](../../ui/scripting_console/scripting_console_execution.js) - Code execution, streaming output, and cancellation handling.
- [`ui/scripting_console/scripting_console_shortcuts.js`](../../ui/scripting_console/scripting_console_shortcuts.js) - Keyboard shortcut parsing, customization, and persistence.
- [`ui/scripting_console/scripting_console_panels.js`](../../ui/scripting_console/scripting_console_panels.js) - Sidebar, TOC, variables, and API reference panels.
- [`ui/scripting_console/scripting_console_notebook_io.js`](../../ui/scripting_console/scripting_console_notebook_io.js) - Notebook save/open and `.ipynb` import/export helpers.
<!-- AUTO-GEN:END -->

## External Interfaces
<!-- MANUAL:BEGIN -->
- Called from shell as a scripting tab iframe.
- Uses `/scripting/*` app-server routes for execution, variables, preferences, and notebook persistence.
- In the desktop app, File > Open Notebook (Ctrl+O) uses the Electron host file picker and can load `.ipynb` or legacy `.arcnb` notebooks from any folder. Browser sessions fall back to the in-app saved-notebooks list under the scripting directory.
- File-backed notebooks track a disk revision token. Clean tabs auto-reload external disk edits, dirty tabs pause autosave and show a conflict banner with Reload, Save Copy, and Overwrite actions.
- Responds to ArcBot active-context requests with the current notebook path, dirty/file state, autosave state, and JSON-backed notebook payload so ArcBot can use the active scripting tab as default app context.
- Sends `arcrho:*` status and command messages to/from the shell.
- Imports the shared `ui/shared/scrollbars.css` WebKit scrollbar treatment so notebook, output, sidebar, and dialog scroll areas match the Dataset/DFM scrollbar style.
<!-- MANUAL:END -->

## Data/State/Caches
<!-- MANUAL:BEGIN -->
- Stores per-tab draft notebook state with tab-scoped browser storage keys.
- Saves notebooks as `.ipynb` files under the user scripting directory by default; opened desktop files save back to their current disk path unless the user chooses Save Copy.
- Tracks clean/dirty state against the last loaded or saved notebook snapshot and notifies the shell so scripting tabs participate in close confirmation.
- Persists keyboard shortcut preferences under APPDATA with browser storage fallback.
<!-- MANUAL:END -->

## Common Change Tasks
<!-- MANUAL:BEGIN -->
1. Change notebook model or persistence: update core state, notebook I/O, app-server scripting routes if needed, and docs together.
2. Change cell behavior or shortcuts: update cells/core/shortcuts modules and verify command/edit mode interactions.
3. Change sidebar or visual layout: update panels/cells/html together and keep INDEX.md as a short pointer only.
<!-- MANUAL:END -->

## Known Risks
<!-- MANUAL:BEGIN -->
- Keyboard handling is sensitive to edit mode, command mode, IME/composition, and Monaco focus.
- Multi-cell selection, queueing, markdown folding, and drag/drop share state and can regress each other.
- Long feature notes should stay in this module doc or release fragments, not in `docs/ui/INDEX.md`.
<!-- MANUAL:END -->
