import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { PAGE_COPY_KEY, DEFAULT_PAGE_COPY, validatePageCopy } from "./page-copy-model.mjs";

const channel = CLOUD_MODE && "BroadcastChannel" in window ? new BroadcastChannel("entre-senderos-page-copy") : null;
channel?.addEventListener("message", () => window.dispatchEvent(new Event("page-copy-changed")));

export async function loadPageCopy() {
  if (CLOUD_MODE) {
    const result = await apiRequest("settings/pages");
    return { ...result, value: validatePageCopy(result.value) };
  }
  const raw = localStorage.getItem(PAGE_COPY_KEY);
  return { value: validatePageCopy(raw === null ? DEFAULT_PAGE_COPY : JSON.parse(raw)), version: raw ?? "initial" };
}

export async function savePageCopy(input, expectedVersion) {
  const value = validatePageCopy(input);
  let saved;
  if (CLOUD_MODE) {
    const result = await apiRequest("settings/pages", { method: "PUT", body: value, headers: { "If-Match": expectedVersion } });
    saved = { ...result, value: validatePageCopy(result.value) };
  } else {
    const current = localStorage.getItem(PAGE_COPY_KEY) ?? "initial";
    if (expectedVersion !== current) {
      const error = new Error("Los textos cambiaron en otra sesión. Recarga antes de guardar.");
      error.status = 409;
      throw error;
    }
    const version = JSON.stringify(value);
    localStorage.setItem(PAGE_COPY_KEY, version);
    saved = { value, version };
  }
  channel?.postMessage("updated");
  window.dispatchEvent(new Event("page-copy-changed"));
  return saved;
}
