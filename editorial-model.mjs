export const EDITORIAL_TIME_ZONE = "America/Costa_Rica";
export const EDITORIAL_PAGE_SIZE = 6;

export function externalLink(value) {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (href.length > 2048 || !/^https?:\/\//iu.test(href) || /[\u0000-\u0020\u007f\\]/u.test(href)) return null;
  try {
    const url = new URL(href);
    return url.username || url.password ? null : url.href;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function authorCredit(input) {
  if (input.author != null && typeof input.author !== "string") throw new Error("El crédito de autoría debe ser un nombre o seudónimo.");
  const author = (input.author || "").trim();
  if (author.length > 150) throw new Error("El crédito de autoría admite hasta 150 caracteres.");
  const authorUrl = input.authorUrl == null || (typeof input.authorUrl === "string" && !input.authorUrl.trim()) ? "" : externalLink(input.authorUrl);
  if (authorUrl === null) throw new Error("El blog de la persona autora debe tener un enlace completo http:// o https://, sin credenciales.");
  if (authorUrl && !author) throw new Error("Indica el crédito de autoría para añadir su blog.");
  return { author, authorUrl };
}

export function publicationMetadata(input) {
  const publishedAt = input.publishedAt ?? null;
  if (publishedAt !== null && (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt).toISOString() !== publishedAt)) throw new Error("La fecha de publicación no es válida.");
  return { publishedAt };
}

export function publicationDate(value) {
  return value ? new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeStyle: "short", timeZone: EDITORIAL_TIME_ZONE }).format(new Date(value)) + " · Costa Rica (UTC−6)" : "Fecha de publicación no registrada";
}

export function editorialPage(entries, { page = 1 } = {}) {
  const sorted = [...entries].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || a.id.localeCompare(b.id, "en"));
  const pages = Math.max(1, Math.ceil(sorted.length / EDITORIAL_PAGE_SIZE));
  const requested = typeof page === "number" ? page : /^[1-9]\d*$/u.test(page) ? Number(page) : 1;
  const current = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const start = (current - 1) * EDITORIAL_PAGE_SIZE;
  return { items: sorted.slice(start, start + EDITORIAL_PAGE_SIZE), page: current, pages, total: sorted.length, pageSize: EDITORIAL_PAGE_SIZE };
}
