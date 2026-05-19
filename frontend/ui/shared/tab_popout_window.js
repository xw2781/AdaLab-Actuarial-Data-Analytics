const DEFAULT_MIN_W = 440;
const DEFAULT_MIN_H = 300;
const TITLEBAR_H = 34;
const VIEWPORT_MARGIN = 12;

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

function getTabSystem(config) {
  if (typeof config.tabSystem === "function") return config.tabSystem();
  return config.tabSystem || null;
}

function getTabLabel(tabId, labels) {
  return labels.get(tabId) || capitalize(tabId) || "Tab";
}

function buildIconButton(action, title, iconMarkup) {
  return `
    <button class="titlebarBtn tabPopoutButton" data-action="${action}" type="button" title="${title}" aria-label="${title}">
      <svg class="titlebarIcon" viewBox="0 0 10 10" aria-hidden="true">
        ${iconMarkup}
      </svg>
    </button>
  `;
}

export function createTabPopoutManager(config = {}) {
  const cssPrefix = String(config.cssPrefix || "").trim();
  const tabs = Array.isArray(config.tabs) ? config.tabs : [];
  if (!cssPrefix || !tabs.length) {
    throw new Error("createTabPopoutManager requires cssPrefix and tabs.");
  }

  const tabBarClass = `${cssPrefix}TabBar`;
  const tabClass = `${cssPrefix}Tab`;
  const pageFloatingClass = `${cssPrefix}TabFloatingPage`;
  const poppedTabClass = `${cssPrefix}TabPopped`;
  const placeholderClass = `${cssPrefix}TabPopoutPlaceholder`;
  const windowClass = `${cssPrefix}TabPopoutWindow`;
  const labels = new Map(tabs.map((tab) => [tab.id, tab.label]));
  const minW = Number(config.minWidth) || DEFAULT_MIN_W;
  const minH = Number(config.minHeight) || DEFAULT_MIN_H;
  const styleId = config.styleId || `${cssPrefix}-tab-popout-window-style`;
  const wiredKey = `${cssPrefix}PopoutWired`;
  const poppedTabs = new Map();
  let popoutZ = Number(config.zIndexStart) || 3300;

  const getPageId = (tabId) => `${cssPrefix}${capitalize(tabId)}Page`;

  function notifyLayout(tabId, reason) {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      if (typeof config.onLayout === "function") config.onLayout(tabId, reason);
    });
  }

  function getFallbackTabId(tabId) {
    for (const candidate of tabs) {
      if (candidate.id !== tabId && !poppedTabs.has(candidate.id)) return candidate.id;
    }
    for (const candidate of tabs) {
      if (candidate.id !== tabId) return candidate.id;
    }
    return tabId;
  }

  function ensureStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .${windowClass}.tabPopoutWindow {
        position: fixed;
        z-index: ${popoutZ};
        left: 72px;
        top: 78px;
        width: min(920px, calc(100vw - 56px));
        height: min(640px, calc(100vh - 56px));
        min-width: ${minW}px;
        min-height: ${minH}px;
        display: flex;
        flex-direction: column;
        background: #fff;
        border: 1px solid #aebbd0;
        border-radius: 6px;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.24);
        overflow: visible;
        color: #1f2937;
        font-family: var(--${cssPrefix}-font, var(--app-font, "Segoe UI", Tahoma, Arial, sans-serif));
      }
      .${windowClass}.tabPopoutWindow::before {
        content: "";
        position: absolute;
        inset: -1px;
        border: 1px solid #aebbd0;
        border-radius: 7px;
        pointer-events: none;
        z-index: 5;
      }
      .${windowClass}.tabPopoutWindow.tabPopoutMaximized {
        border-radius: 6px;
      }
      .${windowClass}.tabPopoutWindow.tabPopoutMinimized {
        min-height: ${TITLEBAR_H + 2}px;
      }
      .${windowClass} .tabPopoutHeader {
        flex: 0 0 ${TITLEBAR_H}px;
        min-height: ${TITLEBAR_H}px;
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
      .${windowClass} .tabPopoutTitle {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #202327;
        font-size: 13px;
        font-weight: 700;
      }
      .${windowClass} .tabPopoutControls {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        position: relative;
        z-index: 3;
      }
      .${windowClass} .tabPopoutButton.titlebarBtn {
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
      .${windowClass} .tabPopoutButton.titlebarBtn:hover {
        background: #dbeafe;
        border-color: #93c5fd;
      }
      .${windowClass} .tabPopoutButton.titlebarBtn[data-action="close"]:hover {
        background: #fee2e2;
        border-color: #fca5a5;
      }
      .${windowClass} .tabPopoutButton .titlebarIcon {
        width: 10px;
        height: 10px;
        stroke: #333;
        stroke-width: 1.2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .${windowClass} .tabPopoutBody {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        display: flex;
        overflow: hidden;
        background: #fff;
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
      }
      .${windowClass}.tabPopoutWindow.tabPopoutMinimized .tabPopoutBody,
      .${windowClass}.tabPopoutWindow.tabPopoutMinimized .tabPopoutResizeHandle {
        display: none;
      }
      .${windowClass} .tabPopoutBody > .${pageFloatingClass} {
        display: block !important;
        flex: 1 1 auto;
        width: 100%;
        height: 100%;
        min-height: 0;
        min-width: 0;
        border: 0 !important;
        box-sizing: border-box;
      }
      .${tabClass}.${poppedTabClass} {
        background: #e5e7eb;
        font-style: normal;
      }
      .${windowClass} .tabPopoutResizeHandle {
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
      .${windowClass} .tabPopoutResizeEdge {
        padding: 0;
        display: block;
      }
      .${windowClass} .tabPopoutResizeNw { left: 0; top: 0; cursor: nwse-resize; }
      .${windowClass} .tabPopoutResizeN {
        left: 22px;
        right: 106px;
        top: 0;
        width: auto;
        height: 8px;
        cursor: ns-resize;
      }
      .${windowClass} .tabPopoutResizeNe { right: 84px; top: 0; cursor: nesw-resize; }
      .${windowClass} .tabPopoutResizeE {
        right: 0;
        top: ${TITLEBAR_H}px;
        bottom: 22px;
        width: 8px;
        height: auto;
        cursor: ew-resize;
      }
      .${windowClass} .tabPopoutResizeSw { left: 0; bottom: 0; cursor: nesw-resize; }
      .${windowClass} .tabPopoutResizeS {
        left: 22px;
        right: 22px;
        bottom: 0;
        width: auto;
        height: 8px;
        cursor: ns-resize;
      }
      .${windowClass} .tabPopoutResizeSe { right: 0; bottom: 0; cursor: nwse-resize; }
      .${windowClass} .tabPopoutResizeW {
        left: 0;
        top: ${TITLEBAR_H}px;
        bottom: 22px;
        width: 8px;
        height: auto;
        cursor: ew-resize;
      }
    `;
    document.head.appendChild(style);
  }

  function getViewportRect() {
    return {
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
      width: Math.max(minW, window.innerWidth - VIEWPORT_MARGIN * 2),
      height: Math.max(minH, window.innerHeight - VIEWPORT_MARGIN * 2),
    };
  }

  function clampRect(rect) {
    const maxW = Math.max(minW, window.innerWidth - VIEWPORT_MARGIN);
    const maxH = Math.max(TITLEBAR_H + 2, window.innerHeight - VIEWPORT_MARGIN);
    const width = Math.min(maxW, Math.max(minW, rect.width));
    const minHeight = rect.minimized ? TITLEBAR_H + 2 : minH;
    const height = Math.min(maxH, Math.max(minHeight, rect.height));
    const maxLeft = Math.max(0, window.innerWidth - 80);
    const maxTop = Math.max(0, window.innerHeight - TITLEBAR_H);
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

  function setRect(win, rect, tabId, reason) {
    const next = clampRect(rect);
    win.style.left = `${Math.round(next.left)}px`;
    win.style.top = `${Math.round(next.top)}px`;
    win.style.width = `${Math.round(next.width)}px`;
    win.style.height = `${Math.round(next.height)}px`;
    notifyLayout(tabId, reason);
  }

  function focusPopout(tabId) {
    const record = poppedTabs.get(tabId);
    if (!record) return false;
    record.win.style.zIndex = String(++popoutZ);
    if (typeof config.onFocusTab === "function") config.onFocusTab(tabId, record);
    notifyLayout(tabId, "focus");
    return true;
  }

  function setTabPoppedState(tabId, popped) {
    document
      .querySelector(`.${tabClass}[data-page="${CSS.escape(tabId)}"]`)
      ?.classList.toggle(poppedTabClass, popped);
  }

  function makeDraggable(record, header) {
    const { win, tabId } = record;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target?.closest?.("button")) return;
      event.preventDefault();
      win.style.zIndex = String(++popoutZ);
      win.classList.remove("tabPopoutMaximized");
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
        notifyLayout(tabId, "drag");
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

  function startResize(record, event, edge) {
    const { win, tabId } = record;
    if (event.button !== 0 || win.classList.contains("tabPopoutMinimized")) return;
    event.preventDefault();
    event.stopPropagation();
    win.classList.remove("tabPopoutMaximized");
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
        if (next.width < minW) {
          next.left = startRect.left + startRect.width - minW;
          next.width = minW;
        }
      }
      if (edge.includes("n")) {
        next.top = startRect.top + dy;
        next.height = startRect.height - dy;
        if (next.height < minH) {
          next.top = startRect.top + startRect.height - minH;
          next.height = minH;
        }
      }
      setRect(win, next, tabId, "resize");
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
    const { win, tabId } = record;
    const minimizing = !win.classList.contains("tabPopoutMinimized");
    if (minimizing) {
      if (!win.classList.contains("tabPopoutMaximized")) record.restoreRect = getRect(win);
      win.classList.remove("tabPopoutMaximized");
      win.classList.add("tabPopoutMinimized");
      setRect(win, { ...getRect(win), height: TITLEBAR_H + 2, minimized: true }, tabId, "minimize");
    } else {
      win.classList.remove("tabPopoutMinimized");
      setRect(win, record.restoreRect || { ...getRect(win), height: minH }, tabId, "restore");
    }
  }

  function toggleMaximized(record) {
    const { win, tabId } = record;
    if (win.classList.contains("tabPopoutMaximized")) {
      win.classList.remove("tabPopoutMaximized", "tabPopoutMinimized");
      setRect(win, record.restoreRect || getRect(win), tabId, "restore");
      return;
    }
    if (!win.classList.contains("tabPopoutMinimized")) record.restoreRect = getRect(win);
    win.classList.remove("tabPopoutMinimized");
    win.classList.add("tabPopoutMaximized");
    const viewport = getViewportRect();
    setRect(win, {
      left: viewport.x,
      top: viewport.y,
      width: viewport.width,
      height: viewport.height,
    }, tabId, "maximize");
  }

  function dockTab(tabId) {
    const record = poppedTabs.get(tabId);
    if (!record) return;
    poppedTabs.delete(tabId);
    record.page.classList.remove(pageFloatingClass);
    record.placeholder.parentNode?.insertBefore(record.page, record.placeholder);
    record.placeholder.remove();
    record.win.remove();
    setTabPoppedState(tabId, false);
    const activeTab = getTabSystem(config)?.getCurrentTab?.();
    record.page.style.display = activeTab === tabId ? "block" : "none";
    if (typeof config.onDockTab === "function") config.onDockTab(tabId, record);
    notifyLayout(tabId, "dock");
  }

  function popoutTab(tabId) {
    if (focusPopout(tabId)) return;
    const page = document.getElementById(getPageId(tabId));
    if (!page) return;

    ensureStyles();

    const placeholder = document.createElement("div");
    placeholder.className = placeholderClass;
    placeholder.hidden = true;
    page.parentNode?.insertBefore(placeholder, page);

    const win = document.createElement("div");
    win.className = `tabPopoutWindow ${windowClass}`;
    win.style.zIndex = String(++popoutZ);
    win.innerHTML = `
      <div class="tabPopoutHeader">
        <div class="tabPopoutTitle">${escapeHtml(getTabLabel(tabId, labels))}</div>
        <span class="tabPopoutControls">
          ${buildIconButton("minimize", "Minimize", '<line x1="2" y1="7" x2="8" y2="7"></line>')}
          ${buildIconButton("maximize", "Maximize", '<rect x="2" y="2" width="6" height="6" rx="0.6"></rect>')}
          ${buildIconButton("close", "Dock tab", '<line x1="2" y1="2" x2="8" y2="8"></line><line x1="8" y1="2" x2="2" y2="8"></line>')}
        </span>
      </div>
      <div class="tabPopoutBody"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeNw" data-edge="nw" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeEdge tabPopoutResizeN" data-edge="n" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeNe" data-edge="ne" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeEdge tabPopoutResizeE" data-edge="e" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeSw" data-edge="sw" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeEdge tabPopoutResizeS" data-edge="s" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeSe" data-edge="se" title="Resize"></div>
      <div class="tabPopoutResizeHandle tabPopoutResizeEdge tabPopoutResizeW" data-edge="w" title="Resize"></div>
    `;
    document.body.appendChild(win);

    const body = win.querySelector(".tabPopoutBody");
    page.classList.add(pageFloatingClass);
    page.style.display = "block";
    body?.appendChild(page);

    const record = { tabId, page, placeholder, win, restoreRect: null };
    poppedTabs.set(tabId, record);
    setTabPoppedState(tabId, true);

    win.querySelectorAll(".tabPopoutButton").forEach((button) => {
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
      dockTab(tabId);
    });
    win.querySelectorAll(".tabPopoutResizeHandle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => startResize(record, event, handle.dataset.edge || "se"));
    });
    win.addEventListener("pointerdown", () => {
      win.style.zIndex = String(++popoutZ);
    });
    const header = win.querySelector(".tabPopoutHeader");
    if (header) makeDraggable(record, header);

    const tabSystem = getTabSystem(config);
    if (tabSystem?.getCurrentTab?.() === tabId) {
      tabSystem.setActive(getFallbackTabId(tabId));
      page.style.display = "block";
    }
    if (typeof config.onPopoutTab === "function") config.onPopoutTab(tabId, record);
    notifyLayout(tabId, "popout");
  }

  function wire() {
    const tabBar = document.querySelector(`.${tabBarClass}`);
    if (!tabBar || tabBar.dataset[wiredKey] === "1") return;
    tabBar.dataset[wiredKey] = "1";
    tabBar.addEventListener("click", (event) => {
      const tab = event.target?.closest?.(`.${tabClass}`);
      const tabId = tab?.dataset?.page || "";
      if (!tabId || !poppedTabs.has(tabId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      focusPopout(tabId);
    }, true);
    tabBar.addEventListener("contextmenu", (event) => {
      const tab = event.target?.closest?.(`.${tabClass}`);
      const tabId = tab?.dataset?.page || "";
      if (!tabId) return;
      event.preventDefault();
      event.stopPropagation();
      popoutTab(tabId);
    });
  }

  return {
    wire,
    popoutTab,
    dockTab,
    focusPopout,
    isPopped: (tabId) => poppedTabs.has(tabId),
  };
}

export function wireTabPopoutWindows(config = {}) {
  const manager = createTabPopoutManager(config);
  manager.wire();
  return manager;
}
