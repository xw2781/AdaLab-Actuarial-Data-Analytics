import { fetchProjectDatasetTypes } from "/ui/dataset/dataset_types_source.js";
import {
  loadProjectUserPreferences,
  scheduleProjectUserPreferencesSave,
} from "/ui/shared/project_user_preferences.js";
import { openLazyReservingClassPicker } from "/ui/shared/reserving_class_lazy_picker.js?v=20260517a";

const qs = new URLSearchParams(window.location.search);
const projectName = String(qs.get("project") || "").trim();

const els = {
  root: document.getElementById("projectInstanceRoot"),
  toolbar: document.querySelector(".pi-toolbar"),
  layout: document.querySelector(".pi-layout"),
  leftPanel: document.querySelector(".pi-left"),
  rightPanel: document.querySelector(".pi-right"),
  leftPanelResizer: document.getElementById("leftPanelResizer"),
  pathTree: document.getElementById("pathTree"),
  selectedPathText: document.getElementById("selectedPathText"),
  hiddenTabsWrap: document.getElementById("hiddenTabsWrap"),
  hiddenTabsList: document.getElementById("hiddenTabsList"),
  hiddenTabsButton: document.getElementById("hiddenTabsButton"),
  hiddenTabsLabel: document.getElementById("hiddenTabsLabel"),
  hiddenTabsMenu: document.getElementById("hiddenTabsMenu"),
  hiddenDropBanner: document.getElementById("hiddenDropBanner"),
  pageLoadingOverlay: document.getElementById("pageLoadingOverlay"),
  pageLoadingTitle: document.getElementById("pageLoadingTitle"),
  pageLoadingMessage: document.getElementById("pageLoadingMessage"),
  pageLoadingElapsed: document.getElementById("pageLoadingElapsed"),
  datasetTableWrap: document.getElementById("datasetTableWrap"),
  datasetTableSurface: document.getElementById("datasetTableSurface"),
  datasetTableContextMenu: document.getElementById("datasetTableContextMenu"),
  datasetGroupContextMenu: document.getElementById("datasetGroupContextMenu"),
  datasetTableFilterPopover: document.getElementById("datasetTableFilterPopover"),
  windowLayer: document.getElementById("datasetWindowLayer"),
};

const DATASET_TABLE_COLUMNS = Object.freeze([
  { key: "name", label: "Name", minWidth: 150 },
  { key: "datasetTypeName", label: "Dataset Type Name", minWidth: 150 },
  { key: "dataFormat", label: "Data Format", minWidth: 120 },
  { key: "formula", label: "Formula", minWidth: 160 },
  { key: "category", label: "Category", minWidth: 120 },
  { key: "methodType", label: "Method Type", minWidth: 110 },
  { key: "lastModified", label: "Last Modified", minWidth: 130 },
  { key: "created", label: "Created", minWidth: 110 },
  { key: "user", label: "User", minWidth: 110 },
]);
const DATASET_COLUMNS = DATASET_TABLE_COLUMNS.length;
const DATASET_TABLE_DEFAULT_WIDTHS = Object.freeze({
  name: 180,
  datasetTypeName: 180,
  dataFormat: 140,
  formula: 180,
  category: 140,
  methodType: 120,
  lastModified: 140,
  created: 120,
  user: 120,
});
const DATASET_TABLE_AUTOFIT_MAX_WIDTH = 460;
const DATASET_TABLE_AUTOFIT_CELL_EXTRA_WIDTH = 38;
const DATASET_TABLE_AUTOFIT_HEADER_EXTRA_WIDTH = 76;
const DATASET_TABLE_BLANK_LABEL = "(Blank)";
const LEFT_PANEL_DEFAULT_WIDTH = 400;
const LEFT_PANEL_MIN_WIDTH = 200;
const LEFT_PANEL_MAX_WIDTH = 600;
const LEFT_PANEL_COLLAPSE_THRESHOLD = 200;
const LEFT_PANEL_RIGHT_MIN_WIDTH = 420;
const LEFT_PANEL_KEYBOARD_STEP = 24;
const DATASET_WINDOW_MIN_WIDTH = 420;
const DATASET_WINDOW_MIN_HEIGHT = 280;
const DATASET_WINDOW_DEFAULT_WIDTH_RATIO = 0.8;
const DATASET_WINDOW_DEFAULT_HEIGHT_RATIO = 0.8;
const DATASET_WINDOW_DOCK_ANIMATION_MS = 520;
const DATASET_WINDOW_RESTORE_ANIMATION_MS = 280;
const DATASET_WINDOW_EDGE_VISIBLE_WIDTH = 80;
const DATASET_WINDOW_TITLEBAR_HEIGHT = 30;
const HIDDEN_TABS_HOVER_CLOSE_MS = 1000;
let selectedPath = "";
let datasetRows = [];
let nextWindowZ = 1;
let windowSeq = 1;
let lastExpandedLeftWidth = LEFT_PANEL_DEFAULT_WIDTH;
let lastDatasetWindowSize = null;
let activeDatasetWindow = null;
let lastDatasetWindowShortcutCloseAt = 0;
const hiddenWindows = new Map();
const datasetWindows = new Map();
const pageLoadingTasks = new Set();
let hiddenTabsHoverCloseTimer = 0;
let hiddenTabsMenuPinned = false;
let minimizedTabTooltip = null;
let pageLoadingFrameTimer = 0;
let pageLoadingStartedAt = 0;
const debugTraceSessionId = `pi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const debugTraceStartMs = performance.now();
const debugTraceQueue = [];
let debugTraceFlushTimer = 0;
let debugTraceFlushInFlight = false;
let debugTracePath = "";
let debugTraceFetchWired = false;
let debugTraceRawFetch = null;
const datasetTableView = {
  groupBy: [],
  columns: DATASET_TABLE_COLUMNS.map((col) => col.key),
  widths: { ...DATASET_TABLE_DEFAULT_WIDTHS },
  filters: new Map(),
  collapsedGroups: new Set(),
  sort: {
    key: "",
    dir: "asc",
  },
};
let datasetTableFilterColumn = "";
let datasetTableFilterAnchor = null;
let datasetTableColumnDragStarted = false;
let datasetGroupContextId = "";
let datasetTableMeasureCanvas = null;

function getDebugTraceElapsedMs() {
  return Math.round((performance.now() - debugTraceStartMs) * 10) / 10;
}

function traceEvent(step, detail = {}) {
  const safeStep = toText(step);
  if (!safeStep) return;
  debugTraceQueue.push({
    step: safeStep,
    elapsed_ms: getDebugTraceElapsedMs(),
    page_url: window.location.href,
    detail: detail && typeof detail === "object" ? detail : {},
  });
  scheduleDebugTraceFlush();
}

function scheduleDebugTraceFlush(delayMs = 200) {
  if (debugTraceFlushTimer) return;
  debugTraceFlushTimer = window.setTimeout(() => {
    debugTraceFlushTimer = 0;
    void flushDebugTrace("timer");
  }, delayMs);
}

async function flushDebugTrace(reason = "manual") {
  if (debugTraceFlushInFlight || !debugTraceQueue.length) return;
  const fetchImpl = debugTraceRawFetch || window.fetch;
  if (typeof fetchImpl !== "function") return;
  const events = debugTraceQueue.splice(0, debugTraceQueue.length);
  debugTraceFlushInFlight = true;
  try {
    const response = await fetchImpl("/debug_trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "project_instance",
        session_id: debugTraceSessionId,
        project_name: projectName,
        events: [
          {
            step: "flush",
            elapsed_ms: getDebugTraceElapsedMs(),
            detail: { reason, count: events.length },
          },
          ...events,
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.path) debugTracePath = toText(payload.path);
  } catch (err) {
    console.warn("Failed to write project instance debug trace:", err);
    debugTraceQueue.unshift(...events.slice(-100));
  } finally {
    debugTraceFlushInFlight = false;
    if (debugTraceQueue.length) scheduleDebugTraceFlush(500);
  }
}

function getFetchTraceUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return toText(input?.url);
}

function installDebugTraceFetchLogger() {
  if (debugTraceFetchWired || typeof window.fetch !== "function") return;
  debugTraceFetchWired = true;
  debugTraceRawFetch = window.fetch.bind(window);
  window.fetch = async (input, init = undefined) => {
    const url = getFetchTraceUrl(input);
    const method = toText(init?.method || input?.method || "GET").toUpperCase();
    const shouldTrace = !!url && !url.includes("/debug_trace");
    const start = performance.now();
    if (shouldTrace) {
      traceEvent("fetch_start", { method, url });
    }
    try {
      const response = await debugTraceRawFetch(input, init);
      if (shouldTrace) {
        traceEvent("fetch_end", {
          method,
          url,
          status: response.status,
          ok: response.ok,
          duration_ms: Math.round((performance.now() - start) * 10) / 10,
        });
      }
      return response;
    } catch (err) {
      if (shouldTrace) {
        traceEvent("fetch_error", {
          method,
          url,
          duration_ms: Math.round((performance.now() - start) * 10) / 10,
          error: toText(err?.message || err),
        });
      }
      throw err;
    }
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDebugTrace("visibility_hidden");
  });
  window.addEventListener("beforeunload", () => {
    void flushDebugTrace("beforeunload");
  });
}

async function applyHostFrameCornerStyle() {
  let isWin11 = false;
  try {
    isWin11 = !!window.parent?.document?.body?.classList?.contains("win11-frame");
  } catch {
    isWin11 = false;
  }

  if (!isWin11 && typeof window.ADAHost?.isWindows11 === "function") {
    try {
      isWin11 = !!(await window.ADAHost.isWindows11());
    } catch {
      isWin11 = false;
    }
  }

  document.body.classList.toggle("win11-frame", isWin11);
  document.body.classList.toggle("win10-borders", !isWin11);
}

function toText(value) {
  return String(value ?? "").trim();
}

function normalizePath(value) {
  return toText(value)
    .split("\\")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\\");
}

function setStatus(text, isError = false) {
  if (isError) console.warn(toText(text));
}

function saveLastSelectedPath(path) {
  const normalized = normalizePath(path);
  if (!projectName || !normalized) return;
  scheduleProjectUserPreferencesSave(projectName, {
    lastReservingClassPath: normalized,
  });
}

async function loadLastSelectedPath() {
  if (!projectName) return "";
  traceEvent("load_last_selected_path_start");
  try {
    const prefs = await loadProjectUserPreferences(projectName);
    const path = normalizePath(prefs?.lastReservingClassPath || prefs?.last_reserving_class_path || "");
    traceEvent("load_last_selected_path_end", { hasPath: !!path, pathLength: path.length });
    return path;
  } catch (err) {
    console.warn("Failed to load last project instance path:", err);
    traceEvent("load_last_selected_path_error", { error: toText(err?.message || err) });
    return "";
  }
}

function getDatasetWindowKey(datasetName, path = selectedPath) {
  return `${normalizePath(path)}\u0001${toText(datasetName).toLowerCase()}`;
}

function getFrameRect(frame) {
  return {
    x: Number.parseFloat(frame.style.left) || 0,
    y: Number.parseFloat(frame.style.top) || 0,
    width: Number.parseFloat(frame.style.width) || frame.getBoundingClientRect().width || DATASET_WINDOW_MIN_WIDTH,
    height: Number.parseFloat(frame.style.height) || frame.getBoundingClientRect().height || DATASET_WINDOW_MIN_HEIGHT,
  };
}

function clearHiddenTabsHoverCloseTimer() {
  if (!hiddenTabsHoverCloseTimer) return;
  window.clearTimeout(hiddenTabsHoverCloseTimer);
  hiddenTabsHoverCloseTimer = 0;
}

function setHiddenTabsMenuOpen(open, { pinned = hiddenTabsMenuPinned } = {}) {
  if (!els.hiddenTabsWrap || !els.hiddenTabsButton) return;
  if (open) clearHiddenTabsHoverCloseTimer();
  hiddenTabsMenuPinned = !!open && !!pinned;
  els.hiddenTabsWrap.classList.toggle("open", !!open);
  els.hiddenTabsButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function scheduleHiddenTabsHoverClose() {
  if (hiddenTabsMenuPinned) return;
  clearHiddenTabsHoverCloseTimer();
  hiddenTabsHoverCloseTimer = window.setTimeout(() => {
    hiddenTabsHoverCloseTimer = 0;
    if (els.hiddenTabsWrap?.matches?.(":hover") || els.hiddenTabsMenu?.matches?.(":hover")) return;
    setHiddenTabsMenuOpen(false, { pinned: false });
  }, HIDDEN_TABS_HOVER_CLOSE_MS);
}

function ensureMinimizedTabTooltip() {
  if (minimizedTabTooltip?.isConnected) return minimizedTabTooltip;
  minimizedTabTooltip = document.createElement("div");
  minimizedTabTooltip.className = "pi-minimized-tab-tooltip";
  minimizedTabTooltip.setAttribute("role", "tooltip");
  minimizedTabTooltip.setAttribute("aria-hidden", "true");
  document.body.appendChild(minimizedTabTooltip);
  return minimizedTabTooltip;
}

function positionMinimizedTabTooltip(tab) {
  if (!minimizedTabTooltip?.classList?.contains("active") || !tab?.getBoundingClientRect) return;
  const rect = tab.getBoundingClientRect();
  const tooltipRect = minimizedTabTooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - tooltipRect.width - 8, rect.left + (rect.width - tooltipRect.width) / 2));
  const top = Math.max(8, rect.bottom + 8);
  minimizedTabTooltip.style.left = `${Math.round(left)}px`;
  minimizedTabTooltip.style.top = `${Math.round(top)}px`;
}

function showMinimizedTabTooltip(tab, text) {
  const tooltipText = toText(text);
  if (!tooltipText) return;
  const tooltip = ensureMinimizedTabTooltip();
  tooltip.textContent = tooltipText;
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.classList.add("active");
  window.requestAnimationFrame(() => positionMinimizedTabTooltip(tab));
}

function hideMinimizedTabTooltip() {
  if (!minimizedTabTooltip) return;
  minimizedTabTooltip.classList.remove("active");
  minimizedTabTooltip.setAttribute("aria-hidden", "true");
}

function updateHiddenTabsArea() {
  const count = hiddenWindows.size;
  hideMinimizedTabTooltip();
  if (els.hiddenTabsLabel) {
    els.hiddenTabsLabel.textContent = `${count} hidden`;
  }
  if (els.hiddenTabsList) {
    els.hiddenTabsList.innerHTML = "";
    for (const [id, item] of hiddenWindows) {
      const fullTitle = item.fullTitle || item.title;
      const tab = document.createElement("div");
      tab.className = "pi-minimized-tab";
      tab.dataset.windowId = id;
      tab.dataset.fullTitle = fullTitle;
      tab.addEventListener("mouseenter", () => showMinimizedTabTooltip(tab, fullTitle));
      tab.addEventListener("mousemove", () => positionMinimizedTabTooltip(tab));
      tab.addEventListener("mouseleave", hideMinimizedTabTooltip);
      tab.addEventListener("focusin", () => showMinimizedTabTooltip(tab, fullTitle));
      tab.addEventListener("focusout", hideMinimizedTabTooltip);
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "pi-minimized-tab-restore";
      restoreBtn.setAttribute("aria-label", item.title);
      restoreBtn.textContent = item.title;
      restoreBtn.addEventListener("click", () => restoreHiddenWindow(id));
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "pi-minimized-tab-close";
      closeBtn.title = `Close ${item.title}`;
      closeBtn.setAttribute("aria-label", `Close ${item.title}`);
      closeBtn.textContent = "x";
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHiddenWindow(id);
      });
      tab.append(restoreBtn, closeBtn);
      els.hiddenTabsList.appendChild(tab);
    }
  }
  if (!els.hiddenTabsMenu) return;
  els.hiddenTabsMenu.innerHTML = "";
  const actions = document.createElement("div");
  actions.className = "pi-hidden-tabs-actions";
  const resumeAllBtn = document.createElement("button");
  resumeAllBtn.type = "button";
  resumeAllBtn.className = "pi-hidden-tabs-action";
  resumeAllBtn.textContent = "Resume all tabs";
  resumeAllBtn.addEventListener("click", () => {
    void restoreAllHiddenWindows();
  });
  const closeAllBtn = document.createElement("button");
  closeAllBtn.type = "button";
  closeAllBtn.className = "pi-hidden-tabs-action danger";
  closeAllBtn.textContent = "Close all tabs";
  closeAllBtn.addEventListener("click", () => {
    closeAllHiddenWindows();
  });
  actions.append(resumeAllBtn, closeAllBtn);
  els.hiddenTabsMenu.appendChild(actions);
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "pi-hidden-tabs-empty";
    empty.textContent = "No hidden tabs.";
    els.hiddenTabsMenu.appendChild(empty);
    return;
  }
  for (const [id, item] of hiddenWindows) {
    const row = document.createElement("div");
    row.className = "pi-hidden-tab-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pi-hidden-tab-item";
    button.setAttribute("role", "menuitem");
    const fullTitle = item.fullTitle || item.title;
    button.title = fullTitle;
    button.innerHTML = `
      <svg class="pi-hidden-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2"></rect>
        <path d="M9 9h6"></path>
        <path d="M9 13h6"></path>
      </svg>
      <span class="pi-hidden-tab-name"></span>
    `;
    button.querySelector(".pi-hidden-tab-name").textContent = fullTitle;
    button.addEventListener("click", () => restoreHiddenWindow(id));
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "pi-hidden-tab-delete";
    deleteBtn.title = `Close ${fullTitle}`;
    deleteBtn.setAttribute("aria-label", `Close ${fullTitle}`);
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7h16"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
        <path d="M6 7l1 13h10l1-13"></path>
        <path d="M9 7V5h6v2"></path>
      </svg>
    `;
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeHiddenWindow(id);
    });
    row.append(button, deleteBtn);
    els.hiddenTabsMenu.appendChild(row);
  }
}

function isPointInHiddenDropZone(x, y) {
  const rootRect = els.root?.getBoundingClientRect?.();
  const layoutRect = els.layout?.getBoundingClientRect?.();
  if (!rootRect || !layoutRect) return false;
  return x >= rootRect.left && x <= rootRect.right && y >= rootRect.top && y < layoutRect.top;
}

function setHiddenDropActive(active, frame = null) {
  els.hiddenTabsWrap?.classList?.toggle("drop-active", !!active);
  els.hiddenDropBanner?.classList?.toggle("active", !!active);
  els.hiddenDropBanner?.setAttribute("aria-hidden", active ? "false" : "true");
  for (const highlighted of els.windowLayer?.querySelectorAll?.(".pi-window.drop-target-active") || []) {
    if (!active || highlighted !== frame) highlighted.classList.remove("drop-target-active");
  }
  frame?.classList?.toggle("drop-target-active", !!active);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function getMinimizedTabElement(frameOrId) {
  const id = typeof frameOrId === "string" ? frameOrId : frameOrId?.dataset?.windowId || "";
  if (!id || !els.hiddenTabsList) return null;
  for (const tab of els.hiddenTabsList.querySelectorAll(".pi-minimized-tab")) {
    if (tab.dataset.windowId === id) return tab;
  }
  return null;
}

function getHiddenDockTargetRect(frameOrId = null) {
  const target = getMinimizedTabElement(frameOrId) || els.hiddenTabsButton || els.hiddenTabsWrap;
  const targetRect = target?.getBoundingClientRect?.();
  const rootRect = els.root?.getBoundingClientRect?.();
  if (!targetRect || !rootRect) return null;
  return {
    x: targetRect.left - rootRect.left,
    y: targetRect.top - rootRect.top,
    width: Math.max(1, targetRect.width),
    height: Math.max(1, targetRect.height),
  };
}

function getFrameTransformToRect(frameRect, targetRect) {
  const scaleX = Math.max(0.08, targetRect.width / Math.max(1, frameRect.width));
  const scaleY = Math.max(0.08, targetRect.height / Math.max(1, frameRect.height));
  return {
    x: targetRect.x - frameRect.x,
    y: targetRect.y - frameRect.y,
    scaleX,
    scaleY,
  };
}

async function animateWindowToDock(frame, dockRect = getHiddenDockTargetRect(frame)) {
  const frameRect = getFrameRect(frame);
  if (!dockRect || prefersReducedMotion() || typeof frame.animate !== "function") return;
  const transform = getFrameTransformToRect(frameRect, dockRect);
  frame.style.pointerEvents = "none";
  frame.style.transformOrigin = "top left";
  try {
    const animation = frame.animate(
      [
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
          offset: 0,
        },
        {
          transform: `translate(${Math.round(transform.x * 0.72)}px, ${Math.round(transform.y * 0.34)}px) scale(0.72, 0.82)`,
          opacity: 0.86,
          offset: 0.52,
        },
        {
          transform: `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px) scale(${transform.scaleX}, ${transform.scaleY})`,
          opacity: 0.08,
          offset: 1,
        },
      ],
      {
        duration: DATASET_WINDOW_DOCK_ANIMATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );
    await animation.finished;
  } catch {
    // Best-effort visual polish only.
  } finally {
    frame.style.transformOrigin = "";
    frame.style.pointerEvents = "";
  }
}

async function animateWindowFromDock(frame, dockRect = getHiddenDockTargetRect(frame)) {
  const frameRect = getFrameRect(frame);
  if (!dockRect || prefersReducedMotion() || typeof frame.animate !== "function") return;
  const transform = getFrameTransformToRect(frameRect, dockRect);
  frame.style.pointerEvents = "none";
  frame.style.transformOrigin = "top left";
  try {
    const animation = frame.animate(
      [
        {
          transform: `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px) scale(${transform.scaleX}, ${transform.scaleY})`,
          opacity: 0.08,
          offset: 0,
        },
        {
          transform: `translate(${Math.round(transform.x * 0.2)}px, ${Math.round(transform.y * 0.58)}px) scale(1.03, 0.96)`,
          opacity: 0.92,
          offset: 0.78,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
          offset: 1,
        },
      ],
      {
        duration: DATASET_WINDOW_RESTORE_ANIMATION_MS,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      }
    );
    await animation.finished;
  } catch {
    // Best-effort visual polish only.
  } finally {
    frame.style.transformOrigin = "";
    frame.style.pointerEvents = "";
  }
}

async function hideDatasetWindow(frame, restoreRect) {
  const id = frame?.dataset?.windowId || "";
  if (!id) return;
  const title = frame.dataset.windowDatasetName || frame.dataset.windowTitle || frame.getAttribute("aria-label") || "Dataset";
  hiddenWindows.set(id, {
    frame,
    title,
    fullTitle: frame.dataset.windowTitle || frame.getAttribute("aria-label") || title,
    restoreRect: restoreRect || getFrameRect(frame),
  });
  frame.dataset.hidden = "1";
  if (activeDatasetWindow === frame) activeDatasetWindow = null;
  setHiddenDropActive(false, frame);
  updateHiddenTabsArea();
  await animateWindowToDock(frame);
  frame.style.display = "none";
  setStatus(`Hidden ${title}`);
}

async function restoreHiddenWindow(id) {
  const item = hiddenWindows.get(id);
  if (!item?.frame) return;
  const dockRect = getHiddenDockTargetRect(id);
  hiddenWindows.delete(id);
  item.frame.dataset.hidden = "0";
  item.frame.style.display = "flex";
  applyWindowRect(item.frame, item.restoreRect || getFrameRect(item.frame));
  raiseWindow(item.frame);
  updateHiddenTabsArea();
  setHiddenTabsMenuOpen(hiddenWindows.size > 0);
  await animateWindowFromDock(item.frame, dockRect);
  setStatus(`Restored ${item.title}`);
}

function closeHiddenWindow(id) {
  const item = hiddenWindows.get(id);
  if (!item?.frame) return;
  const title = item.title || item.frame.dataset.windowTitle || "dataset window";
  closeDatasetWindow(item.frame, { status: false });
  if (!hiddenWindows.size) setHiddenTabsMenuOpen(false, { pinned: false });
  setStatus(`Closed ${title}`);
}

function closeAllHiddenWindows() {
  const count = hiddenWindows.size;
  if (!count) return;
  for (const id of Array.from(hiddenWindows.keys())) {
    const item = hiddenWindows.get(id);
    if (!item?.frame) {
      hiddenWindows.delete(id);
      continue;
    }
    datasetWindows.delete(item.frame.dataset.windowKey || "");
    item.frame.remove();
    hiddenWindows.delete(id);
  }
  updateHiddenTabsArea();
  setHiddenTabsMenuOpen(false, { pinned: false });
  setStatus(`Closed ${count} hidden ${count === 1 ? "tab" : "tabs"}`);
}

async function restoreAllHiddenWindows() {
  const ids = Array.from(hiddenWindows.keys());
  if (!ids.length) return;
  for (const id of ids) {
    await restoreHiddenWindow(id);
  }
  setHiddenTabsMenuOpen(false, { pinned: false });
}

async function activateDatasetWindow(frame) {
  if (!frame?.isConnected) return false;
  if (frame.dataset.hidden === "1" || frame.style.display === "none") {
    await restoreHiddenWindow(frame.dataset.windowId || "");
  } else {
    frame.style.display = "flex";
    raiseWindow(frame);
    setStatus(`Activated ${frame.dataset.windowTitle || frame.getAttribute("aria-label") || "dataset window"}`);
  }
  return true;
}

function getPageLoadingMessage() {
  const loadingPaths = pageLoadingTasks.has("paths");
  const loadingDatasets = pageLoadingTasks.has("datasets");
  if (loadingPaths && loadingDatasets) return "Loading reserving class paths and dataset types...";
  if (loadingPaths) return "Loading reserving class paths...";
  if (loadingDatasets) return "Loading dataset types...";
  return "Loading project contents...";
}

function updatePageLoadingText() {
  if (els.pageLoadingTitle) els.pageLoadingTitle.textContent = "Loading Project Instance";
  if (els.pageLoadingMessage) els.pageLoadingMessage.textContent = getPageLoadingMessage();
}

function stopPageLoadingTimer() {
  if (!pageLoadingFrameTimer) return;
  cancelAnimationFrame(pageLoadingFrameTimer);
  pageLoadingFrameTimer = 0;
}

function tickPageLoadingElapsed() {
  if (!els.pageLoadingOverlay?.classList?.contains("open")) {
    stopPageLoadingTimer();
    return;
  }
  const sec = (performance.now() - pageLoadingStartedAt) / 1000;
  if (els.pageLoadingElapsed) els.pageLoadingElapsed.textContent = `Elapsed: ${sec.toFixed(1)}s`;
  pageLoadingFrameTimer = requestAnimationFrame(tickPageLoadingElapsed);
}

function beginPageLoading(task) {
  if (!els.pageLoadingOverlay) return;
  const wasEmpty = pageLoadingTasks.size === 0;
  pageLoadingTasks.add(task);
  updatePageLoadingText();
  if (!wasEmpty) return;
  pageLoadingStartedAt = performance.now();
  if (els.pageLoadingElapsed) els.pageLoadingElapsed.textContent = "Elapsed: 0.0s";
  els.pageLoadingOverlay.classList.add("open");
  stopPageLoadingTimer();
  pageLoadingFrameTimer = requestAnimationFrame(tickPageLoadingElapsed);
}

function finishPageLoading(task) {
  if (!task) pageLoadingTasks.clear();
  else pageLoadingTasks.delete(task);
  updatePageLoadingText();
  if (pageLoadingTasks.size > 0) return;
  els.pageLoadingOverlay?.classList?.remove("open");
  stopPageLoadingTimer();
}

function setEmptyTable(message) {
  if (!els.datasetTableSurface) return;
  els.datasetTableSurface.innerHTML = "";
  const table = document.createElement("table");
  table.className = "pi-table";
  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.className = "pi-table-empty";
  td.colSpan = DATASET_COLUMNS;
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  els.datasetTableSurface.appendChild(table);
}

function getDatasetName(row) {
  return toText(row?.[0]);
}

function getMethodType(row) {
  const formula = toText(row?.[4]);
  const calculated = row?.[3] === true || String(row?.[3] || "").trim().toLowerCase() === "true";
  if (formula || calculated) return "Calculated";
  return "Source";
}

function getDatasetColumn(key) {
  return DATASET_TABLE_COLUMNS.find((col) => col.key === key) || null;
}

function getOrderedDatasetColumns() {
  const known = new Set(DATASET_TABLE_COLUMNS.map((col) => col.key));
  const ordered = datasetTableView.columns.filter((key) => known.has(key));
  for (const col of DATASET_TABLE_COLUMNS) {
    if (!ordered.includes(col.key)) ordered.push(col.key);
  }
  datasetTableView.columns = ordered;
  return ordered.map(getDatasetColumn).filter(Boolean);
}

function getDatasetGroupByKeys() {
  const raw = Array.isArray(datasetTableView.groupBy)
    ? datasetTableView.groupBy
    : [datasetTableView.groupBy];
  const allowed = new Set(["dataFormat", "category"]);
  const keys = [];
  for (const key of raw) {
    const normalized = toText(key);
    if (!allowed.has(normalized) || keys.includes(normalized)) continue;
    keys.push(normalized);
    if (keys.length >= 2) break;
  }
  datasetTableView.groupBy = keys;
  return keys;
}

function setDatasetGroupByKey(key) {
  const normalized = toText(key);
  if (!["dataFormat", "category"].includes(normalized)) return;
  const keys = getDatasetGroupByKeys();
  const next = keys.includes(normalized)
    ? keys.filter((item) => item !== normalized)
    : [...keys, normalized].slice(-2);
  datasetTableView.groupBy = next;
  datasetTableView.collapsedGroups.clear();
  closeDatasetTableContextMenu();
  renderDatasetTable();
}

function getDatasetCellValue(row, key) {
  const datasetName = getDatasetName(row);
  switch (key) {
    case "name":
    case "datasetTypeName":
      return datasetName;
    case "dataFormat":
      return toText(row?.[1]);
    case "formula":
      return toText(row?.[4]);
    case "category":
      return toText(row?.[2]);
    case "methodType":
      return getMethodType(row);
    case "lastModified":
    case "created":
    case "user":
      return "";
    default:
      return "";
  }
}

function getDatasetFilterKey(value) {
  const text = toText(value);
  return text || DATASET_TABLE_BLANK_LABEL;
}

function compareTextValues(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function buildDatasetRecord(row, rowIndex) {
  const values = {};
  for (const col of DATASET_TABLE_COLUMNS) {
    values[col.key] = getDatasetCellValue(row, col.key);
  }
  const datasetName = values.name || getDatasetName(row);
  return { row, rowIndex, datasetName, values };
}

function getDatasetRecordValue(record, key) {
  return toText(record?.values?.[key] ?? getDatasetCellValue(record?.row, key));
}

function measureDatasetTableText(text) {
  if (!datasetTableMeasureCanvas) {
    datasetTableMeasureCanvas = document.createElement("canvas");
  }
  const ctx = datasetTableMeasureCanvas.getContext?.("2d");
  if (!ctx) return String(text || "").length * 7;
  ctx.font = "12px Segoe UI, Arial, sans-serif";
  return ctx.measureText(String(text || "")).width;
}

function clampInitialDatasetTableWidth(width, col) {
  const minWidth = col?.minWidth || 80;
  const measured = Math.ceil(Number(width) || minWidth);
  return Math.max(minWidth, Math.min(DATASET_TABLE_AUTOFIT_MAX_WIDTH, measured));
}

function getInitialDatasetTableColumnWidth(col, rows = datasetRows) {
  if (!col) return 120;
  let width = measureDatasetTableText(col.label) + DATASET_TABLE_AUTOFIT_HEADER_EXTRA_WIDTH;
  const sourceRows = Array.isArray(rows) ? rows : [];
  for (const row of sourceRows) {
    const value = getDatasetCellValue(row, col.key);
    if (!value) continue;
    width = Math.max(width, measureDatasetTableText(value) + DATASET_TABLE_AUTOFIT_CELL_EXTRA_WIDTH);
    if (width >= DATASET_TABLE_AUTOFIT_MAX_WIDTH) return DATASET_TABLE_AUTOFIT_MAX_WIDTH;
  }
  return clampInitialDatasetTableWidth(width, col);
}

function autoFitInitialDatasetTableWidths(rows = datasetRows) {
  for (const col of DATASET_TABLE_COLUMNS) {
    datasetTableView.widths[col.key] = getInitialDatasetTableColumnWidth(col, rows);
  }
}

function buildDatasetTableRenderContext() {
  const records = datasetRows
    .map((row, rowIndex) => buildDatasetRecord(row, rowIndex))
    .filter((record) => record.datasetName);
  const optionsByKey = new Map();
  const selectionsByKey = new Map();

  for (const col of DATASET_TABLE_COLUMNS) {
    const seen = new Set();
    const options = [];
    for (const record of records) {
      const optionKey = getDatasetFilterKey(getDatasetRecordValue(record, col.key));
      if (seen.has(optionKey)) continue;
      seen.add(optionKey);
      options.push({
        key: optionKey,
        label: optionKey,
      });
    }
    options.sort((a, b) => {
      if (a.key === DATASET_TABLE_BLANK_LABEL) return 1;
      if (b.key === DATASET_TABLE_BLANK_LABEL) return -1;
      return compareTextValues(a.label, b.label);
    });
    optionsByKey.set(col.key, options);
    selectionsByKey.set(col.key, getDatasetFilterSelection(col.key, options));
  }

  return { records, optionsByKey, selectionsByKey };
}

function compareDatasetRecords(a, b) {
  const sortKey = toText(datasetTableView.sort?.key);
  const dir = datasetTableView.sort?.dir === "desc" ? -1 : 1;
  if (!getDatasetColumn(sortKey)) return (a?.rowIndex ?? 0) - (b?.rowIndex ?? 0);
  const cmp = compareTextValues(
    getDatasetRecordValue(a, sortKey),
    getDatasetRecordValue(b, sortKey)
  );
  if (cmp !== 0) return cmp * dir;
  return (a?.rowIndex ?? 0) - (b?.rowIndex ?? 0);
}

function sortDatasetRecords(records) {
  const list = Array.isArray(records) ? records.slice() : [];
  if (!getDatasetColumn(datasetTableView.sort?.key)) return list;
  return list.sort(compareDatasetRecords);
}

function toggleDatasetTableSort(key) {
  if (!getDatasetColumn(key)) return;
  const currentKey = toText(datasetTableView.sort?.key);
  const currentDir = datasetTableView.sort?.dir === "desc" ? "desc" : "asc";
  datasetTableView.sort = {
    key,
    dir: currentKey === key && currentDir === "asc" ? "desc" : "asc",
  };
  renderDatasetTable();
}

function getSortIconSvg(dir) {
  const isDesc = dir === "desc";
  return isDesc
    ? `<svg class="pi-table-sort-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 9.5L2.2 4h7.6L6 9.5z"></path></svg>`
    : `<svg class="pi-table-sort-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 2.5L9.8 8H2.2L6 2.5z"></path></svg>`;
}

function getDatasetColumnOptions(key, context = null) {
  const cached = context?.optionsByKey?.get?.(key);
  if (cached) return cached;
  const seen = new Set();
  const options = [];
  for (const row of datasetRows) {
    const value = getDatasetCellValue(row, key);
    const optionKey = getDatasetFilterKey(value);
    if (seen.has(optionKey)) continue;
    seen.add(optionKey);
    options.push({
      key: optionKey,
      label: optionKey,
    });
  }
  options.sort((a, b) => {
    if (a.key === DATASET_TABLE_BLANK_LABEL) return 1;
    if (b.key === DATASET_TABLE_BLANK_LABEL) return -1;
    return compareTextValues(a.label, b.label);
  });
  return options;
}

function getDatasetFilterSelection(key, options = getDatasetColumnOptions(key)) {
  const optionKeys = new Set(options.map((opt) => opt.key));
  let selected = datasetTableView.filters.get(key);
  if (!(selected instanceof Set)) {
    selected = new Set();
    datasetTableView.filters.set(key, selected);
    return selected;
  }
  for (const selectedKey of Array.from(selected)) {
    if (!optionKeys.has(selectedKey)) selected.delete(selectedKey);
  }
  return selected;
}

function isDatasetColumnFilterActive(key, context = null) {
  const options = getDatasetColumnOptions(key, context);
  if (!options.length) return false;
  const selected = context?.selectionsByKey?.get?.(key) || getDatasetFilterSelection(key, options);
  if (!(selected instanceof Set) || selected.size === 0) return false;
  if (selected.size !== options.length) return true;
  return options.some((opt) => !selected.has(opt.key));
}

function rowMatchesDatasetTableFilters(record, context) {
  for (const col of DATASET_TABLE_COLUMNS) {
    const options = getDatasetColumnOptions(col.key, context);
    if (!options.length) continue;
    const selected = context?.selectionsByKey?.get?.(col.key) || getDatasetFilterSelection(col.key, options);
    if (!(selected instanceof Set) || selected.size === 0 || selected.size === options.length) continue;
    if (!selected.has(getDatasetFilterKey(getDatasetRecordValue(record, col.key)))) return false;
  }
  return true;
}

function getDatasetTableWidth(key) {
  const col = getDatasetColumn(key);
  const width = Number(datasetTableView.widths[key]);
  return Math.max(col?.minWidth || 80, Number.isFinite(width) ? width : col?.minWidth || 120);
}

function getDatasetTableTotalWidth() {
  return getOrderedDatasetColumns().reduce((sum, col) => sum + getDatasetTableWidth(col.key), 0);
}

function syncDatasetTableTotalWidth() {
  const width = Math.max(1, Math.round(getDatasetTableTotalWidth()));
  for (const table of els.datasetTableSurface?.querySelectorAll?.(".pi-table") || []) {
    table.style.width = `${width}px`;
    table.style.minWidth = `${width}px`;
  }
}

function setDatasetTableColumnWidth(key, width) {
  const col = getDatasetColumn(key);
  if (!col) return;
  const next = Math.max(col.minWidth || 80, Math.round(Number(width) || col.minWidth || 120));
  datasetTableView.widths[key] = next;
  for (const colEl of els.datasetTableSurface?.querySelectorAll?.(`col[data-col-key="${CSS.escape(key)}"]`) || []) {
    colEl.style.width = `${next}px`;
  }
  syncDatasetTableTotalWidth();
}

function getDatasetTableRecords(context) {
  const records = Array.isArray(context?.records) ? context.records : datasetRows.map((row, rowIndex) => buildDatasetRecord(row, rowIndex));
  return records.filter((item) => item.datasetName && rowMatchesDatasetTableFilters(item, context));
}

function createDatasetTableHeaderCell(col, colIndex, context = null) {
  const th = document.createElement("th");
  th.dataset.colKey = col.key;
  th.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("text/x-pi-column")) return;
    event.preventDefault();
    th.classList.add("pi-col-drag-over");
  });
  th.addEventListener("dragleave", () => th.classList.remove("pi-col-drag-over"));
  th.addEventListener("drop", (event) => {
    const sourceKey = event.dataTransfer?.getData("text/x-pi-column") || "";
    th.classList.remove("pi-col-drag-over");
    if (!sourceKey || sourceKey === col.key) return;
    event.preventDefault();
    moveDatasetTableColumn(sourceKey, col.key);
  });

  const cell = document.createElement("div");
  cell.className = "pi-table-header-cell";

  const label = document.createElement("span");
  label.className = "pi-table-col-label";
  label.title = "Click to sort. Drag to reorder columns.";
  label.draggable = true;
  const labelText = document.createElement("span");
  labelText.className = "pi-table-col-label-text";
  labelText.textContent = col.label;
  label.appendChild(labelText);
  const isSorted = datasetTableView.sort?.key === col.key;
  if (isSorted) {
    label.insertAdjacentHTML("beforeend", getSortIconSvg(datasetTableView.sort?.dir));
  }
  label.addEventListener("click", (event) => {
    if (datasetTableColumnDragStarted) return;
    event.preventDefault();
    event.stopPropagation();
    toggleDatasetTableSort(col.key);
  });
  label.addEventListener("dragstart", (event) => {
    datasetTableColumnDragStarted = true;
    event.dataTransfer?.setData("text/x-pi-column", col.key);
    event.dataTransfer.effectAllowed = "move";
  });
  label.addEventListener("dragend", () => {
    window.setTimeout(() => {
      datasetTableColumnDragStarted = false;
    }, 0);
  });
  cell.appendChild(label);

  const filterBtn = document.createElement("button");
  filterBtn.type = "button";
  filterBtn.className = "pi-table-filter-btn";
  filterBtn.title = `${col.label} Filter`;
  filterBtn.classList.toggle("active", isDatasetColumnFilterActive(col.key, context));
  filterBtn.innerHTML = `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 3h12L9.5 8v4l-3 1V8z"></path>
    </svg>
  `;
  filterBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleDatasetTableFilterPopover(col.key, filterBtn);
  });
  cell.appendChild(filterBtn);

  const resizer = document.createElement("div");
  resizer.className = "pi-table-col-resizer";
  resizer.title = "Resize column";
  resizer.addEventListener("mousedown", (event) => startDatasetTableColumnResize(event, col.key));
  resizer.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    autoFitDatasetTableColumn(col.key, colIndex);
  });
  cell.appendChild(resizer);
  th.appendChild(cell);
  return th;
}

function createDatasetRecordRow(item, columns) {
  const tr = document.createElement("tr");
  tr.title = selectedPath
    ? `Open ${item.datasetName} for ${selectedPath}`
    : "Select a reserving class path before opening a dataset.";
  for (const col of columns) {
    const value = getDatasetRecordValue(item, col.key);
    const td = document.createElement("td");
    td.title = value;
    const text = document.createElement("span");
    text.className = "pi-table-cell-text";
    text.textContent = value;
    td.appendChild(text);
    tr.appendChild(td);
  }
  tr.addEventListener("dblclick", () => {
    openDatasetWindow(item.datasetName);
  });
  return tr;
}

function getDatasetGroupId(parts) {
  return JSON.stringify(parts.map((part) => [part.key, part.valueKey]));
}

function createDatasetGroupRow(part, depth, columns) {
  const groupId = getDatasetGroupId(part.path);
  const collapsed = datasetTableView.collapsedGroups.has(groupId);
  const tr = document.createElement("tr");
  tr.className = `pi-table-group-row depth-${Math.min(1, depth)}`;
  tr.classList.toggle("collapsed", collapsed);
  tr.dataset.groupId = groupId;
  const td = document.createElement("td");
  td.colSpan = columns.length;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pi-table-group-button";
  btn.innerHTML = `
    <svg class="pi-table-group-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.2 4.2h5.6L6 7.7z"></path>
    </svg>
    <span class="pi-table-group-text"></span>
  `;
  const text = btn.querySelector(".pi-table-group-text");
  if (text) {
    text.textContent = `${part.label}: ${part.valueLabel}`;
  }
  if (depth === 0) {
    const count = document.createElement("span");
    count.className = "pi-table-group-count";
    count.textContent = String(part.records.length);
    count.title = `${part.records.length} records`;
    btn.appendChild(count);
  }
  btn.addEventListener("click", () => {
    if (datasetTableView.collapsedGroups.has(groupId)) datasetTableView.collapsedGroups.delete(groupId);
    else datasetTableView.collapsedGroups.add(groupId);
    renderDatasetTable();
  });
  btn.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showDatasetGroupContextMenu(groupId, event.clientX, event.clientY);
  });
  td.appendChild(btn);
  tr.appendChild(td);
  return tr;
}

function buildDatasetGroupParts(records, groupKeys, depth = 0, path = []) {
  const groupKey = groupKeys[depth];
  const col = getDatasetColumn(groupKey);
  if (!col) return [];
  const groups = new Map();
  for (const record of records) {
    const valueKey = getDatasetFilterKey(getDatasetRecordValue(record, groupKey));
    if (!groups.has(valueKey)) groups.set(valueKey, []);
    groups.get(valueKey).push(record);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === DATASET_TABLE_BLANK_LABEL) return 1;
      if (b === DATASET_TABLE_BLANK_LABEL) return -1;
      return compareTextValues(a, b);
    })
    .map(([valueKey, groupRecords]) => ({
      key: groupKey,
      label: col.label,
      valueKey,
      valueLabel: valueKey,
      records: groupRecords,
      path: [...path, { key: groupKey, valueKey }],
    }));
}

function appendGroupedDatasetRows(tbody, records, groupKeys, columns, depth = 0, path = []) {
  if (depth >= groupKeys.length) {
    for (const item of sortDatasetRecords(records)) {
      tbody.appendChild(createDatasetRecordRow(item, columns));
    }
    return;
  }
  for (const part of buildDatasetGroupParts(records, groupKeys, depth, path)) {
    tbody.appendChild(createDatasetGroupRow(part, depth, columns));
    const groupId = getDatasetGroupId(part.path);
    if (datasetTableView.collapsedGroups.has(groupId)) continue;
    appendGroupedDatasetRows(tbody, part.records, groupKeys, columns, depth + 1, part.path);
  }
}

function createDatasetTable(records, context = null) {
  const group = document.createElement("div");
  group.className = "pi-table-group";

  const table = document.createElement("table");
  table.className = "pi-table";
  const tableWidth = Math.max(1, Math.round(getDatasetTableTotalWidth()));
  table.style.width = `${tableWidth}px`;
  table.style.minWidth = `${tableWidth}px`;
  const colgroup = document.createElement("colgroup");
  const columns = getOrderedDatasetColumns();
  columns.forEach((col) => {
    const colEl = document.createElement("col");
    colEl.dataset.colKey = col.key;
    colEl.style.width = `${getDatasetTableWidth(col.key)}px`;
    colgroup.appendChild(colEl);
  });
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach((col, colIndex) => headerRow.appendChild(createDatasetTableHeaderCell(col, colIndex, context)));
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (!records.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "pi-table-empty";
    td.colSpan = columns.length;
    td.textContent = "No rows for selected filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    const groupKeys = getDatasetGroupByKeys();
    if (groupKeys.length) appendGroupedDatasetRows(tbody, records, groupKeys, columns);
    else for (const item of sortDatasetRecords(records)) tbody.appendChild(createDatasetRecordRow(item, columns));
  }
  table.appendChild(tbody);
  group.appendChild(table);
  return group;
}

function moveDatasetTableColumn(sourceKey, targetKey) {
  const columns = datasetTableView.columns.slice();
  const from = columns.indexOf(sourceKey);
  const to = columns.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return;
  columns.splice(from, 1);
  columns.splice(to, 0, sourceKey);
  datasetTableView.columns = columns;
  renderDatasetTable();
}

function startDatasetTableColumnResize(event, key) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  closeDatasetTableFilterPopover();
  const startX = event.clientX;
  const startWidth = getDatasetTableWidth(key);
  document.body.classList.add("pi-resizing-table-column");

  const onMove = (moveEvent) => {
    setDatasetTableColumnWidth(key, startWidth + moveEvent.clientX - startX);
  };
  const onUp = () => {
    document.body.classList.remove("pi-resizing-table-column");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
}

function autoFitDatasetTableColumn(key, colIndex) {
  const col = getDatasetColumn(key);
  if (!col) return;
  let width = col.minWidth || 80;
  const rows = els.datasetTableSurface?.querySelectorAll?.(".pi-table tbody tr") || [];
  for (const tr of rows) {
    const td = tr.children[colIndex];
    if (!td || td.classList.contains("pi-table-empty")) continue;
    width = Math.max(
      width,
      Math.min(
        DATASET_TABLE_AUTOFIT_MAX_WIDTH,
        measureDatasetTableText(td.textContent || "") + DATASET_TABLE_AUTOFIT_CELL_EXTRA_WIDTH
      )
    );
  }
  width = Math.max(
    width,
    Math.min(
      DATASET_TABLE_AUTOFIT_MAX_WIDTH,
      measureDatasetTableText(col.label) + DATASET_TABLE_AUTOFIT_HEADER_EXTRA_WIDTH
    )
  );
  setDatasetTableColumnWidth(key, width);
}

function renderDatasetTable() {
  if (!els.datasetTableSurface) return;
  const start = performance.now();
  if (!datasetRows.length) {
    els.datasetTableSurface.innerHTML = "";
    setEmptyTable("No dataset types are defined for this project.");
    traceEvent("render_dataset_table_empty", {
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
    return;
  }

  const context = buildDatasetTableRenderContext();
  const records = getDatasetTableRecords(context);
  if (!records.length) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createDatasetTable([], context));
    els.datasetTableSurface.replaceChildren(fragment);
    traceEvent("render_dataset_table_no_visible_rows", {
      datasetRows: datasetRows.length,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
    return;
  }

  const groupKeys = getDatasetGroupByKeys();
  const fragment = document.createDocumentFragment();
  fragment.appendChild(createDatasetTable(records, context));
  els.datasetTableSurface.replaceChildren(fragment);
  traceEvent("render_dataset_table_end", {
    datasetRows: datasetRows.length,
    visibleRows: records.length,
    groups: groupKeys.length,
    groupBy: groupKeys.join(","),
    sortKey: datasetTableView.sort?.key || "",
    duration_ms: Math.round((performance.now() - start) * 10) / 10,
  });
}

function positionFixedMenu(el, x, y) {
  if (!el) return;
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  const rect = el.getBoundingClientRect();
  const pad = 8;
  const left = Math.max(pad, Math.min(rect.left, window.innerWidth - rect.width - pad));
  const top = Math.max(pad, Math.min(rect.top, window.innerHeight - rect.height - pad));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function closeDatasetTableContextMenu() {
  els.datasetTableContextMenu?.classList?.remove("open");
  els.datasetTableContextMenu?.setAttribute("aria-hidden", "true");
}

function closeDatasetGroupContextMenu() {
  els.datasetGroupContextMenu?.classList?.remove("open");
  els.datasetGroupContextMenu?.setAttribute("aria-hidden", "true");
  datasetGroupContextId = "";
}

function showDatasetTableContextMenu(x, y) {
  const menu = els.datasetTableContextMenu;
  if (!menu) return;
  closeDatasetTableFilterPopover();
  closeDatasetGroupContextMenu();
  const groupKeys = getDatasetGroupByKeys();
  for (const item of menu.querySelectorAll("[data-group-key]")) {
    item.classList.toggle("active", groupKeys.includes(toText(item.dataset.groupKey)));
  }
  menu.classList.add("open");
  menu.setAttribute("aria-hidden", "false");
  positionFixedMenu(menu, x, y);
}

function showDatasetGroupContextMenu(groupId, x, y) {
  const menu = els.datasetGroupContextMenu;
  if (!menu || !groupId) return;
  datasetGroupContextId = groupId;
  closeDatasetTableContextMenu();
  closeDatasetTableFilterPopover();
  menu.classList.add("open");
  menu.setAttribute("aria-hidden", "false");
  positionFixedMenu(menu, x, y);
}

function parseDatasetGroupId(groupId) {
  try {
    const parsed = JSON.parse(groupId);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        key: toText(Array.isArray(item) ? item[0] : item?.key),
        valueKey: toText(Array.isArray(item) ? item[1] : item?.valueKey),
      }))
      .filter((item) => item.key && item.valueKey);
  } catch {
    return [];
  }
}

function datasetRecordMatchesGroupPath(record, path) {
  return path.every((part) => getDatasetFilterKey(getDatasetRecordValue(record, part.key)) === part.valueKey);
}

function collectDatasetDescendantGroupIds(records, groupKeys, depth, path, out) {
  if (depth >= groupKeys.length) return;
  for (const part of buildDatasetGroupParts(records, groupKeys, depth, path)) {
    const id = getDatasetGroupId(part.path);
    out.push(id);
    collectDatasetDescendantGroupIds(part.records, groupKeys, depth + 1, part.path, out);
  }
}

function getDatasetDescendantGroupIds(groupId) {
  const path = parseDatasetGroupId(groupId);
  if (!path.length) return [];
  const groupKeys = getDatasetGroupByKeys();
  if (path.length >= groupKeys.length) return [];
  const context = buildDatasetTableRenderContext();
  const records = getDatasetTableRecords(context).filter((record) => datasetRecordMatchesGroupPath(record, path));
  const ids = [];
  collectDatasetDescendantGroupIds(records, groupKeys, path.length, path, ids);
  return ids;
}

function applyDatasetGroupContextAction(action) {
  const ids = getDatasetDescendantGroupIds(datasetGroupContextId);
  if (action === "collapse-all") {
    for (const id of ids) datasetTableView.collapsedGroups.add(id);
  } else if (action === "expand-all") {
    for (const id of ids) datasetTableView.collapsedGroups.delete(id);
  }
  closeDatasetGroupContextMenu();
  renderDatasetTable();
}

function closeDatasetTableFilterPopover() {
  const pop = els.datasetTableFilterPopover;
  if (!pop) return;
  pop.classList.remove("open");
  pop.setAttribute("aria-hidden", "true");
  pop.innerHTML = "";
  datasetTableFilterColumn = "";
  datasetTableFilterAnchor = null;
}

function positionDatasetTableFilterPopover() {
  const pop = els.datasetTableFilterPopover;
  const anchor = datasetTableFilterAnchor;
  if (!pop?.classList?.contains("open") || !anchor?.getBoundingClientRect) return;
  const rect = anchor.getBoundingClientRect();
  positionFixedMenu(pop, rect.left, rect.bottom + 6);
}

function openDatasetTableFilterPopover(key, anchor) {
  const col = getDatasetColumn(key);
  const pop = els.datasetTableFilterPopover;
  if (!col || !pop) return;
  closeDatasetTableContextMenu();
  const options = getDatasetColumnOptions(key);
  const selected = getDatasetFilterSelection(key, options);
  pop.innerHTML = "";

  const title = document.createElement("div");
  title.className = "pi-table-filter-title";
  title.textContent = `${col.label} Filter`;
  pop.appendChild(title);

  const list = document.createElement("div");
  list.className = "pi-table-filter-list";
  pop.appendChild(list);

  for (const opt of options) {
    const row = document.createElement("label");
    row.className = "pi-table-filter-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(opt.key);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(opt.key);
      else selected.delete(opt.key);
      renderDatasetTable();
      const nextAnchor = findDatasetFilterButton(key);
      if (nextAnchor) openDatasetTableFilterPopover(key, nextAnchor);
    });
    const text = document.createElement("span");
    text.textContent = opt.label;
    row.append(cb, text);
    list.appendChild(row);
  }

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "pi-table-filter-empty";
    empty.textContent = "No values";
    list.appendChild(empty);
  }

  datasetTableFilterColumn = key;
  datasetTableFilterAnchor = anchor || findDatasetFilterButton(key);
  pop.classList.add("open");
  pop.setAttribute("aria-hidden", "false");
  positionDatasetTableFilterPopover();
}

function toggleDatasetTableFilterPopover(key, anchor) {
  const pop = els.datasetTableFilterPopover;
  if (
    pop?.classList?.contains("open")
    && datasetTableFilterColumn === key
  ) {
    closeDatasetTableFilterPopover();
    return;
  }
  openDatasetTableFilterPopover(key, anchor);
}

function findDatasetFilterButton(key) {
  const th = els.datasetTableSurface?.querySelector?.(`th[data-col-key="${CSS.escape(key)}"]`);
  return th?.querySelector?.(".pi-table-filter-btn") || null;
}

function initDatasetTableInteractions() {
  if (els.rightPanel?.dataset?.tableInteractionsWired === "1") return;
  if (els.rightPanel) els.rightPanel.dataset.tableInteractionsWired = "1";
  els.datasetTableSurface?.addEventListener("contextmenu", (event) => {
    if (!event.target?.closest?.(".pi-table thead th")) return;
    event.preventDefault();
    event.stopPropagation();
    showDatasetTableContextMenu(event.clientX, event.clientY);
  });
  els.datasetTableContextMenu?.addEventListener("click", (event) => {
    const item = event.target?.closest?.("[data-group-key]");
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    setDatasetGroupByKey(item.dataset.groupKey);
  });
  els.datasetGroupContextMenu?.addEventListener("click", (event) => {
    const item = event.target?.closest?.("[data-group-action]");
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    applyDatasetGroupContextAction(item.dataset.groupAction);
  });
  document.addEventListener("mousedown", (event) => {
    if (els.datasetTableContextMenu?.contains(event.target)) return;
    if (els.datasetGroupContextMenu?.contains(event.target)) return;
    if (els.datasetTableFilterPopover?.contains(event.target)) return;
    if (event.target?.closest?.(".pi-table-filter-btn")) return;
    closeDatasetTableContextMenu();
    closeDatasetGroupContextMenu();
    closeDatasetTableFilterPopover();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDatasetTableContextMenu();
    closeDatasetGroupContextMenu();
    closeDatasetTableFilterPopover();
  }, true);
  window.addEventListener("resize", () => {
    closeDatasetTableContextMenu();
    closeDatasetGroupContextMenu();
    positionDatasetTableFilterPopover();
  });
  els.datasetTableWrap?.addEventListener("scroll", positionDatasetTableFilterPopover, true);
}

function setSelectedPath(path, options = {}) {
  selectedPath = normalizePath(path);
  traceEvent("set_selected_path", {
    hasPath: !!selectedPath,
    pathLength: selectedPath.length,
    persist: options?.persist !== false,
  });
  if (els.selectedPathText) {
    els.selectedPathText.textContent = selectedPath || "Select a reserving class path.";
    els.selectedPathText.title = selectedPath;
  }
  renderDatasetTable();
  if (options?.persist !== false) saveLastSelectedPath(selectedPath);
}

function waitForPathTreeRender() {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => resolve());
    }, 0);
  });
}

function markPathTreeActive(path) {
  const normalized = normalizePath(path);
  if (!els.pathTree || !normalized) return;
  const candidates = els.pathTree.querySelectorAll(".ptree-favorite-row, .ptree-leaf, .ptree-folder");
  for (const el of candidates) {
    const elPath = normalizePath(el.getAttribute("title") || el.dataset?.path || "");
    el.classList.toggle("active-path", !!elPath && elPath.toLowerCase() === normalized.toLowerCase());
  }
}

function getFirstShortcutPath() {
  if (!els.pathTree) return "";
  const shortcutRows = els.pathTree.querySelectorAll(".ptree-section-favorites .ptree-favorite-row[title]");
  for (const row of shortcutRows) {
    const path = normalizePath(row.getAttribute("title") || "");
    if (path) return path;
  }
  return "";
}

async function selectStartupFallbackPath() {
  traceEvent("select_startup_fallback_start");
  await waitForPathTreeRender();
  if (selectedPath) {
    markPathTreeActive(selectedPath);
    traceEvent("select_startup_fallback_skip", { reason: "selected_path_exists" });
    return;
  }
  const shortcutPath = getFirstShortcutPath();
  if (!shortcutPath) {
    traceEvent("select_startup_fallback_skip", { reason: "no_shortcut_path" });
    return;
  }
  setSelectedPath(shortcutPath, { persist: false });
  markPathTreeActive(shortcutPath);
  traceEvent("select_startup_fallback_end", { shortcutPathLength: shortcutPath.length });
}

function getLeftPanelMaxWidth() {
  const layoutWidth = Math.max(0, Number(els.layout?.clientWidth || 0));
  const splitterWidth = Math.max(0, Number(els.leftPanelResizer?.offsetWidth || 0));
  if (!layoutWidth) return LEFT_PANEL_MAX_WIDTH;
  const availableWidth = layoutWidth - splitterWidth - LEFT_PANEL_RIGHT_MIN_WIDTH;
  return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_MAX_WIDTH, availableWidth));
}

function getCurrentLeftPanelWidth() {
  const width = Number(els.leftPanel?.getBoundingClientRect?.().width || 0);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function clampLeftPanelWidth(width) {
  const raw = Number(width);
  const maxWidth = getLeftPanelMaxWidth();
  if (!Number.isFinite(raw)) return Math.min(lastExpandedLeftWidth, maxWidth);
  return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(raw, maxWidth));
}

function setLeftPanelCollapsed(collapsed) {
  if (!els.layout) return;
  els.layout.classList.toggle("left-collapsed", !!collapsed);
  els.layout.style.setProperty("--pi-left-width", collapsed ? "0px" : `${Math.round(lastExpandedLeftWidth)}px`);
  if (els.leftPanelResizer) {
    els.leftPanelResizer.setAttribute("aria-valuenow", collapsed ? "0" : String(Math.round(lastExpandedLeftWidth)));
    els.leftPanelResizer.setAttribute("aria-expanded", collapsed ? "false" : "true");
    els.leftPanelResizer.title = collapsed
      ? "Drag right or double-click to expand reserving class panel"
      : "Drag to resize or double-click to collapse reserving class panel";
  }
}

function setLeftPanelWidth(width) {
  const next = clampLeftPanelWidth(width);
  lastExpandedLeftWidth = next;
  setLeftPanelCollapsed(false);
}

function resizeLeftPanel(width) {
  const raw = Number(width);
  if (!Number.isFinite(raw) || raw <= LEFT_PANEL_COLLAPSE_THRESHOLD) {
    setLeftPanelCollapsed(true);
    return;
  }
  setLeftPanelWidth(raw);
}

function toggleLeftPanelCollapsed() {
  const collapsed = !!els.layout?.classList.contains("left-collapsed");
  if (collapsed) setLeftPanelWidth(lastExpandedLeftWidth);
  else setLeftPanelCollapsed(true);
}

function initLeftPanelResizer() {
  const { layout, leftPanel, leftPanelResizer } = els;
  if (!layout || !leftPanel || !leftPanelResizer || leftPanelResizer.dataset.wired === "1") return;
  leftPanelResizer.dataset.wired = "1";
  lastExpandedLeftWidth = clampLeftPanelWidth(getCurrentLeftPanelWidth() || LEFT_PANEL_DEFAULT_WIDTH);
  setLeftPanelWidth(lastExpandedLeftWidth);

  const startDrag = (event) => {
    if (event.button !== 0) return;
    const layoutRect = layout.getBoundingClientRect();
    const leftEdge = Number(layoutRect?.left || 0);
    leftPanelResizer.classList.add("dragging");
    document.body.classList.add("resizing-left-panel");
    let pendingWidth = getCurrentLeftPanelWidth() || lastExpandedLeftWidth;
    let resizeFrame = 0;

    const flushResize = () => {
      resizeFrame = 0;
      resizeLeftPanel(pendingWidth);
    };

    const scheduleResize = (width) => {
      pendingWidth = width;
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(flushResize);
    };

    const onMove = (moveEvent) => {
      scheduleResize(Number(moveEvent.clientX || 0) - leftEdge);
    };
    const onUp = () => {
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame);
        flushResize();
      }
      leftPanelResizer.classList.remove("dragging");
      document.body.classList.remove("resizing-left-panel");
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    event.preventDefault();
  };

  leftPanelResizer.addEventListener("mousedown", startDrag);
  leftPanelResizer.addEventListener("dblclick", (event) => {
    event.preventDefault();
    toggleLeftPanelCollapsed();
  });
  leftPanelResizer.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleLeftPanelCollapsed();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const baseWidth = layout.classList.contains("left-collapsed")
      ? LEFT_PANEL_COLLAPSE_THRESHOLD
      : getCurrentLeftPanelWidth();
    resizeLeftPanel(baseWidth + direction * LEFT_PANEL_KEYBOARD_STEP);
  });
  window.addEventListener("resize", () => {
    if (layout.classList.contains("left-collapsed")) return;
    setLeftPanelWidth(lastExpandedLeftWidth);
  });
}

async function loadPathTree() {
  if (!els.pathTree) return;
  const start = performance.now();
  traceEvent("load_path_tree_start");
  beginPageLoading("paths");
  if (!projectName) {
    els.pathTree.innerHTML = '<div class="ptree-empty">Project name is missing.</div>';
    finishPageLoading("paths");
    return;
  }

  try {
    const initialPath = await loadLastSelectedPath();
    if (initialPath) {
      setSelectedPath(initialPath, { persist: false });
    }
    traceEvent("open_lazy_reserving_class_picker_start", { hasInitialPath: !!initialPath });
    const result = await openLazyReservingClassPicker({
      projectName,
      inlineContainer: els.pathTree,
      initialPath,
      setStatus: (message) => setStatus(message),
      title: "Reserving Class",
      onProjectMissing: (name) => {
        els.pathTree.innerHTML = `<div class="ptree-empty">Project "${name}" does not exist.</div>`;
        setStatus(`Project "${name}" does not exist.`, true);
      },
      onError: (err) => {
        console.error("Failed to load reserving class paths:", err);
        els.pathTree.innerHTML = '<div class="ptree-empty">Failed to load reserving class paths.</div>';
        setStatus(toText(err?.message) || "Failed to load reserving class paths.", true);
      },
      onSelect: (path) => setSelectedPath(path),
    });
    if (!result?.ok && !els.pathTree.querySelector(".ptree-window")) {
      els.pathTree.innerHTML = '<div class="ptree-empty">No reserving class paths found.</div>';
    }
    traceEvent("open_lazy_reserving_class_picker_end", {
      ok: !!result?.ok,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
    await selectStartupFallbackPath();
    traceEvent("load_path_tree_end", {
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
      treeRows: els.pathTree.querySelectorAll(".ptree-favorite-row, .ptree-folder, .ptree-leaf").length,
    });
  } catch (err) {
    console.error("Failed to load reserving class paths:", err);
    els.pathTree.innerHTML = '<div class="ptree-empty">Failed to load reserving class paths.</div>';
    setStatus(toText(err?.message) || "Failed to load reserving class paths.", true);
    traceEvent("load_path_tree_error", {
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
      error: toText(err?.message || err),
    });
  } finally {
    finishPageLoading("paths");
  }
}

async function loadDatasets() {
  const start = performance.now();
  traceEvent("load_datasets_start");
  beginPageLoading("datasets");
  if (!projectName) {
    setEmptyTable("Project name is missing.");
    finishPageLoading("datasets");
    return;
  }
  try {
    const fetched = await fetchProjectDatasetTypes(projectName);
    datasetRows = Array.isArray(fetched?.data?.rows)
      ? fetched.data.rows.filter((row) => getDatasetName(row))
      : [];
    autoFitInitialDatasetTableWidths(datasetRows);
    traceEvent("load_datasets_fetched", {
      rows: datasetRows.length,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
    renderDatasetTable();
    traceEvent("load_datasets_end", {
      rows: datasetRows.length,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
  } catch (err) {
    console.error("Failed to load dataset types:", err);
    setEmptyTable("Failed to load dataset types.");
    setStatus(toText(err?.message) || "Failed to load dataset types.", true);
    traceEvent("load_datasets_error", {
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
      error: toText(err?.message || err),
    });
  } finally {
    finishPageLoading("datasets");
  }
}

function getWindowBounds() {
  const rect = els.root?.getBoundingClientRect?.();
  return {
    width: Math.max(480, Number(rect?.width || window.innerWidth || 900)),
    height: Math.max(360, Number(rect?.height || window.innerHeight || 640)),
  };
}

function getWindowTopLimit() {
  const rootRect = els.root?.getBoundingClientRect?.();
  const toolbarRect = els.toolbar?.getBoundingClientRect?.();
  if (!rootRect || !toolbarRect) return 0;
  return Math.max(0, Math.round(toolbarRect.bottom - rootRect.top));
}

function getWindowHorizontalLimits(width, bounds = getWindowBounds()) {
  const visibleWidth = Math.min(DATASET_WINDOW_EDGE_VISIBLE_WIDTH, Math.max(1, Number(width) || 1));
  return {
    minX: Math.min(0, visibleWidth - width),
    maxX: Math.max(0, bounds.width - visibleWidth),
  };
}

function clampWindowRect(rect) {
  const bounds = getWindowBounds();
  const minY = getWindowTopLimit();
  const maxHeight = Math.max(DATASET_WINDOW_MIN_HEIGHT, bounds.height - minY);
  const width = Math.max(DATASET_WINDOW_MIN_WIDTH, Math.min(Number(rect.width) || 760, bounds.width));
  const height = Math.max(DATASET_WINDOW_MIN_HEIGHT, Math.min(Number(rect.height) || 500, maxHeight));
  const { minX, maxX } = getWindowHorizontalLimits(width, bounds);
  const maxY = Math.max(minY, bounds.height - DATASET_WINDOW_TITLEBAR_HEIGHT);
  const x = Math.max(minX, Math.min(Number(rect.x) || 0, maxX));
  const y = Math.max(minY, Math.min(Number(rect.y) || minY, maxY));
  return { x, y, width, height };
}

function rememberDatasetWindowSize(rect) {
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  lastDatasetWindowSize = {
    width: Math.max(DATASET_WINDOW_MIN_WIDTH, Math.round(width)),
    height: Math.max(DATASET_WINDOW_MIN_HEIGHT, Math.round(height)),
  };
}

function applyWindowRect(frame, rect, options = {}) {
  const next = clampWindowRect(rect);
  frame.style.left = `${Math.round(next.x)}px`;
  frame.style.top = `${Math.round(next.y)}px`;
  frame.style.width = `${Math.round(next.width)}px`;
  frame.style.height = `${Math.round(next.height)}px`;
  if (
    frame?.classList?.contains("pi-window")
    && frame.dataset.maximized !== "1"
    && options.rememberSize !== false
  ) {
    rememberDatasetWindowSize(next);
  }
  return next;
}

function isDatasetWindowMaximized(frame) {
  return frame?.dataset?.maximized === "1";
}

function getMaximizedWindowRect() {
  const bounds = getWindowBounds();
  const minY = getWindowTopLimit();
  return {
    x: 0,
    y: minY,
    width: bounds.width,
    height: Math.max(DATASET_WINDOW_MIN_HEIGHT, bounds.height - minY),
  };
}

function getPointerRestoreRect(frame, pointerEvent, restoreRect) {
  const rootRect = els.root?.getBoundingClientRect?.();
  const currentRect = frame?.getBoundingClientRect?.();
  if (!rootRect || !currentRect || !pointerEvent) return restoreRect;
  const pointerX = pointerEvent.clientX - rootRect.left;
  const pointerY = pointerEvent.clientY - rootRect.top;
  const ratioX = clampNumber(
    (pointerEvent.clientX - currentRect.left) / Math.max(1, currentRect.width),
    0.12,
    0.88
  );
  const titleOffsetY = clampNumber(pointerEvent.clientY - currentRect.top, 8, 24);
  return {
    ...restoreRect,
    x: pointerX - restoreRect.width * ratioX,
    y: pointerY - titleOffsetY,
  };
}

function maximizeDatasetWindow(frame) {
  if (!frame) return;
  if (!isDatasetWindowMaximized(frame)) {
    frame.__piRestoreRect = getFrameRect(frame);
  }
  frame.dataset.maximized = "1";
  applyWindowRect(frame, getMaximizedWindowRect(), { rememberSize: false });
  updateDatasetWindowMaximizeControl(frame);
  raiseWindow(frame);
}

function restoreDatasetWindow(frame, pointerEvent = null) {
  if (!frame) return;
  const stored = frame.__piRestoreRect || getNextDatasetWindowRect(0);
  const restoreRect = pointerEvent
    ? getPointerRestoreRect(frame, pointerEvent, stored)
    : stored;
  frame.dataset.maximized = "0";
  applyWindowRect(frame, restoreRect);
  updateDatasetWindowMaximizeControl(frame);
  raiseWindow(frame);
}

function toggleDatasetWindowMaximized(frame) {
  if (isDatasetWindowMaximized(frame)) {
    restoreDatasetWindow(frame);
  } else {
    maximizeDatasetWindow(frame);
  }
}

function syncMaximizedDatasetWindows() {
  for (const frame of datasetWindows.values()) {
    if (!frame?.isConnected || frame.dataset.hidden === "1" || !isDatasetWindowMaximized(frame)) continue;
    applyWindowRect(frame, getMaximizedWindowRect(), { rememberSize: false });
  }
}

function updateDatasetWindowMaximizeControl(frame) {
  const button = frame?.querySelector?.(".pi-window-maximize");
  if (!button) return;
  const maximized = isDatasetWindowMaximized(frame);
  button.title = maximized ? "Restore" : "Maximize";
  button.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
}

function getNextDatasetWindowRect(offset = 0) {
  const bounds = getWindowBounds();
  const minY = getWindowTopLimit();
  const availableHeight = Math.max(DATASET_WINDOW_MIN_HEIGHT, bounds.height - minY);
  const preferredWidth = lastDatasetWindowSize?.width
    || Math.round(bounds.width * DATASET_WINDOW_DEFAULT_WIDTH_RATIO);
  const preferredHeight = lastDatasetWindowSize?.height
    || Math.round(availableHeight * DATASET_WINDOW_DEFAULT_HEIGHT_RATIO);
  const width = Math.max(DATASET_WINDOW_MIN_WIDTH, Math.min(preferredWidth, bounds.width));
  const height = Math.max(DATASET_WINDOW_MIN_HEIGHT, Math.min(preferredHeight, availableHeight));
  return clampWindowRect({
    x: Math.round((bounds.width - width) / 2) + offset,
    y: Math.round(minY + (availableHeight - height) / 2) + offset,
    width,
    height,
  });
}

function raiseWindow(frame) {
  frame.style.zIndex = String(++nextWindowZ);
  if (frame?.classList?.contains("pi-window") && frame.dataset.hidden !== "1") {
    activeDatasetWindow = frame;
  }
}

function getActiveDatasetWindow() {
  if (
    activeDatasetWindow?.isConnected
    && activeDatasetWindow.dataset.hidden !== "1"
    && activeDatasetWindow.style.display !== "none"
  ) {
    return activeDatasetWindow;
  }
  let nextActive = null;
  let topZ = -1;
  for (const frame of datasetWindows.values()) {
    if (!frame?.isConnected || frame.dataset.hidden === "1" || frame.style.display === "none") continue;
    const z = Number.parseInt(frame.style.zIndex || "0", 10);
    if (z >= topZ) {
      topZ = z;
      nextActive = frame;
    }
  }
  activeDatasetWindow = nextActive;
  return nextActive;
}

function closeDatasetWindow(frame, { status = true } = {}) {
  if (!frame?.isConnected) return false;
  const title = frame.dataset.windowDatasetName || frame.dataset.windowTitle || frame.getAttribute("aria-label") || "dataset window";
  hiddenWindows.delete(frame.dataset.windowId || "");
  datasetWindows.delete(frame.dataset.windowKey || "");
  if (activeDatasetWindow === frame) activeDatasetWindow = null;
  frame.remove();
  updateHiddenTabsArea();
  if (status) setStatus(`Closed ${title}`);
  return true;
}

function isCloseActiveWindowShortcut(event) {
  return !!event?.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.shiftKey
    && String(event.key || "").toLowerCase() === "w";
}

function closeActiveDatasetWindowFromShortcut(event, frame = getActiveDatasetWindow()) {
  if (!isCloseActiveWindowShortcut(event) || !frame?.isConnected) return false;
  event.preventDefault();
  event.stopPropagation();
  lastDatasetWindowShortcutCloseAt = Date.now();
  closeDatasetWindow(frame);
  return true;
}

function consumeCloseShortcutFromShell() {
  if (Date.now() - lastDatasetWindowShortcutCloseAt < 900) return true;
  const frame = getActiveDatasetWindow();
  if (!frame?.isConnected) return false;
  lastDatasetWindowShortcutCloseAt = Date.now();
  closeDatasetWindow(frame);
  return true;
}

function clampNumber(value, min, max) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return min;
  return Math.max(min, Math.min(raw, max));
}

function resizeRectFromCorner(start, corner, dx, dy) {
  const bounds = getWindowBounds();
  const minY = getWindowTopLimit();
  const { minX } = getWindowHorizontalLimits(start.width, bounds);
  const next = {
    x: start.x,
    y: start.y,
    width: start.width,
    height: start.height,
  };

  if (corner.includes("e")) {
    next.width = clampNumber(start.width + dx, DATASET_WINDOW_MIN_WIDTH, bounds.width);
  }
  if (corner.includes("s")) {
    next.height = clampNumber(start.height + dy, DATASET_WINDOW_MIN_HEIGHT, bounds.height - minY);
  }
  if (corner.includes("w")) {
    const right = start.x + start.width;
    next.x = clampNumber(start.x + dx, minX, right - DATASET_WINDOW_MIN_WIDTH);
    next.width = right - next.x;
  }
  if (corner.includes("n")) {
    const bottom = start.y + start.height;
    next.y = clampNumber(start.y + dy, minY, bottom - DATASET_WINDOW_MIN_HEIGHT);
    next.height = bottom - next.y;
  }

  return next;
}

function lockDatasetViewerInputs(iframe, datasetName) {
  let doc = null;
  try {
    doc = iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch {
    return;
  }
  if (!doc) return;

  const projectInput = doc.getElementById("projectSelect");
  const pathInput = doc.getElementById("pathInput");
  const triInput = doc.getElementById("triInput");
  if (projectInput) {
    projectInput.value = projectName;
    projectInput.readOnly = true;
    projectInput.title = "Project is set by the project instance tab.";
  }
  if (pathInput) {
    pathInput.value = selectedPath;
    pathInput.readOnly = true;
    pathInput.title = "Reserving class path is set by the project instance tab.";
  }
  if (triInput && datasetName) {
    triInput.value = datasetName;
  }
  for (const id of ["projectTreeBtn", "pathTreeBtn"]) {
    const button = doc.getElementById(id);
    if (button) {
      button.disabled = true;
      button.title = "Set by the project instance tab";
    }
  }
}

function wireDatasetViewerWindowShortcuts(iframe, frame) {
  let doc = null;
  try {
    doc = iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch {
    return;
  }
  if (!doc || doc.__piWindowShortcutsWired) return;
  doc.__piWindowShortcutsWired = true;
  doc.addEventListener("mousedown", () => raiseWindow(frame), true);
  doc.addEventListener("focusin", () => raiseWindow(frame), true);
  doc.addEventListener("keydown", (event) => {
    closeActiveDatasetWindowFromShortcut(event, frame);
  }, true);
}

function buildDatasetViewerUrl(datasetName, inst) {
  const params = new URLSearchParams();
  params.set("project", projectName);
  params.set("path", selectedPath);
  params.set("tri", datasetName);
  params.set("inst", inst);
  params.set("project_instance", "1");
  params.set("v", String(Date.now()));
  return `/ui/dataset/dataset_viewer.html?${params.toString()}`;
}

function beginWindowDragCapture(mode) {
  const shield = document.createElement("div");
  shield.className = `pi-window-drag-shield ${mode || "moving"}`;
  els.windowLayer?.appendChild(shield);
  return () => {
    if (shield.parentNode) shield.parentNode.removeChild(shield);
  };
}

function startMove(frame, event) {
  if (event.button !== 0) return;
  raiseWindow(frame);
  const releaseDragCapture = beginWindowDragCapture("moving");
  const getStart = (sourceEvent) => {
    const startRect = frame.getBoundingClientRect();
    const rootRect = els.root.getBoundingClientRect();
    return {
      x: startRect.left - rootRect.left,
      y: startRect.top - rootRect.top,
      width: startRect.width,
      height: startRect.height,
      px: sourceEvent.clientX,
      py: sourceEvent.clientY,
    };
  };
  let start = getStart(event);

  const onMove = (e) => {
    if (isDatasetWindowMaximized(frame)) {
      restoreDatasetWindow(frame, e);
      start = getStart(e);
    }
    applyWindowRect(frame, {
      x: start.x + e.clientX - start.px,
      y: start.y + e.clientY - start.py,
      width: start.width,
      height: start.height,
    });
    setHiddenDropActive(isPointInHiddenDropZone(e.clientX, e.clientY), frame);
  };
  const onUp = (e) => {
    releaseDragCapture();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    if (isPointInHiddenDropZone(e.clientX, e.clientY)) {
      hideDatasetWindow(frame, {
        x: start.x,
        y: start.y,
        width: start.width,
        height: start.height,
      });
      return;
    }
    setHiddenDropActive(false, frame);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
  event.preventDefault();
}

function startResize(frame, event, corner = "se") {
  if (event.button !== 0) return;
  if (isDatasetWindowMaximized(frame)) {
    restoreDatasetWindow(frame);
  }
  raiseWindow(frame);
  const resizeCorner = String(corner || "se").toLowerCase();
  const releaseDragCapture = beginWindowDragCapture(`resizing-${resizeCorner}`);
  const startRect = frame.getBoundingClientRect();
  const rootRect = els.root.getBoundingClientRect();
  const start = {
    x: startRect.left - rootRect.left,
    y: startRect.top - rootRect.top,
    width: startRect.width,
    height: startRect.height,
    px: event.clientX,
    py: event.clientY,
  };

  const onMove = (e) => {
    applyWindowRect(
      frame,
      resizeRectFromCorner(start, resizeCorner, e.clientX - start.px, e.clientY - start.py)
    );
  };
  const onUp = () => {
    releaseDragCapture();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
  event.preventDefault();
}

function openDatasetWindow(datasetName) {
  const name = toText(datasetName);
  if (!name) return;
  if (!selectedPath) {
    setStatus("Select a reserving class path before opening a dataset.", true);
    return;
  }

  const windowKey = getDatasetWindowKey(name);
  const existing = datasetWindows.get(windowKey);
  if (existing?.isConnected) {
    activateDatasetWindow(existing);
    return;
  }
  datasetWindows.delete(windowKey);

  const title = `${selectedPath}\\${name}`;
  const inst = `pi_ds_${Date.now()}_${windowSeq++}`;
  const frame = document.createElement("section");
  frame.className = "pi-window";
  frame.dataset.windowId = inst;
  frame.dataset.windowKey = windowKey;
  frame.dataset.windowDatasetName = name;
  frame.dataset.windowTitle = title;
  frame.setAttribute("aria-label", title);
  frame.innerHTML = `
    <header class="pi-window-titlebar">
      <span class="pi-window-title"></span>
      <div class="pi-window-titlebar-controls">
        <button class="pi-window-titlebar-btn pi-window-minimize" type="button" title="Minimize" aria-label="Minimize">
          <svg class="pi-window-titlebar-icon" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="2" y1="7" x2="8" y2="7"></line>
          </svg>
        </button>
        <button class="pi-window-titlebar-btn pi-window-maximize" type="button" title="Maximize" aria-label="Maximize">
          <svg class="pi-window-titlebar-icon" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="2" y="2" width="6" height="6" rx="0.6"></rect>
          </svg>
        </button>
        <button class="pi-window-titlebar-btn pi-window-close" type="button" title="Close" aria-label="Close">
          <svg class="pi-window-titlebar-icon" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="2" y1="2" x2="8" y2="8"></line>
            <line x1="8" y1="2" x2="2" y2="8"></line>
          </svg>
        </button>
      </div>
    </header>
    <div class="pi-window-body"></div>
    <div class="pi-window-resize pi-window-resize-nw" data-corner="nw" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-edge pi-window-resize-n" data-corner="n" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-ne" data-corner="ne" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-edge pi-window-resize-e" data-corner="e" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-se" data-corner="se" title="Resize"><span class="resizeIcon" aria-hidden="true"></span></div>
    <div class="pi-window-resize pi-window-resize-edge pi-window-resize-s" data-corner="s" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-sw" data-corner="sw" title="Resize"></div>
    <div class="pi-window-resize pi-window-resize-edge pi-window-resize-w" data-corner="w" title="Resize"></div>
  `;

  const titleEl = frame.querySelector(".pi-window-title");
  titleEl.textContent = title;
  titleEl.title = title;

  const body = frame.querySelector(".pi-window-body");
  const iframe = document.createElement("iframe");
  iframe.src = buildDatasetViewerUrl(name, inst);
  iframe.addEventListener("load", () => {
    wireDatasetViewerWindowShortcuts(iframe, frame);
    lockDatasetViewerInputs(iframe, name);
    window.setTimeout(() => lockDatasetViewerInputs(iframe, name), 250);
  });
  body.appendChild(iframe);

  const titlebar = frame.querySelector(".pi-window-titlebar");
  titlebar?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    if (Number(e.detail) >= 2) {
      e.preventDefault();
      frame.__piLastTitlebarToggle = Date.now();
      toggleDatasetWindowMaximized(frame);
      return;
    }
    startMove(frame, e);
  });
  titlebar?.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    if (Number(frame.__piLastTitlebarToggle || 0) && Date.now() - frame.__piLastTitlebarToggle < 400) return;
    e.preventDefault();
    toggleDatasetWindowMaximized(frame);
  });
  for (const handle of frame.querySelectorAll(".pi-window-resize")) {
    handle.addEventListener("mousedown", (e) => {
      startResize(frame, e, handle.getAttribute("data-corner") || "se");
    });
  }
  frame.querySelector(".pi-window-minimize")?.addEventListener("click", () => {
    hideDatasetWindow(frame, getFrameRect(frame));
  });
  frame.querySelector(".pi-window-maximize")?.addEventListener("click", () => {
    toggleDatasetWindowMaximized(frame);
  });
  frame.querySelector(".pi-window-close")?.addEventListener("click", () => closeDatasetWindow(frame));
  frame.addEventListener("mousedown", () => raiseWindow(frame));

  const offset = ((windowSeq - 1) % 5) * 26;
  els.windowLayer.appendChild(frame);
  datasetWindows.set(windowKey, frame);
  applyWindowRect(frame, getNextDatasetWindowRect(offset));
  raiseWindow(frame);
  setStatus(`Opened ${title}`);
}

function initHiddenTabsArea() {
  if (!els.hiddenTabsButton || els.hiddenTabsButton.dataset.wired === "1") return;
  els.hiddenTabsButton.dataset.wired = "1";
  updateHiddenTabsArea();
  els.hiddenTabsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextOpen = !els.hiddenTabsWrap?.classList?.contains("open");
    setHiddenTabsMenuOpen(nextOpen, { pinned: nextOpen });
  });
  els.hiddenTabsButton.addEventListener("mouseenter", () => {
    setHiddenTabsMenuOpen(true, { pinned: hiddenTabsMenuPinned });
  });
  els.hiddenTabsButton.addEventListener("mouseleave", () => {
    scheduleHiddenTabsHoverClose();
  });
  els.hiddenTabsMenu?.addEventListener("mouseenter", () => {
    setHiddenTabsMenuOpen(true, { pinned: hiddenTabsMenuPinned });
  });
  els.hiddenTabsMenu?.addEventListener("mouseleave", () => {
    scheduleHiddenTabsHoverClose();
  });
  document.addEventListener("mousedown", (event) => {
    if (els.hiddenTabsWrap?.contains(event.target)) return;
    setHiddenTabsMenuOpen(false, { pinned: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setHiddenTabsMenuOpen(false, { pinned: false });
  });
}

function initDatasetWindowShortcuts() {
  if (document.body.dataset.piWindowShortcutsWired === "1") return;
  document.body.dataset.piWindowShortcutsWired = "1";
  window.__arcrho_consume_close_shortcut = consumeCloseShortcutFromShell;
  document.addEventListener("keydown", (event) => {
    closeActiveDatasetWindowFromShortcut(event);
  }, true);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "arcrho:status" || msg.type === "arcrho:tooltip") {
    try { window.parent.postMessage(msg, "*"); } catch {}
  }
});

async function boot() {
  installDebugTraceFetchLogger();
  traceEvent("boot_start", { projectName });
  const bootStart = performance.now();
  await applyHostFrameCornerStyle();
  initHiddenTabsArea();
  initLeftPanelResizer();
  initDatasetTableInteractions();
  initDatasetWindowShortcuts();
  window.addEventListener("resize", syncMaximizedDatasetWindows);
  traceEvent("boot_init_complete");
  if (!projectName) {
    setStatus("Project name is missing.", true);
    setEmptyTable("Project name is missing.");
    if (els.pathTree) els.pathTree.innerHTML = '<div class="ptree-empty">Project name is missing.</div>';
    finishPageLoading();
    traceEvent("boot_error", { reason: "missing_project" });
    await flushDebugTrace("missing_project");
    return;
  }
  await Promise.all([loadPathTree(), loadDatasets()]);
  traceEvent("boot_end", {
    duration_ms: Math.round((performance.now() - bootStart) * 10) / 10,
    debugTracePath,
  });
  await flushDebugTrace("boot_end");
}

boot();
