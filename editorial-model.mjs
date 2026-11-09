export const EDITORIAL_TIME_ZONE = "America/Costa_Rica";
export const EDITORIAL_PAGE_SIZE = 6;
export const ENTRY_KINDS = Object.freeze({ post: "Entrada del blog", participant: "Texto de participante" });

export function publicationMetadata(input) {
  const kind = input.kind === undefined ? "participant" : input.kind;
  if (!Object.hasOwn(ENTRY_KINDS, kind)) throw new Error("Elige entrada del blog o texto de participante.");
  const publishedAt = input.publishedAt ?? null;
  if (publishedAt !== null && (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt).toISOString() !== publishedAt)) throw new Error("La fecha de publicación no es válida.");
  return { kind, publishedAt };
}

export function publicationDate(value) {
  return value ? new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeStyle: "short", timeZone: EDITORIAL_TIME_ZONE }).format(new Date(value)) + " · Costa Rica (UTC−6)" : "Fecha de publicación no registrada";
}

export function editorialPage(entries, { kind = "all", page = 1 } = {}) {
  const selectedKind = Object.hasOwn(ENTRY_KINDS, kind) ? kind : "all";
  const filtered = entries.filter((entry) => selectedKind === "all" || entry.kind === selectedKind).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || a.id.localeCompare(b.id, "en"));
  const pages = Math.max(1, Math.ceil(filtered.length / EDITORIAL_PAGE_SIZE));
  const requested = typeof page === "number" ? page : /^[1-9]\d*$/u.test(page) ? Number(page) : 1;
  const current = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const start = (current - 1) * EDITORIAL_PAGE_SIZE;
  return { items: filtered.slice(start, start + EDITORIAL_PAGE_SIZE), page: current, pages, total: filtered.length, kind: selectedKind, pageSize: EDITORIAL_PAGE_SIZE };
}
