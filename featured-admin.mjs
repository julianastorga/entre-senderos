import {
  SHOWCASE_KEY, LEGACY_TEXT_KEY, sanitizeTextHtml, textFragment, wordCount,
  loadShowcase, validateFeaturedText,
} from "./featured-text.mjs";
import { importTextFile } from "./text-import.mjs";
import { contentStorage, refreshShowcase, persistShowcase, storageLocation } from "./content-store.mjs";

export async function createFeaturedAdmin() {
  const form = document.querySelector("#featured-text-form");
  if (!form) return;
  const fields = document.querySelector("#featured-text-fields");
  const editor = document.querySelector("#text-editor");
  const title = document.querySelector("#text-title");
  const author = document.querySelector("#text-author");
  const permission = document.querySelector("#text-permission");
  const counter = document.querySelector("#text-word-count");
  const status = document.querySelector("#text-admin-status");
  const upload = document.querySelector("#text-upload");
  const list = document.querySelector("#showcase-texts");
  const formTitle = document.querySelector("#text-form-title");
  const readingLink = document.querySelector("#text-reading-link");
  const toolbar = form.querySelector(".editor-toolbar");
  const tools = [...toolbar.querySelectorAll("[data-text-command]")];
  let editingId = null;
  let original = null;
  let dirty = false;
  let editorRevision = 0;
  const panel = form.closest('[role="tabpanel"]');

  function updateToolbar() {
    const selection = window.getSelection();
    const inEditor = selection && editor.contains(selection.anchorNode);
    const block = inEditor ? document.queryCommandValue("formatBlock").replace(/[<>]/gu, "").toLowerCase() : "";
    tools.forEach((button) => {
      if (!button.hasAttribute("aria-pressed")) return;
      const active = inEditor && (button.dataset.textCommand === "formatBlock"
        ? block === button.dataset.textValue
        : document.queryCommandState(button.dataset.textCommand));
      button.setAttribute("aria-pressed", String(Boolean(active)));
    });
  }

  function updateCount() {
    try {
      counter.textContent = `${wordCount(editor.innerHTML).toLocaleString("es-419")} palabras · Admite relatos de 1000 palabras y más.`;
    } catch (error) {
      counter.textContent = error.message;
    }
  }
  function fillEditor(text = null) {
    editorRevision += 1;
    editingId = text?.id || null;
    original = text ? JSON.stringify(text) : null;
    title.value = text?.title || "";
    author.value = text?.author || "";
    permission.checked = Boolean(text?.permissionConfirmed);
    editor.replaceChildren(textFragment(text?.html || ""));
    editor.contentEditable = "true";
    fields.disabled = false;
    dirty = false;
    formTitle.textContent = text ? "Editar texto" : "Nuevo texto";
    readingLink.hidden = !text;
    readingLink.href = text ? `texto.html?id=${encodeURIComponent(text.id)}` : "muestra.html";
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
    updateCount();
    updateToolbar();
  }
  function renderList(texts) {
    list.replaceChildren();
    if (!texts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Todavía no hay textos guardados. La muestra enseña el relato de ejemplo.";
      list.append(empty);
    }
    texts.forEach((text) => {
      const card = document.createElement("article");
      card.className = "saved-text";
      const heading = document.createElement("h3");
      heading.textContent = text.title;
      const credit = document.createElement("p");
      credit.textContent = `Por ${text.author} · ${wordCount(text.html).toLocaleString("es-419")} palabras`;
      const actions = document.createElement("div");
      actions.className = "button-row";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button button-outline";
      edit.textContent = "Editar";
      edit.setAttribute("aria-label", `Editar texto: ${text.title}`);
      edit.addEventListener("click", () => {
        if (dirty && !window.confirm("¿Descartar los cambios del editor para abrir este texto?")) return;
        fillEditor(text);
        status.textContent = "Texto cargado para editar. Los cambios se aplicarán al guardar.";
        title.focus();
      });
      const view = document.createElement("a");
      view.className = "text-link";
      view.href = `texto.html?id=${encodeURIComponent(text.id)}`;
      view.textContent = "Leer";
      view.setAttribute("aria-label", `Leer ${text.title}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Eliminar";
      remove.setAttribute("aria-label", `Eliminar texto: ${text.title}`);
      remove.addEventListener("click", async () => {
        if (!window.confirm(`¿Eliminar «${text.title}» de la muestra ${storageLocation}?`)) return;
        panel.inert = true;
        try {
          await refreshShowcase();
          const latest = loadShowcase(contentStorage);
          if (JSON.stringify(latest.find((item) => item.id === text.id)) !== JSON.stringify(text)) throw new Error("El texto cambió en otra pestaña. Recarga antes de eliminarlo.");
          const saved = await persistShowcase(latest.filter((item) => item.id !== text.id));
          if (editingId === text.id) fillEditor();
          renderList(saved);
          status.textContent = "Texto eliminado de la muestra. Los demás relatos no se modificaron.";
        } catch (error) {
          status.textContent = `No se eliminó el texto. ${error.message}`;
        } finally {
          panel.inert = false;
        }
      });
      actions.append(edit, view, remove);
      card.append(heading, credit, actions);
      list.append(card);
    });
  }
  async function loadState() {
    const revision = editorRevision;
    try {
      await refreshShowcase();
      if (dirty || revision !== editorRevision) return;
      const texts = loadShowcase(contentStorage);
      const active = texts.find((text) => text.id === editingId);
      fillEditor(active);
      renderList(texts);
      status.textContent = `Los textos se guardan ${storageLocation}. Crea uno nuevo o elige un relato para editarlo.`;
    } catch (error) {
      editor.contentEditable = "false";
      fields.disabled = true;
      list.replaceChildren();
      status.textContent = `No se pudo cargar la muestra. ${error.message} No se sobrescribió ningún dato. Puedes restablecer el ejemplo para recuperar este espacio.`;
    }
  }
  function markChanged() {
    editorRevision += 1;
    dirty = true;
    status.textContent = "Hay cambios sin guardar. La muestra pública todavía no se ha actualizado.";
    updateCount();
  }
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.querySelector("#new-showcase-text").addEventListener("click", () => {
    if (dirty && !window.confirm("¿Descartar los cambios del editor y crear un texto nuevo?")) return;
    fillEditor();
    status.textContent = "Nuevo texto. Los relatos guardados se conservarán.";
    title.focus();
  });
  form.addEventListener("input", markChanged);
  tools.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("focus", () => {
      tools.forEach((tool) => { tool.tabIndex = tool === button ? 0 : -1; });
    });
    button.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tools.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tools.length) % tools.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tools.length - 1;
      else return;
      event.preventDefault();
      tools[next].focus();
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      editor.focus();
      document.execCommand(button.dataset.textCommand, false, button.dataset.textValue || undefined);
      markChanged();
      updateToolbar();
    });
  });
  document.addEventListener("selectionchange", updateToolbar);
  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    try {
      const html = event.clipboardData.getData("text/html");
      if (html) document.execCommand("insertHTML", false, sanitizeTextHtml(html));
      else document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      markChanged();
    } catch (error) {
      status.textContent = `No se pudo pegar el contenido. ${error.message}`;
    }
  });
  editor.addEventListener("drop", (event) => {
    event.preventDefault();
    status.textContent = "Usa el selector de archivos para importar un relato.";
  });
  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    const revision = editorRevision;
    upload.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = "Convirtiendo el archivo en este navegador. No se envía a ningún servidor.";
    try {
      const { html, warnings } = await importTextFile(file);
      if (editorRevision !== revision) throw new Error("El editor cambió durante la conversión. Se conservaron tus cambios; vuelve a seleccionar el archivo para importarlo.");
      if (!wordCount(html)) throw new Error("El archivo no contiene texto legible.");
      if (editor.textContent.trim() && !window.confirm("¿Reemplazar el contenido del editor por este archivo? Ningún texto guardado cambiará hasta guardar.")) {
        status.textContent = "Importación cancelada. El contenido del editor y los relatos guardados se conservaron.";
        return;
      }
      editor.replaceChildren(textFragment(html));
      if (!title.value.trim()) title.value = file.name.replace(/\.[^.]+$/u, "").slice(0, 150);
      permission.checked = false;
      markChanged();
      status.textContent = "Archivo cargado. Revisa el formato, acredita la autoría y confirma el permiso antes de guardar. Se eliminaron estilos, enlaces y elementos no admitidos.";
      if (warnings.length) status.textContent += ` Avisos de conversión: ${warnings.join(" ")}`;
    } catch (error) {
      status.textContent = `No se cargó el archivo. ${error.message} Los relatos guardados no se modificaron.`;
    } finally {
      upload.value = "";
      upload.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    panel.inert = true;
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
    try {
      await refreshShowcase();
      const latest = loadShowcase(contentStorage);
      if (editingId && JSON.stringify(latest.find((text) => text.id === editingId)) !== original) throw new Error("Este texto cambió en otra pestaña. Recarga antes de guardar para no sobrescribirlo.");
      const text = validateFeaturedText({
        version: 1, id: editingId || crypto.randomUUID(), title: title.value,
        author: author.value, html: editor.innerHTML, permissionConfirmed: permission.checked,
      });
      const saved = await persistShowcase(editingId ? latest.map((item) => item.id === editingId ? text : item) : [text, ...latest]);
      fillEditor(saved.find((item) => item.id === text.id));
      renderList(saved);
      status.textContent = `Texto y crédito de autoría guardados ${storageLocation}. Su ficha y su lectura completa se actualizaron.`;
    } catch (error) {
      panel.inert = false;
      const invalid = title.value.trim().length < 2 ? title : !author.value.trim() ? author : !editor.textContent.trim() ? editor : !permission.checked ? permission : null;
      if (invalid) {
        invalid.setAttribute("aria-invalid", "true");
        invalid.focus();
      }
      status.textContent = `No se guardó el texto. ${error.message}`;
    } finally {
      panel.inert = false;
    }
  });
  document.querySelector("#reset-featured-text").addEventListener("click", async () => {
    if (!window.confirm(`¿Quitar todos los textos de la muestra ${storageLocation} y volver al relato de ejemplo? También se descartarán los cambios del editor.`)) return;
    panel.inert = true;
    try {
      await refreshShowcase();
      await persistShowcase([]);
      editingId = null;
      dirty = false;
      await loadState();
      status.textContent = "Se restableció el relato de ejemplo. No se modificó el catálogo de talleres.";
    } catch (error) {
      status.textContent = `No se pudo restablecer la muestra. ${error.message}`;
    } finally {
      panel.inert = false;
    }
  });
  await loadState();
  window.addEventListener("content-changed", () => {
    if (dirty) status.textContent = "La muestra cambió en otra sesión. Conservamos tus cambios; comprobaremos este relato antes de guardar.";
    else loadState();
  });
  window.addEventListener("storage", (event) => {
    if (![SHOWCASE_KEY, LEGACY_TEXT_KEY, null].includes(event.key)) return;
    if (dirty) status.textContent = "La muestra cambió en otra pestaña. Conservamos tus cambios en el editor; al guardar comprobaremos que este relato no haya cambiado.";
    else loadState();
  });
}
