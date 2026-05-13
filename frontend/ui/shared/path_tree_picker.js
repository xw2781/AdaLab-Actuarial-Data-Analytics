const STYLE_ID = "arcrho-path-tree-picker-style";
const TREE_INDENT_PX = 10;
const TREE_CHILDREN_INDENT_PX = 6;
const TREE_LEAF_EXTRA_INDENT_PX = 12;
const WINDOW_FRAME_MARGIN_PX = 8;
let activePicker = null;

function ensureStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ptree-window {
      position: fixed;
      top: 120px;
      left: 50%;
      transform: translateX(-50%);
      width: 520px;
      min-width: 320px;
      min-height: 240px;
      max-width: 96vw;
      max-height: 88vh;
      background: #fff;
      border: 1px solid #cfcfcf;
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.2);
      z-index: 5200;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
      overscroll-behavior: contain;
    }
    .ptree-window.ptree-refresh-enter {
      opacity: 0;
      pointer-events: none;
    }
    .ptree-window.ptree-refresh-ready {
      opacity: 1;
      transition: opacity 90ms ease-out;
    }
    .ptree-window::after {
      content: "";
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 10px;
      height: 10px;
      border-right: 2px solid transparent;
      border-bottom: 2px solid transparent;
      opacity: 0;
      pointer-events: none;
    }
    .ptree-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background: #f6f6f6;
      border-bottom: 1px solid #e1e1e1;
      user-select: none;
      cursor: grab;
      flex-shrink: 0;
    }
    .ptree-titlebar:active { cursor: grabbing; }
    .ptree-title-wrap {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .ptree-title-icon {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #666;
      flex-shrink: 0;
    }
    .ptree-title-icon svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptree-title {
      font-weight: 600;
      font-size: 14px;
      color: #2e2e2e;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1 1 auto;
    }
    .ptree-tools {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .ptree-toolbtn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #666;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .ptree-toolbtn:hover { background: #e8e8e8; }
    .ptree-toolbtn.active {
      background: #e8f0fe;
      color: #1d4fd8;
    }
    .ptree-toolbtn svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptree-close {
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #666;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .ptree-close:hover { background: #e8e8e8; }
    .ptree-close svg {
      width: 20px;
      height: 20px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptree-body {
      flex: 1 1 auto;
      overflow: auto;
      padding: 8px 0;
      background: #fff;
      overscroll-behavior: contain;
    }
    .ptree-empty {
      padding: 10px 12px;
      color: #777;
      font-size: 13px;
      font-style: italic;
    }
    .ptree-status {
      padding: 6px 12px;
      color: #666;
      font-size: 12px;
      font-style: italic;
    }
    .ptree-status.error {
      color: #b42318;
      font-style: normal;
    }
    .ptree-node { user-select: none; }
    .ptree-node.ptree-removing {
      overflow: hidden;
      opacity: 0;
      max-height: 0 !important;
      transition: max-height 140ms ease, opacity 120ms ease;
    }
    .ptree-folder {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .ptree-folder:hover { background: #eef3ff; }
    .ptree-folder.active-path,
    .ptree-leaf.active-path {
      background: #dfe9ff;
      box-shadow: inset 0 0 0 1px #8fb0f4;
    }
    .ptree-folder.active-path .ptree-label,
    .ptree-leaf.active-path .ptree-label {
      color: #173f90;
      font-weight: 600;
    }
    .ptree-arrow {
      width: 14px;
      height: 14px;
      color: #8a8a8a;
      flex-shrink: 0;
      transition: transform 0.15s ease;
    }
    .ptree-arrow.expanded { transform: rotate(90deg); }
    .ptree-arrow svg { width: 100%; height: 100%; }
    .ptree-label {
      font-size: 13px;
      color: #222;
    }
    .ptree-type-icon {
      width: 13px;
      height: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #6f6f6f;
    }
    .ptree-type-icon svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptree-type-icon.calculated { color: #2563eb; }
    .ptree-type-icon.calculated-muted { color: #6b7280; }
    .ptree-type-icon.imported,
    .ptree-type-icon.source { color: #6b7280; }
    .ptree-type-icon.folder {
      color: #f0ad4e;
    }
    .ptree-type-icon.folder.open {
      color: #ec971f;
    }
    .ptree-type-icon.folder svg {
      fill: currentColor;
      stroke: none;
    }
    .ptree-level {
      margin-left: auto;
      font-size: 11px;
      color: #999;
    }
    .ptree-leaf-tail {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .ptree-fav-btn {
      width: 18px;
      height: 18px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #b5b5b5;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      transition: color 0.12s ease, background 0.12s ease;
    }
    .ptree-fav-btn svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptree-fav-btn:hover {
      background: rgba(0, 0, 0, 0.04);
      color: #cf9800;
    }
    .ptree-fav-btn:hover svg {
      fill: #f6cd3f;
      stroke: #cf9800;
    }
    .ptree-fav-btn.active {
      color: #cf9800;
    }
    .ptree-fav-btn.active svg {
      fill: #f6cd3f;
      stroke: #cf9800;
    }
    .ptree-fav-btn.ancestor {
      color: #cf9800;
    }
    .ptree-fav-btn.ancestor svg {
      fill: none;
      stroke: #cf9800;
    }
    .ptree-fav-btn.ancestor:hover svg {
      fill: none;
      stroke: #cf9800;
    }
    .ptree-children { display: none; padding-left: ${TREE_CHILDREN_INDENT_PX}px; }
    .ptree-children.expanded { display: block; }
    .ptree-leaf {
      display: flex;
      align-items: center;
      padding: 3px 8px 3px 22px;
      border-radius: 4px;
      cursor: pointer;
      gap: 6px;
      font-size: 13px;
      color: #222;
    }
    .ptree-leaf:hover { background: #e8f0fe; }
    .ptree-select-hint {
      margin-left: 6px;
      color: #a3a3a3;
      font-size: 11px;
      font-style: italic;
      white-space: nowrap;
      display: none;
      pointer-events: none;
    }
    .ptree-leaf:hover .ptree-select-hint { display: inline; }
  `;
  doc.head.appendChild(style);
}

function normalizeLevelLabels(rawLabels) {
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels.map((v, idx) => {
    const label = String(v || "").trim();
    return label || `Level ${idx + 1}`;
  });
}

function splitPath(rawPath, delimiter) {
  return String(rawPath || "")
    .split(delimiter)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function normalizePath(rawPath, delimiter) {
  return splitPath(rawPath, delimiter).join(delimiter);
}

function normalizePickerNode(rawNode, options = {}, parentPath = "") {
  if (rawNode && rawNode.__ptreeNormalized) return rawNode;
  const delimiter = String(options?.delimiter || "\\");
  const levelLabels = normalizeLevelLabels(options?.levelLabels);
  const name = String(rawNode?.name || "").trim();
  const explicitPath = String(rawNode?.path || "").trim();
  const path = explicitPath || (parentPath && name ? `${parentPath}${delimiter}${name}` : name);
  const parts = splitPath(path, delimiter);
  const levelIndexRaw = Number(rawNode?.levelIndex ?? rawNode?.level_index);
  const levelIndex = Number.isFinite(levelIndexRaw) && levelIndexRaw >= 0 ? levelIndexRaw : parts.length;
  const levelLabelRaw = rawNode?.levelLabel ?? rawNode?.level_label ?? "";
  const levelLabel = String(levelLabelRaw).trim()
    || (levelIndex > 0 ? (levelLabels[levelIndex - 1] || `Level ${levelIndex}`) : "All");

  const rawChildren = Array.isArray(rawNode?.children) ? rawNode.children : [];
  const children = rawChildren.map((child) => normalizePickerNode(child, options, path));
  const hasChildrenFlag = rawNode?.hasChildren ?? rawNode?.has_children;
  const hasChildren = typeof hasChildrenFlag === "boolean"
    ? hasChildrenFlag
    : children.length > 0;
  const valueTypeRaw = rawNode?.valueType ?? rawNode?.value_type ?? rawNode?.nodeType ?? rawNode?.node_type ?? "";
  const valueType = String(valueTypeRaw || "").trim().toLowerCase();

  return {
    name,
    path,
    levelIndex,
    levelLabel,
    valueType,
    hasChildren,
    children,
    _loaded: children.length > 0,
    __ptreeNormalized: true,
  };
}

export function buildPathTreeFromPaths(paths, options = {}) {
  const delimiter = String(options?.delimiter || "\\");
  const levelLabels = normalizeLevelLabels(options?.levelLabels);
  const root = {
    name: "All",
    path: "",
    levelIndex: 0,
    levelLabel: "All",
    _children: new Map(),
  };

  for (const raw of Array.isArray(paths) ? paths : []) {
    const parts = splitPath(raw, delimiter);
    if (!parts.length) continue;
    let node = root;
    const acc = [];
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx];
      acc.push(part);
      if (!node._children.has(part)) {
        node._children.set(part, {
          name: part,
          path: acc.join(delimiter),
          levelIndex: idx + 1,
          levelLabel: levelLabels[idx] || `Level ${idx + 1}`,
          _children: new Map(),
        });
      }
      node = node._children.get(part);
    }
  }

  const finalize = (nodeObj) => {
    const keys = Array.from(nodeObj._children.keys()).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true }),
    );
    return {
      name: nodeObj.name,
      path: nodeObj.path,
      levelIndex: nodeObj.levelIndex,
      levelLabel: nodeObj.levelLabel,
      children: keys.map((key) => finalize(nodeObj._children.get(key))),
    };
  };

  return finalize(root);
}

function makeDraggable(doc, win, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  const getViewportSize = () => {
    const view = doc?.defaultView || window;
    const width = Number(view?.innerWidth || doc?.documentElement?.clientWidth || 0);
    const height = Number(view?.innerHeight || doc?.documentElement?.clientHeight || 0);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    };
  };
  const clampPosition = (leftIn, topIn) => {
    const leftRaw = Number(leftIn);
    const topRaw = Number(topIn);
    const left = Number.isFinite(leftRaw) ? leftRaw : WINDOW_FRAME_MARGIN_PX;
    const top = Number.isFinite(topRaw) ? topRaw : WINDOW_FRAME_MARGIN_PX;
    const rect = typeof win?.getBoundingClientRect === "function"
      ? win.getBoundingClientRect()
      : null;
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    const safeWidth = Number.isFinite(width) && width > 0 ? width : Number(win?.offsetWidth || 0);
    const safeHeight = Number.isFinite(height) && height > 0 ? height : Number(win?.offsetHeight || 0);
    const viewport = getViewportSize();
    const minLeft = WINDOW_FRAME_MARGIN_PX;
    const minTop = WINDOW_FRAME_MARGIN_PX;
    const maxLeft = viewport.width > 0
      ? Math.max(minLeft, viewport.width - safeWidth - WINDOW_FRAME_MARGIN_PX)
      : minLeft;
    const maxTop = viewport.height > 0
      ? Math.max(minTop, viewport.height - safeHeight - WINDOW_FRAME_MARGIN_PX)
      : minTop;
    return {
      left: Math.min(Math.max(minLeft, left), maxLeft),
      top: Math.min(Math.max(minTop, top), maxTop),
    };
  };
  const applyPosition = (left, top) => {
    const next = clampPosition(left, top);
    win.style.left = `${next.left}px`;
    win.style.top = `${next.top}px`;
    win.style.transform = "none";
  };

  const onMove = (e) => {
    if (!dragging) return;
    applyPosition(e.clientX - offsetX, e.clientY - offsetY);
  };
  const onUp = () => {
    if (dragging) {
      const rect = win.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    }
    dragging = false;
    doc.removeEventListener("mousemove", onMove);
    doc.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".ptree-tools")) return;
    const rect = win.getBoundingClientRect();
    const resizeEdge = 16;
    if (e.clientX >= (rect.right - resizeEdge) && e.clientY >= (rect.bottom - resizeEdge)) return;
    dragging = true;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    applyPosition(rect.left, rect.top);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

function isVerticallyScrollable(el) {
  if (!el || typeof el.scrollHeight !== "number" || typeof el.clientHeight !== "number") return false;
  const view = el.ownerDocument?.defaultView || window;
  const style = view?.getComputedStyle ? view.getComputedStyle(el) : null;
  const overflowY = String(style?.overflowY || "").toLowerCase();
  const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  return canScroll && (el.scrollHeight > (el.clientHeight + 1));
}

function findScrollableAncestorInside(target, root) {
  let el = target && target.nodeType === 1 ? target : null;
  while (el && el !== root) {
    if (isVerticallyScrollable(el)) return el;
    el = el.parentElement;
  }
  if (root && isVerticallyScrollable(root)) return root;
  return null;
}

function isolateWheelScroll(doc, win) {
  if (!doc || !win) return () => {};

  const onWheel = (evt) => {
    if (!win.contains(evt.target)) return;

    const targetEl = evt.target && evt.target.nodeType === 1 ? evt.target : null;
    const scroller = findScrollableAncestorInside(targetEl, win);
    if (!scroller) {
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    const deltaY = Number(evt.deltaY || 0);
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return;

    const atTop = scroller.scrollTop <= 0;
    const atBottom = (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 1);
    if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    doc.removeEventListener("wheel", onWheel, true);
  };
}

function renderTypeIcon(doc, rawType) {
  const type = String(rawType || "").trim().toLowerCase();
  if (!type) return null;

  const el = doc.createElement("span");
  el.className = `ptree-type-icon ${type}`;

  if (type === "folder") {
    el.title = "Folder";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
    return el;
  }
  if (type === "calculated") {
    el.title = "Calculated class type";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8v6H4zM12 11h8v6h-8zM12 3h8v6h-8z"/></svg>';
    return el;
  }
  if (type === "calculated-muted" || type === "calculated_muted") {
    el.className = "ptree-type-icon calculated-muted";
    el.title = "Calculated class context (imported node)";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8v6H4zM12 11h8v6h-8zM12 3h8v6h-8z"/></svg>';
    return el;
  }
  if (type === "imported" || type === "source") {
    el.className = "ptree-type-icon imported";
    el.title = "Imported value type";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v9c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-9"/></svg>';
    return el;
  }
  return null;
}

function normalizeFavoriteState(rawState) {
  const state = String(rawState || "").trim().toLowerCase();
  if (state === "selected" || state === "active" || state === "favorite") return "selected";
  if (state === "ancestor" || state === "inherited" || state === "parent") return "ancestor";
  return "none";
}

function resolveFavoriteState(node, options = {}) {
  const delimiter = String(options?.delimiter || "\\");
  const path = normalizePath(node?.path || "", delimiter);
  if (!path) return "none";
  if (typeof options?.getFavoriteState === "function") {
    try {
      return normalizeFavoriteState(options.getFavoriteState(path, node));
    } catch {
      return "none";
    }
  }
  const nodeState = normalizeFavoriteState(node?.favorite_state ?? node?.favoriteState);
  if (nodeState !== "none") return nodeState;
  return "none";
}

function renderFavoriteButton(doc, node, options = {}, state = "none") {
  if (typeof options?.onToggleFavorite !== "function") return null;
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "ptree-fav-btn";
  const normalizedState = normalizeFavoriteState(state);
  if (normalizedState === "selected") btn.classList.add("active");
  if (normalizedState === "ancestor") btn.classList.add("ancestor");
  btn.title = normalizedState === "selected"
    ? "Favorited"
    : (normalizedState === "ancestor" ? "Ancestor of favorited path" : "Add to favorites");
  btn.setAttribute("aria-label", btn.title);
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.54 5.14 5.67.82-4.1 3.99.97 5.64L12 16.8 6.92 19.39l.97-5.64-4.1-3.99 5.67-.82L12 3.8z"/></svg>';
  btn.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
  });
  btn.addEventListener("click", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    try {
      options.onToggleFavorite(normalizePath(node?.path || "", String(options?.delimiter || "\\")), node, {
        event: evt,
        state: normalizedState,
      });
    } catch {}
  });
  return btn;
}

function setFolderTypeIconExpanded(iconEl, expanded) {
  if (!iconEl || !iconEl.classList?.contains("folder")) return;
  const isOpen = !!expanded;
  iconEl.classList.toggle("open", isOpen);
  if (isOpen) {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>';
  } else {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
  }
}

function renderTitleIcon(doc, rawType) {
  const type = String(rawType || "").trim().toLowerCase();
  if (!type || type === "none" || type === "off" || type === "false") return null;
  const el = doc.createElement("span");
  el.className = "ptree-title-icon";

  if (type === "folder") {
    el.title = "Folder view";
    el.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 8h10l2 3h14v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M3 8V6a3 3 0 0 1 3-3h7l2 3h11a3 3 0 0 1 3 3v2"/></svg>';
    return el;
  }
  if (type === "mapping") {
    el.title = "Filter mapping";
    el.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="7" width="10" height="18" rx="1.5"/><line x1="2" y1="13" x2="12" y2="13"/><line x1="2" y1="19" x2="12" y2="19"/><rect x="20" y="7" width="10" height="18" rx="1.5"/><line x1="20" y1="13" x2="30" y2="13"/><line x1="20" y1="19" x2="30" y2="19"/><line x1="13" y1="16" x2="19" y2="16"/><polyline points="17,13.5 19.5,16 17,18.5"/></svg>';
    return el;
  }

  // Default: reserving-class hierarchy icon (same language as Project Settings ribbon).
  el.title = "Hierarchy view";
  el.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="11" y="3" width="10" height="8" rx="1.5"/><rect x="2" y="21" width="10" height="8" rx="1.5"/><rect x="20" y="21" width="10" height="8" rx="1.5"/><line x1="16" y1="11" x2="16" y2="16"/><line x1="7" y1="16" x2="25" y2="16"/><line x1="7" y1="16" x2="7" y2="21"/><line x1="25" y1="16" x2="25" y2="21"/></svg>';
  return el;
}

function isControlElementVisible(control) {
  const el = control?.element;
  if (!el || typeof el.getClientRects !== "function") return false;
  return el.getClientRects().length > 0;
}

function resolveVisibleHighlightPathKey(context) {
  if (!context || !(context.nodeControls instanceof Map)) return "";
  const activePathKey = String(context.activePathKey || "");
  const delimiter = String(context.delimiter || "\\");
  if (!activePathKey) return "";

  const parts = splitPath(activePathKey, delimiter);
  if (!parts.length) return "";

  let deepestVisible = "";
  let deepestExisting = "";

  for (let i = 1; i <= parts.length; i++) {
    const key = parts.slice(0, i).join(delimiter);
    const control = context.nodeControls.get(key);
    if (!control) continue;
    deepestExisting = key;
    if (isControlElementVisible(control)) {
      deepestVisible = key;
    }
  }

  return deepestVisible || deepestExisting || "";
}

function renderNode(doc, node, depth, options, onSelect, context) {
  const nodeEl = doc.createElement("div");
  nodeEl.className = "ptree-node";
  const currentNode = normalizePickerNode(node, options);
  const onNodeContextMenu = typeof options?.onNodeContextMenu === "function"
    ? options.onNodeContextMenu
    : null;
  const fireNodeContextMenu = (event, element) => {
    if (!onNodeContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      onNodeContextMenu(currentNode, {
        event,
        element,
      });
    } catch {}
  };
  const pathKey = typeof context?.makePathKey === "function"
    ? context.makePathKey(currentNode?.path || "")
    : "";
  const hasChildren = (Array.isArray(currentNode?.children) && currentNode.children.length > 0)
    || Boolean(currentNode?.hasChildren);
  const selectOnDoubleClick = !!options?.selectOnDoubleClick;
  const favoriteState = resolveFavoriteState(currentNode, options);

  if (!hasChildren) {
    const leaf = doc.createElement("div");
    leaf.className = "ptree-leaf";
    leaf.style.paddingLeft = `${8 + depth * TREE_INDENT_PX + TREE_LEAF_EXTRA_INDENT_PX}px`;
    const typeIcon = renderTypeIcon(doc, currentNode?.valueType);
    if (typeIcon) leaf.appendChild(typeIcon);
    const leafLabel = doc.createElement("span");
    leafLabel.className = "ptree-label";
    leafLabel.textContent = String(currentNode?.name || "");
    leaf.appendChild(leafLabel);
    const tail = doc.createElement("span");
    tail.className = "ptree-leaf-tail";
    if (selectOnDoubleClick) {
      const hint = doc.createElement("span");
      hint.className = "ptree-select-hint";
      hint.textContent = "Double Click to Select";
      tail.appendChild(hint);
    }
    const favoriteBtn = renderFavoriteButton(doc, currentNode, options, favoriteState);
    if (favoriteBtn) {
      tail.appendChild(favoriteBtn);
    }
    if (tail.childNodes.length) {
      leaf.appendChild(tail);
    }
    leaf.title = String(currentNode?.path || "");
    if (selectOnDoubleClick) {
      leaf.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(currentNode);
      });
    } else {
      leaf.addEventListener("click", () => onSelect(currentNode));
    }
    leaf.addEventListener("contextmenu", (e) => fireNodeContextMenu(e, leaf));
    nodeEl.appendChild(leaf);
    if (pathKey && context?.nodeControls instanceof Map) {
      context.nodeControls.set(pathKey, {
        path: String(currentNode?.path || ""),
        node: currentNode,
        element: leaf,
        nodeElement: nodeEl,
        hasChildren: false,
        isExpanded: () => false,
        expand: async () => {},
      });
    }
    return nodeEl;
  }

  const folder = doc.createElement("div");
  folder.className = "ptree-folder";
  folder.style.paddingLeft = `${4 + depth * TREE_INDENT_PX}px`;

  const arrow = doc.createElement("div");
  arrow.className = "ptree-arrow";
  arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';

  const label = doc.createElement("span");
  label.className = "ptree-label";
  label.textContent = String(currentNode?.name || "");
  const typeIcon = renderTypeIcon(doc, currentNode?.valueType);

  const level = doc.createElement("span");
  level.className = "ptree-level";
  level.textContent = String(currentNode?.levelLabel || "");
  const favoriteBtn = renderFavoriteButton(doc, currentNode, options, favoriteState);

  const isFolderTypeIcon = !!(typeIcon && typeIcon.classList?.contains("folder"));
  if (isFolderTypeIcon) {
    const defaultExpanded = Number.isInteger(options?.defaultExpandedDepth)
      ? Number(options.defaultExpandedDepth)
      : 0;
    setFolderTypeIconExpanded(typeIcon, depth < defaultExpanded);
  }

  if (typeIcon) folder.append(arrow, typeIcon, label, level);
  else folder.append(arrow, label, level);
  if (favoriteBtn) folder.appendChild(favoriteBtn);
  nodeEl.appendChild(folder);

  const children = doc.createElement("div");
  children.className = "ptree-children";

  const renderChildren = () => {
    children.innerHTML = "";
    const kids = Array.isArray(currentNode.children) ? currentNode.children : [];
    if (!kids.length) {
      const empty = doc.createElement("div");
      empty.className = "ptree-status";
      empty.textContent = "No matching paths.";
      children.appendChild(empty);
      return;
    }
    for (const child of kids) {
      children.appendChild(renderNode(doc, child, depth + 1, options, onSelect, context));
    }
  };

  const ensureChildrenLoaded = async () => {
    if (currentNode._loaded || typeof context?.loadChildren !== "function" || !currentNode.hasChildren) return;
    if (currentNode._loadingPromise) return currentNode._loadingPromise;

    currentNode._loadingPromise = (async () => {
      children.innerHTML = "";
      const loading = doc.createElement("div");
      loading.className = "ptree-status";
      loading.textContent = "Loading...";
      children.appendChild(loading);
      try {
        const loaded = await context.loadChildren(currentNode);
        const rawKids = Array.isArray(loaded?.children)
          ? loaded.children
          : (Array.isArray(loaded) ? loaded : []);
        currentNode.children = rawKids.map((child) => normalizePickerNode(child, options, currentNode.path));
        currentNode.hasChildren = currentNode.children.length > 0;
        currentNode._loaded = true;
        renderChildren();
      } catch (err) {
        children.innerHTML = "";
        const errorEl = doc.createElement("div");
        errorEl.className = "ptree-status error";
        errorEl.textContent = String(err?.message || "Failed to load.");
        children.appendChild(errorEl);
      }
    })().finally(() => {
      currentNode._loadingPromise = null;
    });

    return currentNode._loadingPromise;
  };

  const setExpanded = async (expanded) => {
    if (expanded) {
      await ensureChildrenLoaded();
      if (!currentNode._loaded) {
        renderChildren();
      }
    }
    arrow.classList.toggle("expanded", expanded);
    if (isFolderTypeIcon) setFolderTypeIconExpanded(typeIcon, expanded);
    children.classList.toggle("expanded", expanded);

    if (expanded && options?.autoExpandSingleChild) {
      const kids = Array.isArray(currentNode?.children) ? currentNode.children : [];
      if (kids.length === 1) {
        const onlyChild = kids[0];
        const childHasChildren = (Array.isArray(onlyChild?.children) && onlyChild.children.length > 0)
          || Boolean(onlyChild?.hasChildren);
        if (childHasChildren) {
          const childKey = typeof context?.makePathKey === "function"
            ? context.makePathKey(onlyChild?.path || "")
            : "";
          const childControl = childKey && context?.nodeControls instanceof Map
            ? context.nodeControls.get(childKey)
            : null;
          if (childControl && typeof childControl.expand === "function") {
            await childControl.expand();
          }
        }
      }
    }
    if (typeof context?.refreshActivePath === "function") {
      context.refreshActivePath();
    }
  };

  if (Array.isArray(currentNode.children) && currentNode.children.length > 0) {
    renderChildren();
  }
  nodeEl.appendChild(children);

  if (pathKey && context?.nodeControls instanceof Map) {
    context.nodeControls.set(pathKey, {
      path: String(currentNode?.path || ""),
      node: currentNode,
      element: folder,
      nodeElement: nodeEl,
      hasChildren: true,
      isExpanded: () => arrow.classList.contains("expanded"),
      expand: async () => setExpanded(true),
      collapse: async () => setExpanded(false),
    });
  }

  const defaultDepth = Number.isInteger(options?.defaultExpandedDepth)
    ? Number(options.defaultExpandedDepth)
    : 0;
  const hasExpandedPathsOverride = Array.isArray(options?.expandedPaths);
  if (!hasExpandedPathsOverride && depth < defaultDepth) {
    setExpanded(true);
  }

  folder.addEventListener("click", async () => {
    const expanded = !arrow.classList.contains("expanded");
    await setExpanded(expanded);
  });
  folder.addEventListener("contextmenu", (e) => fireNodeContextMenu(e, folder));
  if (options?.allowBranchSelect) {
    folder.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(currentNode);
    });
  }

  return nodeEl;
}

function collectExpandedPaths(nodeControls, delimiter = "\\") {
  if (!(nodeControls instanceof Map) || !nodeControls.size) return [];
  const out = [];
  for (const control of nodeControls.values()) {
    if (!control || !control.hasChildren || typeof control.isExpanded !== "function") continue;
    if (!control.isExpanded()) continue;
    const el = control.element;
    if (el && typeof el.getClientRects === "function" && el.getClientRects().length < 1) continue;
    const path = normalizePath(control.path || "", delimiter);
    if (!path) continue;
    out.push(path);
  }
  out.sort((a, b) => {
    const depthDiff = splitPath(a, delimiter).length - splitPath(b, delimiter).length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  });
  return out;
}

async function collapseDeepestExpandedNodes(nodeControls, delimiter = "\\") {
  if (!(nodeControls instanceof Map) || !nodeControls.size) {
    return { collapsedCount: 0, depth: 0 };
  }

  const expandedControls = [];
  for (const control of nodeControls.values()) {
    if (!control || !control.hasChildren || typeof control.isExpanded !== "function") continue;
    if (!control.isExpanded()) continue;
    const path = normalizePath(control.path || "", delimiter);
    if (!path) continue;
    const depth = splitPath(path, delimiter).length;
    if (!Number.isFinite(depth) || depth < 1) continue;
    expandedControls.push({ control, depth });
  }

  if (!expandedControls.length) {
    return { collapsedCount: 0, depth: 0 };
  }

  let maxDepth = 0;
  for (const item of expandedControls) {
    if (item.depth > maxDepth) maxDepth = item.depth;
  }

  const targets = expandedControls.filter((item) => item.depth === maxDepth);
  let collapsedCount = 0;
  for (const item of targets) {
    if (!item?.control || typeof item.control.collapse !== "function") continue;
    try {
      await item.control.collapse();
      collapsedCount += 1;
    } catch {
      // ignore collapse failures per node
    }
  }

  return { collapsedCount, depth: maxDepth };
}

function disposeFloatingPathTreePicker(picker, reason = "programmatic", options = {}) {
  if (!picker) return;
  const { doc, win, onEsc, onClose, onBeforeClose, onWheelGuard, getExpandedPaths } = picker;
  if (options?.beforeClose !== false && typeof onBeforeClose === "function") {
    let rect = null;
    let body = null;
    try {
      rect = win && typeof win.getBoundingClientRect === "function"
        ? win.getBoundingClientRect()
        : null;
      body = win && typeof win.querySelector === "function"
        ? win.querySelector(".ptree-body")
        : null;
    } catch {
      rect = null;
      body = null;
    }
    try {
      onBeforeClose({
        reason,
        element: win,
        rect,
        left: Number(rect?.left),
        top: Number(rect?.top),
        width: Number(rect?.width),
        height: Number(rect?.height),
        scrollTop: Number(body?.scrollTop || 0),
        scrollLeft: Number(body?.scrollLeft || 0),
        expandedPaths: typeof getExpandedPaths === "function" ? getExpandedPaths() : [],
      });
    } catch {}
  }
  if (doc && onEsc) doc.removeEventListener("keydown", onEsc);
  if (typeof onWheelGuard === "function") {
    try { onWheelGuard(); } catch {}
  }
  if (win && win.parentNode) win.parentNode.removeChild(win);
  if (activePicker === picker) activePicker = null;
  if (options?.close !== false && typeof onClose === "function") {
    try { onClose(reason); } catch {}
  }
}

function getVisibleTreeNodeCount(body) {
  if (!body || typeof body.querySelectorAll !== "function") return 0;
  return Array.from(body.querySelectorAll(".ptree-node"))
    .filter((node) => node && node.parentNode && !node.classList?.contains("ptree-removing"))
    .length;
}

function animateRemoveTreeNode(nodeEl) {
  if (!nodeEl || !nodeEl.parentNode) return Promise.resolve(false);
  return new Promise((resolve) => {
    const startHeight = Math.max(1, Math.ceil(nodeEl.getBoundingClientRect?.().height || nodeEl.scrollHeight || 1));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (nodeEl.parentNode) nodeEl.parentNode.removeChild(nodeEl);
      resolve(true);
    };
    nodeEl.style.maxHeight = `${startHeight}px`;
    nodeEl.offsetHeight;
    nodeEl.classList.add("ptree-removing");
    setTimeout(finish, 170);
  });
}

export function closeFloatingPathTreePicker(reason = "programmatic") {
  if (!activePicker) return;
  disposeFloatingPathTreePicker(activePicker, reason);
}

export function openFloatingPathTreePicker(options = {}) {
  const doc = options?.document || window.document;
  ensureStyles(doc);
  const previousPicker = activePicker;
  const smoothReplaceExisting = !!previousPicker && options?.smoothReplaceExisting === true;
  if (smoothReplaceExisting) {
    try {
      previousPicker.win.style.pointerEvents = "none";
    } catch {}
  } else {
    closeFloatingPathTreePicker("replaced");
  }

  const delimiter = String(options?.delimiter || "\\");
  const makePathKey = (rawPath) => normalizePath(rawPath, delimiter).toLowerCase();
  const tree = options?.tree && typeof options.tree === "object"
    ? options.tree
    : buildPathTreeFromPaths(options?.paths || [], {
      delimiter,
      levelLabels: options?.levelLabels || [],
    });
  const rawRootNodes = Array.isArray(options?.rootNodes)
    ? options.rootNodes
    : (Array.isArray(tree?.children) ? tree.children : []);
  const rootNodes = rawRootNodes.map((node) => normalizePickerNode(node, options));
  const expandedPathMap = new Map();
  const rawExpandedPaths = Array.isArray(options?.expandedPaths) ? options.expandedPaths : null;
  const initialScrollTopRaw = Number(options?.initialScrollTop);
  const initialScrollLeftRaw = Number(options?.initialScrollLeft);
  const hasInitialScrollPosition =
    Number.isFinite(initialScrollTopRaw) || Number.isFinite(initialScrollLeftRaw);
  const restoreInitialScrollPosition = () => {
    if (!hasInitialScrollPosition) return;
    if (Number.isFinite(initialScrollTopRaw)) {
      body.scrollTop = Math.max(0, initialScrollTopRaw);
    }
    if (Number.isFinite(initialScrollLeftRaw)) {
      body.scrollLeft = Math.max(0, initialScrollLeftRaw);
    }
  };
  if (rawExpandedPaths) {
    for (const raw of rawExpandedPaths) {
      const path = normalizePath(raw, delimiter);
      if (!path) continue;
      const key = makePathKey(path);
      if (!key || expandedPathMap.has(key)) continue;
      expandedPathMap.set(key, path);
    }
  }
  const expandedPaths = rawExpandedPaths
    ? Array.from(expandedPathMap.values()).sort((a, b) => {
      const depthDiff = splitPath(a, delimiter).length - splitPath(b, delimiter).length;
      if (depthDiff !== 0) return depthDiff;
      return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
    })
    : null;
  const hasExpandedPathsOverride = Array.isArray(rawExpandedPaths);
  const initialPath = normalizePath(options?.initialPath || options?.expandPath || "", delimiter);
  const initialActivePath = normalizePath(options?.activePath || initialPath || "", delimiter);
  const baseTitle = String(options?.title || "Path Tree");
  const resolvePickerTitle = (rawPath) => {
    const path = normalizePath(rawPath || "", delimiter);
    if (options?.titleFromActivePath && path) return path;
    return baseTitle;
  };

  const win = doc.createElement("div");
  win.className = "ptree-window";
  if (smoothReplaceExisting) {
    win.classList.add("ptree-refresh-enter");
  }

  const bar = doc.createElement("div");
  bar.className = "ptree-titlebar";

  const titleWrap = doc.createElement("div");
  titleWrap.className = "ptree-title-wrap";

  const titleIcon = renderTitleIcon(
    doc,
    options?.titleIcon === undefined ? "hierarchy" : options?.titleIcon,
  );
  if (titleIcon) titleWrap.appendChild(titleIcon);

  const title = doc.createElement("span");
  title.className = "ptree-title";
  title.textContent = resolvePickerTitle(initialActivePath);
  title.title = title.textContent;
  titleWrap.appendChild(title);

  const tools = doc.createElement("div");
  tools.className = "ptree-tools";

  if (options?.showCollapseButton !== false) {
    const collapseBtn = doc.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "ptree-toolbtn ptree-collapse";
    collapseBtn.title = String(options?.collapseButtonTitle || "Collapse All");
    collapseBtn.setAttribute("aria-label", String(options?.collapseButtonTitle || "Collapse All"));
    collapseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
    collapseBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const result = await collapseDeepestExpandedNodes(renderContext.nodeControls, delimiter);
      if (typeof options?.onCollapseClick === "function") {
        try {
          options.onCollapseClick({
            event: e,
            pickerElement: win,
            titlebarElement: bar,
            collapsedCount: Number(result?.collapsedCount || 0),
            depth: Number(result?.depth || 0),
          });
        } catch {}
      }
    });
    tools.appendChild(collapseBtn);
  }

  if (typeof options?.onHiddenPathsClick === "function" || options?.showHiddenPathsButton) {
    const hiddenBtn = doc.createElement("button");
    hiddenBtn.type = "button";
    hiddenBtn.className = "ptree-toolbtn ptree-hidden-paths";
    if (options?.hiddenPathsButtonActive) hiddenBtn.classList.add("active");
    hiddenBtn.title = String(options?.hiddenPathsButtonTitle || "Hidden Paths");
    hiddenBtn.setAttribute("aria-label", String(options?.hiddenPathsButtonTitle || "Hidden Paths"));
    hiddenBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/></svg>';
    hiddenBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        options.onHiddenPathsClick({
          event: e,
          buttonElement: hiddenBtn,
          pickerElement: win,
          titlebarElement: bar,
        });
      } catch {}
    });
    tools.appendChild(hiddenBtn);
  }

  if (typeof options?.onFilterClick === "function" || options?.showFilterButton) {
    const filterBtn = doc.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "ptree-toolbtn ptree-filter";
    if (options?.filterButtonActive) filterBtn.classList.add("active");
    filterBtn.title = String(options?.filterButtonTitle || "Filter");
    filterBtn.setAttribute("aria-label", String(options?.filterButtonTitle || "Filter"));
    filterBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5z"/></svg>';
    filterBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        options.onFilterClick({
          event: e,
          pickerElement: win,
          titlebarElement: bar,
        });
      } catch {}
    });
    tools.appendChild(filterBtn);
  }

  if (typeof options?.onPreferencesClick === "function" || options?.showPreferencesButton) {
    const prefBtn = doc.createElement("button");
    prefBtn.type = "button";
    prefBtn.className = "ptree-toolbtn ptree-pref";
    if (options?.preferencesButtonActive) prefBtn.classList.add("active");
    prefBtn.title = String(options?.preferencesButtonTitle || "Preferences");
    prefBtn.setAttribute("aria-label", String(options?.preferencesButtonTitle || "Preferences"));
    prefBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
    prefBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        options.onPreferencesClick({
          event: e,
          pickerElement: win,
          titlebarElement: bar,
        });
      } catch {}
    });
    tools.appendChild(prefBtn);
  }

  const closeBtn = doc.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ptree-close";
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", () => closeFloatingPathTreePicker("close_button"));

  tools.appendChild(closeBtn);
  bar.append(titleWrap, tools);
  win.appendChild(bar);

  const body = doc.createElement("div");
  body.className = "ptree-body";
  const renderContext = {
    loadChildren: typeof options?.loadChildren === "function" ? options.loadChildren : null,
    nodeControls: new Map(),
    makePathKey,
    delimiter,
    activePathKey: initialActivePath ? makePathKey(initialActivePath) : "",
  };
  const applyActivePathClasses = () => {
    const highlightPathKey = resolveVisibleHighlightPathKey(renderContext);
    for (const [pathKey, control] of renderContext.nodeControls.entries()) {
      const el = control?.element;
      if (!el || !el.classList) continue;
      const active = !!highlightPathKey && pathKey === highlightPathKey;
      el.classList.toggle("active-path", active);
      el.classList.remove("active-path-ancestor");
    }
  };
  renderContext.refreshActivePath = applyActivePathClasses;
  const setActivePath = (rawPath, node = null, notify = true) => {
    const normalizedPath = normalizePath(rawPath || "", delimiter);
    renderContext.activePathKey = normalizedPath ? makePathKey(normalizedPath) : "";
    const nextTitle = resolvePickerTitle(normalizedPath);
    title.textContent = nextTitle;
    title.title = nextTitle;
    applyActivePathClasses();
    if (notify && typeof options?.onActivePathChange === "function") {
      try {
        options.onActivePathChange(normalizedPath, node, {
          pickerElement: win,
          titleElement: title,
          activePath: normalizedPath,
        });
      } catch {}
    }
  };
  const onSelect = (node) => {
    const path = normalizePath(node?.path || "", delimiter);
    if (!path) return;
    setActivePath(path, node, true);
    if (typeof options?.onSelect === "function") {
      try { options.onSelect(path, node); } catch {}
    }
    if (options?.autoCloseOnSelect !== false) {
      closeFloatingPathTreePicker("select");
    }
  };

  if (!rootNodes.length) {
    const empty = doc.createElement("div");
    empty.className = "ptree-empty";
    empty.textContent = String(options?.emptyMessage || "No paths available.");
    body.appendChild(empty);
  } else {
    for (const child of rootNodes) {
      body.appendChild(renderNode(doc, child, 0, options, onSelect, renderContext));
    }
  }
  setActivePath(initialActivePath, null, false);
  win.appendChild(body);

  makeDraggable(doc, win, bar);

  const autoExpandSavedPaths = async () => {
    if (!hasExpandedPathsOverride || !expandedPaths?.length) return;
    for (const path of expandedPaths) {
      const parts = splitPath(path, delimiter);
      if (!parts.length) continue;
      const segments = [];
      for (const part of parts) {
        segments.push(part);
        const key = makePathKey(segments.join(delimiter));
        const control = renderContext.nodeControls.get(key);
        if (!control || typeof control.expand !== "function") break;
        await control.expand();
      }
    }
  };
  const autoExpandPath = async () => {
    if (!initialPath) return;
    const parts = splitPath(initialPath, delimiter);
    if (!parts.length) return;

    const segments = [];
    let lastControl = null;
    for (const part of parts) {
      segments.push(part);
      const key = makePathKey(segments.join(delimiter));
      const control = renderContext.nodeControls.get(key);
      if (!control) break;
      lastControl = control;
      if (typeof control.expand === "function") {
        await control.expand();
      }
    }
    if (lastControl?.element && typeof lastControl.element.scrollIntoView === "function") {
      lastControl.element.scrollIntoView({ block: "nearest" });
    }
  };
  const finishInitialRender = () => {
    if (!smoothReplaceExisting) return;
    requestAnimationFrame(() => {
      win.classList.add("ptree-refresh-ready");
      win.classList.remove("ptree-refresh-enter");
      setTimeout(() => {
        disposeFloatingPathTreePicker(previousPicker, "replaced", {
          beforeClose: false,
          close: false,
        });
      }, 110);
    });
  };

  if (hasExpandedPathsOverride || initialPath) {
    setTimeout(() => {
      void (async () => {
        if (hasExpandedPathsOverride) {
          await autoExpandSavedPaths();
        } else {
          await autoExpandPath();
        }
        applyActivePathClasses();
        restoreInitialScrollPosition();
        finishInitialRender();
      })();
    }, 0);
  } else if (hasInitialScrollPosition || smoothReplaceExisting) {
    setTimeout(() => {
      restoreInitialScrollPosition();
      finishInitialRender();
    }, 0);
  }

  const onEsc = (e) => {
    if (e.key === "Escape") closeFloatingPathTreePicker("escape");
  };
  doc.addEventListener("keydown", onEsc);
  doc.body.appendChild(win);
  const onWheelGuard = isolateWheelScroll(doc, win);

  activePicker = {
    doc,
    win,
    onEsc,
    onBeforeClose: options?.onBeforeClose,
    onWheelGuard,
    onClose: options?.onClose,
    getExpandedPaths: () => collectExpandedPaths(renderContext.nodeControls, delimiter),
  };

  const removePath = async (rawPath) => {
    const pathKey = makePathKey(rawPath || "");
    if (!pathKey) return { removed: false, remaining: getVisibleTreeNodeCount(body) };
    const control = renderContext.nodeControls.get(pathKey);
    const nodeEl = control?.nodeElement || control?.element?.closest?.(".ptree-node");
    if (!nodeEl || !nodeEl.parentNode) {
      return { removed: false, remaining: getVisibleTreeNodeCount(body) };
    }

    const descendantPrefix = `${pathKey}${delimiter}`;
    for (const key of Array.from(renderContext.nodeControls.keys())) {
      if (key === pathKey || key.startsWith(descendantPrefix)) {
        renderContext.nodeControls.delete(key);
      }
    }

    await animateRemoveTreeNode(nodeEl);
    if (typeof renderContext.refreshActivePath === "function") {
      renderContext.refreshActivePath();
    }
    return { removed: true, remaining: getVisibleTreeNodeCount(body) };
  };

  return {
    close: () => closeFloatingPathTreePicker("api"),
    element: win,
    removePath,
  };
}
