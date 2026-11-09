import { CLOUD_MODE } from "./app-config.mjs";
import { MAX_STORY_HTML_SIZE, MAX_STORY_IMAGES, isImageSource, validateImage } from "./image-model.mjs";

export const SHOWCASE_KEY = "writing-showcase:v1";
export const LEGACY_TEXT_KEY = "writing-featured-text:v1";
export const MAX_TEXT_SIZE = 250_000;
import { authorCredit, externalLink, editorialPage, publicationMetadata, publicationDate } from "./editorial-model.mjs";
import { initReactions } from "./reactions.mjs";
import { REACTIONS_KEY } from "./reaction-model.mjs";

const allowedTags = new Set(["P", "BR", "STRONG", "EM", "U", "BLOCKQUOTE", "H2", "H3", "UL", "OL", "LI", "A"]);
const blockedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "LINK", "META", "TEMPLATE", "CANVAS", "AUDIO", "VIDEO", "SOURCE", "HEAD", "TITLE", "BASE"]);
const blockTags = new Set(["P", "BLOCKQUOTE", "H2", "H3", "UL", "OL", "LI"]);

export function sanitizeTextHtml(html) {
  if (typeof html !== "string" || html.length > MAX_STORY_HTML_SIZE) throw new Error("El relato supera el tamaño permitido.");
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
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src");
      if (!isImageSource(src, { allowDataImages: !CLOUD_MODE })) return;
      const image = validateImage({ src, alt: node.getAttribute("alt") }, { allowDataImages: !CLOUD_MODE });
      const element = document.createElement("img");
      element.src = image.src;
      element.alt = image.alt;
      parent.append(element);
      return;
    }
    let tag = { B: "STRONG", I: "EM", H1: "H2", DIV: "P" }[node.tagName] || node.tagName;
    if (node.tagName === "DIV" && [...node.children].some((child) => blockTags.has(child.tagName) || child.tagName === "DIV")) tag = "";
    if (!allowedTags.has(tag)) {
      node.childNodes.forEach((child) => copy(child, parent));
      return;
    }
    const href = tag === "A" ? externalLink(node.getAttribute("href")) : null;
    if (tag === "A" && !href) {
      node.childNodes.forEach((child) => copy(child, parent));
      return;
    }
    const element = document.createElement(tag.toLowerCase());
    if (href) {
      element.href = href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    node.childNodes.forEach((child) => copy(child, element));
    parent.append(element);
  }
  template.content.childNodes.forEach((node) => copy(node, clean));
  if (clean.querySelectorAll("img").length > MAX_STORY_IMAGES) throw new Error(`El relato admite hasta ${MAX_STORY_IMAGES} imágenes internas.`);
  if (clean.innerHTML.replace(/<img\b[^>]*>/giu, "").length > MAX_TEXT_SIZE) throw new Error("El texto supera el límite de 250.000 caracteres, sin contar las imágenes.");
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

export function validateFeaturedText(input, { sanitize = sanitizeTextHtml, countWords = wordCount, allowDataImages = !CLOUD_MODE } = {}) {
  if (!input || input.version !== 1) throw new Error("El texto guardado no tiene un formato válido.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(input.id) || input.id === "ejemplo") throw new Error("El identificador del texto no es válido.");
  if (title.length < 2 || title.length > 150) throw new Error("Escribe un título de entre 2 y 150 caracteres.");
  const credit = authorCredit(input);
  const html = sanitize(input.html);
  if (!countWords(html)) throw new Error("El relato no puede estar vacío.");
  if (input.permissionConfirmed !== true) throw new Error("Confirma que tienes autorización para publicar el texto y su crédito.");
  const coverImage = input.coverImage == null ? null : validateImage(input.coverImage, { allowDataImages });
  return { version: 1, id: input.id, title, ...credit, html, permissionConfirmed: true, ...publicationMetadata(input), ...(coverImage ? { coverImage } : {}) };
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

export async function initFeaturedView(storage = window.localStorage, reload = async () => {}, cloud = false, getEditorial = null) {
  const content = document.querySelector("[data-featured-content]");
  if (!content) return;
  const initial = content.cloneNode(true);
  const originalTitle = document.title;
  const originalDescription = document.querySelector('meta[name="description"]').content;
  const errorNotice = document.querySelector("#text-error");
  const isReader = content.classList.contains("story");
  const pagination = document.querySelector("[data-editorial-pagination]");
  const results = document.querySelector("[data-editorial-results]");
  let localEntries = [];
  let requestRevision = 0;
  function urlFor(page) {
    const url = new URL(location.href);
    url.searchParams.delete("tipo");
    if (page === 1) url.searchParams.delete("pagina"); else url.searchParams.set("pagina", String(page));
    url.hash = "";
    return url.pathname + url.search;
  }
  function exampleCard() {
    return { id: "ejemplo", publishedAt: null, title: initial.querySelector("[data-featured-title]").textContent, author: "Texto de demostración · Autoría de muestra", excerpt: initial.querySelector("[data-featured-excerpt]").textContent, meta: initial.querySelector("[data-featured-meta]").textContent };
  }

  function fill(container, text) {
    const title = container.querySelector("[data-featured-title]");
    title.textContent = text.title;
    if (title.tagName === "A") title.href = `texto.html?id=${encodeURIComponent(text.id)}`;
    const byline = container.querySelector("[data-featured-author]");
    byline.textContent = text.author ? `Por ${text.author}` : "";
    byline.hidden = !text.author;
    const authorUrl = externalLink(text.authorUrl);
    if (authorUrl) {
      const item = document.createElement("p");
      item.className = "author-blog";
      const link = document.createElement("a");
      link.className = "text-link";
      link.href = authorUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Blog de ${text.author}`;
      item.append(link);
      byline.after(item);
    }
    container.querySelector("[data-featured-meta]").textContent = text.meta || readingMeta(text.html);
    container.classList.add("editorial-entry");
    const category = container.querySelector(".eyebrow");
    category.textContent = "Editorial";
    let time = container.querySelector("[data-publication-date]");
    if (!time) { time = document.createElement("time"); time.dataset.publicationDate = ""; time.className = "publication-date"; container.querySelector("[data-featured-meta]").after(time); }
    time.textContent = publicationDate(text.publishedAt);
    if (text.publishedAt) time.dateTime = text.publishedAt; else time.removeAttribute("datetime");
    if (text.coverImage) {
      const image = document.createElement("img");
      image.className = "story-cover";
      image.src = text.coverImage.src;
      image.alt = text.coverImage.alt;
      image.loading = "lazy";
      image.decoding = "async";
      if (isReader) container.querySelector(".story-header").after(image);
      else container.prepend(image);
    }
    const body = container.querySelector("[data-story-body]");
    if (body) {
      body.replaceChildren(textFragment(text.html));
      body.querySelectorAll("img").forEach((image) => { image.loading = "lazy"; image.decoding = "async"; });
    }
    const words = text.html ? plainText(text.html).split(/\s+/u) : [];
    const summary = text.excerpt ?? (words.slice(0, 40).join(" ") + (words.length > 40 ? "…" : ""));
    const excerpt = container.querySelector("[data-featured-excerpt]");
    if (excerpt) excerpt.textContent = summary;
    const description = container.querySelector("[data-featured-description]");
    if (description) description.hidden = true;
    container.querySelectorAll(".button[href]").forEach((link) => {
      link.href = `texto.html?id=${encodeURIComponent(text.id)}`;
      link.textContent = "Leer publicación";
      link.setAttribute("aria-label", `${link.textContent}: ${text.title}`);
    });
    return summary;
  }

  async function renderBlog() {
    const revision = ++requestRevision;
    const params = new URLSearchParams(location.search);
    const query = { page: params.get("pagina") || "1" };
    let data;
    if (cloud) {
      try { data = await getEditorial(`?pagina=${encodeURIComponent(query.page)}`); }
      catch (error) { if (revision !== requestRevision) return; throw error; }
      if (data.example) data = editorialPage([exampleCard()], query);
    } else data = editorialPage(localEntries.length ? localEntries : [exampleCard()], query);
    if (revision !== requestRevision) return;
    if (location.pathname + location.search !== urlFor(data.page)) history.replaceState(null, "", urlFor(data.page));
    content.hidden = false; errorNotice.hidden = true;
    content.replaceChildren();
    for (const text of data.items) {
      const card = initial.querySelector(".writing-card").cloneNode(true);
      card.querySelector("h2").id = `texto-${text.id}`;
      fill(card, text); content.append(card);
    }
    if (!data.total) {
      const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Todavía no hay publicaciones."; content.append(empty);
    }
    document.querySelectorAll("[data-featured-sample]").forEach((node) => { node.hidden = !data.items.some((item) => item.id === "ejemplo"); });
    const start = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    results.textContent = `${start}–${Math.min(data.page * data.pageSize, data.total)} de ${data.total} publicaciones · Página ${data.page} de ${data.pages}`;
    pagination.replaceChildren();
    function pageLink(label, page, disabled = false, current = false) {
      const node = document.createElement(disabled || current ? "span" : "a");
      node.textContent = label;
      node.className = "page-link";
      if (disabled) node.setAttribute("aria-disabled", "true");
      else if (current) { node.setAttribute("aria-current", "page"); node.setAttribute("aria-label", `Página ${page}, actual`); }
      else { node.href = urlFor(page); node.setAttribute("aria-label", /^\d+$/u.test(label) ? `Página ${page}` : label); }
      pagination.append(node);
    }
    pageLink("Anterior", data.page - 1, data.page === 1);
    const visible = new Set([1, data.pages, data.page - 2, data.page - 1, data.page, data.page + 1, data.page + 2].filter((page) => page >= 1 && page <= data.pages));
    let previous = 0;
    for (const page of [...visible].sort((a, b) => a - b)) {
      if (page > previous + 1) { const gap = document.createElement("span"); gap.textContent = "…"; gap.setAttribute("aria-hidden", "true"); pagination.append(gap); }
      pageLink(String(page), page, false, page === data.page); previous = page;
    }
    pageLink("Siguiente", data.page + 1, data.page === data.pages);
    pagination.hidden = data.pages === 1;
  }

  async function refresh() {
    try {
      if (!isReader) {
        if (!cloud) localEntries = loadShowcase(storage);
        await renderBlog();
        return;
      }
      let texts = [];
      const requested = new URLSearchParams(location.search).get("id");
      if (cloud) {
        const result = await getEditorial(`/entry${requested ? `?id=${encodeURIComponent(requested)}` : ""}`);
        if (result.text) texts = [validateFeaturedText(result.text)];
      } else {
        await reload();
        texts = loadShowcase(storage);
      }
      content.replaceChildren(...[...initial.childNodes].map((node) => node.cloneNode(true)));
      content.hidden = false;
      errorNotice.hidden = true;
      document.title = originalTitle;
      document.querySelector('meta[name="description"]').content = originalDescription;
      if (!texts.length && (!isReader || !requested || requested === "ejemplo")) {
        content.querySelector(".eyebrow").textContent = "Editorial · Ejemplo ficticio";
        document.querySelectorAll("[data-featured-sample]").forEach((node) => { node.hidden = false; });
        await initReactions(content, "ejemplo", storage, cloud, getEditorial);
        return;
      }
      document.querySelectorAll("[data-featured-sample]").forEach((node) => { node.hidden = true; });
      if (isReader) {
        const text = requested ? texts.find((item) => item.id === requested) : texts[0];
        if (!text) throw new Error("No encontramos este relato. Vuelve a Editorial para elegir un texto disponible.");
        const summary = fill(content, text);
        document.title = `${text.title} · Editorial`;
        document.querySelector('meta[name="description"]').content = summary;
        await initReactions(content, text.id, storage, cloud, getEditorial);
      }
    } catch (error) {
      content.hidden = true;
      errorNotice.hidden = false;
      errorNotice.textContent = `No se pudo cargar el texto destacado. ${error.message} No se han sustituido los datos. Revisa el texto desde Administración local.`;
      if (pagination) pagination.hidden = true;
    }
  }
  window.addEventListener("popstate", refresh);
  await refresh();
  window.addEventListener("content-changed", refresh);
  if (cloud) window.addEventListener("focus", refresh);
  window.addEventListener("storage", (event) => {
    if ([SHOWCASE_KEY, LEGACY_TEXT_KEY, null].includes(event.key) || event.key?.startsWith(REACTIONS_KEY)) refresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refresh();
  });
}
