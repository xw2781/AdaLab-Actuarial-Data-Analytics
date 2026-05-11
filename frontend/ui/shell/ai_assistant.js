import { $, getHostApi, shell } from "./shell_context.js?v=20260510a";

const assistantMessages = [];
let assistantMode = "edit";
const ASSISTANT_MODEL = "codex";
let assistantReady = false;
let assistantBusy = false;
let assistantStatusChecked = false;

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
  $("aiAssistantPanel")?.classList.add("open");
  renderEmptyHint();
  if (!assistantStatusChecked) refreshAssistantStatus();
  setTimeout(() => $("aiAssistantInput")?.focus(), 0);
}

function closeAssistant() {
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

  launcher.addEventListener("click", () => {
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
  setComposerEnabled(false);
}
