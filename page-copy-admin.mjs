import { PAGE_COPY_PAGES, pageCopyFields } from "./page-copy-model.mjs";
import { loadPageCopy, savePageCopy } from "./page-copy.mjs";
import { beginLoading } from "./loading.mjs";

export async function createPageCopyAdmin() {
  const panel = document.querySelector("#page-copy-admin");
  if (!panel) return;
  panel.innerHTML = `
    <h2>Textos de las páginas</h2>
    <p>Edita los títulos y las introducciones como texto simple. Estos cambios son públicos y no modifican las definiciones de talleres, servicios ni ediciones. Deja los textos secundarios vacíos para ocultarlos.</p>
    <p>No incluyas información privada. En la vista previa local solo se guardan en este navegador; en el sitio alojado se comparten con quienes lo visitan.</p>
    <form id="page-copy-form"><fieldset disabled><legend class="sr-only">Contenido público de las páginas</legend>
    <div id="page-copy-fields"></div><button class="button" type="submit">Guardar textos</button>
    </fieldset></form>
    <button id="reload-page-copy" class="button button-outline" type="button">Recargar textos guardados</button>
    <p id="page-copy-status" class="form-status" role="status" aria-live="polite"></p>`;
  const form = panel.querySelector("form");
  const fields = form.querySelector("fieldset");
  const container = panel.querySelector("#page-copy-fields");
  const reload = panel.querySelector("#reload-page-copy");
  const status = panel.querySelector("#page-copy-status");
  for (const [key, page] of Object.entries(PAGE_COPY_PAGES)) {
    const section = document.createElement("fieldset");
    section.className = "page-copy-page";
    const legend = document.createElement("legend");
    legend.textContent = page.label;
    section.append(legend);
    for (const field of pageCopyFields(key)) {
      const group = document.createElement("div");
      group.className = "field";
      const input = document.createElement(field.multiline ? "textarea" : "input");
      input.id = `page-copy-${key}-${field.key}`;
      input.name = `${key}.${field.key}`;
      input.maxLength = field.maximum;
      input.required = Boolean(field.required);
      if (field.multiline) input.rows = field.key === "body" ? 7 : 3;
      const label = document.createElement("label");
      label.htmlFor = input.id;
      label.textContent = `${field.label}${field.required ? " *" : ""}`;
      group.append(label, input);
      section.append(group);
    }
    const preview = document.createElement("a");
    preview.href = page.href;
    preview.target = "_blank";
    preview.rel = "noopener noreferrer";
    preview.className = "text-link";
    preview.textContent = `Ver página: ${page.label}`;
    section.append(preview);
    container.append(section);
  }
  let saved = null;
  function values() {
    return { version: 1, pages: Object.fromEntries(Object.keys(PAGE_COPY_PAGES).map((page) =>
      [page, Object.fromEntries(pageCopyFields(page).map(({ key }) => [key, form.elements[`${page}.${key}`].value]))])) };
  }
  function fill(value) {
    for (const [page, content] of Object.entries(value.pages)) {
      for (const [key, text] of Object.entries(content)) form.elements[`${page}.${key}`].value = text;
    }
  }
  async function load() {
    reload.disabled = true;
    fields.disabled = true;
    const finish = beginLoading(container, { label: "Cargando textos guardados", shape: "lines", count: 2 });
    try {
      saved = await loadPageCopy();
      fill(saved.value);
      status.textContent = "Textos cargados. Los cambios se publican al guardar.";
    } catch (error) {
      status.textContent = `No se cargaron los textos. ${error.message} No se sustituyeron los cambios del formulario.`;
    } finally {
      finish();
      fields.disabled = !saved;
      reload.disabled = false;
    }
  }
  reload.addEventListener("click", () => {
    if (saved && JSON.stringify(values()) !== JSON.stringify(saved.value) && !confirm("¿Descartar los textos sin guardar y recargar la última versión?")) return;
    load();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = values();
    fields.disabled = true;
    reload.disabled = true;
    try {
      saved = await savePageCopy(input, saved.version);
      fill(saved.value);
      status.textContent = "Textos guardados. Las páginas públicas se actualizaron.";
    } catch (error) {
      status.textContent = `No se guardaron los textos. ${error.message}${error.status === 409 ? " Conserva una copia de tus cambios y recarga antes de reintentar." : ""}`;
    } finally {
      fields.disabled = false;
      reload.disabled = false;
    }
  });
  await load();
}
