export const PAGE_COPY_KEY = "writing-page-copy:v1";
export const PAGE_COPY_PAGES = {
  home: {
    label: "Inicio", href: "index.html",
    defaults: {
      eyebrow: "Escritura creativa", title: "Un espacio para escribir.",
      intro: "Explora los talleres, consulta las próximas fechas y descubre los textos de la comunidad. La identidad y la presentación del proyecto se incorporarán más adelante.",
    },
  },
  services: {
    label: "Servicios", href: "servicios.html",
    defaults: {
      eyebrow: "Otras formas de escribir en compañía", title: "Servicios de escritura",
      intro: "Descubre propuestas a medida. Consulta los detalles de cada servicio y conversemos sobre lo que necesitas.",
    },
  },
  workshops: {
    label: "Talleres", href: "cursos.html",
    defaults: {
      eyebrow: "Los programas", title: "Talleres de escritura",
      intro: "Consulta la descripción, la frecuencia y las fechas de cada propuesta.",
    },
  },
  team: {
    label: "Nuestro equipo", href: "acerca-de.html",
    defaults: {
      eyebrow: "Presentación", title: "Acerca de nuestro equipo",
      intro: "Conoce a las personas que acompañan el proyecto. Sus presentaciones, fotografías y funciones se incorporarán cuando el equipo las proporcione.",
      sectionTitle: "Un espacio para presentar a nuestro equipo.",
      body: "Aquí compartiremos las trayectorias y los enfoques de quienes hacen posibles los talleres. Los nombres, las biografías y las fotografías están pendientes de confirmación.",
    },
  },
};

const commonFields = [
  { key: "eyebrow", label: "Texto sobre el título", maximum: 100 },
  { key: "title", label: "Título principal", maximum: 150, required: true },
  { key: "intro", label: "Texto introductorio", maximum: 2000, multiline: true },
];

export function pageCopyFields(page) {
  if (!Object.hasOwn(PAGE_COPY_PAGES, page)) throw new Error("Elige una página disponible.");
  return page === "team" ? [...commonFields,
    { key: "sectionTitle", label: "Título de la presentación del equipo", maximum: 200, required: true },
    { key: "body", label: "Presentación del equipo", maximum: 10000, multiline: true },
  ] : commonFields;
}

export const DEFAULT_PAGE_COPY = {
  version: 1, pages: Object.fromEntries(Object.entries(PAGE_COPY_PAGES).map(([key, page]) => [key, { ...page.defaults }])),
};

export function validatePageCopy(input) {
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!record(input) || input.version !== 1 || !record(input.pages) ||
    Object.keys(input).some((key) => !["version", "pages"].includes(key)) ||
    Object.keys(input.pages).some((key) => !Object.hasOwn(PAGE_COPY_PAGES, key))) {
    throw new Error("Los textos deben incluir las páginas disponibles en el formato de la versión 1.");
  }
  const pages = {};
  for (const [key, page] of Object.entries(PAGE_COPY_PAGES)) {
    const fields = pageCopyFields(key);
    const values = input.pages[key] === undefined ? {} : input.pages[key];
    if (!record(values) || Object.keys(values).some((field) => !fields.some(({ key }) => key === field))) throw new Error(`Revisa los campos de la página «${page.label}».`);
    pages[key] = {};
    for (const field of fields) {
      const value = values[field.key] === undefined ? page.defaults[field.key] : values[field.key];
      if (typeof value !== "string" || value.length > field.maximum || (field.required && !value.trim())) {
        throw new Error(`«${field.label}» de ${page.label} ${field.required ? "requiere texto y " : ""}admite hasta ${field.maximum} caracteres.`);
      }
      pages[key][field.key] = value.replace(/\r\n?/gu, "\n").trim();
    }
  }
  return { version: 1, pages };
}
