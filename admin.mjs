import { DEFAULT_WORKSHOPS, validateCatalog, validateWorkshop, sessionDates, formatDate, formatSchedule, formatCadence, parseDate, WORKSHOP_ACCENTS } from "./workshops.mjs";
import { loadCatalog, validateCatalogV2, migrateWorkshops, flattenInstances } from "./catalog-model.mjs";
import { contentStorage, refreshCatalog, persistCatalog, storageLocation } from "./content-store.mjs";
import { createOfferingAdmin } from "./offering-admin.mjs";

export function createAdmin(onSaved) {
  const form = document.querySelector("#workshop-form");
  if (!form) return null;
  const programs = createOfferingAdmin("programs", onSaved);
  const services = createOfferingAdmin("services", onSaved);
  const panel = form.closest('[role="tabpanel"]');
  const status = document.querySelector("#admin-status");
  const preview = document.querySelector("#recurrence-preview");
  const list = document.querySelector("#admin-workshops");
  const title = document.querySelector("#workshop-form-title");
  const cancel = document.querySelector("#cancel-edit");
  const weeklyFields = document.querySelector("#weekly-fields");
  const weekdays = [...form.querySelectorAll('[name="weekday"]')];
  const backupStatus = document.querySelector("#backup-status");
  let editing = null;
  function values() {
    return {
      id: editing?.id || crypto.randomUUID(), programId: form.elements.programId.value,
      code: form.elements.code.value, startDate: form.elements.startDate.value,
      startTime: form.elements.startTime.value, endTime: form.elements.endTime.value,
      cadence: form.elements.cadence.value, sessions: Number(form.elements.sessions.value),
      weekInterval: Number(form.elements.weekInterval.value), weekdays: weekdays.filter((field) => field.checked).map((field) => Number(field.value)),
    };
  }
  function updatePreview() {
    weeklyFields.hidden = form.elements.cadence.value === "monthly";
    weeklyFields.disabled = weeklyFields.hidden;
    try {
      const value = values();
      const dates = sessionDates(value);
      preview.textContent = `${dates.length} encuentros · ${formatCadence(value)} · ${formatDate(dates[0])} – ${formatDate(dates.at(-1))} · ${formatSchedule(value)}`;
    } catch (error) { preview.textContent = error.message; }
  }
  function reset() {
    form.reset(); editing = null; cancel.hidden = true;
    title.textContent = "Crear edición";
    document.querySelector("#save-workshop").textContent = "Guardar edición";
    updatePreview();
  }
  async function latestFor(record) {
    await refreshCatalog();
    const catalog = loadCatalog(contentStorage);
    if (record && JSON.stringify(catalog.instances.find((item) => item.id === record.id)) !== JSON.stringify(record)) {
      const error = new Error("Esta edición cambió en otra sesión. Cancela la edición y vuelve a abrirla.");
      error.status = 409;
      throw error;
    }
    return catalog;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); panel.inert = true;
    try {
      const instance = values();
      const catalog = await latestFor(editing);
      const program = catalog.programs.find((item) => item.id === instance.programId);
      if (!program) throw new Error("Selecciona un taller definido en la pestaña Talleres.");
      validateWorkshop({ ...instance, name: program.name, description: program.description, accent: program.accent }, catalog.instances);
      catalog.instances = editing ? catalog.instances.map((item) => item.id === editing.id ? instance : item) : [...catalog.instances, instance];
      await persistCatalog(catalog);
      reset(); await onSaved();
      status.textContent = `Edición «${instance.code.toUpperCase()}» guardada ${storageLocation}. El calendario y su formulario de inscripción se actualizaron.`;
    } catch (error) {
      if (error.status === 409) await onSaved();
      status.textContent = `No se guardó la edición. ${error.message}`;
    } finally { panel.inert = false; }
  });
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.elements.startDate.addEventListener("change", () => {
    if (!form.elements.startDate.value || weekdays.filter((field) => field.checked).length > 1) return;
    const day = parseDate(form.elements.startDate.value).getUTCDay() || 7;
    weekdays.forEach((field) => { field.checked = Number(field.value) === day; });
    updatePreview();
  });
  cancel.addEventListener("click", () => { reset(); status.textContent = ""; });
  document.querySelector("#export-workshops").addEventListener("click", () => {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(loadCatalog(contentStorage), null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "catalogo.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus.textContent = "Se generó la copia del catálogo: talleres, ediciones y servicios.";
    } catch (error) { backupStatus.textContent = `No se pudo exportar. ${error.message}`; }
  });
  const importer = document.querySelector("#import-workshops");
  importer.addEventListener("change", async () => {
    const file = importer.files[0];
    if (!file) return;
    panel.inert = true;
    try {
      if (file.size > 10_000_000) throw new Error("El archivo supera 10 MB.");
      const data = JSON.parse(await file.text());
      const catalog = data.version === 1 ? migrateWorkshops(validateCatalog(data)) : validateCatalogV2(data);
      if (!confirm(`¿Reemplazar talleres, ediciones y servicios ${storageLocation} por esta copia? Exporta antes para conservar la configuración actual. Las inscripciones y el blog no se modifican.`)) return;
      await refreshCatalog(); await persistCatalog(catalog); reset(); await onSaved();
      backupStatus.textContent = "Catálogo importado.";
    } catch (error) { backupStatus.textContent = `No se importó el catálogo. ${error.message}`; }
    finally { panel.inert = false; importer.value = ""; }
  });
  document.querySelector("#reset-workshops").addEventListener("click", async () => {
    if (!confirm(`¿Reemplazar todos los talleres, ediciones y servicios ${storageLocation} por los cinco talleres y los horarios de ejemplo? Exporta primero. Las solicitudes existentes se conservarán.`)) return;
    panel.inert = true;
    try {
      await refreshCatalog(); await persistCatalog(migrateWorkshops(DEFAULT_WORKSHOPS)); reset(); await onSaved();
      backupStatus.textContent = "Se restableció el catálogo de ejemplo.";
    } catch (error) { backupStatus.textContent = `No se restableció el catálogo. ${error.message}`; }
    finally { panel.inert = false; }
  });
  return {
    lock() {
      programs.lock(); services.lock();
      document.querySelector("#workshop-fields").disabled = true;
      document.querySelector("#export-workshops").disabled = true; list.replaceChildren();
    },
    update(catalog) {
      programs.update(catalog); services.update(catalog);
      const selected = form.elements.programId.value;
      form.elements.programId.replaceChildren(new Option("Elige un taller definido", ""));
      catalog.programs.forEach((program) => form.elements.programId.add(new Option(program.name, program.id)));
      form.elements.programId.value = selected;
      document.querySelector("#workshop-fields").disabled = false;
      document.querySelector("#export-workshops").disabled = false;
      list.replaceChildren();
      for (const workshop of flattenInstances(catalog)) {
        const instance = catalog.instances.find((item) => item.id === workshop.id);
        const card = document.createElement("article"); card.className = "admin-workshop";
        card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[workshop.accent].color);
        const code = document.createElement("p"); code.className = "eyebrow"; code.textContent = workshop.code;
        const heading = document.createElement("h3"); heading.textContent = `${workshop.name} · ${workshop.code}`;
        const description = document.createElement("p");
        const dates = sessionDates(workshop);
        description.textContent = `${formatCadence(workshop)} · ${formatDate(dates[0])} – ${formatDate(dates.at(-1))} · ${formatSchedule(workshop)}`;
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "button button-outline"; edit.textContent = "Editar edición";
        edit.addEventListener("click", () => {
          if (editing && !confirm("¿Descartar la edición actual?")) return;
          editing = structuredClone(instance);
          for (const key of ["programId", "code", "startDate", "startTime", "endTime", "cadence", "sessions", "weekInterval"]) form.elements[key].value = instance[key];
          weekdays.forEach((field) => { field.checked = instance.weekdays.includes(Number(field.value)); });
          title.textContent = "Editar edición"; cancel.hidden = false; status.textContent = ""; updatePreview(); form.elements.programId.focus();
        });
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "Eliminar edición";
        remove.addEventListener("click", async () => {
          if (!confirm(`¿Eliminar la edición ${instance.code}? Se quitarán sus fechas y su formulario. El taller y las solicitudes anteriores se conservarán.`)) return;
          panel.inert = true;
          try {
            const latest = await latestFor(instance);
            latest.instances = latest.instances.filter((item) => item.id !== instance.id);
            await persistCatalog(latest);
            if (editing?.id === instance.id) reset();
            await onSaved(); status.textContent = "Edición eliminada. El taller y las solicitudes se conservaron.";
          } catch (error) {
            if (error.status === 409) await onSaved();
            status.textContent = `No se eliminó la edición. ${error.message}`;
          } finally { panel.inert = false; }
        });
        const signup = document.createElement("a"); signup.className = "text-link"; signup.textContent = "Formulario de esta edición";
        signup.href = `contacto.html?edicion=${encodeURIComponent(instance.id)}#inscripcion`;
        const actions = document.createElement("div"); actions.className = "button-row"; actions.append(edit, remove, signup);
        card.append(code, heading, description, actions); list.append(card);
      }
      if (!catalog.instances.length) list.textContent = "No hay ediciones programadas. Los talleres siguen disponibles como propuestas.";
    },
  };
}
