// ---------------------------------------------------------------------------
// Notebook save / open
// ---------------------------------------------------------------------------

function getNotebookFilenameFromPath(pathLike) {
  const normalized = String(pathLike || "").replace(/\\/g, "/").trim();
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function getNotebookDisplayTitle() {
  return currentNotebookFilename || DEFAULT_NOTEBOOK_TITLE;
}

function updateNotebookTitleUI() {
  const title = getNotebookDisplayTitle();
  if (toolbarNotebookTitleEl) {
    toolbarNotebookTitleEl.textContent = title;
  }
  try {
    window.parent?.postMessage({ type: "arcrho:update-active-tab-title", title }, "*");
  } catch {}
}

function setCurrentNotebookFilename(pathLike) {
  currentNotebookFilename = getNotebookFilenameFromPath(pathLike);
  currentNotebookPath = String(pathLike || "").trim();
  updateNotebookTitleUI();
}

function getNotebookDirectoryFromPath(pathLike) {
  const raw = String(pathLike || "").trim();
  if (!raw) return "";
  const slash = Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/"));
  return slash >= 0 ? raw.slice(0, slash) : "";
}

function getNotebookHostApi() {
  return window.ADAHost || window.parent?.ADAHost || window.top?.ADAHost || null;
}

function getNotebookExtension(pathLike) {
  const name = getNotebookFilenameFromPath(pathLike).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function getNotebookCopyFilename(pathLike) {
  const name = getNotebookFilenameFromPath(pathLike) || "notebook.ipynb";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.copy.ipynb`;
  return `${name.slice(0, dot)}.copy${name.slice(dot)}`;
}

function revisionToken(revision) {
  if (!revision || typeof revision !== "object") return "";
  const hash = String(revision.hash || "").trim();
  if (hash) return hash;
  return `${Number(revision.size || 0)}:${Number(revision.mtimeMs || 0)}`;
}

function sameRevision(left, right) {
  const leftToken = revisionToken(left);
  const rightToken = revisionToken(right);
  return !!leftToken && !!rightToken && leftToken === rightToken;
}

function getNotebookStateText() {
  try {
    return JSON.stringify(getNotebookSavePayload());
  } catch {
    return "";
  }
}

function setNotebookDirty(nextDirty) {
  const dirty = !!nextDirty;
  if (notebookDirty === dirty) return;
  notebookDirty = dirty;
  try {
    window.parent?.postMessage({ type: "arcrho:scripting-dirty", dirty }, "*");
  } catch {}
}

function updateNotebookDirtyState() {
  if (suppressNotebookDirtyTracking) return;
  setNotebookDirty(getNotebookStateText() !== savedNotebookText);
  scheduleNotebookAutoSave();
}

function markNotebookSavedBaseline(pathLike = currentNotebookPath, revision = lastNotebookDiskRevision) {
  savedNotebookText = getNotebookStateText();
  lastNotebookDiskRevision = revision || null;
  notebookDiskConflict = "";
  setNotebookDirty(false);
  hideNotebookFileBanner();
  if (pathLike) startNotebookRevisionPolling();
}

function withNotebookDirtyTrackingSuspended(fn) {
  const previous = suppressNotebookDirtyTracking;
  suppressNotebookDirtyTracking = true;
  try {
    return fn();
  } finally {
    suppressNotebookDirtyTracking = previous;
  }
}

function buildIpynbSource(source) {
  return String(source || "").match(/[^\n]*\n|[^\n]+/g) || [];
}

function buildNotebookFileData() {
  const extension = getNotebookExtension(currentNotebookPath || currentNotebookFilename);
  const cellsPayload = getNotebookSavePayload();
  if (extension === ".arcnb") {
    return { cells: cellsPayload.map((cell) => ({ type: normalizeCellType(cell.type), source: sourceToText(cell.source) })) };
  }
  return {
    cells: cellsPayload.map((cell) => {
      const cellType = normalizeCellType(cell.type);
      const entry = {
        cell_type: cellType,
        metadata: {},
        source: buildIpynbSource(cell.source),
      };
      if (cellType === CELL_TYPES.CODE) {
        entry.execution_count = null;
        entry.outputs = [];
      }
      return entry;
    }),
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

async function readNotebookDiskRevision(pathLike = currentNotebookPath) {
  const hostApi = getNotebookHostApi();
  const filePath = String(pathLike || "").trim();
  if (!filePath || typeof hostApi?.getFileRevision !== "function") return null;
  const result = await hostApi.getFileRevision({ path: filePath });
  return result?.exists ? result.revision || null : null;
}

function showNotebookFileBanner(message, conflict = "changed") {
  notebookDiskConflict = conflict;
  if (notebookFileBannerMessage) notebookFileBannerMessage.textContent = message;
  notebookFileBanner?.classList.add("open");
  if (conflict) setStatus("Changed on disk");
}

function hideNotebookFileBanner() {
  notebookFileBanner?.classList.remove("open");
}

function setNotebookDiskConflict(message, conflict = "changed") {
  clearTimeout(notebookAutoSaveTimer);
  showNotebookFileBanner(message, conflict);
}

function scheduleNotebookAutoSave() {
  clearTimeout(notebookAutoSaveTimer);
  if (!notebookAutoSaveEnabled || !notebookDirty || notebookDiskConflict || !currentNotebookPath) return;
  const hostApi = getNotebookHostApi();
  if (typeof hostApi?.saveJsonFile !== "function") return;
  notebookAutoSaveTimer = setTimeout(() => {
    void saveCurrentNotebookFile({ closeDialog: false, source: "auto" });
  }, 1500);
}

function setNotebookAutoSaveEnabled(enabled) {
  notebookAutoSaveEnabled = !!enabled;
  if (!notebookAutoSaveEnabled) clearTimeout(notebookAutoSaveTimer);
  else scheduleNotebookAutoSave();
}

function buildScriptingAssistantContext() {
  const fileState = notebookDiskConflict
    ? "changed-on-disk"
    : notebookDirty ? "unsaved-changes" : "saved";
  return {
    available: true,
    tabType: "scripting",
    pageType: "scripting",
    title: getNotebookDisplayTitle(),
    targetPath: currentNotebookPath || "",
    path: currentNotebookPath || "",
    notebookFilename: currentNotebookFilename || "",
    dirty: notebookDirty,
    autoSaveEnabled: notebookAutoSaveEnabled,
    fileState,
    activeJson: buildNotebookFileData(),
  };
}

async function checkNotebookDiskForChanges({ force = false } = {}) {
  if (!currentNotebookPath) return;
  const revision = await readNotebookDiskRevision();
  if (!revision) {
    if (lastNotebookDiskRevision) {
      setNotebookDiskConflict(`${getNotebookDisplayTitle()} is no longer available on disk. Save a copy or choose Overwrite to recreate it.`, "deleted");
    }
    return;
  }
  if (!lastNotebookDiskRevision) {
    lastNotebookDiskRevision = revision;
    return;
  }
  if (!force && sameRevision(revision, lastNotebookDiskRevision)) return;
  if (sameRevision(revision, lastNotebookDiskRevision)) return;
  if (notebookDirty) {
    lastNotebookDiskRevision = lastNotebookDiskRevision || revision;
    setNotebookDiskConflict(`${getNotebookDisplayTitle()} changed on disk while this tab has unsaved edits.`, "changed");
    return;
  }
  await reloadCurrentNotebookFromDisk({ reason: "external" });
}

function startNotebookRevisionPolling() {
  clearInterval(notebookRevisionPollTimer);
  if (!currentNotebookPath) return;
  const hostApi = getNotebookHostApi();
  if (typeof hostApi?.getFileRevision !== "function") return;
  notebookRevisionPollTimer = setInterval(() => {
    void checkNotebookDiskForChanges();
  }, 3000);
}

function openSaveNbDialog(defaultName = "") {
  const overlay = document.getElementById("saveNbOverlay");
  const input = document.getElementById("saveNbName");
  const proposed = String(defaultName || currentNotebookFilename || DEFAULT_NOTEBOOK_FILENAME).trim();
  overlay.classList.add("open");
  input.value = proposed;
  input.focus();
  input.select();
}

function closeSaveNbDialog() {
  document.getElementById("saveNbOverlay").classList.remove("open");
}

function postShellStatus(text) {
  const msg = String(text || "").trim();
  if (!msg) return;
  try {
    window.parent?.postMessage({ type: "arcrho:status", text: msg }, "*");
  } catch {}
}

function getNotebookSavePayload() {
  return cells.map((c) => {
    const entry = {
      type: normalizeCellType(c.type),
      source: c.editor ? c.editor.getValue() : "",
    };
    if (c.executionTimeMs != null) entry.execution_time_ms = Math.round(c.executionTimeMs);
    if (c.execStartTime) entry.exec_start_time = c.execStartTime instanceof Date ? c.execStartTime.toISOString() : c.execStartTime;
    if (c.execEndTime) entry.exec_end_time = c.execEndTime instanceof Date ? c.execEndTime.toISOString() : c.execEndTime;
    return entry;
  });
}

async function saveNotebookViaApi(filename, { closeDialog = true } = {}) {
  const nextName = String(filename || "").trim();
  if (!nextName) {
    setStatus("Enter a filename");
    postShellStatus("Enter a filename");
    return false;
  }

  try {
    const resp = await scriptingFetch("/scripting/save-notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: nextName, cells: getNotebookSavePayload() }),
    });
    const result = await resp.json();
    if (result && result.success === false) {
      const msg = result.message || "Save failed";
      setStatus(msg);
      postShellStatus(msg);
      return false;
    }

    const savedName = getNotebookFilenameFromPath(result?.path) || nextName;
    setCurrentNotebookFilename(result?.path || savedName);
    try {
      lastNotebookDiskRevision = await readNotebookDiskRevision(result?.path || "");
    } catch {
      lastNotebookDiskRevision = null;
    }
    markNotebookSavedBaseline(result?.path || savedName, lastNotebookDiskRevision);
    const msg = result?.message || `Saved ${savedName}`;
    setStatus(msg);
    postShellStatus(msg);
    if (closeDialog) closeSaveNbDialog();
    return true;
  } catch {
    setStatus("Save failed");
    postShellStatus("Save failed");
    return false;
  }
}

async function confirmSaveNb() {
  const input = document.getElementById("saveNbName");
  const filename = input.value.trim();
  if (!filename) {
    setStatus("Enter a filename");
    postShellStatus("Enter a filename");
    return;
  }
  await saveNotebookByFilename(filename, { closeDialog: true });
}

async function requestNotebookSave(forcePrompt = false) {
  if (forcePrompt || !currentNotebookFilename) {
    postShellStatus("Save As...");
    openSaveNbDialog();
    return;
  }
  await saveNotebookByFilename(currentNotebookFilename, { closeDialog: false });
}

async function openOpenNbDialog() {
  if (await openNotebookFromAnyFolder()) return;
  const overlay = document.getElementById("openNbOverlay");
  const list = document.getElementById("openNbList");
  overlay.classList.add("open");
  list.innerHTML = `<li style="color:#bbb;text-align:center">Loading...</li>`;
  try {
    const resp = await scriptingFetch("/scripting/notebooks");
    const notebooks = await resp.json();
    if (notebooks.length === 0) {
      list.innerHTML = `<li style="color:#bbb;text-align:center">No saved notebooks.</li>`;
      return;
    }
    list.innerHTML = "";
    notebooks.forEach((nb) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="nb-name">${escapeHtml(nb.name)}</span><span class="nb-meta">${escapeHtml(nb.size)}</span>`;
      li.addEventListener("click", () => loadNotebook(nb.name));
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = `<li style="color:#bbb;text-align:center">Failed to load.</li>`;
  }
}

function closeOpenNbDialog() {
  document.getElementById("openNbOverlay").classList.remove("open");
}

function sourceToText(source) {
  if (Array.isArray(source)) return source.map((part) => String(part ?? "")).join("");
  if (source == null) return "";
  return String(source);
}

function normalizeImportedCellType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  if (value === "markdown" || value === "raw") return value;
  return "code";
}

function extractPlainText(dataBundle) {
  if (!dataBundle || typeof dataBundle !== "object" || Array.isArray(dataBundle)) return "";
  return sourceToText(dataBundle["text/plain"]);
}

function convertImportedOutputs(outputs) {
  if (!Array.isArray(outputs)) return {};
  const stdout = [];
  const stderr = [];
  const errors = [];
  const unsupported = new Set();

  outputs.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      unsupported.add("unknown-output");
      return;
    }
    const outputType = String(item.output_type || "").trim().toLowerCase();
    if (outputType === "stream") {
      const target = String(item.name || "").toLowerCase() === "stderr" ? stderr : stdout;
      const text = sourceToText(item.text);
      if (text) target.push(text);
      return;
    }
    if (outputType === "error") {
      if (Array.isArray(item.traceback) && item.traceback.length) {
        errors.push(item.traceback.map((line) => String(line ?? "")).join("\n"));
      } else {
        const ename = String(item.ename || "Error").trim();
        const evalue = String(item.evalue || "").trim();
        errors.push(evalue ? `${ename}: ${evalue}` : ename);
      }
      return;
    }
    if (outputType === "execute_result" || outputType === "display_data") {
      const text = extractPlainText(item.data);
      if (text) stdout.push(text);
      if (item.data && typeof item.data === "object" && !Array.isArray(item.data)) {
        Object.keys(item.data).forEach((mimeKey) => {
          if (mimeKey !== "text/plain") unsupported.add(mimeKey);
        });
      } else {
        unsupported.add(outputType);
      }
      return;
    }
    unsupported.add(outputType || "unknown-output");
  });

  const result = {};
  if (stdout.length) result.stdout = stdout.join("");
  if (stderr.length) result.stderr = stderr.join("");
  if (errors.length) result.error = errors.join("\n");
  if (unsupported.size) {
    result.unsupported = Array.from(unsupported).sort();
    result.unsupported_message = `Imported output contains unsupported rich display types: ${result.unsupported.join(", ")}.`;
  }
  return result;
}

function normalizeNotebookData(data, filename = "") {
  const lower = String(filename || "").toLowerCase();
  const rawCells = data && typeof data === "object" && Array.isArray(data.cells) ? data.cells : [];
  if (lower.endsWith(".arcnb")) {
    return rawCells
      .filter((cell) => cell && typeof cell === "object")
      .map((cell) => ({
        type: normalizeImportedCellType(cell.type),
        source: sourceToText(cell.source),
      }));
  }
  return rawCells
    .filter((cell) => cell && typeof cell === "object")
    .map((cell) => {
      const entry = {
        type: normalizeImportedCellType(cell.cell_type),
        source: sourceToText(cell.source),
      };
      if (entry.type === "code") {
        if (Number.isInteger(cell.execution_count)) entry.execution_count = cell.execution_count;
        const importOutput = convertImportedOutputs(cell.outputs);
        if (Object.keys(importOutput).length) entry.import_output = importOutput;
      }
      return entry;
    });
}

function applyLoadedNotebookCells(loadedCells, filename, options = {}) {
  commitPendingEditUndoSnapshot();
  if (options.recordUndo !== false) recordNotebookUndoSnapshot();
  setCurrentNotebookFilename(filename);

  let unsupportedOutputCells = 0;
  const normalizedCells = Array.isArray(loadedCells) ? loadedCells : [];
  withNotebookDirtyTrackingSuspended(() => withNotebookUndoSuspended(() => {
    discardPendingEditUndoSnapshot();
    editingCellId = null;
    focusedCellId = null;
    selectedCellIds.clear();
    rangeSelectionAnchorId = null;
    resetSectionCollapseState();

    cells.forEach((cell) => {
      if (cell.editor) cell.editor.dispose();
      cell.cellEl.remove();
    });
    cells = [];
    nextCellId = 1;

    normalizedCells.forEach((c) => {
      const cell = addCell(c.source || "", null, "after", c.type || "code", { recordUndo: false, persist: false });
      const applied = applyImportedCellState(cell, c);
      if (applied.hasUnsupported) unsupportedOutputCells += 1;
    });

    if (cells.length === 0) {
      addCell("", null, "after", CELL_TYPES.CODE, { recordUndo: false, persist: false });
    }

    focusCell(cells[0]?.id);
    refreshToc();
    saveCellsToStorage();
  }));
  renderAllMarkdownCells({ setStatusMessage: false });
  markNotebookSavedBaseline(filename, options.revision || lastNotebookDiskRevision);
  return unsupportedOutputCells;
}

async function reloadCurrentNotebookFromDisk({ reason = "manual" } = {}) {
  const hostApi = getNotebookHostApi();
  if (!currentNotebookPath || typeof hostApi?.readJsonFile !== "function") return false;
  try {
    const result = await hostApi.readJsonFile({ path: currentNotebookPath });
    if (!result?.exists) {
      const msg = result?.error || `File not found: ${currentNotebookPath}`;
      setNotebookDiskConflict(msg, "deleted");
      return false;
    }
    const loadedCells = normalizeNotebookData(result.data, currentNotebookPath);
    const unsupportedOutputCells = applyLoadedNotebookCells(loadedCells, currentNotebookPath, {
      revision: result.revision || null,
      recordUndo: reason !== "external",
    });
    const label = getNotebookFilenameFromPath(currentNotebookPath);
    const suffix = unsupportedOutputCells > 0 ? ` (${unsupportedOutputCells} cells include unsupported rich outputs)` : "";
    const msg = reason === "external" ? `Reloaded disk changes for ${label}${suffix}` : `Reloaded ${label}${suffix}`;
    setStatus(msg);
    postShellStatus(msg);
    return true;
  } catch {
    setStatus("Reload failed");
    postShellStatus("Reload failed");
    return false;
  }
}

async function openNotebookFromAnyFolder() {
  const hostApi = window.ADAHost || window.parent?.ADAHost || window.top?.ADAHost;
  if (!hostApi || typeof hostApi.pickOpenFile !== "function" || typeof hostApi.readJsonFile !== "function") {
    return false;
  }
  const startDir = getNotebookDirectoryFromPath(currentNotebookPath);
  let filePath = "";
  try {
    filePath = await hostApi.pickOpenFile({
      startDir,
      filters: [
        { name: "Notebooks", extensions: ["ipynb", "arcnb"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
  } catch {
    setStatus("Open failed");
    postShellStatus("Open failed");
    return true;
  }
  if (!filePath) return true;

  try {
    const result = await hostApi.readJsonFile({ path: filePath });
    if (!result || !result.exists) {
      const msg = result?.error || `File not found: ${filePath}`;
      setStatus(msg);
      postShellStatus(msg);
      return true;
    }
    const loadedCells = normalizeNotebookData(result.data, filePath);
    const unsupportedOutputCells = applyLoadedNotebookCells(loadedCells, filePath, { revision: result.revision || null });
    if (unsupportedOutputCells > 0) {
      setStatus(`Opened ${getNotebookFilenameFromPath(filePath)} (${unsupportedOutputCells} cells include unsupported rich outputs)`);
    } else {
      setStatus(`Opened ${getNotebookFilenameFromPath(filePath)}`);
    }
    postShellStatus(`Opened ${filePath}`);
    return true;
  } catch {
    setStatus("Load failed");
    postShellStatus("Load failed");
    return true;
  }
}

async function saveCurrentNotebookFile({ closeDialog = true, ignoreRevisionConflict = false, source = "manual" } = {}) {
  if (!currentNotebookPath) {
    return saveNotebookViaApi(currentNotebookFilename, { closeDialog });
  }

  const hostApi = getNotebookHostApi();
  if (typeof hostApi?.saveJsonFile !== "function") {
    return saveNotebookViaApi(currentNotebookFilename, { closeDialog });
  }

  if (!ignoreRevisionConflict && lastNotebookDiskRevision) {
    let currentRevision = null;
    try {
      currentRevision = await readNotebookDiskRevision();
    } catch {
      currentRevision = null;
    }
    if (!currentRevision) {
      setNotebookDiskConflict(`${getNotebookDisplayTitle()} is no longer available on disk.`, "deleted");
      return false;
    }
    if (!sameRevision(currentRevision, lastNotebookDiskRevision)) {
      setNotebookDiskConflict(`${getNotebookDisplayTitle()} changed on disk. Resolve before saving.`, "changed");
      return false;
    }
  }

  try {
    const result = await hostApi.saveJsonFile({
      path: currentNotebookPath,
      data: buildNotebookFileData(),
      filters: [
        { name: "Notebooks", extensions: ["ipynb", "arcnb"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result?.error) {
      const msg = result.error || "Save failed";
      setStatus(msg);
      postShellStatus(msg);
      return false;
    }
    const savedPath = result?.path || currentNotebookPath;
    setCurrentNotebookFilename(savedPath);
    try {
      lastNotebookDiskRevision = await readNotebookDiskRevision(savedPath);
    } catch {
      lastNotebookDiskRevision = null;
    }
    markNotebookSavedBaseline(savedPath, lastNotebookDiskRevision);
    const savedName = getNotebookFilenameFromPath(savedPath);
    const msg = source === "auto" ? `Auto-saved ${savedName}` : `Saved ${savedName}`;
    setStatus(msg);
    postShellStatus(`${msg}${source === "auto" ? "" : ` (${savedPath})`}`);
    if (closeDialog) closeSaveNbDialog();
    return true;
  } catch {
    setStatus("Save failed");
    postShellStatus("Save failed");
    return false;
  }
}

async function saveNotebookByFilename(filename, { closeDialog = true } = {}) {
  if (currentNotebookPath && getNotebookFilenameFromPath(currentNotebookPath) === getNotebookFilenameFromPath(filename)) {
    return saveCurrentNotebookFile({ closeDialog });
  }
  return saveNotebookViaApi(filename, { closeDialog });
}

async function loadNotebook(filename) {
  try {
    const resp = await scriptingFetch("/scripting/load-notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    const result = await resp.json();
    if (!result.success) {
      setStatus(result.message || "Load failed");
      return;
    }

    const loadedCells = Array.isArray(result.cells) ? result.cells : [];
    const openedPath = result.path || filename;
    let revision = null;
    try {
      revision = await readNotebookDiskRevision(openedPath);
    } catch {
      revision = null;
    }
    const unsupportedOutputCells = applyLoadedNotebookCells(loadedCells, openedPath, { revision });

    closeOpenNbDialog();
    if (unsupportedOutputCells > 0) {
      setStatus(`Opened ${filename} (${unsupportedOutputCells} cells include unsupported rich outputs)`);
    } else {
      setStatus(`Opened ${filename}`);
    }
  } catch {
    setStatus("Load failed");
  }
}


// ---------------------------------------------------------------------------
// API help
// ---------------------------------------------------------------------------

let apiLoaded = false;

async function ensureApiHelpLoaded() {
  if (!apiList || apiLoaded) return;
  try {
    const resp = await scriptingFetch("/scripting/api-help");
    const funcs = await resp.json();
    apiList.innerHTML = funcs
      .map(
        (f) =>
          `<div><span class="sc-api-fn">${escapeHtml(f.name)}</span><span class="sc-api-desc"> - ${escapeHtml(f.description)}</span></div>`
      )
      .join("");
    apiLoaded = true;
  } catch {
    apiList.textContent = "Failed to load.";
  }
}


// ---------------------------------------------------------------------------
// Persistence (localStorage)
// ---------------------------------------------------------------------------

function saveCellsToStorage() {
  try {
    const payload = cells.map((c) => ({
      type: normalizeCellType(c.type),
      source: c.editor ? c.editor.getValue() : "",
    }));
    localStorage.setItem(CELLS_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  updateNotebookDirtyState();
}

function parseStoredCells(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;

  // Backward compatibility: older saves used string[] only.
  return parsed.map((entry) => {
    if (typeof entry === "string") {
      return { type: CELL_TYPES.CODE, source: entry };
    }
    if (entry && typeof entry === "object") {
      const source = typeof entry.source === "string"
        ? entry.source
        : (typeof entry.code === "string" ? entry.code : "");
      return { type: normalizeCellType(entry.type), source };
    }
    return { type: CELL_TYPES.CODE, source: "" };
  });
}

function loadCellsFromStorage() {
  const keys = [CELLS_STORAGE_KEY];
  if (CELLS_STORAGE_KEY !== LEGACY_CELLS_STORAGE_KEY) {
    keys.push(LEGACY_CELLS_STORAGE_KEY);
  }

  for (const key of keys) {
    try {
      const normalized = parseStoredCells(localStorage.getItem(key));
      if (normalized && normalized.length > 0) return normalized;
    } catch {
      // ignore malformed storage and continue fallback keys
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

function setStatus(text) {
  statusText.textContent = text;
  setTimeout(() => {
    if (statusText.textContent === text) statusText.textContent = "";
  }, 4000);
}
