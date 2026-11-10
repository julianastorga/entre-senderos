import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { flattenInstances } from "./catalog-model.mjs";
import { ENROLLMENT_STATUSES, groupEnrollments, validateEnrollmentContact, validatePaymentMethod } from "./enrollment-model.mjs";
import { publicationDate } from "./editorial-model.mjs";
import { activeAndUpcomingEditions, formatDate, sessionDates } from "./workshops.mjs";
import { initPhoneInput, validatePhone } from "./assets/phone-input.js";
import { beginLoading } from "./loading.mjs";

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function paymentVisibility(form) {
  const method = form.elements.paymentMethod;
  method.required = form.elements.status.value === "confirmed";
  form.querySelector("[data-payment-field]").hidden = !method.required && !method.value.trim();
}

export async function createEnrollmentAdmin() {
  const panel = document.querySelector("#enrollments-admin");
  if (!panel) return;
  panel.innerHTML = `
    <div class="section-heading"><h2>Inscripciones y contactos</h2><button id="reload-enrollments" class="button button-outline" type="button">Actualizar inscripciones</button></div>
    <p>Datos privados, agrupados por ediciones activas y próximas. Las solicitudes anteriores y de servicios se conservan aparte. Los cambios no envían mensajes ni realizan cobros.</p>
    <details id="manual-enrollment" class="form-panel manual-enrollment"><summary>Añadir participante a una edición</summary>
    <form id="manual-enrollment-form"><fieldset disabled><legend class="sr-only">Inscripción manual</legend>
    <div class="field"><label for="manual-course">Edición *</label><select id="manual-course" name="course" required><option value="">Elige una edición</option></select></div>
    <div class="form-row"><div class="field"><label for="manual-name">Nombre *</label><input id="manual-name" name="name" required maxlength="100" autocomplete="off"></div><div class="field"><label for="manual-email">Correo electrónico *</label><input id="manual-email" name="email" type="email" required maxlength="254" autocomplete="off"></div></div>
    <div class="form-row"><div class="field"><label for="manual-phone-country">País del teléfono *</label><select id="manual-phone-country" name="phoneCountry" required><option value="CR">Costa Rica (+506)</option></select></div><div class="field"><label for="manual-phone">Teléfono *</label><input id="manual-phone" name="phone" type="tel" required maxlength="40" autocomplete="off" aria-describedby="manual-phone-error"><span id="manual-phone-error" class="field-error" data-phone-error></span></div></div>
    <div class="field"><label for="manual-status">Estado de la inscripción</label><select id="manual-status" name="status"></select></div>
    <div class="field" data-payment-field hidden><label for="manual-payment">Medio de pago recibido *</label><input id="manual-payment" name="paymentMethod" maxlength="100" aria-describedby="manual-payment-help"><p id="manual-payment-help" class="field-hint">Por ejemplo: SINPE Móvil, transferencia o efectivo. No registres números de tarjeta, cuentas ni otros datos bancarios.</p></div>
    <div class="field"><label for="manual-message">Notas de la solicitud (opcional)</label><textarea id="manual-message" name="message" rows="3" maxlength="2000"></textarea></div>
    <label class="checkbox-label"><input name="consent" type="checkbox" required><span>Confirmo que cuento con autorización para registrar estos datos de contacto. Esto no suscribe a la persona al boletín.</span></label>
    <div class="button-row"><button class="button" type="submit">Añadir participante</button><button class="button button-outline" type="reset">Limpiar formulario</button></div>
    </fieldset><p id="manual-enrollment-status" class="form-status" role="status" aria-live="polite"></p></form></details>
    <p id="enrollments-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="enrollment-list" class="enrollment-groups"></div>
    <button id="more-enrollments" class="button button-outline" type="button" hidden>Cargar más inscripciones</button>`;
  const list = panel.querySelector("#enrollment-list");
  const status = panel.querySelector("#enrollments-status");
  const reload = panel.querySelector("#reload-enrollments");
  const more = panel.querySelector("#more-enrollments");
  const manual = panel.querySelector("#manual-enrollment-form");
  const manualFields = manual.querySelector("fieldset");
  const manualStatus = panel.querySelector("#manual-enrollment-status");
  if (!CLOUD_MODE) {
    status.textContent = "Las inscripciones privadas están disponibles con una sesión administradora en el sitio alojado. La vista previa local no guarda contactos.";
    reload.disabled = true;
    panel.querySelector("#manual-enrollment").hidden = true;
    return;
  }
  initPhoneInput(manual);
  for (const [key, name] of Object.entries(ENROLLMENT_STATUSES)) manual.elements.status.add(new Option(name, key));
  manual.addEventListener("change", () => paymentVisibility(manual));
  const records = new Map();
  const cards = new Map();
  let workshops = [];
  let token = null;
  let loaded = false;
  let loading = false;
  let saving = 0;
  let manualId = `${new Date().toISOString()}-${crypto.randomUUID()}`;
  manual.addEventListener("reset", () => {
    manualId = `${new Date().toISOString()}-${crypto.randomUUID()}`;
    queueMicrotask(() => paymentVisibility(manual));
  });
  function controls() {
    reload.disabled = loading || saving > 0;
    more.disabled = loading || saving > 0;
    manualFields.disabled = !loaded || loading || saving > 0;
  }
  function editionOptions(select, selected, current = "") {
    const active = activeAndUpcomingEditions(workshops);
    const activeIds = new Set(active.map(({ id }) => id));
    const previous = workshops.filter(({ id }) => !activeIds.has(id));
    select.replaceChildren(new Option("Elige una edición", ""));
    if (current && !workshops.some(({ id }) => id === current)) select.add(new Option("Conservar solicitud actual", current));
    for (const [label, editions] of [["Activas y próximas", active], ["Ediciones anteriores", previous]]) {
      if (!editions.length) continue;
      const group = el("optgroup");
      group.label = label;
      for (const instance of editions) group.append(new Option(`${instance.name} · ${instance.code} · ${formatDate(instance.startDate)}`, instance.id));
      select.append(group);
    }
    if (selected && ![...select.options].some(({ value }) => value === selected)) select.add(new Option("Edición seleccionada no disponible", selected));
    select.value = selected;
  }
  function dirty() {
    return [...list.querySelectorAll("form")].some((form) => {
      const value = records.get(form.dataset.enrollmentId).value;
      return form.elements.status.value !== value.status || form.elements.paymentMethod.value !== (value.paymentMethod || "") ||
        form.elements.course.value !== (value.course || "");
    });
  }
  function manualDirty() {
    return ["name", "email", "phone", "course", "message", "paymentMethod"].some((key) => manual.elements[key].value !== "") ||
      manual.elements.consent.checked || manual.elements.status.value !== "interested" || manual.elements.phoneCountry.value !== "CR";
  }
  function render() {
    const groups = groupEnrollments([...records.values()], workshops);
    const sections = [];
    function section(heading, summary, members, editionId) {
      const group = el("section", undefined, "enrollment-group");
      if (editionId) group.dataset.editionId = editionId;
      group.append(el("h3", heading), el("p", summary, "small-print"));
      const entries = el("div", undefined, "enrollment-list");
      for (const record of members) {
        if (!cards.has(record.id)) cards.set(record.id, card(record));
        entries.append(cards.get(record.id));
      }
      if (!members.length) entries.append(el("p", "No hay participantes entre las solicitudes cargadas.", "empty-state"));
      group.append(entries);
      sections.push(group);
    }
    for (const group of groups.editions) {
      const instance = group.instance;
      section(`${instance.name} · ${instance.code}`, `${group.active ? "Activa" : "Próxima"} · ${formatDate(instance.startDate)} – ${formatDate(sessionDates(instance).at(-1))} · ${group.records.length} solicitudes cargadas`, group.records, instance.id);
    }
    if (groups.other.length) section("Ediciones anteriores y otras solicitudes", `${groups.other.length} solicitudes cargadas de ediciones finalizadas o eliminadas, servicios y orientación.`, groups.other);
    if (!sections.length) sections.push(el("p", "Todavía no hay ediciones ni solicitudes de inscripción.", "empty-state"));
    list.replaceChildren(...sections);
    more.hidden = !token;
    status.textContent = `${records.size} solicitudes cargadas${token ? ". Hay más solicitudes: carga las siguientes páginas para completar los grupos." : "."} Solo la administración puede ver estos contactos.`;
  }
  function card(record, message = "") {
    const value = record.value;
    const item = el("article", undefined, "saved-text enrollment-card");
    const heading = el("h4", value.name);
    heading.id = `enrollment-${record.id}`;
    item.setAttribute("aria-labelledby", heading.id);
    const offering = value.workshopName || value.serviceName || (value.course === "orientacion" ? "Solicitud de orientación" : value.course);
    item.append(heading, el("p", `${offering}${value.editionCode ? ` · ${value.editionCode}` : ""}${value.startDate ? ` · ${formatDate(value.startDate)}` : ""}`));
    item.append(el("p", `Recibida: ${publicationDate(value.createdAt)}${value.source === "admin" ? " · Añadida por administración" : ""}`, "small-print"));
    if (value.originalAssignment) {
      const original = value.originalAssignment;
      item.append(el("p", `Solicitud original: ${original.workshopName || original.serviceName || original.course}${original.editionCode ? ` · ${original.editionCode}` : ""}`, "small-print"));
    }
    const contact = el("div", undefined, "enrollment-contact");
    const email = el("a", value.email);
    email.href = `mailto:${encodeURIComponent(value.email)}`;
    email.setAttribute("aria-label", `Escribir a ${value.name}: ${value.email}`);
    contact.append(email);
    if (value.phone) {
      if (/^\+[1-9]\d{6,14}$/u.test(value.phone)) {
        const phone = el("a", value.phone);
        phone.href = `https://wa.me/${value.phone.slice(1)}`;
        phone.target = "_blank";
        phone.rel = "noopener noreferrer";
        phone.setAttribute("aria-label", `Abrir WhatsApp con ${value.name}: ${value.phone}`);
        contact.append(phone);
      } else contact.append(el("p", `Teléfono sin formato internacional válido: ${value.phone}`));
    } else contact.append(el("p", "Teléfono no facilitado en esta solicitud anterior.", "small-print"));
    item.append(contact);
    if (value.message) item.append(el("p", value.message, "enrollment-message"));
    const form = el("form");
    form.dataset.enrollmentId = record.id;
    const fields = el("fieldset");
    fields.append(el("legend", `Gestión de la inscripción de ${value.name}`, "sr-only"));
    function field(name, labelText, input) {
      const container = el("div", undefined, "field");
      const label = el("label", labelText);
      input.id = `enrollment-${name}-${record.id}`;
      input.name = name;
      label.htmlFor = input.id;
      container.append(label, input);
      fields.append(container);
      return container;
    }
    const select = el("select");
    for (const [key, name] of Object.entries(ENROLLMENT_STATUSES)) select.add(new Option(name, key));
    select.value = value.status;
    field("status", "Estado de la inscripción", select);
    const payment = el("input");
    payment.maxLength = 100;
    payment.value = value.paymentMethod || "";
    const paymentField = field("paymentMethod", "Medio de pago recibido", payment);
    paymentField.dataset.paymentField = "";
    const help = el("p", "Por ejemplo: SINPE Móvil, transferencia o efectivo. No incluyas datos bancarios.", "field-hint");
    help.id = `enrollment-payment-help-${record.id}`;
    payment.setAttribute("aria-describedby", help.id);
    paymentField.append(help);
    const assignment = el("select");
    editionOptions(assignment, value.course || "", value.course);
    field("course", "Edición asignada / mover a otra edición", assignment);
    const save = el("button", "Guardar inscripción", "button button-outline");
    save.type = "submit";
    save.setAttribute("aria-label", `Guardar inscripción de ${value.name}`);
    const output = el("p", message || (value.updatedAt ? `Actualizada: ${publicationDate(value.updatedAt)}` : ""), "form-status");
    output.setAttribute("role", "status");
    output.setAttribute("aria-live", "polite");
    fields.append(save);
    form.append(fields, output);
    form.addEventListener("change", () => paymentVisibility(form));
    paymentVisibility(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (assignment.value !== value.course && !confirm(`¿Mover a ${value.name} a «${assignment.selectedOptions[0].textContent}»? Se conservarán su contacto, estado y medio de pago.`)) return;
      fields.disabled = true;
      saving += 1;
      controls();
      try {
        const result = await apiRequest(`enrollments?id=${encodeURIComponent(record.id)}`, {
          method: "PUT", body: { status: select.value, paymentMethod: payment.value, ...(assignment.value !== value.course ? { course: assignment.value } : {}) },
          headers: { "If-Match": record.version },
        });
        record.value = result.value;
        record.version = result.version;
        const updated = card(record, `Inscripción guardada: ${ENROLLMENT_STATUSES[result.value.status]}.`);
        cards.set(record.id, updated);
        render();
        updated.querySelector('[type="submit"]').focus();
      } catch (error) {
        output.textContent = `No se guardó la inscripción. ${error.message}${error.status === 409 ? " Actualiza las inscripciones antes de reintentar." : ""}`;
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
      const [page, catalog] = await Promise.all([
        apiRequest(`enrollments${append && token ? `?continuationToken=${encodeURIComponent(token)}` : ""}`),
        apiRequest("catalog"),
      ]);
      workshops = flattenInstances(catalog.value);
      editionOptions(manual.elements.course, manual.elements.course.value);
      if (!append) records.clear();
      for (const record of page.value.items) records.set(record.id, record);
      token = page.value.continuationToken;
      cards.clear();
      render();
      loaded = true;
    } catch (error) {
      status.textContent = `No se cargaron las inscripciones. ${error.message} No se modificaron los datos.`;
    } finally {
      finish();
      loading = false;
      list.inert = false;
      controls();
    }
  }
  manual.addEventListener("submit", async (event) => {
    event.preventDefault();
    let body;
    try {
      body = { ...validateEnrollmentContact(Object.fromEntries(new FormData(manual))),
        ...validatePhone({ phone: manual.elements.phone.value, phoneCountry: manual.elements.phoneCountry.value }),
        status: manual.elements.status.value, paymentMethod: validatePaymentMethod(manual.elements.paymentMethod.value, manual.elements.status.value),
        course: manual.elements.course.value, consent: manual.elements.consent.checked, id: manualId };
    } catch (error) {
      manualStatus.textContent = `No se añadió la persona. ${error.message}`;
      return;
    }
    saving += 1;
    controls();
    try {
      const result = await apiRequest("enrollments", { method: "POST", body });
      records.set(result.value.id, { id: result.value.id, value: result.value.value, version: result.version });
      manual.reset();
      render();
      manualStatus.textContent = "Participante añadido a la edición. No se enviaron mensajes ni se realizó ningún cobro.";
    } catch (error) {
      manualStatus.textContent = `No se confirmó el alta. ${error.message}${error.status === 409 ? " Actualiza las inscripciones para comprobar si ya se guardó; no se duplicó el registro." : ""}`;
    } finally {
      saving -= 1;
      controls();
    }
  });
  reload.addEventListener("click", () => {
    if (dirty() && !confirm("¿Descartar los cambios de inscripciones sin guardar y actualizar?")) return;
    load();
  });
  more.addEventListener("click", () => {
    if (dirty() && !confirm("¿Descartar los cambios de inscripciones sin guardar y cargar más?")) return;
    load(true);
  });
  window.addEventListener("content-changed", () => {
    if (loading || saving) return;
    if (dirty() || manualDirty()) status.textContent = "El catálogo cambió. Guarda tus cambios y actualiza las inscripciones para ver las nuevas ediciones.";
    else load();
  });
  await load();
}
