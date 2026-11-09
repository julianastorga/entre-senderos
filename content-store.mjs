import { CLOUD_MODE } from "./app-config.mjs";
import { saveCatalog, loadCatalog } from "./catalog-model.mjs";
import { SHOWCASE_KEY, saveShowcase, loadShowcase } from "./featured-text.mjs";

const cache = new Map();
const memoryStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
export const contentStorage = CLOUD_MODE ? memoryStorage : window.localStorage;
export const storageLocation = CLOUD_MODE ? "en Azure, para todas las personas que visitan el sitio" : "en este navegador";
const versions = {};
const channel = CLOUD_MODE && "BroadcastChannel" in window ? new BroadcastChannel("entre-senderos-content") : null;
channel?.addEventListener("message", () => window.dispatchEvent(new Event("content-changed")));

export async function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("El servicio no respondió correctamente. Si administras el sitio, vuelve a iniciar sesión con una cuenta autorizada.");
  }
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "No se pudo completar la solicitud.");
    error.status = response.status;
    throw error;
  }
  return { value, version: response.headers.get("etag") };
}

export async function refreshCatalog() {
  if (!CLOUD_MODE) return;
  const { value, version } = await apiRequest("catalog");
  saveCatalog(memoryStorage, value);
  versions.catalog = version;
}

export async function refreshShowcase() {
  if (!CLOUD_MODE) return;
  const { value, version } = await apiRequest("showcase");
  saveShowcase(memoryStorage, value.texts);
  versions.showcase = version;
}

function notify() {
  channel?.postMessage("updated");
  window.dispatchEvent(new Event("content-changed"));
}

export async function persistCatalog(catalog) {
  if (!CLOUD_MODE) return saveCatalog(contentStorage, catalog);
  const { value, version } = await apiRequest("catalog", {
    method: "PUT", body: catalog, headers: { "If-Match": versions.catalog },
  });
  saveCatalog(memoryStorage, value);
  versions.catalog = version;
  notify();
  return loadCatalog(memoryStorage);
}

export async function persistShowcase(texts) {
  if (!CLOUD_MODE) return saveShowcase(contentStorage, texts);
  const { value, version } = await apiRequest("showcase", {
    method: "PUT", body: { version: 1, texts }, headers: { "If-Match": versions.showcase },
  });
  saveShowcase(memoryStorage, value.texts);
  versions.showcase = version;
  notify();
  return loadShowcase(memoryStorage);
}
