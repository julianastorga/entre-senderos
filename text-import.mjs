import { MAX_TEXT_SIZE, sanitizeTextHtml } from "./featured-text.mjs";

export const MAX_WORD_FILE_SIZE = 5_000_000;

export function validateTextUpload(file) {
  const extension = /\.((?:html?|txt|docx?))$/iu.exec(file.name)?.[1].toLowerCase();
  if (!extension) throw new Error("Usa un archivo Word (.doc o .docx), HTML (.html o .htm) o de texto (.txt).");
  const word = extension === "doc" || extension === "docx";
  if (file.size > (word ? MAX_WORD_FILE_SIZE : MAX_TEXT_SIZE)) {
    throw new Error(word ? "El archivo Word supera el límite de 5 MB." : "El archivo supera el límite de 250 KB.");
  }
  return extension;
}

function convertWord(buffer, extension) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./assets/word-import.worker.js", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => finish(new Error("La conversión tardó demasiado. Prueba con un documento más pequeño.")), 20_000);
    function finish(error, result) {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    worker.addEventListener("message", ({ data }) => {
      if (data.error) finish(new Error(`No se pudo convertir el documento Word. ${data.error}`));
      else finish(null, data);
    }, { once: true });
    worker.addEventListener("error", () => finish(new Error("No se pudo iniciar la conversión local de Word. Recarga la página e inténtalo de nuevo.")), { once: true });
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}

function cleanWordHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img, svg, style, script, object, iframe").forEach((node) => node.remove());
  // Legacy Word represents emphasis as styled spans; retain only semantic marks.
  template.content.querySelectorAll("span[style]").forEach((node) => {
    const marks = [];
    if (node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 600) marks.push("strong");
    if (node.style.fontStyle === "italic") marks.push("em");
    if (`${node.style.textDecorationLine} ${node.style.textDecoration}`.includes("underline")) marks.push("u");
    marks.forEach((tag) => {
      const mark = document.createElement(tag);
      mark.append(...node.childNodes);
      node.append(mark);
    });
  });
  template.content.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
  return sanitizeTextHtml(template.innerHTML);
}

export async function importTextFile(file) {
  const extension = validateTextUpload(file);
  if (extension === "doc" || extension === "docx") {
    const result = await convertWord(await file.arrayBuffer(), extension);
    return { html: cleanWordHtml(result.html), warnings: result.warnings };
  }
  const content = await file.text();
  if (extension !== "txt") return { html: sanitizeTextHtml(content), warnings: [] };
  const container = document.createElement("div");
  content.replace(/\r\n?/gu, "\n").split(/\n\s*\n/gu).forEach((paragraph) => {
    const node = document.createElement("p");
    paragraph.split("\n").forEach((line, index) => {
      if (index) node.append(document.createElement("br"));
      node.append(document.createTextNode(line));
    });
    container.append(node);
  });
  return { html: sanitizeTextHtml(container.innerHTML), warnings: [] };
}
