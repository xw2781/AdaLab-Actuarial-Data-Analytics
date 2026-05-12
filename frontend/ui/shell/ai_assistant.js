import { $, getHostApi, shell } from "./shell_context.js?v=20260510a";

const assistantMessages = [];
let assistantMode = "edit";
const ASSISTANT_MODEL = "codex";
const ASSISTANT_LAUNCHER_VISIBLE_KEY = "arcrho_ai_assistant_launcher_visible";
const ASSISTANT_LAUNCHER_POSITION_KEY = "arcrho_ai_assistant_launcher_position";
let assistantReady = false;
let assistantBusy = false;
let assistantStatusChecked = false;
let suppressLauncherClick = false;

function setText(el, text) {
  if (el) el.textContent = text || "";
}

function setStatus(text, tone = "") {
  const el = $("aiAssistantStatus");
  if (!el) return;
  el.classList.toggle("error", tone === "error");
  setText(el, text);
}

function setSetup({ open = false, text = "", install = false, login = false } = {}) {
  const setup = $("aiAssistantSetup");
  const setupText = $("aiAssistantSetupText");
  const installBtn = $("aiAssistantSetupBtn");
  const loginBtn = $("aiAssistantLoginBtn");
  setup?.classList.toggle("open", !!open);
  setText(setupText, text);
  if (installBtn) installBtn.style.display = install ? "inline-block" : "none";
  if (loginBtn) loginBtn.style.display = login ? "inline-block" : "none";
}

export function isAiAssistantLauncherVisible() {
  try {
    return localStorage.getItem(ASSISTANT_LAUNCHER_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAiAssistantLauncherVisible(visible) {
  const show = !!visible;
  try {
    localStorage.setItem(ASSISTANT_LAUNCHER_VISIBLE_KEY, show ? "1" : "0");
  } catch {}
  const launcher = $("aiAssistantLauncher");
  const panel = $("aiAssistantPanel");
  if (launcher) launcher.style.display = show ? "" : "none";
  if (show && launcher) applyLauncherPosition(launcher, loadLauncherPosition(launcher));
  if (!show) {
    launcher?.classList.remove("assistant-open");
    panel?.classList.remove("open");
  } else if (panel?.classList.contains("open")) {
    launcher?.classList.add("assistant-open");
  }
  shell.updateViewMenuState?.();
  return show;
}

export function toggleAiAssistantLauncherVisible() {
  return setAiAssistantLauncherVisible(!isAiAssistantLauncherVisible());
}

function getModeLabel() {
  return assistantMode === "review" ? "Review Mode" : "Edit Mode";
}

function setAssistantMode(mode) {
  assistantMode = mode === "review" ? "review" : "edit";
  setText($("aiAssistantModeLabel"), getModeLabel());
  $("aiAssistantReviewModeOption")?.classList.toggle("active", assistantMode === "review");
  $("aiAssistantEditModeOption")?.classList.toggle("active", assistantMode === "edit");
  setStatus(assistantReady ? `Codex ready. ${getModeLabel()}.` : `${getModeLabel()} selected.`);
}

function setComposerEnabled(enabled) {
  const input = $("aiAssistantInput");
  const sendBtn = $("aiAssistantSendBtn");
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.disabled = !enabled;
}

function appendMessage(role, text) {
  const container = $("aiAssistantMessages");
  if (!container) return null;
  const el = document.createElement("div");
  el.className = `aiAssistantMessage ${role}`;
  el.textContent = text || "";
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function renderEmptyHint() {
  const container = $("aiAssistantMessages");
  if (!container || container.children.length) return;
  appendMessage("system", "ArcBot is in Edit Mode for JSON files inside the configured Server Connection root.");
}

function applyStatus(status) {
  assistantReady = !!status?.installed && !!status?.authenticated;
  if (!status?.installed) {
    setStatus("Codex CLI is not installed.", "error");
    setSetup({
      open: true,
      install: true,
      login: false,
      text: "Install will run: npm install -g @openai/codex.",
    });
    setComposerEnabled(false);
    return;
  }
  if (!status?.authenticated) {
    setStatus("Codex CLI is installed but not signed in.", "error");
    setSetup({
      open: true,
      install: false,
      login: true,
      text: "Sign in to link this computer to your Codex account.",
    });
    setComposerEnabled(false);
    return;
  }
  setStatus(`Codex ready (${status.version || "installed"}). ${getModeLabel()}.`);
  setSetup({ open: false });
  setComposerEnabled(!assistantBusy);
}

function requestActivePageContext() {
  const activeTab = shell.state?.tabs?.find?.((tab) => tab.id === shell.state.activeId) || null;
  const baseContext = {
    available: false,
    tabId: activeTab?.id || "",
    tabType: activeTab?.type || "home",
    title: activeTab?.title || "",
  };
  const iframe = activeTab?.iframe || null;
  if (!iframe?.contentWindow) return Promise.resolve(baseContext);

  return new Promise((resolve) => {
    const requestId = `arcbot_context_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve({ ...baseContext, ...(value || {}), available: !!value?.available });
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
      finish(baseContext);
      return;
    }
    setTimeout(() => finish(baseContext), 900);
  });
}

function notifyActivePageJsonUpdated(result) {
  const activeTab = shell.state?.tabs?.find?.((tab) => tab.id === shell.state.activeId) || null;
  const iframe = activeTab?.iframe || null;
  if (!iframe?.contentWindow) return;
  try {
    iframe.contentWindow.postMessage({
      type: "arcrho:assistant-json-updated",
      path: result?.targetPath || "",
    }, "*");
  } catch {
    // ignore stale iframe messaging
  }
}

async function refreshAssistantStatus() {
  const host = getHostApi();
  if (!host?.codexAssistantStatus) {
    setStatus("ArcBot is available in the desktop app only.", "error");
    setSetup({ open: false });
    setComposerEnabled(false);
    return;
  }
  assistantStatusChecked = true;
  setStatus("Checking Codex CLI...");
  setComposerEnabled(false);
  try {
    const status = await host.codexAssistantStatus();
    applyStatus(status);
  } catch (err) {
    assistantReady = false;
    setStatus(String(err?.message || err || "Codex status check failed."), "error");
    setComposerEnabled(false);
  }
}

function openAssistant() {
  $("aiAssistantLauncher")?.classList.add("assistant-open");
  $("aiAssistantPanel")?.classList.add("open");
  renderEmptyHint();
  if (!assistantStatusChecked) refreshAssistantStatus();
  setTimeout(() => $("aiAssistantInput")?.focus(), 0);
}

function closeAssistant() {
  if (isAiAssistantLauncherVisible()) $("aiAssistantLauncher")?.classList.remove("assistant-open");
  $("aiAssistantPanel")?.classList.remove("open");
}

function closeModeMenu() {
  const button = $("aiAssistantModeButton");
  $("aiAssistantModeMenu")?.classList.remove("open");
  button?.setAttribute("aria-expanded", "false");
}

function closeModelMenu() {
  const button = $("aiAssistantModelButton");
  $("aiAssistantModelMenu")?.classList.remove("open");
  button?.setAttribute("aria-expanded", "false");
}

function closeSelectMenus() {
  closeModeMenu();
  closeModelMenu();
}

function toggleModeMenu(forceOpen) {
  const button = $("aiAssistantModeButton");
  const menu = $("aiAssistantModeMenu");
  if (!button || !menu) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !menu.classList.contains("open");
  closeModelMenu();
  menu.classList.toggle("open", shouldOpen);
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function toggleModelMenu(forceOpen) {
  const button = $("aiAssistantModelButton");
  const menu = $("aiAssistantModelMenu");
  if (!button || !menu) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !menu.classList.contains("open");
  closeModeMenu();
  menu.classList.toggle("open", shouldOpen);
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function showUnavailableModel(name) {
  closeModelMenu();
  window.alert(`${name} is not currently available. ArcBot will continue using Codex.`);
}

function getLauncherDefaultPosition(launcher) {
  const rect = launcher.getBoundingClientRect();
  const width = rect.width || 42;
  const height = rect.height || 42;
  const statusbarHeight = Number(shell.getStatusBarHeight?.() || 0);
  return {
    left: window.innerWidth - width - 18,
    top: window.innerHeight - statusbarHeight - height - 18,
  };
}

function readLauncherPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSISTANT_LAUNCHER_POSITION_KEY) || "null");
    if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) return parsed;
  } catch {}
  return null;
}

function loadLauncherPosition(launcher) {
  const parsed = readLauncherPosition();
  if (parsed) return adaptLauncherPositionToWindow(launcher, parsed);
  return getLauncherDefaultPosition(launcher);
}

function saveLauncherPosition(launcher, left, top) {
  const tucked = getLauncherTuckedEdges(launcher, left, top);
  const anchor = getLauncherResizeAnchor(launcher, left, top, tucked);
  const payload = {
    left: Math.round(left),
    top: Math.round(top),
    tuckedX: tucked.x,
    tuckedY: tucked.y,
  };
  if (anchor) {
    payload.anchorCornerX = anchor.cornerX;
    payload.anchorCornerY = anchor.cornerY;
    payload.anchorOffsetX = anchor.offsetX;
    payload.anchorOffsetY = anchor.offsetY;
  }
  try {
    localStorage.setItem(ASSISTANT_LAUNCHER_POSITION_KEY, JSON.stringify(payload));
  } catch {}
}

function getLauncherMetrics(launcher) {
  const rect = launcher.getBoundingClientRect();
  const width = rect.width || 42;
  const height = rect.height || 42;
  const statusbarHeight = Number(shell.getStatusBarHeight?.() || 0);
  return {
    width,
    height,
    halfWidth: Math.round(width / 2),
    halfHeight: Math.round(height / 2),
    viewportWidth: Math.max(0, window.innerWidth),
    viewportHeight: Math.max(0, window.innerHeight - statusbarHeight),
  };
}

function getLauncherTuckedEdges(launcher, left, top) {
  const metrics = getLauncherMetrics(launcher);
  return {
    x: left < 0 ? "left" : (left + metrics.width > metrics.viewportWidth ? "right" : ""),
    y: top < 0 ? "top" : (top + metrics.height > metrics.viewportHeight ? "bottom" : ""),
  };
}

function getLauncherResizeAnchor(launcher, left, top, tucked) {
  if (!tucked?.x && !tucked?.y) return null;
  const metrics = getLauncherMetrics(launcher);
  const centerX = left + metrics.halfWidth;
  const centerY = top + metrics.halfHeight;
  const cornerX = tucked.x || (centerX <= metrics.viewportWidth / 2 ? "left" : "right");
  const cornerY = tucked.y || (centerY <= metrics.viewportHeight / 2 ? "top" : "bottom");
  return {
    cornerX,
    cornerY,
    offsetX: Math.round(Math.max(0, cornerX === "right" ? metrics.viewportWidth - centerX : centerX)),
    offsetY: Math.round(Math.max(0, cornerY === "bottom" ? metrics.viewportHeight - centerY : centerY)),
  };
}

function adaptLauncherPositionToWindow(launcher, position) {
  const metrics = getLauncherMetrics(launcher);
  let left = Number(position?.left || 0);
  let top = Number(position?.top || 0);
  const hasAnchor = ["left", "right"].includes(position?.anchorCornerX)
    && ["top", "bottom"].includes(position?.anchorCornerY)
    && Number.isFinite(position?.anchorOffsetX)
    && Number.isFinite(position?.anchorOffsetY);
  if (hasAnchor && (position?.tuckedX || position?.tuckedY)) {
    let centerX = position.anchorCornerX === "right"
      ? metrics.viewportWidth - Math.max(0, Number(position.anchorOffsetX))
      : Math.max(0, Number(position.anchorOffsetX));
    let centerY = position.anchorCornerY === "bottom"
      ? metrics.viewportHeight - Math.max(0, Number(position.anchorOffsetY))
      : Math.max(0, Number(position.anchorOffsetY));
    if (position.tuckedX === "left") centerX = 0;
    else if (position.tuckedX === "right") centerX = metrics.viewportWidth;
    if (position.tuckedY === "top") centerY = 0;
    else if (position.tuckedY === "bottom") centerY = metrics.viewportHeight;
    left = centerX - metrics.halfWidth;
    top = centerY - metrics.halfHeight;
  } else {
    if (position?.tuckedX === "left") left = -metrics.halfWidth;
    else if (position?.tuckedX === "right") left = metrics.viewportWidth - metrics.halfWidth;
    if (position?.tuckedY === "top") top = -metrics.halfHeight;
    else if (position?.tuckedY === "bottom") top = metrics.viewportHeight - metrics.halfHeight;
  }
  return { left, top };
}

function clampLauncherPosition(launcher, left, top, options = {}) {
  const { snap = true } = options;
  const metrics = getLauncherMetrics(launcher);
  const fullMaxLeft = Math.max(0, metrics.viewportWidth - metrics.width);
  const fullMaxTop = Math.max(0, metrics.viewportHeight - metrics.height);
  let nextLeft = Math.min(Math.max(left, -metrics.halfWidth), metrics.viewportWidth - metrics.halfWidth);
  let nextTop = Math.min(Math.max(top, -metrics.halfHeight), metrics.viewportHeight - metrics.halfHeight);
  if (snap) {
    if (nextLeft < 0) nextLeft = -metrics.halfWidth;
    else if (nextLeft > fullMaxLeft) nextLeft = metrics.viewportWidth - metrics.halfWidth;
    if (nextTop < 0) nextTop = -metrics.halfHeight;
    else if (nextTop > fullMaxTop) nextTop = metrics.viewportHeight - metrics.halfHeight;
  }
  return {
    left: nextLeft,
    top: nextTop,
  };
}

function updateLauncherTuckedState(launcher, left, top) {
  const tucked = getLauncherTuckedEdges(launcher, left, top);
  const nearLeft = tucked.x === "left";
  const nearRight = tucked.x === "right";
  const nearTop = tucked.y === "top";
  const nearBottom = tucked.y === "bottom";
  launcher.classList.toggle("tucked", nearLeft || nearRight || nearTop || nearBottom);
  launcher.classList.toggle("tucked-left", nearLeft);
  launcher.classList.toggle("tucked-right", nearRight);
  launcher.classList.toggle("tucked-top", nearTop);
  launcher.classList.toggle("tucked-bottom", nearBottom);
}

function applyLauncherPosition(launcher, position, options = {}) {
  const next = clampLauncherPosition(launcher, Number(position?.left || 0), Number(position?.top || 0), options);
  launcher.style.left = `${Math.round(next.left)}px`;
  launcher.style.top = `${Math.round(next.top)}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
  updateLauncherTuckedState(launcher, next.left, next.top);
  return next;
}

function initAssistantLauncherDrag(launcher) {
  let dragState = null;
  launcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    try { launcher.setPointerCapture(event.pointerId); } catch {}
  });

  launcher.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return;
    dragState.moved = true;
    launcher.classList.add("dragging");
    applyLauncherPosition(launcher, {
      left: dragState.left + dx,
      top: dragState.top + dy,
    }, { snap: false });
    event.preventDefault();
  });

  const endDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    try { launcher.releasePointerCapture(event.pointerId); } catch {}
    launcher.classList.remove("dragging");
    if (dragState.moved) {
      const rect = launcher.getBoundingClientRect();
      const next = applyLauncherPosition(launcher, { left: rect.left, top: rect.top });
      saveLauncherPosition(launcher, next.left, next.top);
      suppressLauncherClick = true;
      setTimeout(() => { suppressLauncherClick = false; }, 150);
    }
    dragState = null;
  };

  launcher.addEventListener("pointerup", endDrag);
  launcher.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => {
    if (!isAiAssistantLauncherVisible()) return;
    const next = applyLauncherPosition(launcher, loadLauncherPosition(launcher));
    saveLauncherPosition(launcher, next.left, next.top);
  });
}

function clampPanelPosition(panel, left, top) {
  const margin = 8;
  const rect = panel.getBoundingClientRect();
  const width = rect.width || 420;
  const height = rect.height || 420;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

function applyPanelPosition(panel, left, top) {
  const next = clampPanelPosition(panel, left, top);
  panel.style.left = `${Math.round(next.left)}px`;
  panel.style.top = `${Math.round(next.top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function initAssistantDrag(panel) {
  const header = $("aiAssistantHeader");
  if (!header) return;
  let dragState = null;

  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.("button")) return;
    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try { header.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    applyPanelPosition(panel, event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
  });

  const stopDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    try { header.releasePointerCapture(event.pointerId); } catch {}
    dragState = null;
  };

  header.addEventListener("pointerup", stopDrag);
  header.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", () => {
    if (!panel.classList.contains("open")) return;
    const rect = panel.getBoundingClientRect();
    applyPanelPosition(panel, rect.left, rect.top);
  });
}

async function installCodexCli() {
  const host = getHostApi();
  if (!host?.codexAssistantInstall) return;
  const confirmed = window.confirm(
    "Install Codex CLI now?\n\nArcRho will run: npm install -g @openai/codex"
  );
  if (!confirmed) return;
  assistantBusy = true;
  setStatus("Installing Codex CLI...");
  setSetup({ open: false });
  setComposerEnabled(false);
  try {
    const result = await host.codexAssistantInstall();
    if (!result?.ok) {
      setStatus(result?.error || "Codex CLI installation failed.", "error");
      setSetup({
        open: true,
        install: true,
        login: false,
        text: "Install will run: npm install -g @openai/codex.",
      });
      return;
    }
    shell.updateStatusBar?.("Codex CLI installed.");
    await refreshAssistantStatus();
  } catch (err) {
    setStatus(String(err?.message || err || "Codex CLI installation failed."), "error");
  } finally {
    assistantBusy = false;
    setComposerEnabled(assistantReady);
  }
}

async function loginCodexCli() {
  const host = getHostApi();
  if (!host?.codexAssistantLogin) return;
  const confirmed = window.confirm(
    "Open Codex sign-in now?\n\nA terminal window will run: codex login"
  );
  if (!confirmed) return;
  try {
    const result = await host.codexAssistantLogin();
    if (!result?.ok) {
      setStatus(result?.error || "Could not start Codex sign-in.", "error");
      return;
    }
    setStatus("Complete Codex sign-in, then refresh status.");
  } catch (err) {
    setStatus(String(err?.message || err || "Could not start Codex sign-in."), "error");
  }
}

async function sendAssistantMessage() {
  if (assistantBusy) return;
  const host = getHostApi();
  const input = $("aiAssistantInput");
  const text = String(input?.value || "").trim();
  if (!text || !host?.codexAssistantSend) return;
  if (!assistantReady) {
    setStatus("Install Codex CLI or sign in before sending.", "error");
    return;
  }

  assistantMessages.push({ role: "user", content: text });
  appendMessage("user", text);
  if (input) input.value = "";
  const pending = appendMessage("assistant", "...");

  assistantBusy = true;
  setComposerEnabled(false);
  setStatus("ArcBot is checking the active page context...");
  try {
    const activeContext = await requestActivePageContext();
    setStatus(`Codex is responding in ${getModeLabel()}...`);
    const result = await host.codexAssistantSend({
      mode: assistantMode,
      model: ASSISTANT_MODEL,
      messages: assistantMessages,
      activeContext,
    });
    if (!result?.ok) {
      const message = result?.error || "Codex request failed.";
      if (pending) pending.textContent = message;
      if (result?.needsAuth) {
        assistantReady = false;
        setStatus("Codex CLI needs sign-in.", "error");
        setSetup({
          open: true,
          install: false,
          login: true,
          text: "Sign in to link this computer to your Codex account.",
        });
      } else {
        setStatus(message, "error");
      }
      return;
    }
    const reply = String(result?.text || "").trim() || "No response.";
    if (pending) pending.textContent = reply;
    assistantMessages.push({ role: "assistant", content: reply });
    if (result?.editApplied) notifyActivePageJsonUpdated(result);
    setStatus(result?.editApplied ? "ArcBot applied a JSON edit." : `Codex ready. ${getModeLabel()}.`);
  } catch (err) {
    const message = String(err?.message || err || "Codex request failed.");
    if (pending) pending.textContent = message;
    setStatus(message, "error");
  } finally {
    assistantBusy = false;
    setComposerEnabled(assistantReady);
  }
}

export function initAiAssistant() {
  const launcher = $("aiAssistantLauncher");
  const panel = $("aiAssistantPanel");
  const composer = $("aiAssistantComposer");
  if (!launcher || !panel || !composer) return;
  if (!getHostApi()) {
    launcher.style.display = "none";
    return;
  }
  setAiAssistantLauncherVisible(isAiAssistantLauncherVisible());

  launcher.addEventListener("click", (event) => {
    if (suppressLauncherClick) {
      event.preventDefault();
      return;
    }
    if (panel.classList.contains("open")) closeAssistant();
    else openAssistant();
  });
  $("aiAssistantCloseBtn")?.addEventListener("click", closeAssistant);
  $("aiAssistantRefreshBtn")?.addEventListener("click", refreshAssistantStatus);
  $("aiAssistantSetupBtn")?.addEventListener("click", installCodexCli);
  $("aiAssistantLoginBtn")?.addEventListener("click", loginCodexCli);
  $("aiAssistantModeButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleModeMenu();
  });
  $("aiAssistantReviewModeOption")?.addEventListener("click", () => {
    closeModeMenu();
    setAssistantMode("review");
  });
  $("aiAssistantEditModeOption")?.addEventListener("click", (event) => {
    event.preventDefault();
    closeModeMenu();
    setAssistantMode("edit");
  });
  $("aiAssistantModelButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleModelMenu();
  });
  $("aiAssistantCodexModelOption")?.addEventListener("click", () => {
    closeModelMenu();
    setStatus(assistantReady ? `Codex ready. ${getModeLabel()}.` : "Codex selected.");
  });
  $("aiAssistantClaudeModelOption")?.addEventListener("click", () => showUnavailableModel("Claude"));
  $("aiAssistantCopilotModelOption")?.addEventListener("click", () => showUnavailableModel("Copilot"));
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendAssistantMessage();
  });
  $("aiAssistantInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendAssistantMessage();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target?.closest?.(".aiAssistantSelectWrap")) return;
    closeSelectMenus();
  }, true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSelectMenus();
  }, true);
  initAssistantDrag(panel);
  initAssistantLauncherDrag(launcher);
  setComposerEnabled(false);
}
