export function wireNotesEditorInteractions(deps = {}) {
  const getNotesProgrammaticInput = typeof deps.getNotesProgrammaticInput === "function"
    ? deps.getNotesProgrammaticInput
    : () => false;
  const getLastSavedNotesText = typeof deps.getLastSavedNotesText === "function"
    ? deps.getLastSavedNotesText
    : () => "";
  const setNotesDirty = typeof deps.setNotesDirty === "function"
    ? deps.setNotesDirty
    : () => {};
  const updateNotesSaveUi = typeof deps.updateNotesSaveUi === "function"
    ? deps.updateNotesSaveUi
    : () => {};
  const onSaveNotes = typeof deps.onSaveNotes === "function"
    ? deps.onSaveNotes
    : async () => ({ ok: false, error: "Notes save handler not configured." });
  const setStatus = typeof deps.setStatus === "function"
    ? deps.setStatus
    : () => {};
  const formatSaveErrorStatus = typeof deps.formatSaveErrorStatus === "function"
    ? deps.formatSaveErrorStatus
    : (result) => `Notes save failed: ${result?.error || "Unknown error."}`;

  const ids = (deps && typeof deps.ids === "object" && deps.ids) || {};
  const classes = (deps && typeof deps.classes === "object" && deps.classes) || {};
  const inputId = String(ids.inputId || "dsNotesInput");
  const wrapId = String(ids.wrapId || "dsNotesInputWrap");
  const decorId = String(ids.decorId || "dsNotesDecor");
  const toolbarId = String(ids.toolbarId || "dsNotesToolbar");
  const formatToolbarId = String(ids.formatToolbarId || "");
  const saveBtnId = String(ids.saveBtnId || "dsNotesSaveBtn");
  const tooltipClass = String(classes.tooltipClass || "dsNotesPathTooltip");
  const pathTokenClass = String(classes.pathTokenClass || "dsNotesPathToken");
  const hoverPathClass = String(classes.hoverPathClass || "isHoverPath");
  const contextMenuClass = String(classes.contextMenuClass || "notesPathContextMenu");
  const contextMenuItemClass = String(classes.contextMenuItemClass || "notesPathContextMenuItem");
  const tooltipClickText = String(deps.tooltipClickText || "Right-click for file options");
  const tooltipClickWhenEditingText = String(
    deps.tooltipClickWhenEditingText || "Exit editing, then right-click for file options",
  );

  const notesInput = document.getElementById(inputId);
  if (!notesInput || notesInput.dataset.wired === "1") return;
  notesInput.dataset.wired = "1";
  notesInput.spellcheck = false;
  notesInput.setAttribute("spellcheck", "false");
  const notesWrap = document.getElementById(wrapId);
  const notesDecor = document.getElementById(decorId);
  const notesToolbar = document.getElementById(toolbarId);
  const notesFormatToolbar = formatToolbarId ? document.getElementById(formatToolbarId) : null;
  const notesSaveBtn = document.getElementById(saveBtnId);
  const indentUnit = "    ";
  const pathPatterns = [
    /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n\\]*/g,
    /\\\\[^\\/:*?"<>|\r\n]+\\[^\\/:*?"<>|\r\n]+(?:\\[^\\/:*?"<>|\r\n\\]+)*/g,
  ];
  let hoverPathToken = null;
  let notesPlainTextEditMode = false;
  let notesDecorRenderPending = false;
  let notesTextStyleState = null;
  let notesSelectionSnapshot = { start: 0, end: 0 };

  const notesStyleControls = notesFormatToolbar ? {
    fontFamily: notesFormatToolbar.querySelector('[data-notes-style="font-family"]'),
    fontSize: notesFormatToolbar.querySelector('[data-notes-style="font-size"]'),
    color: notesFormatToolbar.querySelector('[data-notes-style="color"]'),
    bold: notesFormatToolbar.querySelector('[data-notes-toggle="bold"]'),
    italic: notesFormatToolbar.querySelector('[data-notes-toggle="italic"]'),
    underline: notesFormatToolbar.querySelector('[data-notes-toggle="underline"]'),
    strike: notesFormatToolbar.querySelector('[data-notes-toggle="strike"]'),
  } : null;

  const isNotesToolbarElement = (el) => !!(notesFormatToolbar && el && notesFormatToolbar.contains(el));

  const rememberNotesSelection = () => {
    if (!notesInput) return;
    const start = Number.isFinite(notesInput.selectionStart) ? notesInput.selectionStart : 0;
    const end = Number.isFinite(notesInput.selectionEnd) ? notesInput.selectionEnd : start;
    notesSelectionSnapshot = { start, end };
  };

  const restoreNotesSelectionAndFocus = () => {
    if (!notesInput) return;
    try {
      notesInput.focus({ preventScroll: true });
    } catch {
      notesInput.focus();
    }
    try {
      const textLen = String(notesInput.value || "").length;
      const start = Math.max(0, Math.min(textLen, Number(notesSelectionSnapshot?.start ?? 0)));
      const end = Math.max(start, Math.min(textLen, Number(notesSelectionSnapshot?.end ?? start)));
      notesInput.selectionStart = start;
      notesInput.selectionEnd = end;
    } catch {}
  };

  const sanitizePathToken = (raw) =>
    String(raw || "")
      .trim()
      .replace(/^[("'`]+/, "")
      .replace(/[)"'`,.;:!?]+$/, "");

  const escapeHtml = (raw) =>
    String(raw || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const tooltipEl = document.createElement("div");
  tooltipEl.className = tooltipClass;
  tooltipEl.textContent = tooltipClickText;
  document.body.appendChild(tooltipEl);
  const contextMenuEl = document.createElement("div");
  contextMenuEl.className = contextMenuClass;
  contextMenuEl.setAttribute("role", "menu");
  contextMenuEl.innerHTML = `
    <button type="button" class="${contextMenuItemClass}" data-notes-path-action="open" role="menuitem">Open File</button>
    <button type="button" class="${contextMenuItemClass}" data-notes-path-action="copy" role="menuitem">Copy File Path</button>
  `;
  document.body.appendChild(contextMenuEl);
  let contextMenuPath = "";

  const hidePathTooltip = () => {
    tooltipEl.classList.remove("show");
  };

  const hidePathContextMenu = () => {
    contextMenuPath = "";
    contextMenuEl.classList.remove("show");
    contextMenuEl.style.left = "";
    contextMenuEl.style.top = "";
  };

  const showPathContextMenu = (clientX, clientY, targetPath) => {
    contextMenuPath = String(targetPath || "");
    if (!contextMenuPath) return;
    hidePathTooltip();
    contextMenuEl.classList.add("show");
    contextMenuEl.style.left = "0px";
    contextMenuEl.style.top = "0px";
    const pad = 8;
    let left = Math.round(Number(clientX) || 0);
    let top = Math.round(Number(clientY) || 0);
    const rect = contextMenuEl.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
  };

  const showPathTooltip = (clientX, clientY, text) => {
    tooltipEl.textContent = String(text || tooltipClickText);
    tooltipEl.classList.add("show");
    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";
    const pad = 8;
    const dx = 14;
    const dy = 14;
    let left = Math.round((Number(clientX) || 0) + dx);
    let top = Math.round((Number(clientY) || 0) + dy);
    const rect = tooltipEl.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, Math.round((Number(clientY) || 0) - rect.height - 10));
    }
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const setHoverPathToken = (nextToken) => {
    if (hoverPathToken === nextToken) return;
    if (hoverPathToken) hoverPathToken.classList.remove(hoverPathClass);
    hoverPathToken = nextToken || null;
    if (hoverPathToken) hoverPathToken.classList.add(hoverPathClass);
  };

  const getMatches = (text) => {
    const src = String(text || "");
    if (!src) return [];
    const matches = [];
    for (const pathRe of pathPatterns) {
      pathRe.lastIndex = 0;
      let m;
      while ((m = pathRe.exec(src)) !== null) {
        const raw = String(m[0] || "");
        if (!raw) continue;
        const leadTrim = (raw.match(/^[("'`]+/)?.[0]?.length) || 0;
        const tailTrim = (raw.match(/[)"'`,.;:!?]+$/)?.[0]?.length) || 0;
        const start = m.index + leadTrim;
        const end = m.index + raw.length - tailTrim;
        if (end <= start) continue;
        const path = sanitizePathToken(src.slice(start, end));
        if (!path || !path.includes("\\")) continue;
        matches.push({ start, end, path });
      }
    }

    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (b.end - b.start) - (a.end - a.start);
    });

    const deduped = [];
    let cursor = -1;
    for (const m of matches) {
      if (m.start < cursor) continue;
      deduped.push(m);
      cursor = m.end;
    }
    return deduped;
  };

  const syncDecorScroll = () => {
    if (!notesDecor) return;
    notesDecor.scrollTop = notesInput.scrollTop;
    notesDecor.scrollLeft = notesInput.scrollLeft;
  };

  const syncNotesToolbarWidth = () => {
    if (!notesWrap) return;
    const widthPx = Math.max(0, Math.round(notesWrap.getBoundingClientRect().width));
    if (!widthPx) return;
    if (notesToolbar) notesToolbar.style.width = `${widthPx}px`;
    if (notesFormatToolbar) notesFormatToolbar.style.width = `${widthPx}px`;
  };

  const clampInt = (value, min, max, fallback) => {
    const n = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const rgbStringToHex = (raw) => {
    const src = String(raw || "").trim();
    if (!src) return "";
    if (/^#[0-9a-f]{6}$/i.test(src)) return src.toLowerCase();
    const m = src.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return "";
    const parts = m[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isFinite(v))) return "";
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
  };

  const getComputedNotesFontSize = () => {
    try {
      const px = Number.parseFloat(window.getComputedStyle(notesInput).fontSize || "");
      if (Number.isFinite(px) && px > 0) return Math.round(px);
    } catch {}
    return 13;
  };

  const getDefaultNotesTextStyleState = () => {
    let colorHex = "#1c2433";
    try {
      colorHex = rgbStringToHex(window.getComputedStyle(notesDecor || notesInput).color) || colorHex;
    } catch {}
    return {
      fontFamily: "",
      fontSize: getComputedNotesFontSize(),
      color: colorHex,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    };
  };

  const getNotesTextDecorationLine = (state) => {
    const lines = [];
    if (state?.underline) lines.push("underline");
    if (state?.strike) lines.push("line-through");
    return lines.length ? lines.join(" ") : "none";
  };

  const applyNotesTextStyle = (nextState) => {
    if (!nextState || (!notesInput && !notesDecor)) return;
    notesTextStyleState = {
      fontFamily: String(nextState.fontFamily || ""),
      fontSize: clampInt(nextState.fontSize, 8, 48, 13),
      color: rgbStringToHex(nextState.color) || "#1c2433",
      bold: !!nextState.bold,
      italic: !!nextState.italic,
      underline: !!nextState.underline,
      strike: !!nextState.strike,
    };

    const fontFamily = notesTextStyleState.fontFamily || "";
    const fontSizePx = `${notesTextStyleState.fontSize}px`;
    const fontWeight = notesTextStyleState.bold ? "700" : "400";
    const fontStyle = notesTextStyleState.italic ? "italic" : "normal";
    const textDecorationLine = getNotesTextDecorationLine(notesTextStyleState);

    if (notesDecor) {
      notesDecor.style.fontFamily = fontFamily;
      notesDecor.style.fontSize = fontSizePx;
      notesDecor.style.fontWeight = fontWeight;
      notesDecor.style.fontStyle = fontStyle;
      notesDecor.style.color = notesTextStyleState.color;
      notesDecor.style.textDecorationLine = textDecorationLine;
      notesDecor.style.textDecorationColor = notesTextStyleState.color;
    }

    if (notesInput) {
      notesInput.style.fontFamily = fontFamily;
      notesInput.style.fontSize = fontSizePx;
      notesInput.style.fontWeight = fontWeight;
      notesInput.style.fontStyle = fontStyle;
      notesInput.style.textDecorationLine = textDecorationLine;
      notesInput.style.textDecorationColor = notesTextStyleState.color;
      if (notesPlainTextEditMode) {
        notesInput.style.color = notesTextStyleState.color;
      } else {
        notesInput.style.color = "transparent";
      }
    }

    if (notesStyleControls) {
      if (notesStyleControls.fontFamily) {
        notesStyleControls.fontFamily.value = notesTextStyleState.fontFamily;
      }
      if (notesStyleControls.fontSize) {
        notesStyleControls.fontSize.value = String(notesTextStyleState.fontSize);
      }
      if (notesStyleControls.color) {
        notesStyleControls.color.value = notesTextStyleState.color;
      }
      for (const [key, el] of [
        ["bold", notesStyleControls.bold],
        ["italic", notesStyleControls.italic],
        ["underline", notesStyleControls.underline],
        ["strike", notesStyleControls.strike],
      ]) {
        if (!el) continue;
        const active = !!notesTextStyleState[key];
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", active ? "true" : "false");
      }
    }
  };

  const wireNotesFormatToolbar = () => {
    if (!notesFormatToolbar || !notesStyleControls) return;
    notesFormatToolbar.addEventListener("mousedown", (e) => {
      const target = e.target?.closest?.("[data-notes-toggle]");
      if (!target) return;
      // Keep textarea focus/caret when clicking toggle buttons.
      e.preventDefault();
      e.stopPropagation();
    });

    const updateFromControls = ({ refocus = false } = {}) => {
      applyNotesTextStyle({
        ...(notesTextStyleState || getDefaultNotesTextStyleState()),
        fontFamily: String(notesStyleControls.fontFamily?.value || ""),
        fontSize: clampInt(notesStyleControls.fontSize?.value, 8, 48, 13),
        color: String(notesStyleControls.color?.value || ""),
      });
      if (refocus) restoreNotesSelectionAndFocus();
    };

    notesStyleControls.fontFamily?.addEventListener("change", () => updateFromControls({ refocus: true }));
    notesStyleControls.fontSize?.addEventListener("input", () => updateFromControls());
    notesStyleControls.fontSize?.addEventListener("change", () => updateFromControls({ refocus: true }));
    notesStyleControls.fontSize?.addEventListener("blur", () => updateFromControls());
    notesStyleControls.color?.addEventListener("input", () => updateFromControls());
    notesStyleControls.color?.addEventListener("change", () => updateFromControls({ refocus: true }));

    for (const [key, el] of [
      ["bold", notesStyleControls.bold],
      ["italic", notesStyleControls.italic],
      ["underline", notesStyleControls.underline],
      ["strike", notesStyleControls.strike],
    ]) {
      if (!el) continue;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const base = notesTextStyleState || getDefaultNotesTextStyleState();
        applyNotesTextStyle({ ...base, [key]: !base[key] });
        restoreNotesSelectionAndFocus();
      });
    }

    notesFormatToolbar.addEventListener("focusout", () => {
      window.setTimeout(() => {
        flushNotesEditingViewIfInactive();
      }, 0);
    });
  };

  const renderNotesDecor = () => {
    if (!notesDecor) return;
    const src = String(notesInput.value || "");
    const matches = getMatches(src);
    let html = "";
    let cursor = 0;
    matches.forEach((m, idx) => {
      if (m.start > cursor) {
        html += escapeHtml(src.slice(cursor, m.start));
      }
      const tokenText = src.slice(m.start, m.end);
      html += `<span class="${pathTokenClass}" data-path="${encodeURIComponent(m.path)}" data-path-index="${idx}">${escapeHtml(tokenText)}</span>`;
      cursor = m.end;
    });
    if (cursor < src.length) {
      html += escapeHtml(src.slice(cursor));
    }
    notesDecor.innerHTML = html || " ";
    setHoverPathToken(null);
    syncDecorScroll();
  };

  const setNotesPlainTextMode = (enabled) => {
    const next = !!enabled;
    if (notesPlainTextEditMode === next) return;
    notesPlainTextEditMode = next;
    if (notesDecor) {
      notesDecor.style.display = next ? "none" : "";
    }
    if (next) {
      let visibleColor = notesTextStyleState?.color || "#111";
      try {
        visibleColor = window.getComputedStyle(notesDecor || notesInput).color || visibleColor;
      } catch {}
      notesInput.style.color = visibleColor;
    } else {
      notesInput.style.color = "transparent";
    }
  };

  const openPathViaShellBridge = (targetPath) =>
    new Promise((resolve) => {
      if (!targetPath || !window.parent || window.parent === window) {
        resolve({ ok: false, error: "Open path requires desktop app." });
        return;
      }

      const requestId = `ds-open-path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let done = false;
      let timeoutId = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        if (timeoutId != null) window.clearTimeout(timeoutId);
        window.removeEventListener("message", onMessage);
        resolve(result || { ok: false, error: "Open path failed." });
      };

      const onMessage = (evt) => {
        const msg = evt?.data;
        if (!msg || msg.type !== "arcrho:open-path-result") return;
        if (String(msg.requestId || "") !== requestId) return;
        finish({ ok: !!msg.ok, error: String(msg.error || "") });
      };

      window.addEventListener("message", onMessage);
      timeoutId = window.setTimeout(() => {
        finish({ ok: false, error: "Open path timed out." });
      }, 5000);

      try {
        window.parent.postMessage({ type: "arcrho:open-path", requestId, path: targetPath }, "*");
      } catch {
        finish({ ok: false, error: "Open path requires desktop app." });
      }
    });

  const isNotesEditing = () => (
    document.activeElement === notesInput || isNotesToolbarElement(document.activeElement)
  );

  const flushNotesEditingViewIfInactive = () => {
    if (document.activeElement === notesInput) return;
    if (isNotesToolbarElement(document.activeElement)) return;
    notesInput.style.cursor = "";
    setHoverPathToken(null);
    hidePathTooltip();
    if (notesDecorRenderPending) {
      renderNotesDecor();
      notesDecorRenderPending = false;
    }
    setNotesPlainTextMode(false);
  };

  const openDetectedPath = async (targetPath) => {
    if (!targetPath) return;
    try {
      const hostApi = window.ADAHost || null;
      const result = (hostApi && typeof hostApi.openPath === "function")
        ? await hostApi.openPath({ path: targetPath })
        : await openPathViaShellBridge(targetPath);
      if (result?.ok) {
        setStatus(`Opened path: ${targetPath}`);
      } else if (result?.error === "Open path requires desktop app.") {
        setStatus("Open path requires desktop app.");
      } else {
        setStatus(`Open path failed: ${result?.error || targetPath}`);
      }
    } catch (err) {
      setStatus(`Open path failed: ${String(err?.message || err)}`);
    }
  };

  const copyDetectedPath = async (targetPath) => {
    const text = String(targetPath || "");
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement("textarea");
        temp.value = text;
        temp.setAttribute("readonly", "");
        temp.style.position = "fixed";
        temp.style.left = "-9999px";
        temp.style.top = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }
      setStatus("Copied file path.");
    } catch (err) {
      setStatus(`Copy file path failed: ${String(err?.message || err)}`);
    }
  };

  const getPathFromDecorToken = (tokenEl) => {
    const raw = tokenEl?.getAttribute?.("data-path") || "";
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return String(raw);
    }
  };

  const getDecorTokenAtPoint = (clientX, clientY) => {
    if (!notesDecor || !notesWrap) return null;
    const old = notesInput.style.pointerEvents;
    notesInput.style.pointerEvents = "none";
    let node = null;
    try {
      node = document.elementFromPoint(clientX, clientY);
    } finally {
      notesInput.style.pointerEvents = old;
    }
    const token = node?.closest?.(`.${pathTokenClass}`);
    if (!token || !notesDecor.contains(token)) return null;
    return token;
  };

  notesInput.addEventListener("input", () => {
    if (notesPlainTextEditMode) {
      notesDecorRenderPending = true;
    } else {
      renderNotesDecor();
      notesDecorRenderPending = false;
    }
    if (getNotesProgrammaticInput()) {
      updateNotesSaveUi();
      return;
    }
    const current = String(notesInput.value || "");
    setNotesDirty(current !== String(getLastSavedNotesText() || ""));
    updateNotesSaveUi();
  });
  notesInput.addEventListener("scroll", () => {
    syncDecorScroll();
    setHoverPathToken(null);
    hidePathTooltip();
    hidePathContextMenu();
  });
  notesInput.addEventListener("mousemove", (e) => {
    if ((e.buttons & 1) === 1) {
      notesInput.style.cursor = "";
      setHoverPathToken(null);
      hidePathTooltip();
      return;
    }
    const token = getDecorTokenAtPoint(e.clientX, e.clientY);
    if (!token) {
      notesInput.style.cursor = "";
      setHoverPathToken(null);
      hidePathTooltip();
      return;
    }
    notesInput.style.cursor = "pointer";
    setHoverPathToken(token);
    const tipText = isNotesEditing()
      ? tooltipClickWhenEditingText
      : tooltipClickText;
    showPathTooltip(e.clientX, e.clientY, tipText);
  });
  notesInput.addEventListener("mouseleave", () => {
    notesInput.style.cursor = "";
    setHoverPathToken(null);
    hidePathTooltip();
  });
  notesInput.addEventListener("focus", () => {
    rememberNotesSelection();
    setNotesPlainTextMode(true);
    notesInput.style.cursor = "";
    setHoverPathToken(null);
    hidePathTooltip();
  });
  notesInput.addEventListener("blur", () => {
    rememberNotesSelection();
    window.setTimeout(() => {
      flushNotesEditingViewIfInactive();
    }, 0);
  });
  notesInput.addEventListener("select", rememberNotesSelection);
  notesInput.addEventListener("keyup", rememberNotesSelection);
  notesInput.addEventListener("mouseup", rememberNotesSelection);

  notesInput.addEventListener("keydown", (e) => {
    rememberNotesSelection();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      notesInput.blur();
      return;
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    e.stopPropagation();

    const text = notesInput.value || "";
    const start = Number.isFinite(notesInput.selectionStart) ? notesInput.selectionStart : text.length;
    const end = Number.isFinite(notesInput.selectionEnd) ? notesInput.selectionEnd : start;
    if (e.shiftKey) {
      const blockStart = text.lastIndexOf("\n", Math.max(0, start) - 1) + 1;
      let endAnchor = end;
      if (start !== end && end > blockStart && text[end - 1] === "\n") {
        endAnchor = end - 1;
      }
      let blockEnd = text.indexOf("\n", endAnchor);
      if (blockEnd === -1) blockEnd = text.length;

      const block = text.slice(blockStart, blockEnd);
      const lines = block.split("\n");
      let removedBeforeStart = 0;
      let removedBeforeEnd = 0;
      let relOffset = 0;

      const outdented = lines.map((line) => {
        let removeCount = 0;
        if (line.startsWith(indentUnit)) {
          removeCount = indentUnit.length;
        } else if (line.startsWith("\t")) {
          removeCount = 1;
        }

        const lineAbsStart = blockStart + relOffset;
        relOffset += line.length + 1;

        if (removeCount > 0) {
          if (lineAbsStart < start) {
            removedBeforeStart += Math.min(removeCount, start - lineAbsStart);
          }
          if (lineAbsStart < end) {
            removedBeforeEnd += Math.min(removeCount, end - lineAbsStart);
          }
        }

        return removeCount > 0 ? line.slice(removeCount) : line;
      });

      notesInput.value = `${text.slice(0, blockStart)}${outdented.join("\n")}${text.slice(blockEnd)}`;
      const nextStart = Math.max(blockStart, start - removedBeforeStart);
      const nextEnd = Math.max(nextStart, end - removedBeforeEnd);
      notesInput.selectionStart = nextStart;
      notesInput.selectionEnd = nextEnd;
      notesInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    notesInput.value = `${text.slice(0, start)}${indentUnit}${text.slice(end)}`;
    const cursor = start + indentUnit.length;
    notesInput.selectionStart = cursor;
    notesInput.selectionEnd = cursor;
    notesInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  notesInput.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      if (notesPlainTextEditMode) return;
      const token = getDecorTokenAtPoint(e.clientX, e.clientY);
      const targetPath = getPathFromDecorToken(token);
      if (!targetPath) return;
      e.preventDefault();
      e.stopPropagation();
      setHoverPathToken(token);
      showPathContextMenu(e.clientX, e.clientY, targetPath);
      return;
    }
    if (e.button !== 0) return;
    hidePathTooltip();
    hidePathContextMenu();
  });

  notesInput.addEventListener("contextmenu", (e) => {
    if (notesPlainTextEditMode) return;
    const token = getDecorTokenAtPoint(e.clientX, e.clientY);
    const targetPath = getPathFromDecorToken(token);
    if (!targetPath) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverPathToken(token);
    showPathContextMenu(e.clientX, e.clientY, targetPath);
  });

  notesInput.addEventListener("click", (e) => {
    rememberNotesSelection();
    if (e.button !== 0) return;
    hidePathTooltip();
  });

  contextMenuEl.addEventListener("click", (e) => {
    const actionBtn = e.target?.closest?.("[data-notes-path-action]");
    if (!actionBtn || !contextMenuEl.contains(actionBtn)) return;
    const action = String(actionBtn.getAttribute("data-notes-path-action") || "");
    const targetPath = contextMenuPath;
    e.preventDefault();
    e.stopPropagation();
    hidePathContextMenu();
    if (action === "open") {
      void openDetectedPath(targetPath);
    } else if (action === "copy") {
      void copyDetectedPath(targetPath);
    }
  });

  const onDocumentMouseDown = (e) => {
    if (contextMenuEl.contains(e.target)) return;
    hidePathContextMenu();
  };

  const onWindowKeyDown = (e) => {
    if (e.key === "Escape") hidePathContextMenu();
  };

  document.addEventListener("mousedown", onDocumentMouseDown);
  window.addEventListener("keydown", onWindowKeyDown);

  notesSaveBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const result = await onSaveNotes();
    if (!result.ok) {
      setStatus(formatSaveErrorStatus(result));
      updateNotesSaveUi();
    }
  });

  let notesResizeObserver = null;
  wireNotesFormatToolbar();
  applyNotesTextStyle(getDefaultNotesTextStyleState());

  if (notesWrap && (notesToolbar || notesFormatToolbar) && typeof ResizeObserver !== "undefined") {
    notesResizeObserver = new ResizeObserver(() => {
      syncNotesToolbarWidth();
    });
    notesResizeObserver.observe(notesWrap);
  }
  window.addEventListener("resize", syncNotesToolbarWidth);
  window.addEventListener("resize", hidePathContextMenu);

  window.addEventListener("beforeunload", () => {
    window.removeEventListener("resize", syncNotesToolbarWidth);
    window.removeEventListener("resize", hidePathContextMenu);
    document.removeEventListener("mousedown", onDocumentMouseDown);
    window.removeEventListener("keydown", onWindowKeyDown);
    try {
      notesResizeObserver?.disconnect();
    } catch {}
    tooltipEl.remove();
    contextMenuEl.remove();
  }, { once: true });

  renderNotesDecor();
  setNotesPlainTextMode(false);
  syncNotesToolbarWidth();
  updateNotesSaveUi();
}
