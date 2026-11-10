import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { ENROLLMENT_STATUSES } from "./enrollment-model.mjs";
import { publicationDate } from "./editorial-model.mjs";
import { formatDate } from "./workshops.mjs";
import { beginLoading } from "./loading.mjs";

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function createEnrollmentAdmin() {
  const panel = document.querySelector("#enrollments-admin");
  if (!panel) return;
  panel.innerHTML = `
    <div class="section-heading"><h2>Inscripciones y contactos</h2><button id="reload-enrollments" class="button button-outline" type="button">Actualizar inscripciones</button></div>
    <p>Datos privados de las solicitudes de talleres y servicios. Contacta a cada persona y guarda su estado; cambiarlo no envía mensajes ni realiza cobros. Se conservan las solicitudes de ediciones eliminadas.</p>
    <p id="enrollments-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="enrollment-list" class="enrollment-list"></div>
    <button id="more-enrollments" class="button button-outline" type="button" hidden>Cargar más inscripciones</button>`;
  const list = panel.querySelector("#enrollment-list");
  const status = panel.querySelector("#enrollments-status");
  const reload = panel.querySelector("#reload-enrollments");
  const more = panel.querySelector("#more-enrollments");
  if (!CLOUD_MODE) {
    status.textContent = "Las inscripciones privadas y sus estados están disponibles en Azure con una sesión administradora. El formulario local no guarda datos de contacto.";
    reload.disabled = true;
    return;
  }
  const records = new Map();
  let token = null;
  let loaded = false;
  let loading = false;
  let saving = 0;
  function controls() {
    reload.disabled = loading || saving > 0;
    more.disabled = loading || saving > 0;
  }
  function card(record) {
    const value = record.value;
    const item = el("article", undefined, "saved-text enrollment-card");
    const heading = el("h3", value.name);
    heading.id = `enrollment-${record.id}`;
    item.setAttribute("aria-labelledby", heading.id);
    const offering = value.workshopName || value.serviceName || (value.course === "orientacion" ? "Solicitud de orientación" : value.course);
    item.append(heading, el("p", `${offering}${value.editionCode ? ` · ${value.editionCode}` : ""}${value.startDate ? ` · ${formatDate(value.startDate)}` : ""}`));
    item.append(el("p", `Recibida: ${publicationDate(value.createdAt)}`, "small-print"));
    const contact = el("div", undefined, "enrollment-contact");
    const email = el("a", value.email);
    email.href = `mailto:${encodeURIComponent(value.email)}`;
    email.setAttribute("aria-label", `Escribir a ${value.name}: ${value.email}`);
    contact.append(email);
    if (value.phone) {
      if (/^\+[1-9]\d{6,14}$/u.test(value.phone)) {
        const phone = el("a", value.phone);
        phone.href = `tel:${value.phone}`;
        phone.setAttribute("aria-label", `Llamar a ${value.name}: ${value.phone}`);
        contact.append(phone);
      } else contact.append(el("p", `Teléfono sin formato internacional válido: ${value.phone}`));
    } else contact.append(el("p", "Teléfono no facilitado en esta solicitud anterior.", "small-print"));
    item.append(contact);
    if (value.message) item.append(el("p", value.message, "enrollment-message"));
    const form = el("form");
    const fields = el("fieldset");
    fields.append(el("legend", `Estado de la solicitud de ${value.name}`, "sr-only"));
    const field = el("div", undefined, "field");
    const label = el("label", "Estado de la inscripción");
    label.htmlFor = `enrollment-status-${record.id}`;
    const select = el("select");
    select.id = label.htmlFor;
    select.name = "status";
    for (const [key, name] of Object.entries(ENROLLMENT_STATUSES)) select.add(new Option(name, key));
    select.value = value.status;
    field.append(label, select);
    const save = el("button", "Guardar estado", "button button-outline");
    save.type = "submit";
    save.setAttribute("aria-label", `Guardar estado de ${value.name}`);
    const output = el("p", value.updatedAt ? `Estado actualizado: ${publicationDate(value.updatedAt)}` : "", "form-status");
    output.setAttribute("role", "status");
    output.setAttribute("aria-live", "polite");
    fields.append(field, save);
    form.append(fields, output);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      fields.disabled = true;
      saving += 1;
      controls();
      try {
        const result = await apiRequest(`enrollments?id=${encodeURIComponent(record.id)}`, {
          method: "PUT", body: { status: select.value }, headers: { "If-Match": record.version },
        });
        record.value = result.value;
        record.version = result.version;
        select.value = result.value.status;
        output.textContent = `Estado guardado: ${ENROLLMENT_STATUSES[result.value.status]}. ${publicationDate(result.value.updatedAt)}`;
      } catch (error) {
        output.textContent = `No se guardó el estado. ${error.message}${error.status === 409 ? " Actualiza las inscripciones y revisa el estado antes de reintentar." : ""}`;
      } finally {
        fields.disabled = false;
        saving -= 1;
        controls();
      }
    });
    item.append(form);
    return item;
  }
  async function load(append = false) {
    loading = true;
    controls();
    list.inert = true;
    const finish = beginLoading(list, { label: "Cargando inscripciones privadas", count: 2, show: !loaded });
    try {
      const { value } = await apiRequest(`enrollments${append && token ? `?continuationToken=${encodeURIComponent(token)}` : ""}`);
      if (!append) records.clear();
      for (const record of value.items) records.set(record.id, record);
      token = value.continuationToken;
      list.replaceChildren(...[...records.values()].map(card));
      if (!records.size) list.append(el("p", "Todavía no hay solicitudes de inscripción.", "empty-state"));
      more.hidden = !token;
      loaded = true;
      status.textContent = `${records.size} solicitudes cargadas${token ? ". Hay más solicitudes disponibles." : "."} Solo la administración puede ver estos contactos.`;
    } catch (error) {
      status.textContent = `No se cargaron las inscripciones. ${error.message} No se modificaron los datos.`;
    } finally {
      finish();
      loading = false;
      list.inert = false;
      controls();
    }
  }
  reload.addEventListener("click", () => {
    const dirty = [...list.querySelectorAll("select")].some((select) => select.value !== records.get(select.id.slice("enrollment-status-".length))?.value.status);
    if (dirty && !confirm("¿Descartar los estados sin guardar y actualizar las inscripciones?")) return;
    load();
  });
  more.addEventListener("click", () => {
    const dirty = [...list.querySelectorAll("select")].some((select) => select.value !== records.get(select.id.slice("enrollment-status-".length))?.value.status);
    if (dirty && !confirm("¿Descartar los estados sin guardar y cargar más inscripciones?")) return;
    load(true);
  });
  await load();
}
