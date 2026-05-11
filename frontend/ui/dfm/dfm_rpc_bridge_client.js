import {
  getDfmIsDirty,
  getEffectiveDevLabelsForModel,
  getRatioHeaderLabels,
  state,
} from "/ui/dfm/dfm_state.js";
import { applyDfmMethodPayload, saveRatioSelectionPattern } from "/ui/dfm/dfm_persistence.js";
import {
  createDfmRpcBridgeDialog,
  createDfmRpcBridgeMessageBox,
} from "/ui/dfm/dfm_rpc_bridge_dialog.js";

let syncInFlight = false;

function textValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function numberValue(id, fallback) {
  const raw = Number.parseInt(textValue(id), 10);
  return Number.isFinite(raw) ? raw : fallback;
}

function buildRequestPayload() {
  return {
    project_name: textValue("projectSelect"),
    reserving_class: textValue("pathInput"),
    method_name: textValue("dfmMethodName"),
    output_vector: textValue("dfmOutputVector"),
    input_triangle: textValue("triInput"),
    origin_length: numberValue("originLenSelect", 12),
    development_length: numberValue("devLenSelect", 12),
    decimal_places: numberValue("decimalPlaces", 4),
    timeout_sec: 8.0,
  };
}

function validatePayload(payload) {
  const missing = [];
  if (!payload.project_name) missing.push("Project");
  if (!payload.reserving_class) missing.push("Reserving Class");
  if (!payload.method_name) missing.push("Name");
  if (!payload.output_vector) missing.push("Output Vector");
  if (!payload.input_triangle) missing.push("Input Triangle");
  if (!payload.origin_length) missing.push("Origin Length");
  if (!payload.development_length) missing.push("Development Length");
  return missing;
}

async function postJson(url, payload) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.detail || data?.message || `Request failed: ${resp.status}`);
  }
  return data;
}

function postStatus(text, tone = "") {
  window.parent.postMessage({ type: "arcrho:status", text, ...(tone ? { tone } : {}) }, "*");
}

function buildCurrentPatternLabelFallbacks() {
  const model = state?.model || {};
  const originLabels = Array.isArray(model.origin_labels)
    ? model.origin_labels.map((label) => String(label ?? ""))
    : [];
  const developmentLabels = getRatioHeaderLabels(getEffectiveDevLabelsForModel(model))
    .map((label) => String(label ?? ""));
  return {
    origin_labels: originLabels,
    development_labels: developmentLabels,
  };
}

async function ensureSavedBeforeSync(dialog) {
  if (!getDfmIsDirty()) return true;
  const shouldSave = window.confirm("This DFM tab has unsaved edits. Save and proceed with sync?");
  if (!shouldSave) return false;
  dialog.setWaiting("Saving current DFM method before sync...");
  const result = await saveRatioSelectionPattern(false);
  if (!result?.ok) {
    dialog.setMessage(result?.error ? `Save failed: ${result.error}` : "Save was canceled. Sync stopped.", "error");
    return false;
  }
  return true;
}

async function refreshComparison(dialog, payload) {
  dialog.setBusy(true);
  try {
    const data = await postJson("/dfm/rpc-bridge/compare", payload);
    dialog.setComparison(data, {
      labelFallbacks: buildCurrentPatternLabelFallbacks(),
      onRefresh: () => refreshComparison(dialog, payload),
      onPrimary: (action) => runPrimaryAction(dialog, payload, action),
    });
  } catch (err) {
    dialog.setMessage(String(err?.message || err), "error");
  } finally {
    dialog.setBusy(false);
  }
}

async function runPrimaryAction(dialog, payload, action) {
  dialog.setBusy(true);
  const statusDialog = createDfmRpcBridgeMessageBox("Preparing selected DFM version action...");
  statusDialog.setBusy(true);
  dialog.close();
  try {
    if (action === "update-local") {
      statusDialog.setWaiting("Updating local DFM JSON from remote...");
      const data = await postJson("/dfm/rpc-bridge/apply", payload);
      const applied = await applyDfmMethodPayload(data?.payload);
      if (!applied?.ok) {
        statusDialog.setMessage("Updated, but could not reload this tab.", "error");
        postStatus("DFM sync: local JSON updated, but tab apply failed.", "warn");
        return;
      }
      statusDialog.setMessage("Local updated.", "ok");
      postStatus("DFM sync: local DFM JSON updated from remote.");
      return;
    }
    if (action === "keep-local") {
      statusDialog.setWaiting("Keeping local DFM JSON and removing remote RPC JSON...");
      const data = await postJson("/dfm/rpc-bridge/keep-local", payload);
      const message = data?.ok ? "No changes made on local." : (data?.message || "Keep local failed.");
      statusDialog.setMessage(message, data?.ok ? "ok" : "error");
      postStatus(`DFM sync: ${message}`, data?.ok ? "" : "warn");
      return;
    }
    if (action === "update-remote") {
      statusDialog.setWaiting("Sending SyncDFM request and waiting for remote result...");
      const data = await postJson("/dfm/rpc-bridge/update-remote", payload);
      const message = data?.ok ? "Remote database updated" : (data?.message || "Remote update failed.");
      statusDialog.setMessage(message, data?.ok ? "ok" : "error");
      postStatus(`DFM sync: ${message}`, data?.ok ? "" : "warn");
      return;
    }
  } catch (err) {
    statusDialog.setMessage(String(err?.message || err), "error");
    postStatus(`DFM sync failed: ${String(err?.message || err)}`, "warn");
  } finally {
    statusDialog.setBusy(false);
  }
}

export async function startDfmRpcBridgeSync(buttonEl = null) {
  if (syncInFlight) return;
  syncInFlight = true;
  if (buttonEl) buttonEl.disabled = true;
  const dialog = createDfmRpcBridgeDialog();
  dialog.setWaiting("Preparing DFM RPC bridge sync...");
  try {
    const saved = await ensureSavedBeforeSync(dialog);
    if (!saved) return;

    const payload = buildRequestPayload();
    const missing = validatePayload(payload);
    if (missing.length) {
      dialog.setMessage(`Complete these Details fields before syncing: ${missing.join(", ")}.`, "error");
      return;
    }

    dialog.setWaiting("Sending DFM request and waiting for remote JSON...");
    const data = await postJson("/dfm/rpc-bridge/sync", payload);
    if (!data?.ok && data?.status === "timeout") {
      dialog.setMessage("Timed out waiting for remote DFM JSON. Use Refresh if the remote file appears later.", "warn");
      postStatus("DFM sync timed out waiting for remote JSON.", "warn");
      return;
    }
    dialog.setComparison(data, {
      labelFallbacks: buildCurrentPatternLabelFallbacks(),
      onRefresh: () => refreshComparison(dialog, payload),
      onPrimary: (action) => runPrimaryAction(dialog, payload, action),
    });
  } catch (err) {
    dialog.setMessage(String(err?.message || err), "error");
    postStatus(`DFM sync failed: ${String(err?.message || err)}`, "warn");
  } finally {
    syncInFlight = false;
    if (buttonEl) buttonEl.disabled = false;
  }
}
