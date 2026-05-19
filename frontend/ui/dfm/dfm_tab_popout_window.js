const STYLE_ID = "dfm-tab-popout-window-style";
const TAB_LABELS = new Map([
  ["details", "Details"],
  ["data", "Data"],
  ["ratios", "Ratios"],
  ["results", "Results"],
  ["notes", "Notes"],
]);

const poppedTabs = new Map();
let popoutZ = 3300;
const POPOUT_MIN_W = 440;
const POPOUT_MIN_H = 300;
const POPOUT_TITLEBAR_H = 34;
const POPOUT_MARGIN = 12;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function getPageId(tabId) {
  return `dfm${capitalize(tabId)}Page`;
}

function getTabLabel(tabId) {
  return TAB_LABELS.get(tabId) || capitalize(tabId) || "DFM";
}

function getFallbackTabId(tabId) {
  for (const candidate of TAB_LABELS.keys()) {
    if (candidate !== tabId && !poppedTabs.has(candidate)) return candidate;
  }
  for (const candidate of TAB_LABELS.keys()) {
    if (candidate !== tabId) return candidate;
  }
  return tabId;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .dfmTabPopoutWindow {
      position: fixed;
      z-index: 3300;
      left: 72px;
      top: 78px;
      width: min(920px, calc(100vw - 56px));
      height: min(640px, calc(100vh - 56px));
      min-width: ${POPOUT_MIN_W}px;
      min-height: ${POPOUT_MIN_H}px;
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #aebbd0;
      border-radius: 6px;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.24);
      overflow: visible;
      color: #1f2937;
      font-family: var(--dfm-font, "Segoe UI", Tahoma, Arial, sans-serif);
    }
    .dfmTabPopoutWindow.dfmTabPopoutMaximized {
      border-radius: 6px;
    }
    .dfmTabPopoutWindow.dfmTabPopoutMinimized {
      min-height: ${POPOUT_TITLEBAR_H + 2}px;
    }
    .dfmTabPopoutHeader {
      flex: 0 0 ${POPOUT_TITLEBAR_H}px;
      min-height: ${POPOUT_TITLEBAR_H}px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 7px 0 10px;
      border-bottom: 1px solid #c9d1dc;
      background: #edf1f5;
      cursor: move;
      user-select: none;
      box-sizing: border-box;
    }
    .dfmTabPopoutTitle {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #202327;
      font-size: 13px;
      font-weight: 700;
    }
    .dfmTabPopoutControls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      position: relative;
      z-index: 3;
    }
    .dfmTabPopoutButton.titlebarBtn {
      width: 28px;
      height: 20px;
      min-width: 0;
      padding: 0;
      border: 1px solid #c6ced8;
      border-radius: 4px;
      background: #fff;
      color: #333;
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      appearance: none;
      -webkit-appearance: none;
    }
    .dfmTabPopoutButton.titlebarBtn:hover {
      background: #dbeafe;
      border-color: #93c5fd;
    }
    .dfmTabPopoutButton.titlebarBtn[data-action="close"]:hover {
      background: #fee2e2;
      border-color: #fca5a5;
    }
    .dfmTabPopoutButton .titlebarIcon {
      width: 10px;
      height: 10px;
      stroke: #333;
      stroke-width: 1.2;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .dfmTabPopoutBody {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      display: flex;
      overflow: hidden;
      background: #fff;
      border-bottom-left-radius: 6px;
      border-bottom-right-radius: 6px;
    }
    .dfmTabPopoutWindow.dfmTabPopoutMinimized .dfmTabPopoutBody,
    .dfmTabPopoutWindow.dfmTabPopoutMinimized .dfmTabPopoutResizeHandle {
      display: none;
    }
    .dfmTabPopoutBody > .dfmTabFloatingPage {
      display: block !important;
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      min-height: 0;
      min-width: 0;
      border: 0 !important;
      box-sizing: border-box;
    }
    .dfmTab.dfmTabPopped {
      background: #e5e7eb;
      font-style: normal;
    }
    .dfmTabPopoutResizeHandle {
      position: absolute;
      width: 22px;
      height: 22px;
      pointer-events: auto;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 0 4px 4px 0;
      box-sizing: border-box;
      background: transparent;
      z-index: 2;
    }
    .dfmTabPopoutResizeEdge {
      padding: 0;
      display: block;
    }
    .dfmTabPopoutResizeNw {
      left: 0;
      top: 0;
      cursor: nwse-resize;
    }
    .dfmTabPopoutResizeN {
      left: 22px;
      right: 106px;
      top: 0;
      width: auto;
      height: 8px;
      cursor: ns-resize;
    }
    .dfmTabPopoutResizeNe {
      right: 84px;
      top: 0;
      cursor: nesw-resize;
    }
    .dfmTabPopoutResizeE {
      right: 0;
      top: ${POPOUT_TITLEBAR_H}px;
      bottom: 22px;
      width: 8px;
      height: auto;
      cursor: ew-resize;
    }
    .dfmTabPopoutResizeSw {
      left: 0;
      bottom: 0;
      cursor: nesw-resize;
    }
    .dfmTabPopoutResizeS {
      left: 22px;
      right: 22px;
      bottom: 0;
      width: auto;
      height: 8px;
      cursor: ns-resize;
    }
    .dfmTabPopoutResizeSe {
      right: 0;
      bottom: 0;
      cursor: nwse-resize;
    }
    .dfmTabPopoutResizeW {
      left: 0;
      top: ${POPOUT_TITLEBAR_H}px;
      bottom: 22px;
      width: 8px;
      height: auto;
      cursor: ew-resize;
    }
  `;
  document.head.appendChild(style);
}

function refreshFloatingLayout() {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function getViewportRect() {
  return {
    x: POPOUT_MARGIN,
    y: POPOUT_MARGIN,
    width: Math.max(POPOUT_MIN_W, window.innerWidth - POPOUT_MARGIN * 2),
    height: Math.max(POPOUT_MIN_H, window.innerHeight - POPOUT_MARGIN * 2),
  };
}

function clampRect(rect) {
  const maxW = Math.max(POPOUT_MIN_W, window.innerWidth - POPOUT_MARGIN);
  const maxH = Math.max(POPOUT_TITLEBAR_H + 2, window.innerHeight - POPOUT_MARGIN);
  const width = Math.min(maxW, Math.max(POPOUT_MIN_W, rect.width));
  const minHeight = rect.minimized ? POPOUT_TITLEBAR_H + 2 : POPOUT_MIN_H;
  const height = Math.min(maxH, Math.max(minHeight, rect.height));
  const maxLeft = Math.max(0, window.innerWidth - 80);
  const maxTop = Math.max(0, window.innerHeight - POPOUT_TITLEBAR_H);
  const left = Math.min(maxLeft, Math.max(0, rect.left));
  const top = Math.min(maxTop, Math.max(0, rect.top));
  return { left, top, width, height };
}

function getRect(win) {
  const rect = win.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function setRect(win, rect) {
  const next = clampRect(rect);
  win.style.left = `${Math.round(next.left)}px`;
  win.style.top = `${Math.round(next.top)}px`;
  win.style.width = `${Math.round(next.width)}px`;
  win.style.height = `${Math.round(next.height)}px`;
  refreshFloatingLayout();
}

function focusPopout(tabId) {
  const record = poppedTabs.get(tabId);
  if (!record) return false;
  record.win.style.zIndex = String(++popoutZ);
  return true;
}

function setTabPoppedState(tabId, popped) {
  document
    .querySelector(`.dfmTab[data-page="${CSS.escape(tabId)}"]`)
    ?.classList.toggle("dfmTabPopped", popped);
}

function makeDraggable(win, header) {
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target?.closest?.("button")) return;
    event.preventDefault();
    win.style.zIndex = String(++popoutZ);
    win.classList.remove("dfmTabPopoutMaximized");
    const rect = win.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const pointerId = event.pointerId;
    header.setPointerCapture?.(pointerId);
    const move = (moveEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - 80);
      const maxTop = Math.max(0, window.innerHeight - 44);
      const nextLeft = Math.min(maxLeft, Math.max(0, startLeft + moveEvent.clientX - startX));
      const nextTop = Math.min(maxTop, Math.max(0, startTop + moveEvent.clientY - startY));
      win.style.left = `${nextLeft}px`;
      win.style.top = `${nextTop}px`;
    };
    const stop = () => {
      header.releasePointerCapture?.(pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
}

function startResize(win, event, edge) {
  if (event.button !== 0 || win.classList.contains("dfmTabPopoutMinimized")) return;
  event.preventDefault();
  event.stopPropagation();
  win.classList.remove("dfmTabPopoutMaximized");
  win.style.zIndex = String(++popoutZ);
  const pointerTarget = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startRect = getRect(win);
  pointerTarget.setPointerCapture?.(pointerId);

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    let next = { ...startRect };
    if (edge.includes("e")) next.width = startRect.width + dx;
    if (edge.includes("s")) next.height = startRect.height + dy;
    if (edge.includes("w")) {
      next.left = startRect.left + dx;
      next.width = startRect.width - dx;
      if (next.width < POPOUT_MIN_W) {
        next.left = startRect.left + startRect.width - POPOUT_MIN_W;
        next.width = POPOUT_MIN_W;
      }
    }
    if (edge.includes("n")) {
      next.top = startRect.top + dy;
      next.height = startRect.height - dy;
      if (next.height < POPOUT_MIN_H) {
        next.top = startRect.top + startRect.height - POPOUT_MIN_H;
        next.height = POPOUT_MIN_H;
      }
    }
    setRect(win, next);
  };

  const stop = () => {
    pointerTarget.releasePointerCapture?.(pointerId);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function toggleMinimized(record) {
  const { win } = record;
  const minimizing = !win.classList.contains("dfmTabPopoutMinimized");
  if (minimizing) {
    if (!win.classList.contains("dfmTabPopoutMaximized")) record.restoreRect = getRect(win);
    win.classList.remove("dfmTabPopoutMaximized");
    win.classList.add("dfmTabPopoutMinimized");
    setRect(win, { ...getRect(win), height: POPOUT_TITLEBAR_H + 2, minimized: true });
  } else {
    win.classList.remove("dfmTabPopoutMinimized");
    setRect(win, record.restoreRect || { ...getRect(win), height: POPOUT_MIN_H });
  }
}

function toggleMaximized(record) {
  const { win } = record;
  if (win.classList.contains("dfmTabPopoutMaximized")) {
    win.classList.remove("dfmTabPopoutMaximized", "dfmTabPopoutMinimized");
    setRect(win, record.restoreRect || getRect(win));
    return;
  }
  if (!win.classList.contains("dfmTabPopoutMinimized")) record.restoreRect = getRect(win);
  win.classList.remove("dfmTabPopoutMinimized");
  win.classList.add("dfmTabPopoutMaximized");
  const viewport = getViewportRect();
  setRect(win, {
    left: viewport.x,
    top: viewport.y,
    width: viewport.width,
    height: viewport.height,
  });
}

function dockDfmTab(tabId) {
  const record = poppedTabs.get(tabId);
  if (!record) return;
  poppedTabs.delete(tabId);
  record.page.classList.remove("dfmTabFloatingPage");
  record.placeholder.parentNode?.insertBefore(record.page, record.placeholder);
  record.placeholder.remove();
  record.win.remove();
  setTabPoppedState(tabId, false);
  const activeTab = window.dfmTabSystem?.getCurrentTab?.();
  record.page.style.display = activeTab === tabId ? "block" : "none";
  refreshFloatingLayout();
}

function popoutDfmTab(tabId, options = {}) {
  if (focusPopout(tabId)) return;
  const page = document.getElementById(getPageId(tabId));
  if (!page) return;

  ensureStyles();

  const placeholder = document.createElement("div");
  placeholder.className = "dfmTabPopoutPlaceholder";
  placeholder.hidden = true;
  page.parentNode?.insertBefore(placeholder, page);

  const win = document.createElement("div");
  win.className = "dfmTabPopoutWindow";
  win.style.zIndex = String(++popoutZ);
  win.innerHTML = `
    <div class="dfmTabPopoutHeader">
      <div class="dfmTabPopoutTitle">${escapeHtml(getTabLabel(tabId))}</div>
      <span class="dfmTabPopoutControls">
        <button class="titlebarBtn dfmTabPopoutButton" data-action="minimize" type="button" title="Minimize" aria-label="Minimize">
          <svg class="titlebarIcon" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="2" y1="7" x2="8" y2="7"></line>
          </svg>
        </button>
        <button class="titlebarBtn dfmTabPopoutButton" data-action="maximize" type="button" title="Maximize" aria-label="Maximize">
          <svg class="titlebarIcon" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="2" y="2" width="6" height="6" rx="0.6"></rect>
          </svg>
        </button>
        <button class="titlebarBtn dfmTabPopoutButton" data-action="close" type="button" title="Dock tab" aria-label="Dock tab">
          <svg class="titlebarIcon" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="2" y1="2" x2="8" y2="8"></line>
            <line x1="8" y1="2" x2="2" y2="8"></line>
          </svg>
        </button>
      </span>
    </div>
    <div class="dfmTabPopoutBody"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeNw" data-edge="nw" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeEdge dfmTabPopoutResizeN" data-edge="n" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeNe" data-edge="ne" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeEdge dfmTabPopoutResizeE" data-edge="e" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeSw" data-edge="sw" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeEdge dfmTabPopoutResizeS" data-edge="s" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeSe" data-edge="se" title="Resize"></div>
    <div class="dfmTabPopoutResizeHandle dfmTabPopoutResizeEdge dfmTabPopoutResizeW" data-edge="w" title="Resize"></div>
  `;
  document.body.appendChild(win);

  const body = win.querySelector(".dfmTabPopoutBody");
  page.classList.add("dfmTabFloatingPage");
  page.style.display = "block";
  body?.appendChild(page);

  const record = { tabId, page, placeholder, win, restoreRect: null };
  poppedTabs.set(tabId, record);
  setTabPoppedState(tabId, true);

  win.querySelectorAll(".dfmTabPopoutButton").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
  });
  win.querySelector('[data-action="minimize"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMinimized(record);
  });
  win.querySelector('[data-action="maximize"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMaximized(record);
  });
  win.querySelector('[data-action="close"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    dockDfmTab(tabId);
  });
  win.querySelectorAll(".dfmTabPopoutResizeHandle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startResize(win, event, handle.dataset.edge || "se"));
  });
  win.addEventListener("pointerdown", () => {
    win.style.zIndex = String(++popoutZ);
  });
  const header = win.querySelector(".dfmTabPopoutHeader");
  if (header) makeDraggable(win, header);

  if (window.dfmTabSystem?.getCurrentTab?.() === tabId) {
    window.dfmTabSystem.setActive(getFallbackTabId(tabId));
  }
  if (typeof options.onPopoutTab === "function") {
    options.onPopoutTab(tabId);
  }
  refreshFloatingLayout();
}

export function wireDfmTabPopoutWindows(options = {}) {
  const tabBar = document.querySelector(".dfmTabBar");
  if (!tabBar || tabBar.dataset.dfmPopoutWired === "1") return;
  tabBar.dataset.dfmPopoutWired = "1";
  tabBar.addEventListener("click", (event) => {
    const tab = event.target?.closest?.(".dfmTab");
    const tabId = tab?.dataset?.page || "";
    if (!tabId || !poppedTabs.has(tabId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    focusPopout(tabId);
  }, true);
  tabBar.addEventListener("contextmenu", (event) => {
    const tab = event.target?.closest?.(".dfmTab");
    const tabId = tab?.dataset?.page || "";
    if (!tabId) return;
    event.preventDefault();
    event.stopPropagation();
    popoutDfmTab(tabId, options);
  });
}
