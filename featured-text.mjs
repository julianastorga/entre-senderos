export const SHOWCASE_KEY = "writing-showcase:v1";
export const LEGACY_TEXT_KEY = "writing-featured-text:v1";
export const MAX_TEXT_SIZE = 250_000;

const allowedTags = new Set(["P", "BR", "STRONG", "EM", "U", "BLOCKQUOTE", "H2", "H3", "UL", "OL", "LI"]);
const blockedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "IMG", "SVG", "MATH", "FORM", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "LINK", "META", "TEMPLATE", "CANVAS", "AUDIO", "VIDEO", "SOURCE", "HEAD", "TITLE", "BASE"]);
const blockTags = new Set(["P", "BLOCKQUOTE", "H2", "H3", "UL", "OL", "LI"]);

export function sanitizeTextHtml(html) {
  if (typeof html !== "string" || html.length > MAX_TEXT_SIZE) throw new Error("El texto supera el límite de 250.000 caracteres.");
  // Template contents stay inert: imported resources are never attached or loaded.
  const template = document.createElement("template");
  template.innerHTML = html;
  const clean = document.createElement("div");
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== "http://www.w3.org/1999/xhtml" || blockedTags.has(node.tagName)) return;
    let tag = { B: "STRONG", I: "EM", H1: "H2", DIV: "P" }[node.tagName] || node.tagName;
    if (node.tagName === "DIV" && [...node.children].some((child) => blockTags.has(child.tagName) || child.tagName === "DIV")) tag = "";
    if (!allowedTags.has(tag)) {
      node.childNodes.forEach((child) => copy(child, parent));
      return;
    }
    const element = document.createElement(tag.toLowerCase());
    node.childNodes.forEach((child) => copy(child, element));
    parent.append(element);
  }
  template.content.childNodes.forEach((node) => copy(node, clean));
  return clean.innerHTML;
}

export function textFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeTextHtml(html);
  return template.content;
}

export function plainText(html) {
  function read(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeName === "BR") return " ";
    const text = [...node.childNodes].map(read).join("");
    return blockTags.has(node.nodeName) ? `${text} ` : text;
  }
  return read(textFragment(html)).replace(/\s+/gu, " ").trim();
}

export function wordCount(html) {
  return (plainText(html).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
}

export function readingMeta(html) {
  const words = wordCount(html);
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${words.toLocaleString("es-419")} palabras · ${minutes} ${minutes === 1 ? "minuto" : "minutos"} de lectura`;
}

export function validateFeaturedText(input, { sanitize = sanitizeTextHtml, countWords = wordCount } = {}) {
  if (!input || input.version !== 1) throw new Error("El texto guardado no tiene un formato válido.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const author = typeof input.author === "string" ? input.author.trim() : "";
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(input.id) || input.id === "ejemplo") throw new Error("El identificador del texto no es válido.");
  if (title.length < 2 || title.length > 150) throw new Error("Escribe un título de entre 2 y 150 caracteres.");
  if (!author || author.length > 150) throw new Error("Indica el crédito de autoría, con un máximo de 150 caracteres.");
  const html = sanitize(input.html);
  if (!countWords(html)) throw new Error("El relato no puede estar vacío.");
  if (input.permissionConfirmed !== true) throw new Error("Confirma que tienes autorización para publicar el texto y su crédito.");
  return { version: 1, id: input.id, title, author, html, permissionConfirmed: true };
}

export function validateShowcase(input, options) {
  if (!input || input.version !== 1 || !Array.isArray(input.texts)) throw new Error("La colección de textos no tiene un formato válido.");
  const texts = input.texts.map((text) => validateFeaturedText(text, options));
  if (new Set(texts.map((text) => text.id)).size !== texts.length) throw new Error("Hay identificadores de texto repetidos.");
  return texts;
}

export function loadShowcase(storage) {
  const value = storage.getItem(SHOWCASE_KEY);
  if (value !== null) return validateShowcase(JSON.parse(value));
  const legacy = storage.getItem(LEGACY_TEXT_KEY);
  return legacy === null ? [] : [validateFeaturedText({ ...JSON.parse(legacy), id: "texto-anterior" })];
}

export function saveShowcase(storage, texts) {
  const validated = validateShowcase({ version: 1, texts });
  storage.setItem(SHOWCASE_KEY, JSON.stringify({ version: 1, texts: validated }));
  return validated;
}

export async function initFeaturedView(storage = window.localStorage, reload = async () => {}, cloud = false) {
  const content = document.querySelector("[data-featured-content]");
  if (!content) return;
  const initial = content.cloneNode(true);
  const originalTitle = document.title;
  const originalDescription = document.querySelector('meta[name="description"]').content;
  const errorNotice = document.querySelector("#text-error");
  const isReader = content.classList.contains("story");

  function fill(container, text) {
    const title = container.querySelector("[data-featured-title]");
    title.textContent = text.title;
    if (title.tagName === "A") title.href = `texto.html?id=${encodeURIComponent(text.id)}`;
    container.querySelector("[data-featured-author]").textContent = `Por ${text.author}`;
    container.querySelector("[data-featured-meta]").textContent = readingMeta(text.html);
    const body = container.querySelector("[data-story-body]");
    if (body) body.replaceChildren(textFragment(text.html));
    const words = plainText(text.html).split(/\s+/u);
    const summary = words.slice(0, 40).join(" ") + (words.length > 40 ? "…" : "");
    const excerpt = container.querySelector("[data-featured-excerpt]");
    if (excerpt) excerpt.textContent = summary;
    const description = container.querySelector("[data-featured-description]");
    if (description) description.hidden = true;
    container.querySelectorAll(".button[href]").forEach((link) => {
      link.href = `texto.html?id=${encodeURIComponent(text.id)}`;
      link.setAttribute("aria-label", `Leer relato completo: ${text.title}`);
    });
    return summary;
  }

  async function refresh() {
    try {
      await reload();
      const texts = loadShowcase(storage);
      content.replaceChildren(...[...initial.childNodes].map((node) => node.cloneNode(true)));
      content.hidden = false;
      errorNotice.hidden = true;
      document.title = originalTitle;
      document.querySelector('meta[name="description"]').content = originalDescription;
      const requested = new URLSearchParams(location.search).get("id");
      if (!texts.length && (!isReader || !requested || requested === "ejemplo")) {
        document.querySelectorAll("[data-featured-sample]").forEach((node) => { node.hidden = false; });
        return;
      }
      document.querySelectorAll("[data-featured-sample]").forEach((node) => { node.hidden = true; });
      if (isReader) {
        const text = requested ? texts.find((item) => item.id === requested) : texts[0];
        if (!text) throw new Error("No encontramos este relato. Vuelve a la muestra para elegir un texto disponible.");
        const summary = fill(content, text);
        document.title = `${text.title} · Muestra de textos`;
        document.querySelector('meta[name="description"]').content = summary;
      } else {
        const template = initial.querySelector(".writing-card");
        content.replaceChildren();
        texts.forEach((text) => {
          const card = template.cloneNode(true);
          card.querySelector("h2").id = `texto-${text.id}`;
          fill(card, text);
          content.append(card);
        });
      }
    } catch (error) {
      content.hidden = true;
      errorNotice.hidden = false;
      errorNotice.textContent = `No se pudo cargar el texto destacado. ${error.message} No se han sustituido los datos. Revisa el texto desde Administración local.`;
    }
  }
  await refresh();
  window.addEventListener("content-changed", refresh);
  if (cloud) window.addEventListener("focus", refresh);
  window.addEventListener("storage", (event) => {
    if ([SHOWCASE_KEY, LEGACY_TEXT_KEY, null].includes(event.key)) refresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refresh();
  });
}
