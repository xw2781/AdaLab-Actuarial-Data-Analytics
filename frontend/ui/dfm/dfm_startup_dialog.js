import {
  getCurrentDfmObjectSnapshot,
  getLastDfmObjectSnapshot,
  recordDfmObjectSnapshot,
} from "/ui/dfm/dfm_startup_state.js";

const STYLE_ID = "dfm-startup-dialog-style";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .dfmStartupOverlay {
      position: fixed;
      inset: 0;
      z-index: 7000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(245, 247, 250, 0.72);
      backdrop-filter: blur(4px);
    }
    .dfmStartupWindow {
      width: min(760px, calc(100vw - 48px));
      max-height: min(680px, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      background: #f8f9fb;
      border: 1px solid #c8ced8;
      box-shadow: 0 18px 42px rgba(31, 41, 55, 0.22);
      font-family: var(--dfm-font, Arial, sans-serif);
    }
    .dfmStartupHeader {
      padding: 14px 18px;
      border-bottom: 1px solid #d7dce4;
      background: #eef2f7;
      font-weight: 700;
      color: #202938;
    }
    .dfmStartupBody {
      padding: 16px;
      overflow: auto;
    }
    .dfmStartupChoices {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .dfmStartupChoice {
      min-height: 82px;
      padding: 12px;
      border: 1px solid #cfd6e2;
      background: #fff;
      text-align: left;
      cursor: pointer;
      color: #1f2937;
      border-radius: 6px;
    }
    .dfmStartupChoice:hover,
    .dfmStartupChoice.active {
      border-color: #7aa7e8;
      background: #eef6ff;
    }
    .dfmStartupChoice strong {
      display: block;
      font-size: 14px;
      margin-bottom: 6px;
    }
    .dfmStartupChoice span {
      display: block;
      font-size: 12px;
      line-height: 1.35;
      color: #5b6472;
    }
    .dfmStartupPanel {
      margin-top: 14px;
      padding: 12px;
      border: 1px solid #d8dde6;
      background: #fff;
      border-radius: 6px;
    }
    .dfmStartupRow {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .dfmStartupRow label {
      width: 86px;
      font-size: 12px;
      color: #586174;
    }
    .dfmStartupRow input {
      flex: 1;
      min-width: 0;
      height: 30px;
      border: 1px solid #c5ccd8;
      border-radius: 5px;
      padding: 4px 8px;
      font: 13px var(--dfm-font, Arial, sans-serif);
    }
    .dfmStartupBtn {
      min-height: 30px;
      padding: 5px 12px;
      border: 1px solid #bfc7d3;
      border-radius: 5px;
      background: #f8fafc;
      color: #202938;
      cursor: pointer;
      font: 13px var(--dfm-font, Arial, sans-serif);
    }
    .dfmStartupBtn.primary {
      border-color: #3f82d8;
      background: #2f73c8;
      color: #fff;
    }
    .dfmStartupTree {
      max-height: 260px;
      overflow: auto;
      border: 1px solid #e1e5ec;
      background: #fbfcfe;
    }
    .dfmStartupClass {
      padding: 8px 10px 4px;
      color: #4b5565;
      font-weight: 700;
      font-size: 12px;
    }
    .dfmStartupMethod {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 8px 10px 8px 22px;
      border: 0;
      border-top: 1px solid #edf0f5;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font: 13px var(--dfm-font, Arial, sans-serif);
    }
    .dfmStartupMethod:hover,
    .dfmStartupMethod.selected {
      background: #eaf3ff;
    }
    .dfmStartupMethod small {
      color: #667085;
      white-space: nowrap;
    }
    .dfmStartupStatus {
      min-height: 18px;
      margin-top: 8px;
      color: #7a3d00;
      font-size: 12px;
      white-space: pre-wrap;
    }
    .dfmStartupActions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px 14px;
      border-top: 1px solid #d7dce4;
      background: #f1f4f8;
    }
    @media (max-width: 720px) {
      .dfmStartupChoices { grid-template-columns: 1fr; }
      .dfmStartupRow { align-items: stretch; flex-direction: column; }
      .dfmStartupRow label { width: auto; }
    }
  `;
  document.head.appendChild(style);
}

function setField(id, value, options = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value == null ? "" : String(value);
  if (!options?.silent) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function normalizeSnapshot(snapshot = {}) {
  return {
    project: String(snapshot.project || "").trim(),
    reservingClass: String(snapshot.reservingClass || snapshot.reserving_class || "").trim(),
    methodName: String(snapshot.methodName || snapshot.name || "").trim(),
    outputVector: String(snapshot.outputVector || snapshot.output_vector || "").trim(),
    inputTriangle: String(snapshot.inputTriangle || snapshot.input_triangle || "").trim(),
    originLength: Number.parseInt(String(snapshot.originLength || snapshot.origin_length || 12), 10) || 12,
    developmentLength: Number.parseInt(String(snapshot.developmentLength || snapshot.development_length || 12), 10) || 12,
    decimalPlaces: Number.parseInt(String(snapshot.decimalPlaces || snapshot.decimal_places || 4), 10) || 4,
  };
}

function methodToSnapshot(method) {
  return normalizeSnapshot({
    project: method?.project,
    reservingClass: method?.reservingClass,
    methodName: method?.methodName,
    outputVector: method?.outputVector,
    inputTriangle: method?.inputTriangle,
    originLength: method?.originLength,
    developmentLength: method?.developmentLength,
    decimalPlaces: method?.decimalPlaces,
  });
}

function applySnapshot(snapshot, options = {}) {
  const data = normalizeSnapshot(snapshot);
  setField("projectSelect", data.project);
  setField("pathInput", data.reservingClass);
  setField("dfmOutputVector", data.outputVector);
  setField("dfmMethodName", data.methodName);
  setField("triInput", data.inputTriangle);
  setField("originLenSelect", data.originLength);
  setField("devLenSelect", data.developmentLength);
  setField("decimalPlaces", data.decimalPlaces);
  if (options?.record !== false) recordDfmObjectSnapshot(data);
  return data;
}

async function fetchIndex(projectName, refresh = false) {
  const query = new URLSearchParams({
    project_name: projectName,
    refresh: refresh ? "true" : "false",
  });
  const response = await fetch(`/dfm/method-index?${query.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function renderMethodTree(container, methods, onSelect) {
  const byClass = new Map();
  for (const method of Array.isArray(methods) ? methods : []) {
    const key = String(method?.reservingClass || "Unassigned");
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(method);
  }
  const classes = [...byClass.keys()].sort((a, b) => a.localeCompare(b));
  if (!classes.length) {
    container.innerHTML = `<div class="dfmStartupClass">No DFM objects found for this project.</div>`;
    return;
  }
  container.innerHTML = classes.map((className) => `
    <div class="dfmStartupClass">${escapeHtml(className)}</div>
    ${byClass.get(className).map((method, index) => `
      <button class="dfmStartupMethod" type="button" data-method-class="${escapeHtml(className)}" data-method-index="${index}">
        <span>${escapeHtml(method.methodName || method.filename || "DFM")}</span>
        <small>${escapeHtml(method.inputTriangle || method.outputVector || "")}</small>
      </button>
    `).join("")}
  `).join("");
  container.querySelectorAll(".dfmStartupMethod").forEach((button) => {
    button.addEventListener("click", () => {
      container.querySelectorAll(".dfmStartupMethod").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      const className = button.dataset.methodClass || "";
      const index = Number.parseInt(button.dataset.methodIndex || "-1", 10);
      const method = byClass.get(className)?.[index] || null;
      onSelect(method);
    });
  });
}

export async function openDfmStartupChooser(options = {}) {
  ensureStyles();
  const current = getCurrentDfmObjectSnapshot();
  const last = await getLastDfmObjectSnapshot(current.project);
  let mode = last?.methodName ? "continue" : "existing";
  let selectedMethod = null;
  let loadedProject = "";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dfmStartupOverlay";
    overlay.innerHTML = `
      <div class="dfmStartupWindow" role="dialog" aria-modal="true" aria-labelledby="dfmStartupTitle">
        <div class="dfmStartupHeader" id="dfmStartupTitle">Open DFM Object</div>
        <div class="dfmStartupBody">
          <div class="dfmStartupChoices">
            <button class="dfmStartupChoice" type="button" data-mode="continue">
              <strong>Continue</strong>
              <span>${last?.methodName ? escapeHtml(`${last.project || "-"} > ${last.reservingClass || "-"} > ${last.methodName}`) : "No last DFM object is available."}</span>
            </button>
            <button class="dfmStartupChoice" type="button" data-mode="existing">
              <strong>Select Existing</strong>
              <span>Browse cached DFM objects from a project methods folder.</span>
            </button>
            <button class="dfmStartupChoice" type="button" data-mode="new">
              <strong>Create New</strong>
              <span>Use the last project and reserving class, then start with blank object fields.</span>
            </button>
          </div>
          <div class="dfmStartupPanel" data-panel="continue"></div>
          <div class="dfmStartupPanel" data-panel="existing" style="display:none;">
            <div class="dfmStartupRow">
              <label for="dfmStartupProject">Project</label>
              <input id="dfmStartupProject" value="${escapeHtml(last?.project || current.project || "")}" />
              <button class="dfmStartupBtn" type="button" data-action="load-index">Load</button>
              <button class="dfmStartupBtn" type="button" data-action="refresh-index">Refresh</button>
            </div>
            <div class="dfmStartupTree" data-role="method-tree"></div>
            <div class="dfmStartupStatus" data-role="existing-status"></div>
          </div>
          <div class="dfmStartupPanel" data-panel="new" style="display:none;">
            <div class="dfmStartupRow">
              <label>Project</label>
              <input data-role="new-project" value="${escapeHtml(last?.project || current.project || "")}" />
            </div>
            <div class="dfmStartupRow">
              <label>Class</label>
              <input data-role="new-class" value="${escapeHtml(last?.reservingClass || current.reservingClass || "")}" />
            </div>
          </div>
        </div>
        <div class="dfmStartupActions">
          <button class="dfmStartupBtn primary" type="button" data-action="open">Open</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const buttons = overlay.querySelectorAll(".dfmStartupChoice");
    const status = overlay.querySelector("[data-role='existing-status']");
    const tree = overlay.querySelector("[data-role='method-tree']");
    const projectInput = overlay.querySelector("#dfmStartupProject");
    const openBtn = overlay.querySelector("[data-action='open']");

    const renderMode = () => {
      buttons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("active", active);
        button.disabled = button.dataset.mode === "continue" && !last?.methodName;
      });
      overlay.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.style.display = panel.dataset.panel === mode ? "" : "none";
      });
    };

    const loadIndex = async (refresh = false) => {
      const projectName = String(projectInput?.value || "").trim();
      selectedMethod = null;
      if (!projectName) {
        status.textContent = "Project is required.";
        tree.innerHTML = "";
        return;
      }
      status.textContent = refresh ? "Refreshing index..." : "Loading index...";
      try {
        const data = await fetchIndex(projectName, refresh);
        loadedProject = String(data?.project || projectName);
        renderMethodTree(tree, data?.methods || [], (method) => {
          selectedMethod = method;
          status.textContent = method ? `${method.reservingClass} > ${method.methodName}` : "";
        });
        status.textContent = data?.methods?.length
          ? `${data.methods.length} DFM object${data.methods.length === 1 ? "" : "s"} indexed.`
          : "No DFM objects found.";
      } catch (err) {
        status.textContent = String(err?.message || err || "Could not load DFM method index.");
        tree.innerHTML = "";
      }
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.mode === "continue" && !last?.methodName) return;
        mode = button.dataset.mode || mode;
        renderMode();
        if (mode === "existing" && !loadedProject) void loadIndex(false);
      });
    });

    overlay.querySelector("[data-action='load-index']")?.addEventListener("click", () => loadIndex(false));
    overlay.querySelector("[data-action='refresh-index']")?.addEventListener("click", () => loadIndex(true));
    projectInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void loadIndex(false);
    });
    projectInput?.addEventListener("input", () => {
      selectedMethod = null;
      loadedProject = "";
      tree.innerHTML = "";
      status.textContent = "";
    });

    openBtn?.addEventListener("click", () => {
      if (mode === "continue" && last?.methodName) {
        const applied = applySnapshot(last);
        overlay.remove();
        resolve({ action: "load", snapshot: applied });
        return;
      }
      if (mode === "existing") {
        if (!selectedMethod) {
          status.textContent = "Select a DFM object first.";
          return;
        }
        const applied = applySnapshot(methodToSnapshot(selectedMethod));
        overlay.remove();
        resolve({ action: "load", snapshot: applied });
        return;
      }
      const newProject = overlay.querySelector("[data-role='new-project']")?.value || last?.project || current.project || "";
      const newClass = overlay.querySelector("[data-role='new-class']")?.value || last?.reservingClass || current.reservingClass || "";
      const applied = applySnapshot({
        project: newProject,
        reservingClass: newClass,
        methodName: "",
        outputVector: "",
        inputTriangle: "",
        originLength: 12,
        developmentLength: 12,
        decimalPlaces: 4,
      }, { record: false });
      overlay.remove();
      resolve({ action: "new", snapshot: applied });
    });

    renderMode();
    if (mode === "existing") void loadIndex(false);
  }).then((result) => {
    if (result?.action === "load" && typeof options.onLoad === "function") {
      options.onLoad(result.snapshot);
    }
    if (result?.action === "new" && typeof options.onNew === "function") {
      options.onNew(result.snapshot);
    }
    return result;
  });
}
