export const EDITORIAL_TIME_ZONE = "America/Costa_Rica";
export const EDITORIAL_PAGE_SIZE = 6;

export const COAUTHORED_SAMPLE = {
  id: "ejemplo-coautoria",
  title: "Dos voces, un mismo sendero",
  subtitle: "Una invitación a escribir en compañía y a escuchar otras miradas.",
  author: "Equipo del taller y Marina del Bosque (autorías ficticias)",
  authorUrl: "https://example.org/",
  tags: ["Escritura compartida", "Coautoría"],
  publishedAt: null,
  html: `<p><em>Publicación de demostración escrita a cuatro manos. Las autorías son ficticias y no corresponden a participantes reales. El enlace a example.org es un marcador de ejemplo, no el blog de una persona real.</em></p>
<p>Dejamos dos cuadernos abiertos sobre la mesa. En el primero había una frase: «El camino empezaba donde terminaba el ruido». En el segundo, una pregunta: «¿Y si el silencio también tuviera algo que contar?».</p>
<p>Decidimos intercambiarlos. Quien había escrito la frase tuvo que continuar la pregunta; quien había planteado la pregunta buscó un personaje que se atreviera a caminar. Al principio intentamos explicar nuestras intenciones. Después descubrimos que escuchar el texto de la otra persona era más interesante que defender el propio.</p>
<h2>Un ejercicio para compartir</h2>
<p>Escribe el inicio de una escena y deja una puerta abierta: un objeto fuera de lugar, una visita inesperada o una decisión todavía pendiente. Entrega la página a otra persona para que la continúe sin corregir lo anterior. Cuando el texto regrese, léelo en voz alta antes de añadir una nueva línea.</p>
<p>No se trata de adivinar lo que la otra persona quería decir. Se trata de reconocer una posibilidad que no habríamos encontrado a solas. A veces aparece una voz distinta; a veces, una pausa que necesitábamos.</p>
<p>Esta muestra también permite probar un <a href="https://example.org/">enlace externo de ejemplo</a> dentro del texto. El crédito de coautoría y su enlace aparecen por separado en la ficha y en esta página de lectura.</p>
<p>Al cerrar los cuadernos, ninguna de las dos voces había desaparecido. Habíamos encontrado una tercera: la de una conversación que seguía abierta.</p>`,
};

export function tagKey(value) {
  return value.trim().replace(/\s+/gu, " ").normalize("NFC").toLocaleLowerCase("es");
}

export function postMetadata(input) {
  if (input.subtitle != null && typeof input.subtitle !== "string") throw new Error("El subtítulo debe ser texto.");
  const subtitle = (input.subtitle || "").trim();
  if (subtitle.length > 300) throw new Error("El subtítulo admite hasta 300 caracteres.");
  if (input.tags != null && !Array.isArray(input.tags)) throw new Error("Las etiquetas deben ser una lista.");
  const tags = input.tags ?? [];
  if (tags.length > 10) throw new Error("Cada publicación admite hasta 10 etiquetas.");
  const unique = new Map();
  for (const value of tags) {
    if (typeof value !== "string" || /[,\u0000-\u001f\u007f]/u.test(value)) throw new Error("Cada etiqueta debe ser texto sin comas ni caracteres de control.");
    const name = value.trim().replace(/\s+/gu, " ").normalize("NFC");
    if (!name || name.length > 40) throw new Error("Cada etiqueta debe tener entre 1 y 40 caracteres.");
    if (!unique.has(tagKey(name))) unique.set(tagKey(name), name);
  }
  return { subtitle, tags: [...unique.values()] };
}

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

export function editorialPage(entries, { page = 1, tag = "" } = {}) {
  const sorted = [...entries].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || a.id.localeCompare(b.id, "en"));
  const counts = new Map();
  for (const entry of sorted) {
    for (const name of new Set((entry.tags || []).map(tagKey))) {
      const current = counts.get(name);
      if (current) current.count += 1;
      else counts.set(name, { key: name, name: entry.tags.find((item) => tagKey(item) === name), count: 1 });
    }
  }
  const selectedTag = typeof tag === "string" ? tagKey(tag) : "";
  const matching = selectedTag ? sorted.filter((entry) => (entry.tags || []).some((name) => tagKey(name) === selectedTag)) : sorted;
  const [featured = null, ...archive] = matching;
  const pages = Math.max(1, Math.ceil(archive.length / EDITORIAL_PAGE_SIZE));
  const requested = typeof page === "number" ? page : /^[1-9]\d*$/u.test(page) ? Number(page) : 1;
  const current = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const start = (current - 1) * EDITORIAL_PAGE_SIZE;
  return {
    featured, items: archive.slice(start, start + EDITORIAL_PAGE_SIZE),
    page: current, pages, total: matching.length, archiveTotal: archive.length, allTotal: sorted.length,
    pageSize: EDITORIAL_PAGE_SIZE, tag: selectedTag,
    tags: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
  };
}
