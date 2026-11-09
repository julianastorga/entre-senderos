import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { validateContacts, DEFAULT_CONTACTS } from "./contact-model.mjs";

const key = "writing-contact-settings:v1";
let version;

export async function loadContacts() {
  if (!CLOUD_MODE) return validateContacts(JSON.parse(localStorage.getItem(key) || JSON.stringify(DEFAULT_CONTACTS)));
  const result = await apiRequest("settings/contacts");
  version = result.version;
  return validateContacts(result.value);
}

export function contactsVersion() { return version; }

export async function saveContacts(input, expectedVersion = version) {
  const contacts = validateContacts(input);
  if (CLOUD_MODE) {
    const result = await apiRequest("settings/contacts", { method: "PUT", body: contacts, headers: { "If-Match": expectedVersion } });
    version = result.version;
  } else localStorage.setItem(key, JSON.stringify(contacts));
  window.dispatchEvent(new Event("contacts-changed"));
  return contacts;
}
