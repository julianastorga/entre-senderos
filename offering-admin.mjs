import { WORKSHOP_ACCENTS, formatWorkshopPrices } from "./workshops.mjs";
import { loadCatalog, validateOffering, validateProgram } from "./catalog-model.mjs";
import { contentStorage, refreshCatalog, persistCatalog, storageLocation } from "./content-store.mjs";
import { createCoverUpload } from "./image-upload.mjs";
import { imageElement } from "./image-model.mjs";

export function createOfferingAdmin(kind, onSaved) {
  const container = document.querySelector(`[data-offering-admin="${kind}"]`);
  if (!container) return null;
  const prefix = kind === "programs" ? "program" : "service";
  const label = kind === "programs" ? "taller" : "servicio";
  container.innerHTML = `
    <section class="admin-layout section"><div><details class="form-panel admin-create">
    <summary id="${prefix}-form-title">Crear ${label}</summary>
    <form id="${prefix}-form"><fieldset disabled><legend class="sr-only">Definición del ${label}</legend>
    <div class="field"><label for="${prefix}-name">Nombre *</label><input id="${prefix}-name" name="name" required minlength="3" maxlength="100"></div>
    <div class="field"><label for="${prefix}-description">Descripción breve *</label><textarea id="${prefix}-description" name="description" rows="3" required maxlength="1500"></textarea></div>
    ${kind === "programs" ? `
    <div class="field"><label for="program-modality">Modalidad *</label><input id="program-modality" name="modality" required maxlength="120" value="Taller corto" placeholder="Taller corto"></div>
    <div class="form-row"><div class="field"><label for="program-priceCRC">Precio por edición en colones (CRC)</label><input id="program-priceCRC" name="priceCRC" type="number" min="0" step="0.01" inputmode="decimal" aria-describedby="program-price-help"></div><div class="field"><label for="program-priceUSD">Precio por edición en dólares (USD)</label><input id="program-priceUSD" name="priceUSD" type="number" min="0" step="0.01" inputmode="decimal" aria-describedby="program-price-help"></div></div>
    <p id="program-price-help" class="field-hint">Define cada importe por separado, con hasta dos decimales. Se aplican a todas las ediciones de este taller y se muestran en ambas monedas. No se convierte entre monedas; deja un campo vacío para indicar que está por confirmar. Usa 0 si no tiene costo.</p>
    <div class="field"><label for="program-overview">En qué consiste</label><textarea id="program-overview" name="overview" rows="5" maxlength="20000" placeholder="Qué se hará durante el taller y cómo se trabajará."></textarea></div>
    <div class="field"><label for="program-audience">A quién está dirigido</label><textarea id="program-audience" name="audience" rows="5" maxlength="20000" placeholder="Personas a quienes se dirige la propuesta y experiencia previa, si corresponde."></textarea></div>
    <div class="field"><label for="program-objectives">Objetivos</label><textarea id="program-objectives" name="objectives" rows="5" maxlength="20000" placeholder="Qué aprenderán y practicarán las personas participantes."></textarea></div>
    <div class="field"><label for="program-requiredReading">Lecturas recomendadas</label><textarea id="program-requiredReading" name="requiredReading" rows="5" maxlength="20000" placeholder="Libros, autorías y sugerencias de lectura."></textarea><p class="field-hint">Lecturas opcionales para acompañar el taller. Los campos vacíos se mostrarán como pendientes de publicación.</p></div>` : ""}
    <div class="field"><label for="${prefix}-details">Detalles adicionales de la propuesta</label><textarea id="${prefix}-details" name="details" rows="7" maxlength="20000" placeholder="Contenidos, destinatarios, metodología..."></textarea></div>
    <fieldset class="image-controls"><legend>Portada (opcional)</legend>
    <div class="field"><label for="${prefix}-cover-upload">Imagen JPG, PNG o WebP (hasta 8 MB)</label><input id="${prefix}-cover-upload" type="file" accept="image/jpeg,image/png,image/webp"></div>
    <div class="field"><label for="${prefix}-cover-alt">Descripción accesible de la imagen</label><input id="${prefix}-cover-alt" maxlength="250"></div>
    <p class="field-hint">Se reduce la imagen y se eliminan sus metadatos. Carga únicamente imágenes autorizadas: en Azure quedan disponibles mediante su enlace.</p>
    ${kind === "programs" ? '<p class="field-hint">Cada página de taller muestra una portada. Mientras no cargues la suya, se utilizará una ilustración provisional identificada como ejemplo.</p>' : ""}
    <div id="${prefix}-cover-preview" class="cover-preview" hidden></div><button id="${prefix}-cover-remove" type="button" class="text-button" hidden>Quitar portada</button></fieldset>
    <div class="field"><label for="${prefix}-accent">Acento verde *</label><select id="${prefix}-accent" name="accent" required></select></div>
    <div class="button-row"><button type="submit" class="button">Guardar ${label}</button><button type="button" class="button button-outline" data-cancel hidden>Cancelar edición</button></div>
    </fieldset></form></details><p class="form-status" role="status" aria-live="polite"></p></div>
    <aside><h2 class="aside-heading">${kind === "programs" ? "Talleres definidos" : "Servicios disponibles"}</h2><p>${kind === "programs" ? "Define aquí la propuesta. Crea sus fechas en la pestaña Ediciones." : "Las consultas se reciben desde Contacto; los servicios no añaden encuentros al calendario."}</p><div class="admin-workshops" data-offering-list></div></aside></section>`;
  const form = container.querySelector("form");
  const status = container.querySelector('[role="status"]');
  const fieldset = form.querySelector("fieldset");
  const panel = container.closest('[role="tabpanel"]');
  const title = container.querySelector(`#${prefix}-form-title`);
  const disclosure = form.closest("details");
  const cancel = form.querySelector("[data-cancel]");
  const cover = createCoverUpload(form, prefix, status, () => {});
  for (const [value, accent] of Object.entries(WORKSHOP_ACCENTS)) form.elements.accent.add(new Option(accent.label, value));
  let editing = null;
  function reset() {
    form.reset(); cover.set(null); editing = null; cancel.hidden = true;
    title.textContent = `Crear ${label}`;
  }
  cancel.addEventListener("click", () => { reset(); status.textContent = ""; });
  async function latestFor(record) {
    await refreshCatalog();
    const catalog = loadCatalog(contentStorage);
    if (record && JSON.stringify(catalog[kind].find((item) => item.id === record.id)) !== JSON.stringify(record)) {
      const error = new Error("La propuesta cambió en otra sesión. Cancela la edición y vuelve a abrirla.");
      error.status = 409;
      throw error;
    }
    return catalog;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    panel.inert = true;
    try {
      const validate = kind === "programs" ? validateProgram : validateOffering;
      const values = { id: editing?.id || crypto.randomUUID(), ...Object.fromEntries(new FormData(form)), coverImage: cover.read() };
      if (kind === "programs") for (const field of ["priceCRC", "priceUSD"]) values[field] = form.elements[field].value === "" ? null : form.elements[field].valueAsNumber;
      const offering = validate(values);
      const catalog = await latestFor(editing);
      catalog[kind] = editing ? catalog[kind].map((item) => item.id === offering.id ? offering : item) : [...catalog[kind], offering];
      await persistCatalog(catalog);
      reset();
      await onSaved();
      status.textContent = `La propuesta «${offering.name}» se guardó ${storageLocation}.`;
    } catch (error) {
      if (error.status === 409) await onSaved();
      status.textContent = `No se guardó la propuesta. ${error.message}`;
    } finally { panel.inert = false; }
  });
  return {
    lock() { fieldset.disabled = true; container.querySelector("[data-offering-list]").replaceChildren(); },
    update(catalog) {
      fieldset.disabled = false;
      const list = container.querySelector("[data-offering-list]");
      list.replaceChildren();
      for (const offering of catalog[kind]) {
        const card = document.createElement("article");
        card.className = "admin-workshop";
        card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[offering.accent].color);
        const category = document.createElement("p"); category.className = "eyebrow"; category.textContent = kind === "programs" ? "Taller definido" : "Servicio";
        const heading = document.createElement("h3"); heading.textContent = offering.name;
        const description = document.createElement("p"); description.textContent = offering.description;
        const link = document.createElement("a");
        link.className = "text-link"; link.textContent = "Ver página pública";
        link.href = `propuesta.html?tipo=${kind === "programs" ? "taller" : "servicio"}&id=${encodeURIComponent(offering.id)}`;
        const edit = document.createElement("button");
        edit.type = "button"; edit.className = "button button-outline"; edit.textContent = "Editar";
        edit.setAttribute("aria-label", `Editar ${label}: ${offering.name}`);
        edit.addEventListener("click", () => {
          if (editing && !confirm("¿Descartar la edición actual?")) return;
          editing = structuredClone(offering);
          for (const key of ["name", "description", "details", "accent", ...(kind === "programs" ? ["modality", "overview", "audience", "objectives", "requiredReading"] : [])]) form.elements[key].value = offering[key];
          if (kind === "programs") for (const field of ["priceCRC", "priceUSD"]) form.elements[field].value = offering[field] ?? "";
          cover.set(offering.coverImage);
          disclosure.open = true;
          cancel.hidden = false; title.textContent = `Editar ${label}`; status.textContent = ""; form.elements.name.focus();
        });
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "text-button"; remove.textContent = "Eliminar";
        remove.setAttribute("aria-label", `Eliminar ${label}: ${offering.name}`);
        remove.addEventListener("click", async () => {
          if (!confirm(`¿Eliminar «${offering.name}»? Las solicitudes existentes se conservarán. Para eliminar un taller, primero debes quitar sus ediciones.`)) return;
          panel.inert = true;
          try {
            const latest = await latestFor(offering);
            if (kind === "programs" && latest.instances.some((instance) => instance.programId === offering.id)) throw new Error("Elimina primero las ediciones de este taller en la pestaña Ediciones.");
            latest[kind] = latest[kind].filter((item) => item.id !== offering.id);
            await persistCatalog(latest);
            if (editing?.id === offering.id) reset();
            await onSaved();
            status.textContent = "Propuesta eliminada. Las solicitudes existentes se conservaron.";
          } catch (error) {
            if (error.status === 409) await onSaved();
            status.textContent = `No se eliminó la propuesta. ${error.message}`;
          } finally { panel.inert = false; }
        });
        const actions = document.createElement("div"); actions.className = "button-row"; actions.append(edit, remove, link);
        card.append(category);
        if (offering.coverImage) card.append(imageElement(offering.coverImage, "workshop-cover"));
        card.append(heading, description);
        if (kind === "programs") {
          const prices = document.createElement("p"); prices.textContent = `Precios por edición: ${formatWorkshopPrices(offering)}`;
          card.append(prices);
        }
        card.append(actions); list.append(card);
      }
      if (!catalog[kind].length) list.textContent = "No hay propuestas guardadas.";
    },
  };
}
