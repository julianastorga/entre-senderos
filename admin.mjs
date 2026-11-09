import {
  DEFAULT_WORKSHOPS, WORKSHOP_ACCENTS, WorkshopValidationError, loadWorkshops,
  validateWorkshop, validateCatalog, sessionDates, formatDate, formatSchedule, formatCadence, parseDate,
} from "./workshops.mjs";
import { contentStorage, refreshCatalog, persistCatalog, storageLocation } from "./content-store.mjs";

export function createAdmin(onSaved) {
  const form = document.querySelector("#workshop-form");
  if (!form) return null;
  const fields = document.querySelector("#workshop-fields");
  const title = document.querySelector("#workshop-form-title");
  const cancel = document.querySelector("#cancel-edit");
  const saveButton = document.querySelector("#save-workshop");
  const status = document.querySelector("#admin-status");
  const preview = document.querySelector("#recurrence-preview");
  const list = document.querySelector("#admin-workshops");
  const exportButton = document.querySelector("#export-workshops");
  const importInput = document.querySelector("#import-workshops");
  const backupStatus = document.querySelector("#backup-status");
  const weeklyFields = document.querySelector("#weekly-fields");
  const weekdayInputs = [...form.querySelectorAll('[name="weekday"]')];
  const accentSelect = form.elements.accent;
  Object.entries(WORKSHOP_ACCENTS).forEach(([key, accent]) => accentSelect.add(new Option(accent.label, key)));
  accentSelect.value = "pine";
  function updateAccent() {
    document.querySelector("#accent-swatch").style.backgroundColor = WORKSHOP_ACCENTS[accentSelect.value].color;
  }
  accentSelect.addEventListener("change", updateAccent);
  updateAccent();
  let editingId = null;
  let originalWorkshop = null;
  const panel = form.closest('[role="tabpanel"]');

  function values() {
    return {
      id: editingId || crypto.randomUUID(),
      name: form.elements.name.value, code: form.elements.code.value,
      description: form.elements.description.value, startDate: form.elements.startDate.value,
      startTime: form.elements.startTime.value, endTime: form.elements.endTime.value,
      cadence: form.elements.cadence.value, sessions: Number(form.elements.sessions.value),
      weekInterval: Number(form.elements.weekInterval.value),
      weekdays: weekdayInputs.filter((input) => input.checked).map((input) => Number(input.value)),
      accent: accentSelect.value,
    };
  }

  function updatePreview() {
    if (!form.elements.startDate.value) {
      preview.textContent = "Elige una fecha para ver el inicio y el cierre.";
      return;
    }
    try {
      const workshop = values();
      const dates = sessionDates(workshop);
      preview.textContent = `${dates.length} encuentros · ${formatCadence(workshop)} · Inicio: ${formatDate(dates[0])} · Cierre: ${formatDate(dates.at(-1))} · ${formatSchedule(workshop)}`;
    } catch (error) {
      preview.textContent = error.message;
    }
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((node) => { node.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  function resetEditor() {
    form.reset();
    editingId = null;
    originalWorkshop = null;
    title.textContent = "Crear taller";
    saveButton.textContent = "Guardar taller";
    cancel.hidden = true;
    status.textContent = "";
    clearErrors();
    accentSelect.value = "pine";
    updateAccent();
    toggleWeeklyFields();
    updatePreview();
  }

  function toggleWeeklyFields() {
    const monthly = form.elements.cadence.value === "monthly";
    weeklyFields.hidden = monthly;
    weeklyFields.disabled = monthly;
  }

  form.elements.cadence.addEventListener("change", toggleWeeklyFields);
  form.elements.startDate.addEventListener("change", () => {
    if (!form.elements.startDate.value || weekdayInputs.filter((input) => input.checked).length > 1) return;
    const day = parseDate(form.elements.startDate.value).getUTCDay() || 7;
    weekdayInputs.forEach((input) => { input.checked = Number(input.value) === day; });
  });

  function report(error) {
    if (error instanceof WorkshopValidationError) {
      let first;
      for (const [key, message] of Object.entries(error.errors)) {
        const field = key === "weekdays" ? weekdayInputs[0] : form.elements.namedItem(key);
        const errorNode = document.getElementById(`workshop-${key}-error`);
        if (errorNode) errorNode.textContent = message;
        if (field) {
          field.setAttribute("aria-invalid", "true");
          first ||= field;
        }
      }
      first?.focus();
    }
    status.textContent = `No se guardó el taller. ${error.message}`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    panel.inert = true;
    try {
      await refreshCatalog();
      const latest = loadWorkshops(contentStorage);
      if (editingId && JSON.stringify(latest.find((item) => item.id === editingId)) !== JSON.stringify(originalWorkshop)) {
        const conflict = new Error("Este taller cambió en otra pestaña. Cancela la edición y vuelve a abrirlo para no sobrescribir esos cambios.");
        conflict.status = 409;
        throw conflict;
      }
      const workshop = validateWorkshop(values(), latest);
      const updated = editingId ? latest.map((item) => item.id === editingId ? workshop : item) : [...latest, workshop];
      await persistCatalog(updated);
      resetEditor();
      await onSaved();
      status.textContent = `Taller «${workshop.name}» guardado ${storageLocation}. El catálogo y el calendario ya están actualizados.`;
    } catch (error) {
      if (error.status === 409) await onSaved();
      panel.inert = false;
      report(error);
    } finally {
      panel.inert = false;
    }
  });
  form.addEventListener("input", () => {
    status.textContent = "";
    updatePreview();
  });
  form.addEventListener("change", updatePreview);
  cancel.addEventListener("click", () => {
    resetEditor();
    form.elements.name.focus();
  });

  exportButton.addEventListener("click", () => {
    try {
      const workshops = loadWorkshops(contentStorage);
      const blob = new Blob([JSON.stringify({ version: 1, workshops }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "talleres.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus.textContent = "Archivo generado para descargar. No se publicó ningún cambio en internet.";
    } catch (error) {
      backupStatus.textContent = `No se pudo exportar el catálogo. ${error.message}`;
    }
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("El archivo supera el límite de 2 MB.");
      const workshops = validateCatalog(JSON.parse(await file.text()));
      if (!window.confirm(`¿Reemplazar el catálogo completo ${storageLocation} por ${workshops.length} talleres y descartar la edición actual? Exporta primero si necesitas conservarlo.`)) return;
      panel.inert = true;
      await refreshCatalog();
      await persistCatalog(workshops);
      resetEditor();
      await onSaved();
      backupStatus.textContent = `Se importaron ${workshops.length} talleres ${storageLocation}.`;
    } catch (error) {
      backupStatus.textContent = `No se importó el archivo y no se modificó el catálogo. ${error.message}`;
    } finally {
      panel.inert = false;
      importInput.value = "";
    }
  });

  document.querySelector("#reset-workshops").addEventListener("click", async () => {
    if (!window.confirm(`¿Reemplazar el catálogo ${storageLocation} por los tres talleres de ejemplo y descartar la edición actual? Exporta primero si necesitas conservarlo.`)) return;
    panel.inert = true;
    try {
      await refreshCatalog();
      await persistCatalog(DEFAULT_WORKSHOPS);
      resetEditor();
      await onSaved();
      backupStatus.textContent = `Se restablecieron los tres talleres de ejemplo ${storageLocation}.`;
    } catch (error) {
      backupStatus.textContent = `No se pudo restablecer el catálogo. ${error.message}`;
    } finally {
      panel.inert = false;
    }
  });

  return {
    update(workshops) {
      fields.disabled = false;
      exportButton.disabled = false;
      list.replaceChildren();
      workshops.forEach((workshop) => {
        const card = document.createElement("article");
        card.className = "admin-workshop";
        card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[workshop.accent].color);
        const code = document.createElement("p");
        code.className = "eyebrow";
        code.textContent = workshop.code;
        const heading = document.createElement("h3");
        heading.textContent = workshop.name;
        const schedule = document.createElement("p");
        const dates = sessionDates(workshop);
        schedule.textContent = `${formatCadence(workshop)} · ${workshop.sessions} encuentros · ${formatDate(dates[0])} – ${formatDate(dates.at(-1))} · ${formatSchedule(workshop)} · US$50`;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "button button-outline";
        edit.textContent = "Editar";
        edit.setAttribute("aria-label", `Editar ${workshop.name}`);
        edit.addEventListener("click", () => {
          if (editingId && !window.confirm("¿Descartar la edición actual para abrir este taller?")) return;
          clearErrors();
          editingId = workshop.id;
          originalWorkshop = workshop;
          for (const [key, value] of Object.entries(workshop)) {
            const field = form.elements.namedItem(key);
            if (field) field.value = value ?? "";
          }
          weekdayInputs.forEach((input) => { input.checked = workshop.weekdays.includes(Number(input.value)); });
          toggleWeeklyFields();
          updateAccent();
          title.textContent = "Editar taller";
          saveButton.textContent = "Guardar cambios";
          cancel.hidden = false;
          status.textContent = "";
          updatePreview();
          form.elements.name.focus();
        });
        card.append(code, heading, schedule, edit);
        list.append(card);
      });
      if (!workshops.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No hay talleres guardados. Crea el primero.";
        list.append(empty);
      }
    },
    lock() {
      fields.disabled = true;
      exportButton.disabled = true;
      list.replaceChildren();
    },
  };
}
