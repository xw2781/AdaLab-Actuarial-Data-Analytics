import { $, getHostApi, shell } from "./shell_context.js?v=20260510a";

let assistantMessages = [];
let assistantActivities = [];
let assistantDebugLogs = [];
let assistantAttachments = [];
let currentSessionId = "";
let currentSessionTitle = "New ArcBot Chat";
let currentContext = null;
let currentUsage = null;
let currentRequestId = "";
let currentPendingMessageEl = null;
let currentRunStartedAt = 0;
let currentStepStartedAt = 0;
let currentWorkCardEl = null;
let assistantProgressSteps = [];
let assistantProgressTicker = null;
let latestSessionList = [];
let assistantMode = "edit";
const ASSISTANT_LAUNCHER_VISIBLE_KEY = "arcrho_ai_assistant_launcher_visible";
const ASSISTANT_LAUNCHER_POSITION_KEY = "arcrho_ai_assistant_launcher_position";
const ASSISTANT_PANEL_SIZE_KEY = "arcrho_ai_assistant_panel_size";
const ASSISTANT_PANEL_OPENED_SESSION_KEY = "arcrho_ai_assistant_panel_opened_session";
const ASSISTANT_PANEL_MIN_WIDTH = 420;
const ASSISTANT_PANEL_DEFAULT_HEIGHT = 640;
const ASSISTANT_ATTACHMENT_EXTENSIONS = [
  "txt", "md", "csv", "tsv", "json", "jsonl", "ipynb", "arcnb", "py", "r", "sql",
  "js", "ts", "html", "css", "xml", "yaml", "yml", "toml", "ini", "log",
];
const ASSISTANT_WORK_STEP_DEFS = [
  { id: "understanding", label: "Understanding request" },
  { id: "scanning", label: "Scanning app contents" },
  { id: "executing", label: "Executing / modifying" },
  { id: "finalizing", label: "Finalizing" },
];
let assistantReady = false;
let assistantBusy = false;
let assistantCancelRequested = false;
let assistantHostRequestSubmitted = false;
let assistantAppContextEnabled = true;
let assistantStatusChecked = false;
let suppressLauncherClick = false;
let assistantUserAvatarName = "ArcRho";

function getAssistantBrandInitial(name) {
  const text = String(name || "").trim();
  const firstAscii = Array.from(text).find((char) => /^[A-Za-z0-9]$/.test(char));
  return firstAscii ? firstAscii.toUpperCase() : "#";
}

function createAssistantUserAvatarSvg(initial) {
  const safeInitial = getAssistantBrandInitial(initial);
  return `
    <svg viewBox="0 0 32 32" role="img" aria-label="${safeInitial} initial avatar" focusable="false">
      <text x="16" y="21" text-anchor="middle" fill="#526071" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700">${safeInitial}</text>
    </svg>
  `;
}

function setText(el, text) {
  if (el) el.textContent = text || "";
}

function setAssistantConnectionStatus(online, detail = "") {
  const el = $("aiAssistantConnectionStatus");
  if (!el) return;
  el.classList.toggle("online", !!online);
  el.classList.toggle("offline", !online);
  el.textContent = online ? "Online" : "Offline";
  el.setAttribute("aria-label", online ? "ArcBot online" : "ArcBot offline");
  el.title = detail || (online ? "ArcBot is online" : "ArcBot is offline");
}

function setStatus(text, _tone = "") {
  setAssistantConnectionStatus(assistantReady, text);
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

function nowIso() {
  return new Date().toISOString();
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    role: String(message?.role || "").toLowerCase() === "assistant" ? "assistant"
      : String(message?.role || "").toLowerCase() === "system" ? "system"
      : "user",
    content: String(message?.content || ""),
    timestamp: String(message?.timestamp || nowIso()),
  })).filter((message) => message.content.trim());
}

function normalizeActivities(activities) {
  if (!Array.isArray(activities)) return [];
  return activities.map((activity) => ({
    type: String(activity?.type || "info"),
    text: String(activity?.text || ""),
    elapsedMs: Number.isFinite(activity?.elapsedMs) ? Math.max(0, Math.round(activity.elapsedMs)) : null,
    timestamp: String(activity?.timestamp || nowIso()),
  })).filter((activity) => activity.text.trim()).slice(-120);
}

function normalizeDebugLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.map((entry) => ({
    type: String(entry?.type || "debug"),
    text: String(entry?.text || ""),
    timestamp: String(entry?.timestamp || nowIso()),
  })).filter((entry) => entry.text.trim()).slice(-300);
}

function getSessionPayload() {
  return {
    id: currentSessionId,
    title: currentSessionTitle,
    mode: assistantMode,
    messages: assistantMessages,
    activities: assistantActivities,
    debugLogs: assistantDebugLogs,
    context: currentContext,
    usage: currentUsage,
  };
}

async function saveCurrentSession() {
  const host = getHostApi();
  if (!host?.codexAssistantSaveSession || !currentSessionId) return;
  try {
    const result = await host.codexAssistantSaveSession(getSessionPayload());
    if (result?.ok && result.session) {
      currentSessionId = result.session.id || currentSessionId;
      currentSessionTitle = result.session.title || currentSessionTitle;
      updateSessionSelectLabel();
    }
  } catch {
    // Session persistence failures should not block chat.
  }
}

function renderMessages() {
  const container = $("aiAssistantMessages");
  if (!container) return;
  container.textContent = "";
  currentWorkCardEl = null;
  for (const message of assistantMessages) {
    appendMessage(message.role, message.content, { save: false });
  }
  renderActivities();
  renderEmptyHint();
}

function formatElapsed(ms) {
  const value = Math.max(0, Number(ms || 0));
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

function createAssistantProgressSteps() {
  return ASSISTANT_WORK_STEP_DEFS.map((step) => ({
    ...step,
    state: "pending",
    status: "",
    elapsedMs: 0,
    startedAt: 0,
  }));
}

function getAssistantProgressStepIndex(stepId) {
  return ASSISTANT_WORK_STEP_DEFS.findIndex((step) => step.id === stepId);
}

function finishAssistantProgressStep(step, state = "completed", status = "") {
  if (!step) return;
  const now = performance.now();
  if (step.startedAt) {
    step.elapsedMs += Math.max(0, now - step.startedAt);
    step.startedAt = 0;
  }
  step.state = state;
  if (status) step.status = status;
}

function updateAssistantProgressStep(stepId, state = "active", status = "", options = {}) {
  if (!assistantProgressSteps.length) assistantProgressSteps = createAssistantProgressSteps();
  const index = getAssistantProgressStepIndex(stepId);
  if (index < 0) return;
  const now = performance.now();
  assistantProgressSteps.forEach((step, stepIndex) => {
    if (stepIndex < index && (step.state === "pending" || step.state === "active")) {
      finishAssistantProgressStep(step, "completed");
    } else if (stepIndex !== index && step.state === "active") {
      finishAssistantProgressStep(step, stepIndex < index ? "completed" : "pending");
    }
  });
  const step = assistantProgressSteps[index];
  if (state === "active") {
    if (step.state !== "active") step.startedAt = now;
    step.state = "active";
    if (status) step.status = status;
  } else {
    finishAssistantProgressStep(step, state, status);
  }
  if (options.render !== false) renderActivities();
}

function getAssistantProgressElapsed(step) {
  if (!step) return 0;
  const liveMs = step.state === "active" && step.startedAt
    ? performance.now() - step.startedAt
    : 0;
  return Math.max(0, Math.round(Number(step.elapsedMs || 0) + liveMs));
}

function completeAssistantProgress(status = "Completed") {
  if (!assistantProgressSteps.length) assistantProgressSteps = createAssistantProgressSteps();
  assistantProgressSteps.forEach((step, index) => {
    const finalStatus = index === assistantProgressSteps.length - 1 ? status : "";
    if (step.state !== "failed") finishAssistantProgressStep(step, "completed", finalStatus);
  });
  renderActivities();
}

function failAssistantProgress(status = "Request failed") {
  if (!assistantProgressSteps.length) assistantProgressSteps = createAssistantProgressSteps();
  const activeStep = assistantProgressSteps.find((step) => step.state === "active") ||
    assistantProgressSteps.find((step) => step.state === "pending") ||
    assistantProgressSteps.at(-1);
  finishAssistantProgressStep(activeStep, "failed", status);
  renderActivities();
}

function classifyAssistantActivity(activity) {
  const text = String(activity?.text || "");
  const lower = text.toLowerCase();
  const type = String(activity?.type || "").toLowerCase();
  if (type === "error" || lower.includes("failed") || lower.includes("could not") || lower.includes("error:")) {
    return { stepId: "finalizing", state: "failed", status: text || "Request failed" };
  }
  if (lower.includes("request canceled") || lower.includes("cancel requested")) {
    return { stepId: "finalizing", state: "failed", status: text || "Request canceled" };
  }
  if (lower.includes("request received") || lower.includes("understanding")) {
    return { stepId: "understanding", state: "active", status: text || "Reading the request" };
  }
  if (
    lower.includes("active context") ||
    lower.includes("active app") ||
    lower.includes("active page") ||
    lower.includes("active json") ||
    lower.includes("active file") ||
    lower.includes("context estimate") ||
    lower.includes("scanned")
  ) {
    return { stepId: "scanning", state: "active", status: text };
  }
  if (
    lower.includes("codex") ||
    lower.includes("editable local") ||
    lower.includes("edit started") ||
    lower.includes("session prepared") ||
    lower.includes("resolving arcbot project") ||
    lower.includes("warm session") ||
    lower.includes("cli")
  ) {
    return { stepId: "executing", state: "active", status: text };
  }
  if (
    lower.includes("validating") ||
    lower.includes("applying") ||
    lower.includes("response received") ||
    lower.includes("response completed") ||
    lower.includes("edit completed") ||
    lower.includes("applied json") ||
    lower.includes("cleaned edited json")
  ) {
    const complete = lower.includes("response completed") || lower.includes("applied json");
    return { stepId: "finalizing", state: complete ? "completed" : "active", status: text };
  }
  return null;
}

function updateAssistantProgressFromActivity(activity, options = {}) {
  const progress = classifyAssistantActivity(activity);
  if (!progress) return;
  updateAssistantProgressStep(progress.stepId, progress.state, progress.status, options);
}

function inferAssistantProgressSteps(activities) {
  const savedSteps = createAssistantProgressSteps();
  const previousSteps = assistantProgressSteps;
  assistantProgressSteps = savedSteps;
  for (const activity of activities || []) {
    updateAssistantProgressFromActivity(activity, { render: false });
  }
  if ((activities || []).length && !savedSteps.some((step) => step.state === "failed")) {
    savedSteps.forEach((step) => {
      if (step.state === "active" || step.state === "pending") finishAssistantProgressStep(step, "completed");
    });
  }
  assistantProgressSteps = previousSteps;
  return savedSteps;
}

function startAssistantProgressTicker() {
  stopAssistantProgressTicker();
  assistantProgressTicker = window.setInterval(() => {
    if (!currentRunStartedAt) {
      stopAssistantProgressTicker();
      return;
    }
    renderActivities();
  }, 900);
}

function stopAssistantProgressTicker() {
  if (!assistantProgressTicker) return;
  window.clearInterval(assistantProgressTicker);
  assistantProgressTicker = null;
}

function appendDebugLog(text, type = "debug") {
  const raw = String(text || "").trim();
  if (!raw) return;
  assistantDebugLogs.push({ type, text: raw, timestamp: nowIso() });
  assistantDebugLogs = assistantDebugLogs.slice(-300);
  renderDebugLog();
}

function renderDebugLog() {
  const log = $("aiAssistantDebugLog");
  if (!log) return;
  log.textContent = assistantDebugLogs
    .map((entry) => `[${entry.timestamp}] ${entry.type}: ${entry.text}`)
    .join("\n");
  log.scrollTop = log.scrollHeight;
}

function appendActivity(text, type = "activity", options = {}) {
  const now = performance.now();
  const elapsedMs = Number.isFinite(options.elapsedMs)
    ? options.elapsedMs
    : (currentStepStartedAt ? now - currentStepStartedAt : 0);
  if (currentRunStartedAt) currentStepStartedAt = now;
  const activity = {
    type,
    text: String(text || "").trim(),
    elapsedMs: Math.round(Math.max(0, elapsedMs)),
    timestamp: nowIso(),
  };
  if (!activity.text) return;
  assistantActivities.push(activity);
  assistantActivities = assistantActivities.slice(-120);
  updateAssistantProgressFromActivity(activity, { render: false });
  renderActivities();
  if (options.save !== false) saveCurrentSession();
}

function renderActivities() {
  const legacyPanel = $("aiAssistantActivity");
  if (legacyPanel) legacyPanel.classList.remove("open");
  const container = $("aiAssistantMessages");
  if (!container) return;
  if (!assistantActivities.length && !currentRunStartedAt) {
    currentWorkCardEl?.remove();
    currentWorkCardEl = null;
    return;
  }
  const steps = currentRunStartedAt
    ? (assistantProgressSteps.length ? assistantProgressSteps : createAssistantProgressSteps())
    : inferAssistantProgressSteps(assistantActivities);

  if (!currentWorkCardEl || !currentWorkCardEl.isConnected) {
    currentWorkCardEl = document.createElement("details");
    currentWorkCardEl.className = "aiAssistantWorkCard";
    currentWorkCardEl.open = !!currentRunStartedAt;
  }
  const pendingRow = currentPendingMessageEl?.closest?.(".aiAssistantMessageRow") || null;
  const assistantRows = [...container.querySelectorAll(".aiAssistantMessageRow.assistant")];
  const anchor = pendingRow || assistantRows.at(-1) || null;
  if (anchor && anchor !== currentWorkCardEl.nextSibling) {
    container.insertBefore(currentWorkCardEl, anchor);
  } else if (!currentWorkCardEl.parentNode) {
    container.appendChild(currentWorkCardEl);
  }

  const isRunning = !!currentRunStartedAt;
  const totalMs = isRunning
    ? performance.now() - currentRunStartedAt
    : assistantActivities.reduce((sum, item) => (
        sum + (Number.isFinite(item.elapsedMs) ? Math.max(0, item.elapsedMs) : 0)
      ), 0);
  const activeStep = steps.find((step) => step.state === "active");
  const failedStep = steps.find((step) => step.state === "failed");
  const completedSteps = steps.filter((step) => step.state === "completed").length;
  currentWorkCardEl.classList.toggle("running", isRunning);
  currentWorkCardEl.classList.toggle("failed", !!failedStep);
  currentWorkCardEl.classList.toggle("complete", !isRunning);
  if (isRunning) currentWorkCardEl.open = true;
  else currentWorkCardEl.open = false;

  currentWorkCardEl.textContent = "";
  const summary = document.createElement("summary");
  const titleWrap = document.createElement("span");
  titleWrap.className = "aiAssistantWorkTitleWrap";
  const pulse = document.createElement("span");
  pulse.className = "aiAssistantWorkPulse";
  const title = document.createElement("span");
  title.className = "aiAssistantWorkTitle";
  title.textContent = failedStep ? "Needs attention" : isRunning ? "Working" : "Worked";
  const subtitle = document.createElement("span");
  subtitle.className = "aiAssistantWorkSubtitle";
  subtitle.textContent = failedStep?.status || activeStep?.status || (isRunning ? "Waiting for the next update..." : "Task details collapsed.");
  titleWrap.append(pulse, title, subtitle);
  const meta = document.createElement("span");
  meta.className = "aiAssistantWorkMeta";
  meta.textContent = `${formatElapsed(totalMs)} - ${completedSteps}/${steps.length}`;
  summary.append(titleWrap, meta);
  currentWorkCardEl.appendChild(summary);

  const list = document.createElement("div");
  list.className = "aiAssistantWorkSteps";
  for (const step of steps) {
    const row = document.createElement("div");
    row.className = `aiAssistantWorkStep ${step.state || "pending"}`;
    const marker = document.createElement("span");
    marker.className = "aiAssistantWorkStepMarker";
    const body = document.createElement("span");
    body.className = "aiAssistantWorkStepBody";
    const label = document.createElement("span");
    label.className = "aiAssistantWorkStepLabel";
    label.textContent = step.label;
    const status = document.createElement("span");
    status.className = "aiAssistantWorkStepStatus";
    status.textContent = step.status || (step.state === "active" ? "In progress..." : "");
    const time = document.createElement("span");
    time.className = "aiAssistantWorkStepTime";
    const stepElapsed = getAssistantProgressElapsed(step);
    time.textContent = stepElapsed ? formatElapsed(stepElapsed) : "";
    body.append(label, status);
    row.append(marker, body, time);
    list.appendChild(row);
  }
  currentWorkCardEl.appendChild(list);
  scrollMessagesToBottom();
}

function updateContextPanel() {
  const panel = $("aiAssistantContextPanel");
  if (!panel) return;
  const context = currentContext || {};
  const usage = currentUsage || {};
  const rows = [
    ["Session", currentSessionTitle || currentSessionId || "New ArcBot Chat"],
    ["Tab", context.title || context.tabType || "No active tab context"],
    ["Type", context.tabType || "home"],
    ["File", context.targetPath || context.path || "No active JSON-backed file"],
    ["Context", usage.promptChars ? `${Number(usage.promptChars).toLocaleString()} chars, ~${Number(usage.estimatedTokens || 0).toLocaleString()} tokens` : "Not measured yet"],
    ["Included", usage.includedMessages != null ? `${usage.includedMessages} messages${usage.truncated ? ", truncated" : ""}` : "Not measured yet"],
  ];
  panel.textContent = "";
  const grid = document.createElement("div");
  grid.className = "aiAssistantContextGrid";
  for (const [label, value] of rows) {
    const labelEl = document.createElement("div");
    labelEl.className = "aiAssistantContextLabel";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "aiAssistantContextValue";
    valueEl.title = String(value);
    valueEl.textContent = String(value);
    grid.append(labelEl, valueEl);
  }
  panel.appendChild(grid);
}

function renderAssistantAttachments() {
  const list = $("aiAssistantAttachmentList");
  if (!list) return;
  list.textContent = "";
  list.classList.toggle("open", assistantAttachments.length > 0);
  assistantAttachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "aiAssistantAttachmentChip";
    chip.title = attachment.path || attachment.name || "Attached file";
    const icon = document.createElement("span");
    const kind = getAttachmentIconKind(attachment.name || attachment.path || "");
    icon.className = `aiAssistantAttachmentIcon type-${kind}`;
    icon.innerHTML = getAttachmentIconSvg(kind);
    const textWrap = document.createElement("span");
    textWrap.className = "aiAssistantAttachmentText";
    const name = document.createElement("span");
    name.className = "aiAssistantAttachmentName";
    name.textContent = attachment.name || "Attached file";
    const type = document.createElement("span");
    type.className = "aiAssistantAttachmentType";
    type.textContent = getAttachmentTypeLabel(attachment.name || attachment.path || "");
    textWrap.append(name, type);
    const remove = document.createElement("button");
    remove.className = "aiAssistantAttachmentRemove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${attachment.name || "attachment"}`);
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      assistantAttachments.splice(index, 1);
      renderAssistantAttachments();
    });
    chip.append(icon, textWrap, remove);
    list.appendChild(chip);
  });
}

function getAttachmentExtension(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop() || "";
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index + 1).toLowerCase() : "";
}

function getAttachmentIconKind(fileName) {
  const ext = getAttachmentExtension(fileName);
  if (["csv", "tsv", "xlsx", "xls", "xlsm", "json", "jsonl", "parquet"].includes(ext)) return "data";
  if (["py", "r", "sql", "js", "ts", "html", "css", "xml", "yaml", "yml", "toml", "ini"].includes(ext)) return "code";
  if (["md", "txt", "log", "ipynb", "arcnb"].includes(ext)) return "note";
  return "file";
}

function getAttachmentTypeLabel(fileName) {
  const ext = getAttachmentExtension(fileName);
  if (!ext) return "File";
  if (["md", "markdown"].includes(ext)) return "MD";
  return ext.toUpperCase();
}

function getAttachmentIconSvg(kind) {
  if (kind === "data") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect><path d="M5 10h14"></path><path d="M10 5v14"></path><path d="M14 5v14"></path></svg>';
  }
  if (kind === "code") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l-6-6 6-6"></path><path d="M15 6l6 6-6 6"></path></svg>';
  }
  if (kind === "note") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h8l4 4v12H7z"></path><path d="M15 4v5h4"></path><path d="M10 13h6"></path><path d="M10 17h4"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>';
}

function closeAttachMenu() {
  $("aiAssistantAttachMenu")?.classList.remove("open");
  $("aiAssistantAttachBtn")?.setAttribute("aria-expanded", "false");
}

function toggleAttachMenu() {
  const menu = $("aiAssistantAttachMenu");
  const button = $("aiAssistantAttachBtn");
  const open = !menu?.classList.contains("open");
  menu?.classList.toggle("open", open);
  button?.setAttribute("aria-expanded", open ? "true" : "false");
}

async function attachAssistantContextFile() {
  closeAttachMenu();
  const host = getHostApi();
  if (!host?.pickOpenFile || !host?.readTextFile) {
    setStatus("File attachments are available in the desktop app only.", "error");
    return;
  }
  if (assistantAttachments.length >= 5) {
    setStatus("ArcBot can attach up to 5 files per request.", "error");
    return;
  }
  try {
    const filePath = await host.pickOpenFile({
      filters: [
        { name: "Context Files", extensions: ASSISTANT_ATTACHMENT_EXTENSIONS },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!filePath) return;
    if (assistantAttachments.some((item) => item.path === filePath)) {
      setStatus("That file is already attached.");
      return;
    }
    const result = await host.readTextFile({ path: filePath, maxBytes: 200000 });
    if (!result?.ok) {
      setStatus(result?.error || "Could not attach that file.", "error");
      return;
    }
    assistantAttachments.push({
      name: result.name || filePath.split(/[\\/]/).pop() || "attachment",
      path: result.path || filePath,
      size: Number(result.size || 0),
      text: String(result.text || ""),
    });
    renderAssistantAttachments();
    setStatus(`Attached ${result.name || "file"} as ArcBot context.`);
  } catch (err) {
    setStatus(String(err?.message || err || "Could not attach file."), "error");
  }
}

function getActiveTabPreviewContext() {
  const activeTab = shell.state?.tabs?.find?.((tab) => tab.id === shell.state.activeId) || null;
  return {
    available: !!activeTab && activeTab.type !== "home",
    tabId: activeTab?.id || "",
    tabType: activeTab?.type || "home",
    title: activeTab?.title || "Home",
    targetPath: "",
    fileState: "",
  };
}

function formatAppContextTooltip(context) {
  if (!assistantAppContextEnabled) {
    return [
      "App Context Off",
      "ArcBot will not receive active page, tab, file, or notebook contents.",
    ].join("\n");
  }
  const ctx = context && typeof context === "object" ? context : getActiveTabPreviewContext();
  const title = String(ctx.title || "Home");
  const type = String(ctx.tabType || ctx.pageType || "home");
  const path = String(ctx.targetPath || ctx.path || "").trim();
  const state = String(ctx.fileState || (ctx.dirty ? "unsaved-changes" : "") || "").trim();
  return [
    "App Context",
    `Tab: ${title} (${type})`,
    path ? `File: ${path}` : "File: no active file",
    state ? `State: ${state}` : "",
  ].filter(Boolean).join("\n");
}

async function refreshAppContextTooltip({ probe = false } = {}) {
  const tooltip = $("aiAssistantAppContextTooltip");
  const button = $("aiAssistantAppContextBtn");
  if (!tooltip && !button) return;
  let context = getActiveTabPreviewContext();
  if (probe && assistantAppContextEnabled) {
    try {
      context = await requestActivePageContext();
    } catch {
      // Keep shell-level preview when iframe context is unavailable.
    }
  }
  const text = formatAppContextTooltip(context);
  if (tooltip) tooltip.textContent = text;
  button?.removeAttribute("title");
}

function setAssistantContextPanelOpen(open) {
  const panel = $("aiAssistantContextPanel");
  panel?.classList.toggle("open", !!open);
  updateContextPanel();
}

function setAssistantAppContextEnabled(enabled) {
  assistantAppContextEnabled = !!enabled;
  const button = $("aiAssistantAppContextBtn");
  button?.classList.toggle("active", assistantAppContextEnabled);
  button?.setAttribute("aria-pressed", assistantAppContextEnabled ? "true" : "false");
  button?.setAttribute("aria-label", assistantAppContextEnabled ? "App Context on" : "App Context off");
  if (!assistantAppContextEnabled) {
    currentContext = {
      available: false,
      tabType: "off",
      title: "App Context Off",
      targetPath: "",
      fileState: "disabled",
    };
    setAssistantContextPanelOpen(false);
  }
  updateContextPanel();
  refreshAppContextTooltip({ probe: assistantAppContextEnabled });
}

function updateSessionSelectLabel() {
  updateContextPanel();
}

async function refreshSessionList(selectedId = currentSessionId) {
  const host = getHostApi();
  if (!host?.codexAssistantListSessions) return [];
  try {
    const result = await host.codexAssistantListSessions({ includeArchived: false });
    const sessions = result?.ok && Array.isArray(result.sessions) ? result.sessions : [];
    latestSessionList = sessions;
    return sessions;
  } catch {
    return [];
  }
}

async function loadAssistantSession(sessionId) {
  const host = getHostApi();
  if (!host?.codexAssistantLoadSession || !sessionId) return false;
  const result = await host.codexAssistantLoadSession(sessionId);
  if (!result?.ok || !result.session) return false;
  const session = result.session;
  currentSessionId = session.id || "";
  currentSessionTitle = session.title || "ArcBot Chat";
  assistantMode = session.mode === "review" ? "review" : "edit";
  assistantMessages = normalizeMessages(session.messages);
  assistantActivities = normalizeActivities(session.activities);
  assistantDebugLogs = normalizeDebugLogs(session.debugLogs);
  currentContext = session.context || null;
  currentUsage = session.usage || null;
  setAssistantMode(assistantMode, { save: false });
  renderMessages();
  renderActivities();
  renderDebugLog();
  await refreshSessionList(currentSessionId);
  updateSessionSelectLabel();
  return true;
}

async function createAssistantSession() {
  const host = getHostApi();
  if (!host?.codexAssistantCreateSession) return false;
  const result = await host.codexAssistantCreateSession({ mode: assistantMode });
  if (!result?.ok || !result.session) return false;
  currentSessionId = result.session.id;
  currentSessionTitle = result.session.title || "New ArcBot Chat";
  assistantMessages = [];
  assistantActivities = [];
  assistantDebugLogs = [];
  currentContext = null;
  currentUsage = null;
  refreshAppContextTooltip();
  renderMessages();
  renderActivities();
  renderDebugLog();
  await refreshSessionList(currentSessionId);
  updateSessionSelectLabel();
  return true;
}

async function ensureAssistantSession() {
  const sessions = await refreshSessionList();
  if (sessions.length && await loadAssistantSession(sessions[0].id)) return;
  await createAssistantSession();
}

function formatSessionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function refreshHistoryPage() {
  const host = getHostApi();
  const list = $("aiAssistantHistoryList");
  if (!host?.codexAssistantListSessions || !list) return;
  list.textContent = "";
  const result = await host.codexAssistantListSessions({ includeArchived: true });
  const sessions = result?.ok && Array.isArray(result.sessions) ? result.sessions : [];
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "aiAssistantHistoryEmpty";
    empty.textContent = "No chat sessions yet.";
    list.appendChild(empty);
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = `aiAssistantHistoryRow${session.archived ? " archived" : ""}`;
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "aiAssistantHistoryName";
    name.textContent = session.title || "ArcBot Chat";
    const meta = document.createElement("div");
    meta.className = "aiAssistantHistoryMeta";
    const updated = formatSessionDate(session.updatedAt);
    meta.textContent = `${session.messageCount || 0} messages${updated ? ` · ${updated}` : ""}${session.archived ? " · Archived" : ""}`;
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "aiAssistantHistoryActions";
    const openBtn = document.createElement("button");
    openBtn.className = "aiAssistantMiniBtn";
    openBtn.type = "button";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", async () => {
      if (session.archived && host.codexAssistantArchiveSession) {
        await host.codexAssistantArchiveSession(session.id, false);
      }
      await loadAssistantSession(session.id);
      await closeHistoryPage();
    });
    const archiveBtn = document.createElement("button");
    archiveBtn.className = "aiAssistantMiniBtn";
    archiveBtn.type = "button";
    archiveBtn.textContent = session.archived ? "Restore" : "Archive";
    archiveBtn.addEventListener("click", async () => {
      if (!host.codexAssistantArchiveSession) return;
      await host.codexAssistantArchiveSession(session.id, !session.archived);
      if (session.id === currentSessionId && !session.archived) {
        await createAssistantSession();
      }
      await refreshSessionList(currentSessionId);
      await refreshHistoryPage();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "aiAssistantMiniBtn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!host.codexAssistantDeleteSession) return;
      const confirmed = window.confirm(`Delete this ArcBot chat session?\n\n${session.title || "ArcBot Chat"}`);
      if (!confirmed) return;
      await host.codexAssistantDeleteSession(session.id);
      if (session.id === currentSessionId) {
        await createAssistantSession();
      }
      await refreshSessionList(currentSessionId);
      await refreshHistoryPage();
    });
    actions.append(openBtn, archiveBtn, deleteBtn);
    row.append(info, actions);
    list.appendChild(row);
  }
}

async function openHistoryPage() {
  const panel = $("aiAssistantPanel");
  panel?.classList.add("history-open");
  $("aiAssistantHistoryPage")?.classList.add("open");
  $("aiAssistantHistoryBtn")?.setAttribute("aria-expanded", "true");
  await refreshHistoryPage();
}

async function closeHistoryPage() {
  const panel = $("aiAssistantPanel");
  panel?.classList.remove("history-open");
  $("aiAssistantHistoryPage")?.classList.remove("open");
  $("aiAssistantHistoryBtn")?.setAttribute("aria-expanded", "false");
  await refreshSessionList(currentSessionId);
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
  return assistantMode === "review" ? "Read Only" : "Edit Automatically";
}

function setModeIcon() {
  const icon = $("aiAssistantModeIcon");
  if (!icon) return;
  icon.innerHTML = assistantMode === "review"
    ? '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle>'
    : '<path d="M18 11V7a2 2 0 0 0-4 0v3"></path><path d="M14 10V6a2 2 0 0 0-4 0v7"></path><path d="M10 13V8a2 2 0 1 0-4 0v6"></path><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-16 0"></path>';
}

function setAssistantMode(mode, options = {}) {
  assistantMode = mode === "review" ? "review" : "edit";
  setText($("aiAssistantModeLabel"), getModeLabel());
  setModeIcon();
  $("aiAssistantReviewModeOption")?.classList.toggle("active", assistantMode === "review");
  $("aiAssistantEditModeOption")?.classList.toggle("active", assistantMode === "edit");
  setStatus(assistantReady ? `Codex ready. ${getModeLabel()}.` : `${getModeLabel()} selected.`);
  if (!assistantMessages.length) renderMessages();
  if (options.save !== false) saveCurrentSession();
}

function setComposerEnabled(enabled) {
  const input = $("aiAssistantInput");
  const sendBtn = $("aiAssistantSendBtn");
  if (input) input.disabled = false;
  if (sendBtn) {
    const isCancel = !!assistantBusy && !!currentRequestId;
    sendBtn.disabled = !isCancel && !enabled;
    sendBtn.classList.toggle("cancel", isCancel);
    sendBtn.classList.toggle("canceling", isCancel && assistantCancelRequested);
    sendBtn.setAttribute("aria-label", isCancel ? "Cancel request" : "Send");
    sendBtn.title = isCancel ? "Cancel request" : "Send";
  }
}

function autoGrowAssistantInput() {
  const input = $("aiAssistantInput");
  if (!input) return;
  input.style.height = "auto";
  const nextHeight = Math.min(300, Math.max(38, input.scrollHeight));
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > 300 ? "auto" : "hidden";
}

async function loadAssistantUserAvatarName() {
  const host = getHostApi();
  if (!host?.getWindowsUserName) return;
  try {
    const userName = String(await host.getWindowsUserName() || "").trim();
    if (!userName) return;
    assistantUserAvatarName = userName;
    document.querySelectorAll(".aiAssistantAvatarUser").forEach((avatar) => {
      avatar.innerHTML = createAssistantUserAvatarSvg(assistantUserAvatarName);
    });
  } catch {
    // Keep the default initial avatar if the host name is unavailable.
  }
}

function getMessageAvatar(role) {
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "aiAssistantAvatar aiAssistantAvatarArcBot";
    avatar.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.className = "arcbot-mini-img";
    img.src = "/icons/ArcBot%20mini.png";
    img.alt = "";
    img.draggable = false;
    avatar.appendChild(img);
    return avatar;
  }
  const avatar = document.createElement("div");
  avatar.className = "aiAssistantAvatar aiAssistantAvatarUser";
  avatar.setAttribute("aria-hidden", "true");
  avatar.innerHTML = createAssistantUserAvatarSvg(assistantUserAvatarName);
  return avatar;
}

function appendMessage(role, text) {
  const container = $("aiAssistantMessages");
  if (!container) return null;
  const normalizedRole = role === "assistant" ? "assistant" : role === "system" ? "system" : "user";
  const el = document.createElement("div");
  el.className = `aiAssistantMessage ${normalizedRole}`;
  el.textContent = text || "";
  if (normalizedRole === "system") {
    const row = document.createElement("div");
    row.className = "aiAssistantMessageRow system";
    row.appendChild(el);
    container.appendChild(row);
  } else {
    const row = document.createElement("div");
    row.className = `aiAssistantMessageRow ${normalizedRole}`;
    row.append(getMessageAvatar(normalizedRole), el);
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
  return el;
}

function scrollMessagesToBottom() {
  const container = $("aiAssistantMessages");
  if (container) container.scrollTop = container.scrollHeight;
}

function renderEmptyHint() {
  const container = $("aiAssistantMessages");
  if (!container || container.children.length) return;
  appendMessage("system", assistantMode === "edit"
    ? "ArcBot can edit JSON-backed app context files automatically."
    : "ArcBot is in Read Only mode and cannot edit files.");
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
  const panel = $("aiAssistantPanel");
  applyFirstSessionOpenPanelSize(panel);
  $("aiAssistantLauncher")?.classList.add("assistant-open");
  panel?.classList.add("open");
  renderEmptyHint();
  refreshAppContextTooltip();
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

function closeSelectMenus() {
  closeModeMenu();
}

function toggleModeMenu(forceOpen) {
  const button = $("aiAssistantModeButton");
  const menu = $("aiAssistantModeMenu");
  if (!button || !menu) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !menu.classList.contains("open");
  menu.classList.toggle("open", shouldOpen);
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
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

function readPanelSize() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSISTANT_PANEL_SIZE_KEY) || "null");
    if (parsed && Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) return parsed;
  } catch {}
  return null;
}

function savePanelSize(panel) {
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  try {
    localStorage.setItem(ASSISTANT_PANEL_SIZE_KEY, JSON.stringify({
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }));
  } catch {}
}

function hasOpenedPanelThisSession() {
  try {
    return sessionStorage.getItem(ASSISTANT_PANEL_OPENED_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markPanelOpenedThisSession() {
  try {
    sessionStorage.setItem(ASSISTANT_PANEL_OPENED_SESSION_KEY, "1");
  } catch {}
}

function clampPanelSize(width, height) {
  const statusbarHeight = Number(shell.getStatusBarHeight?.() || 0);
  const maxWidth = Math.max(ASSISTANT_PANEL_MIN_WIDTH, window.innerWidth - 16);
  const maxHeight = Math.max(340, window.innerHeight - statusbarHeight - 16);
  return {
    width: Math.min(Math.max(ASSISTANT_PANEL_MIN_WIDTH, Number(width) || ASSISTANT_PANEL_MIN_WIDTH), maxWidth),
    height: Math.min(Math.max(340, Number(height) || ASSISTANT_PANEL_DEFAULT_HEIGHT), maxHeight),
  };
}

function applyPanelSize(panel, size = readPanelSize()) {
  if (!panel || !size) return;
  const next = clampPanelSize(size.width, size.height);
  panel.style.width = `${Math.round(next.width)}px`;
  panel.style.height = `${Math.round(next.height)}px`;
}

function applyFirstSessionOpenPanelSize(panel) {
  if (!panel || hasOpenedPanelThisSession()) return;
  const saved = readPanelSize();
  const rect = panel.getBoundingClientRect();
  applyPanelSize(panel, {
    width: ASSISTANT_PANEL_MIN_WIDTH,
    height: saved?.height || rect.height || ASSISTANT_PANEL_DEFAULT_HEIGHT,
  });
  markPanelOpenedThisSession();
}

function applyPanelPosition(panel, left, top) {
  const next = clampPanelPosition(panel, left, top);
  panel.style.left = `${Math.round(next.left)}px`;
  panel.style.top = `${Math.round(next.top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function initAssistantResize(panel) {
  const handle = $("aiAssistantResizeHandle");
  if (!handle) return;
  applyPanelSize(panel);
  let resizeState = null;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    try { handle.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const next = clampPanelSize(
      resizeState.width + event.clientX - resizeState.startX,
      resizeState.height + event.clientY - resizeState.startY,
    );
    applyPanelSize(panel, next);
    const rect = panel.getBoundingClientRect();
    applyPanelPosition(panel, rect.left, rect.top);
  });

  const stopResize = (event) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    savePanelSize(panel);
    resizeState = null;
  };

  handle.addEventListener("pointerup", stopResize);
  handle.addEventListener("pointercancel", stopResize);
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

async function cancelAssistantMessage() {
  if (!assistantBusy || !currentRequestId || assistantCancelRequested) return;
  const host = getHostApi();
  assistantCancelRequested = true;
  setComposerEnabled(false);
  appendActivity("Cancel requested", "activity");
  setStatus("Canceling ArcBot request...");
  try {
    if (!host?.codexAssistantCancel) throw new Error("ArcBot cancel is not available.");
    const result = await host.codexAssistantCancel(currentRequestId);
    if (!result?.ok && assistantHostRequestSubmitted) {
      setStatus(result?.error || "Could not cancel ArcBot request.", "error");
    }
  } catch (err) {
    setStatus(String(err?.message || err || "Could not cancel ArcBot request."), "error");
  }
}

async function sendAssistantMessage() {
  if (assistantBusy) return;
  const host = getHostApi();
  const input = $("aiAssistantInput");
  const text = String(input?.value || "").trim();
  if ((!text && !assistantAttachments.length) || !host?.codexAssistantSend) return;
  if (!currentSessionId) await ensureAssistantSession();
  if (!assistantReady) {
    setStatus("Install Codex CLI or sign in before sending.", "error");
    return;
  }

  const userText = text || "Use the attached file context.";
  const requestAttachments = assistantAttachments.map((attachment) => ({ ...attachment }));
  const visibleText = requestAttachments.length
    ? `${userText}\n\nAttached: ${requestAttachments.map((item) => item.name).join(", ")}`
    : userText;
  assistantMessages.push({ role: "user", content: visibleText, timestamp: nowIso() });
  appendMessage("user", visibleText);
  currentSessionTitle = assistantMessages.find((message) => message.role === "user")?.content?.slice(0, 42) || currentSessionTitle;
  if (input) input.value = "";
  assistantAttachments = [];
  renderAssistantAttachments();
  autoGrowAssistantInput();
  currentRequestId = `arcbot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  currentRunStartedAt = performance.now();
  currentStepStartedAt = currentRunStartedAt;
  assistantProgressSteps = createAssistantProgressSteps();
  startAssistantProgressTicker();
  assistantCancelRequested = false;
  assistantHostRequestSubmitted = false;
  assistantActivities = [];
  assistantDebugLogs = [];
  renderActivities();
  renderDebugLog();
  appendActivity("Understanding request", "activity", { elapsedMs: 0 });
  const pending = appendMessage("assistant", "...");
  currentPendingMessageEl = pending;
  await saveCurrentSession();

  assistantBusy = true;
  setComposerEnabled(false);
  setStatus(assistantAppContextEnabled ? "ArcBot is checking the active page context..." : "ArcBot is responding without app context...");
  appendActivity(
    assistantAppContextEnabled ? "Scanning active app contents" : "App context disabled",
    "activity",
    { save: false },
  );
  try {
    const activeContext = assistantAppContextEnabled
      ? await requestActivePageContext()
      : {
          available: false,
          disabled: true,
          tabType: "off",
          title: "App Context Off",
          targetPath: "",
        };
    currentContext = {
      available: !!activeContext?.available,
      tabType: activeContext?.tabType || "home",
      title: activeContext?.title || "",
      targetPath: activeContext?.targetPath || activeContext?.path || "",
      fileState: activeContext?.disabled ? "disabled" : (activeContext?.fileState || ""),
    };
    updateContextPanel();
    appendActivity(
      activeContext?.available
        ? `Scanned ${activeContext.title || activeContext.tabType || "active tab"} context`
        : "No active app context available",
      "activity",
      { save: false },
    );
    if (assistantCancelRequested) {
      const message = "Request canceled.";
      if (pending) pending.textContent = message;
      assistantMessages.push({ role: "assistant", content: message, timestamp: nowIso() });
      appendActivity("Request canceled", "activity");
      failAssistantProgress("Request canceled");
      setStatus("ArcBot request canceled.");
      return;
    }
    setStatus(`Codex is responding in ${getModeLabel()}...`);
    assistantHostRequestSubmitted = true;
    const result = await host.codexAssistantSend({
      requestId: currentRequestId,
      sessionId: currentSessionId,
      mode: assistantMode,
      messages: assistantMessages,
      activeContext,
      attachments: requestAttachments,
    });
    currentUsage = result?.usage || currentUsage;
    updateContextPanel();
    if (assistantCancelRequested && result?.ok) {
      const message = "Request canceled.";
      if (pending) pending.textContent = message;
      assistantMessages.push({ role: "assistant", content: message, timestamp: nowIso() });
      appendActivity("Request canceled", "activity");
      failAssistantProgress("Request canceled");
      setStatus("ArcBot request canceled.");
      return;
    }
    if (!result?.ok) {
      const wasCanceled = !!result?.canceled || assistantCancelRequested;
      const message = wasCanceled ? "Request canceled." : (result?.error || "Codex request failed.");
      if (pending) pending.textContent = message;
      assistantMessages.push({ role: "assistant", content: message, timestamp: nowIso() });
      if (wasCanceled) {
        setStatus("ArcBot request canceled.");
        appendActivity("Request canceled", "activity");
        failAssistantProgress("Request canceled");
      } else if (result?.needsAuth) {
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
        appendActivity("Request failed", "error");
        failAssistantProgress(message);
      }
      return;
    }
    const reply = String(result?.text || "").trim() || "No response.";
    if (pending) pending.textContent = reply;
    assistantMessages.push({ role: "assistant", content: reply, timestamp: nowIso() });
    if (result?.editApplied) notifyActivePageJsonUpdated(result);
    appendActivity(result?.editApplied ? "Applied JSON-backed edit with host validation." : "Response completed.", "activity");
    completeAssistantProgress(result?.editApplied ? "Edit applied" : "Response completed");
    setStatus(result?.editApplied ? "ArcBot applied a JSON-backed edit." : `Codex ready. ${getModeLabel()}.`);
  } catch (err) {
    const message = assistantCancelRequested ? "Request canceled." : String(err?.message || err || "Codex request failed.");
    if (pending) pending.textContent = message;
    assistantMessages.push({ role: "assistant", content: message, timestamp: nowIso() });
    appendActivity(assistantCancelRequested ? "Request canceled" : "Request failed", assistantCancelRequested ? "activity" : "error");
    failAssistantProgress(message);
    setStatus(message, assistantCancelRequested ? "" : "error");
  } finally {
    currentRequestId = "";
    currentRunStartedAt = 0;
    currentStepStartedAt = 0;
    stopAssistantProgressTicker();
    renderActivities();
    currentPendingMessageEl = null;
    await saveCurrentSession();
    await refreshSessionList(currentSessionId);
    assistantBusy = false;
    assistantCancelRequested = false;
    assistantHostRequestSubmitted = false;
    setComposerEnabled(assistantReady);
  }
}

function handleAssistantEvent(event) {
  if (!event || event.requestId !== currentRequestId) return;
  if (event.type === "stdout") {
    appendDebugLog(event.text, "stdout");
    updateAssistantProgressStep("executing", "active", "Codex is streaming a response.");
    return;
  }
  if (event.type === "stderr") {
    appendDebugLog(event.text, "stderr");
    updateAssistantProgressStep("executing", "active", "Codex reported command output.");
    return;
  }
  if (event.type === "usage") {
    currentUsage = event.usage || currentUsage;
    updateContextPanel();
    updateAssistantProgressStep("scanning", "active", "Estimated context window usage.");
    appendDebugLog(event.text, "usage");
    return;
  }
  if (event.type === "context" && event.context) {
    currentContext = { ...(currentContext || {}), ...event.context };
    updateContextPanel();
    appendActivity(`Read ${event.context.title || event.context.tabType || "active tab"} context`, "activity");
    appendDebugLog(`${event.text}\n${JSON.stringify(event.context, null, 2)}`, "context");
    return;
  }
  const text = String(event.text || "").trim();
  if (!text) return;
  appendDebugLog(text, event.type || "activity");
  const lower = text.toLowerCase();
  if (lower.includes("checking active json")) appendActivity("Read active file", "activity");
  else if (lower.includes("creating editable local json")) appendActivity("Edit started", "activity");
  else if (lower.includes("cleaned explanatory text")) appendActivity("Cleaned edited JSON", "activity");
  else if (lower.includes("validating and applying")) appendActivity("Edit completed", "activity");
  else if (lower.includes("codex response received")) appendActivity("Response received", "activity");
  else if (lower.includes("checking latest arcbot edit history")) appendActivity("Revert started", "activity");
  else if (lower.includes("starting codex cli") || lower.includes("starting warm codex session")) appendActivity("Codex started", "activity");
  else if (lower.includes("resolving arcbot project")) appendActivity("Session prepared", "activity");
}

export function initAiAssistant() {
  const launcher = $("aiAssistantLauncher");
  const panel = $("aiAssistantPanel");
  const composer = $("aiAssistantComposer");
  if (!launcher || !panel || !composer) return;
  const host = getHostApi();
  if (!host) {
    launcher.style.display = "none";
    return;
  }
  setAiAssistantLauncherVisible(isAiAssistantLauncherVisible());
  ensureAssistantSession();
  host.onCodexAssistantEvent?.(handleAssistantEvent);

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
  $("aiAssistantAttachBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAttachMenu();
  });
  $("aiAssistantAttachFileOption")?.addEventListener("click", attachAssistantContextFile);
  $("aiAssistantNewChatBtn")?.addEventListener("click", async () => {
    await createAssistantSession();
    closeHistoryPage();
    setStatus("New ArcBot chat started.");
  });
  $("aiAssistantHistoryBtn")?.addEventListener("click", () => {
    const page = $("aiAssistantHistoryPage");
    if (page?.classList.contains("open")) closeHistoryPage();
    else openHistoryPage();
  });
  $("aiAssistantHistoryCloseBtn")?.addEventListener("click", () => {
    closeHistoryPage();
  });
  $("aiAssistantAppContextBtn")?.addEventListener("click", async () => {
    setAssistantAppContextEnabled(!assistantAppContextEnabled);
    if (assistantAppContextEnabled) {
      const activeContext = await requestActivePageContext();
      currentContext = {
        available: !!activeContext?.available,
        tabType: activeContext?.tabType || "home",
        title: activeContext?.title || "",
        targetPath: activeContext?.targetPath || activeContext?.path || "",
        fileState: activeContext?.fileState || "",
      };
      updateContextPanel();
    }
    refreshAppContextTooltip({ probe: assistantAppContextEnabled });
  });
  $("aiAssistantAppContextBtn")?.addEventListener("mouseenter", () => {
    const tooltip = $("aiAssistantAppContextTooltip");
    if (tooltip) {
      tooltip.textContent = formatAppContextTooltip(getActiveTabPreviewContext());
      tooltip.classList.add("open");
    }
    refreshAppContextTooltip({ probe: assistantAppContextEnabled });
  });
  $("aiAssistantAppContextBtn")?.addEventListener("mouseleave", () => {
    $("aiAssistantAppContextTooltip")?.classList.remove("open");
  });
  $("aiAssistantDebugBtn")?.addEventListener("click", () => {
    const panel = $("aiAssistantDebugPanel");
    const open = !panel?.classList.contains("open");
    panel?.classList.toggle("open", open);
    $("aiAssistantDebugBtn")?.setAttribute("aria-expanded", open ? "true" : "false");
    renderDebugLog();
  });
  $("aiAssistantCopyDebugBtn")?.addEventListener("click", async () => {
    const text = $("aiAssistantDebugLog")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("ArcBot debug log copied.");
    } catch {
      setStatus("Could not copy ArcBot debug log.", "error");
    }
  });
  $("aiAssistantModeButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAttachMenu();
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
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (assistantBusy) {
      cancelAssistantMessage();
    } else {
      sendAssistantMessage();
    }
  });
  $("aiAssistantInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!assistantBusy) sendAssistantMessage();
    }
  });
  $("aiAssistantInput")?.addEventListener("input", autoGrowAssistantInput);
  autoGrowAssistantInput();

  document.addEventListener("pointerdown", (event) => {
    if (event.target?.closest?.(".aiAssistantSelectWrap")) return;
    if (event.target?.closest?.("#aiAssistantAttachMenu") || event.target?.closest?.("#aiAssistantAttachBtn")) return;
    closeSelectMenus();
    closeAttachMenu();
  }, true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSelectMenus();
      closeAttachMenu();
    }
  }, true);
  initAssistantDrag(panel);
  initAssistantResize(panel);
  initAssistantLauncherDrag(launcher);
  setAssistantAppContextEnabled(true);
  renderAssistantAttachments();
  loadAssistantUserAvatarName();
  setComposerEnabled(false);
}
