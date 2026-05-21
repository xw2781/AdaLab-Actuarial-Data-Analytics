import { shell } from "./shell_context.js?v=20260510a";

const API_BASE = window.location.origin;
const macroWindow = document.getElementById("macroWindow");
const macroCloseBtn = document.getElementById("macroCloseBtn");
const macroRefreshBtn = document.getElementById("macroRefreshBtn");
const macroRunBtn = document.getElementById("macroRunBtn");
const macroEditBtn = document.getElementById("macroEditBtn");
const macroList = document.getElementById("macroList");
const macroDescription = document.getElementById("macroDescription");
const macroStatus = document.getElementById("macroStatus");
const macroHeader = document.getElementById("macroHeader");

const MACRO_WINDOW_POSITION_KEY = "arcrho_macro_window_position";

let macros = [];
let selectedMacroId = "";
let macroWindowWired = false;

function setMacroStatus(text, tone = "", options = {}) {
  const message = String(text || "");
  if (macroStatus) {
    macroStatus.textContent = message;
    macroStatus.dataset.tone = tone || "";
  }
  if (options.statusBar && message) {
    shell.updateStatusBar?.(message, { tone: tone || "" });
  }
}

function getSelectedMacro() {
  return macros.find((macro) => macro.id === selectedMacroId) || null;
}

function renderMacroList() {
  if (!macroList) return;
  macroList.textContent = "";
  if (!macros.length) {
    const empty = document.createElement("div");
    empty.className = "macroEmpty";
    empty.textContent = "No macros found.";
    macroList.appendChild(empty);
    return;
  }
  if (!selectedMacroId || !macros.some((macro) => macro.id === selectedMacroId)) {
    selectedMacroId = macros[0]?.id || "";
  }
  macros.forEach((macro) => {
    const item = document.createElement("button");
    item.className = "macroListItem";
    item.type = "button";
    item.dataset.id = macro.id;
    item.classList.toggle("active", macro.id === selectedMacroId);
    item.textContent = macro.name || macro.id;
    item.title = macro.path || macro.id;
    item.addEventListener("click", () => {
      selectedMacroId = macro.id;
      renderMacroList();
      renderMacroDescription();
    });
    macroList.appendChild(item);
  });
}

function renderMacroDescription() {
  const macro = getSelectedMacro();
  if (!macroDescription) return;
  if (!macro) {
    macroDescription.textContent = "Select a macro to view its description.";
    if (macroRunBtn) macroRunBtn.disabled = true;
    if (macroEditBtn) macroEditBtn.disabled = true;
    return;
  }
  macroDescription.textContent = macro.description || "This macro has no description section yet.";
  if (macroRunBtn) macroRunBtn.disabled = false;
  if (macroEditBtn) macroEditBtn.disabled = false;
}

async function loadMacros() {
  setMacroStatus("Loading macros...");
  try {
    const response = await fetch(`${API_BASE}/scripting/macros`);
    macros = await response.json();
    if (!Array.isArray(macros)) macros = [];
    renderMacroList();
    renderMacroDescription();
    setMacroStatus(macros.length ? `${macros.length} macro(s) available.` : "No macros found.");
  } catch (err) {
    macros = [];
    renderMacroList();
    renderMacroDescription();
    setMacroStatus(String(err?.message || err || "Failed to load macros."), "error");
  }
}

function getActiveDfmTab() {
  return shell.state?.tabs?.find?.((tab) => tab.id === shell.state.activeId && tab.type === "dfm") || null;
}

function requestActiveDfmContext() {
  const tab = getActiveDfmTab();
  if (!tab) return Promise.resolve({ available: false, error: "Open a DFM tab before running a macro." });
  shell.ensureIframe?.(tab);
  const iframe = tab.iframe;
  if (!iframe?.contentWindow) {
    return Promise.resolve({ available: false, error: "The active DFM tab is not ready yet." });
  }
  return new Promise((resolve) => {
    const requestId = `macro_context_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (context) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(context || { available: false, error: "DFM context failed." });
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const msg = event.data || {};
      if (msg.type !== "arcrho:assistant-context-result" || msg.requestId !== requestId) return;
      finish(msg.context || {});
    };
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow.postMessage({ type: "arcrho:assistant-context-request", requestId }, "*");
    } catch {
      finish({ available: false, error: "Could not request DFM context." });
      return;
    }
    setTimeout(() => finish({ available: false, error: "Timed out reading active DFM context." }), 1500);
  });
}

function applyPayloadToActiveDfm(payload) {
  const tab = getActiveDfmTab();
  if (!tab) return Promise.resolve({ ok: false, error: "Open a DFM tab before running a macro." });
  shell.ensureIframe?.(tab);
  const iframe = tab.iframe;
  if (!iframe?.contentWindow) {
    return Promise.resolve({ ok: false, error: "The active DFM tab is not ready yet." });
  }
  return new Promise((resolve) => {
    const requestId = `macro_apply_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(result || { ok: false, error: "DFM apply failed." });
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const msg = event.data || {};
      if (msg.type !== "arcrho:dfm-apply-method-payload-result" || msg.requestId !== requestId) return;
      finish({ ok: !!msg.ok, error: String(msg.error || "") });
    };
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow.postMessage({ type: "arcrho:dfm-apply-method-payload", requestId, payload }, "*");
    } catch {
      finish({ ok: false, error: "Could not apply macro result to the DFM tab." });
      return;
    }
    setTimeout(() => finish({ ok: false, error: "Timed out applying macro result." }), 3000);
  });
}

async function runSelectedMacro() {
  const macro = getSelectedMacro();
  if (!macro) return;
  if (!getActiveDfmTab()) {
    setMacroStatus("Open a DFM tab before running a macro.", "error", { statusBar: true });
    return;
  }
  setMacroStatus(`Running macro: ${macro.name || macro.id}...`, "", { statusBar: true });
  if (macroRunBtn) macroRunBtn.disabled = true;
  try {
    const activeContext = await requestActiveDfmContext();
    if (!activeContext?.available || !activeContext?.activeJson) {
      throw new Error(activeContext?.error || "Active DFM JSON is not available.");
    }
    const response = await fetch(`${API_BASE}/scripting/run-macro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ macro_id: macro.id, active_context: activeContext }),
    });
    const result = await response.json();
    if (!result?.success) throw new Error(result?.message || "Macro failed.");
    const applied = await applyPayloadToActiveDfm(result.payload);
    if (!applied?.ok) throw new Error(applied?.error || "Macro ran, but the DFM tab did not accept the result.");
    const output = String(result.stdout || "").trim();
    const message = output ? `Macro applied. ${output}` : "Macro applied to the active DFM.";
    setMacroStatus(message, "", { statusBar: true });
  } catch (err) {
    const message = String(err?.message || err || "Macro failed.");
    setMacroStatus(`Macro failed: ${message}`, "error", { statusBar: true });
  } finally {
    if (macroRunBtn) macroRunBtn.disabled = false;
  }
}

function editSelectedMacro() {
  const macro = getSelectedMacro();
  if (!macro?.path) return;
  shell.openScriptingTab?.({ forceNew: true, notebookPath: macro.path });
  setMacroStatus(`Opened ${macro.name || macro.id} in Scripting Console.`, "", { statusBar: true });
}

function clampMacroWindowPosition(left, top) {
  const margin = 8;
  const rect = macroWindow?.getBoundingClientRect?.();
  const width = rect?.width || 430;
  const height = rect?.height || 420;
  const statusbarHeight = Number(shell.getStatusBarHeight?.() || 0);
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - statusbarHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, Number(left) || margin), maxLeft),
    top: Math.min(Math.max(margin, Number(top) || margin), maxTop),
  };
}

function applyMacroWindowPosition(left, top) {
  if (!macroWindow) return;
  const next = clampMacroWindowPosition(left, top);
  macroWindow.style.left = `${Math.round(next.left)}px`;
  macroWindow.style.top = `${Math.round(next.top)}px`;
  macroWindow.style.right = "auto";
}

function readMacroWindowPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MACRO_WINDOW_POSITION_KEY) || "null");
    if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) return parsed;
  } catch {}
  return null;
}

function saveMacroWindowPosition() {
  if (!macroWindow) return;
  const rect = macroWindow.getBoundingClientRect();
  try {
    localStorage.setItem(MACRO_WINDOW_POSITION_KEY, JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    }));
  } catch {}
}

function restoreMacroWindowPosition() {
  const saved = readMacroWindowPosition();
  if (saved) applyMacroWindowPosition(saved.left, saved.top);
}

function clampOpenMacroWindow() {
  if (!macroWindow?.classList.contains("open")) return;
  const rect = macroWindow.getBoundingClientRect();
  applyMacroWindowPosition(rect.left, rect.top);
  saveMacroWindowPosition();
}

function initMacroWindowDrag() {
  if (!macroWindow || !macroHeader) return;
  let dragState = null;

  macroHeader.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.("button")) return;
    const rect = macroWindow.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try { macroHeader.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  macroHeader.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    applyMacroWindowPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
  });

  const stopDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    try { macroHeader.releasePointerCapture(event.pointerId); } catch {}
    saveMacroWindowPosition();
    dragState = null;
  };

  macroHeader.addEventListener("pointerup", stopDrag);
  macroHeader.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", clampOpenMacroWindow);
}

export function openMacroWindow() {
  restoreMacroWindowPosition();
  macroWindow?.classList.add("open");
  void loadMacros();
}

export function closeMacroWindow() {
  macroWindow?.classList.remove("open");
}

export function initMacroWindow() {
  if (macroWindowWired) return;
  macroWindowWired = true;
  macroCloseBtn?.addEventListener("click", closeMacroWindow);
  macroRefreshBtn?.addEventListener("click", () => loadMacros());
  macroRunBtn?.addEventListener("click", runSelectedMacro);
  macroEditBtn?.addEventListener("click", editSelectedMacro);
  initMacroWindowDrag();
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && macroWindow?.classList.contains("open")) closeMacroWindow();
  }, true);
}
