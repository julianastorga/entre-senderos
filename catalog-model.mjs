import { CLOUD_MODE } from "./app-config.mjs";
import { loadWorkshops, validateWorkshop, validateCatalog as validateLegacyCatalog, WORKSHOP_ACCENTS, WORKSHOP_PRICE } from "./workshops.mjs";
import { validateImage } from "./image-model.mjs";

export const CATALOG_KEY = "writing-catalog:v2";
export const DEFAULT_PROGRAMS = [
  { id: "niebla", name: "Sendero de la Niebla", description: "Una introducción a la escritura creativa con ejercicios breves, lecturas y espacio para experimentar.", details: "", accent: "pine" },
  { id: "paramo", name: "Sendero del Páramo", description: "Un taller de narrativa breve para desarrollar personajes, trabajar escenas y revisar un relato propio.", details: "", accent: "moss" },
  { id: "corteza", name: "Sendero de la Corteza", description: "Un espacio para explorar las capas de un texto y profundizar en el trabajo de revisión.", details: "", accent: "olive" },
  { id: "sotobosque", name: "Sotobosque", description: "Una exploración de la escritura a través de la imagen, el ritmo y la observación.", details: "", accent: "fern" },
  { id: "bosque-adentro", name: "Bosque Adentro", description: "Un recorrido para desarrollar un proyecto de escritura con acompañamiento y lectura compartida.", details: "", accent: "eucalyptus" },
];
export const DEFAULT_SERVICES = [
  { id: "talleres-personalizados", name: "Talleres personalizados", description: "Propuestas de escritura adaptadas a las necesidades de un grupo, equipo u organización.", details: "Conversemos sobre los objetivos, el formato y la duración para preparar una propuesta a medida.", accent: "sage" },
];

export function validateOffering(input, { allowDataImages = !CLOUD_MODE } = {}) {
  if (!input || typeof input !== "object") throw new Error("La propuesta no tiene un formato válido.");
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const offering = { id: text(input.id), name: text(input.name), description: text(input.description), details: text(input.details), accent: input.accent || "pine" };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(offering.id) || offering.name.length < 3 || offering.name.length > 100) throw new Error("Indica un nombre de entre 3 y 100 caracteres y un identificador válido.");
  if (!offering.description || offering.description.length > 1500 || offering.details.length > 20000 || !Object.hasOwn(WORKSHOP_ACCENTS, offering.accent)) throw new Error("Revisa la descripción, los detalles y el acento verde de la propuesta.");
  if (input.coverImage != null) offering.coverImage = validateImage(input.coverImage, { allowDataImages });
  return offering;
}

export function validateCatalogV2(input, options) {
  if (!input || input.version !== 2 || !Array.isArray(input.programs) || !Array.isArray(input.instances) || !Array.isArray(input.services)) throw new Error("El catálogo debe incluir talleres, ediciones y servicios de la versión 2.");
  const programs = input.programs.map((program) => validateOffering(program, options));
  const services = input.services.map((service) => validateOffering(service, options));
  if (new Set(programs.map((program) => program.id)).size !== programs.length || new Set(services.map((service) => service.id)).size !== services.length) throw new Error("Hay propuestas con identificadores repetidos.");
  const instances = [];
  for (const candidate of input.instances) {
    const program = programs.find((item) => item.id === candidate?.programId);
    if (!program) throw new Error("Cada edición debe pertenecer a un taller existente. Elimina primero sus ediciones antes de quitar un taller.");
    const valid = validateWorkshop({ ...candidate, name: program.name, description: program.description, accent: program.accent, coverImage: undefined }, instances, options);
    if (instances.some((item) => item.id === valid.id)) throw new Error("Hay ediciones con identificadores repetidos.");
    const { id, code, startDate, startTime, endTime, timeZone, cadence, weekInterval, weekdays, sessions, price } = valid;
    instances.push({ id, programId: program.id, code, startDate, startTime, endTime, timeZone, cadence, weekInterval, weekdays, sessions, price });
  }
  return { version: 2, programs, instances, services };
}

export function migrateWorkshops(workshops, options) {
  const programs = structuredClone(DEFAULT_PROGRAMS);
  const instances = [];
  const seeds = {
    niebla: { name: "Sendero de la Niebla", programId: "niebla" },
    paramo: { name: "Sendero del Páramo", programId: "paramo" },
    sotomonte: { name: "Sendero del Sotomonte", programId: "sotobosque" },
  };
  validateLegacyCatalog({ version: 1, workshops }, options).forEach((workshop, index) => {
    const seed = Object.hasOwn(seeds, workshop.id) && seeds[workshop.id].name === workshop.name ? seeds[workshop.id] : null;
    let program;
    if (seed) {
      program = programs.find((item) => item.id === seed.programId);
      program.description = workshop.description;
      program.accent = workshop.accent;
      if (workshop.coverImage) program.coverImage = workshop.coverImage;
    } else {
      program = { id: `legacy-${index}-${workshop.id.slice(0, 45)}`, name: workshop.name, description: workshop.description, details: "", accent: workshop.accent, ...(workshop.coverImage ? { coverImage: workshop.coverImage } : {}) };
      programs.push(program);
    }
    instances.push({ ...workshop, programId: program.id });
  });
  return validateCatalogV2({ version: 2, programs, instances, services: structuredClone(DEFAULT_SERVICES) }, options);
}

export function flattenInstances(catalog) {
  return catalog.instances.map((instance) => {
    const program = catalog.programs.find((item) => item.id === instance.programId);
    return { ...instance, name: program.name, description: program.description, accent: program.accent, price: WORKSHOP_PRICE, ...(program.coverImage ? { coverImage: program.coverImage } : {}) };
  });
}

export function loadCatalog(storage) {
  const value = storage.getItem(CATALOG_KEY);
  return value === null ? migrateWorkshops(loadWorkshops(storage)) : validateCatalogV2(JSON.parse(value));
}

export function saveCatalog(storage, input) {
  const catalog = validateCatalogV2(input);
  storage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}
