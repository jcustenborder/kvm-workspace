"use strict";

/** @typedef {{id: string, name: string, lan: string, tailnet: string}} Device */
/** @typedef {{id: string, deviceId: string, name: string, endpoint: string}} Session */
/**
 * @typedef {object} WorkspaceAPI
 * @property {() => Promise<{devices: Device[], sessions: Session[]}>} list
 * @property {(device: Device) => Promise<void>} save
 * @property {(id: string) => Promise<void>} remove
 * @property {(id: string, route: 'lan' | 'tailnet') => Promise<void>} open
 * @property {(sessionId: string) => Promise<void>} focus
 * @property {(callback: () => void) => (() => void) | void} [onChanged]
 */

const workspace = /** @type {Window & {workspace: WorkspaceAPI}} */ (window).workspace;

/**
 * @template {HTMLElement} T
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T}
 */
function get(selector, root = document) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing workspace UI element: ${selector}`);
  return /** @type {T} */ (element);
}

const deviceList = get("#device-list");
const sessionList = get("#session-list");
const emptyState = get("#empty-state");
const loading = get("#loading");
const appError = get("#app-error");
const announcement = get("#announcement");
const addButton = /** @type {HTMLButtonElement} */ (get("#add-device"));
const deviceTemplate = /** @type {HTMLTemplateElement} */ (get("#device-template"));
const sessionTemplate = /** @type {HTMLTemplateElement} */ (get("#session-template"));
const deviceDialog = /** @type {HTMLDialogElement} */ (get("#device-dialog"));
const deviceForm = /** @type {HTMLFormElement} */ (get("#device-form"));
const deviceFields = /** @type {HTMLFieldSetElement} */ (get("#device-fields"));
const nameInput = /** @type {HTMLInputElement} */ (get("#device-name"));
const lanInput = /** @type {HTMLInputElement} */ (get("#device-lan"));
const tailnetInput = /** @type {HTMLInputElement} */ (get("#device-tailnet"));
const saveButton = /** @type {HTMLButtonElement} */ (get("#save-device"));
const cancelDevice = /** @type {HTMLButtonElement} */ (get("#cancel-device"));
const deviceError = get("#device-error");
const removeDialog = /** @type {HTMLDialogElement} */ (get("#remove-dialog"));
const removeError = get("#remove-error");
const cancelRemove = /** @type {HTMLButtonElement} */ (get("#cancel-remove"));
const confirmRemove = /** @type {HTMLButtonElement} */ (get("#confirm-remove"));

/** @type {string | null} */
let editingId = null;
/** @type {Device | null} */
let removalDevice = null;
let saving = false;
let removing = false;
let refreshVersion = 0;
let hasLoaded = false;

/** @param {unknown} error */
function showError(error) {
  appError.textContent = error instanceof Error ? error.message : String(error);
  appError.hidden = false;
}

function clearError() {
  appError.hidden = true;
  appError.textContent = "";
  announcement.textContent = "";
}

/**
 * @param {HTMLButtonElement} button
 * @param {() => Promise<void>} action
 * @param {string} message
 */
async function runAction(button, action, message) {
  if (button.disabled) return;
  clearError();
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await action();
    announcement.textContent = message;
    await refresh();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

/** @param {Device} device */
function deviceRow(device) {
  const row = /** @type {HTMLLIElement} */ (deviceTemplate.content.firstElementChild.cloneNode(true));
  get(".device-name", row).textContent = device.name;
  for (const route of /** @type {const} */ (["lan", "tailnet"])) {
    const address = get(`[data-address="${route}"]`, row);
    address.textContent = device[route] || "Not set";
    address.classList.toggle("unset", !device[route]);
    const button = /** @type {HTMLButtonElement} */ (get(`[data-route="${route}"]`, row));
    button.disabled = !device[route];
    button.setAttribute("aria-label", `Open ${route === "lan" ? "LAN" : "Tailnet"} for ${device.name}`);
    button.dataset.focus = `device:${device.id}:${route}`;
    button.addEventListener("click", () => {
      void runAction(button, () => workspace.open(device.id, route), `Opened ${device.name} over ${route === "lan" ? "LAN" : "tailnet"}.`);
    });
  }
  const edit = get('[data-action="edit"]', row);
  edit.setAttribute("aria-label", `Edit ${device.name}`);
  edit.dataset.focus = `device:${device.id}:edit`;
  edit.addEventListener("click", () => showEditor(device));
  const remove = get('[data-action="remove"]', row);
  remove.setAttribute("aria-label", `Remove ${device.name}`);
  remove.dataset.focus = `device:${device.id}:remove`;
  remove.addEventListener("click", () => showRemoval(device));
  return row;
}

/** @param {Session} session */
function sessionRow(session) {
  const row = /** @type {HTMLLIElement} */ (sessionTemplate.content.firstElementChild.cloneNode(true));
  get(".session-name", row).textContent = session.name;
  get(".session-endpoint", row).textContent = session.endpoint;
  const button = /** @type {HTMLButtonElement} */ (get("button", row));
  button.setAttribute("aria-label", `Focus window for ${session.name} at ${session.endpoint}`);
  button.dataset.focus = `session:${session.id}`;
  button.addEventListener("click", () => {
    void runAction(button, () => workspace.focus(session.id), `Focused ${session.name}.`);
  });
  return row;
}

async function refresh() {
  const version = ++refreshVersion;
  get("#devices-section").setAttribute("aria-busy", "true");
  get("#sessions-section").setAttribute("aria-busy", "true");
  try {
    const { devices, sessions } = await workspace.list();
    if (version !== refreshVersion) return;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.focus : undefined;
    deviceList.replaceChildren(...devices.map(deviceRow));
    sessionList.replaceChildren(...sessions.map(sessionRow));
    get("#device-count").textContent = String(devices.length);
    get("#session-count").textContent = String(sessions.length);
    emptyState.hidden = devices.length !== 0;
    deviceList.hidden = devices.length === 0;
    sessionList.hidden = sessions.length === 0;
    get("#sessions-empty").hidden = sessions.length !== 0;
    loading.hidden = true;
    hasLoaded = true;
    if (focusKey) {
      let target = addButton;
      for (const button of document.querySelectorAll("button[data-focus]")) {
        if (/** @type {HTMLButtonElement} */ (button).dataset.focus === focusKey) {
          target = /** @type {HTMLButtonElement} */ (button);
          break;
        }
      }
      target.focus();
    }
  } finally {
    if (version === refreshVersion) {
      get("#devices-section").setAttribute("aria-busy", "false");
      get("#sessions-section").setAttribute("aria-busy", "false");
      if (!hasLoaded) loading.textContent = "Workspace unavailable. Try Refresh.";
    }
  }
}

function requestRefresh() {
  void refresh().catch(showError);
}

/** @param {Device | null} [device] */
function showEditor(device = null) {
  editingId = device?.id ?? null;
  deviceForm.reset();
  nameInput.value = device?.name ?? "";
  lanInput.value = device?.lan ?? "";
  tailnetInput.value = device?.tailnet ?? "";
  get("#device-dialog-title").textContent = device ? "Edit KVM" : "Add KVM";
  saveButton.textContent = device ? "Save changes" : "Add KVM";
  deviceError.hidden = true;
  deviceError.textContent = "";
  deviceDialog.showModal();
  nameInput.focus();
}

/** @param {SubmitEvent} event */
async function saveDevice(event) {
  event.preventDefault();
  if (saving) return;
  const device = {
    id: editingId ?? crypto.randomUUID(),
    name: nameInput.value.trim(),
    lan: lanInput.value.trim(),
    tailnet: tailnetInput.value.trim(),
  };
  saving = true;
  deviceFields.disabled = saveButton.disabled = cancelDevice.disabled = true;
  deviceForm.setAttribute("aria-busy", "true");
  deviceError.hidden = true;
  clearError();
  try {
    await workspace.save(device);
    deviceDialog.close();
    announcement.textContent = `${device.name} saved.`;
  } catch (error) {
    deviceError.textContent = error instanceof Error ? error.message : String(error);
    deviceError.hidden = false;
    deviceError.focus();
    return;
  } finally {
    saving = false;
    deviceFields.disabled = saveButton.disabled = cancelDevice.disabled = false;
    deviceForm.setAttribute("aria-busy", "false");
  }
  await refresh().catch(showError);
  addButton.focus();
}

/** @param {Device} device */
function showRemoval(device) {
  removalDevice = device;
  get("#remove-message").textContent = `Remove “${device.name}” from your saved devices?`;
  removeError.hidden = true;
  removeError.textContent = "";
  removeDialog.showModal();
  cancelRemove.focus();
}

/** @param {SubmitEvent} event */
async function removeDevice(event) {
  event.preventDefault();
  if (removing || !removalDevice) return;
  const device = removalDevice;
  removing = true;
  confirmRemove.disabled = cancelRemove.disabled = true;
  get("#remove-form").setAttribute("aria-busy", "true");
  removeError.hidden = true;
  clearError();
  try {
    await workspace.remove(device.id);
    removeDialog.close();
    announcement.textContent = `${device.name} removed.`;
  } catch (error) {
    removeError.textContent = error instanceof Error ? error.message : String(error);
    removeError.hidden = false;
    removeError.focus();
    return;
  } finally {
    removing = false;
    confirmRemove.disabled = cancelRemove.disabled = false;
    get("#remove-form").setAttribute("aria-busy", "false");
  }
  await refresh().catch(showError);
  addButton.focus();
}

addButton.addEventListener("click", () => showEditor());
get("#add-first-device").addEventListener("click", () => showEditor());
get("#refresh").addEventListener("click", () => { clearError(); requestRefresh(); });
deviceForm.addEventListener("submit", saveDevice);
get("#remove-form").addEventListener("submit", removeDevice);
cancelDevice.addEventListener("click", () => deviceDialog.close());
cancelRemove.addEventListener("click", () => removeDialog.close());
deviceDialog.addEventListener("cancel", (/** @type {Event} */ event) => { if (saving) event.preventDefault(); });
removeDialog.addEventListener("cancel", (/** @type {Event} */ event) => { if (removing) event.preventDefault(); });

if (typeof workspace?.onChanged === "function") {
  const unsubscribe = workspace.onChanged(requestRefresh);
  if (typeof unsubscribe === "function") window.addEventListener("pagehide", unsubscribe, { once: true });
}
requestRefresh();
