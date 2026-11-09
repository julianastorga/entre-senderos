import { CLOUD_MODE } from "./app-config.mjs";
import { validateImage } from "./image-model.mjs";

export const STORAGE_KEY = "writing-workshops:v1";
export const WORKSHOP_PRICE = 50;
export const WORKSHOP_TIME_ZONE = "America/Costa_Rica";
const DEFAULT_HOURS = Object.freeze({ startTime: "18:00", endTime: "20:00" });

export const CADENCES = Object.freeze({
  weekly: "Por semanas",
  fortnightly: "Cada dos semanas",
  monthly: "Cada mes",
});
export const WEEKDAYS = Object.freeze(["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]);
export const WORKSHOP_ACCENTS = Object.freeze({
  pine: { label: "Pino", color: "#2a4d3d" },
  moss: { label: "Musgo", color: "#48613b" },
  fern: { label: "Helecho", color: "#35634e" },
  olive: { label: "Oliva", color: "#5a6d46" },
  eucalyptus: { label: "Eucalipto", color: "#446d62" },
  sage: { label: "Salvia", color: "#48674d" },
});

export const DEFAULT_WORKSHOPS = [
  {
    id: "niebla", code: "NIE-01", name: "Sendero de la Niebla",
    description: "Una introducción a la escritura creativa con ejercicios breves, lecturas y espacio para experimentar.",
    startDate: "2027-01-19", cadence: "weekly", weekInterval: 1, weekdays: [2], sessions: 6,
    ...DEFAULT_HOURS, timeZone: WORKSHOP_TIME_ZONE, price: WORKSHOP_PRICE, accent: "pine",
  },
  {
    id: "paramo", code: "PAR-01", name: "Sendero del Páramo",
    description: "Un taller de narrativa breve para desarrollar personajes, trabajar escenas y revisar un relato propio.",
    startDate: "2027-03-04", cadence: "weekly", weekInterval: 1, weekdays: [4], sessions: 6,
    ...DEFAULT_HOURS, timeZone: WORKSHOP_TIME_ZONE, price: WORKSHOP_PRICE, accent: "moss",
  },
  {
    id: "sotomonte", code: "SOT-01", name: "Sendero del Sotomonte",
    description: "Una exploración de la escritura poética a través de la imagen, el ritmo y la observación.",
    startDate: "2027-04-10", cadence: "weekly", weekInterval: 2, weekdays: [6], sessions: 6,
    ...DEFAULT_HOURS, timeZone: WORKSHOP_TIME_ZONE, price: WORKSHOP_PRICE, accent: "fern",
  },
];

export class WorkshopValidationError extends Error {
  constructor(errors) {
    super(Object.values(errors).join(" "));
    this.name = "WorkshopValidationError";
    this.errors = errors;
  }
}

export function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("La fecha debe tener el formato AAAA-MM-DD.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("La fecha no existe.");
  }
  return date;
}

function dateString(date) {
  if (date.getUTCFullYear() > 9999) throw new Error("La fecha de cierre supera el año 9999.");
  return date.toISOString().slice(0, 10);
}

function recurrence(workshop) {
  const start = parseDate(workshop.startDate);
  if (!Object.hasOwn(CADENCES, workshop.cadence)) throw new Error("La frecuencia no es válida.");
  if (workshop.cadence === "monthly") return { cadence: "monthly", weekInterval: 1, weekdays: [] };
  const weekInterval = workshop.cadence === "fortnightly" ? 2 : workshop.weekInterval ?? 1;
  const weekdays = workshop.weekdays === undefined ? [start.getUTCDay() || 7] : workshop.weekdays;
  const errors = {};
  if (!Number.isInteger(weekInterval) || weekInterval < 1 || weekInterval > 52) errors.weekInterval = "Indica un intervalo de 1 a 52 semanas.";
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) || new Set(weekdays).size !== weekdays.length) {
    errors.weekdays = "Selecciona uno o más días de la semana, sin repeticiones.";
  } else if (!weekdays.includes(start.getUTCDay() || 7)) {
    errors.startDate = "La fecha de inicio debe coincidir con uno de los días seleccionados.";
  }
  if (Object.keys(errors).length) throw new WorkshopValidationError(errors);
  return { cadence: "weekly", weekInterval, weekdays: [...weekdays].sort((a, b) => a - b) };
}

export function sessionDates(workshop) {
  const start = parseDate(workshop.startDate);
  const schedule = recurrence(workshop);
  if (!Number.isInteger(workshop.sessions) || workshop.sessions < 1 || workshop.sessions > 52) {
    throw new Error("El número de encuentros debe estar entre 1 y 52.");
  }
  if (schedule.cadence === "weekly") {
    const monday = new Date(start);
    monday.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const dates = [];
    for (let week = 0; dates.length < workshop.sessions; week += schedule.weekInterval) {
      for (const weekday of schedule.weekdays) {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + week * 7 + weekday - 1);
        if (date < start) continue;
        dates.push(dateString(date));
        if (dates.length === workshop.sessions) break;
      }
    }
    return dates;
  }
  return Array.from({ length: workshop.sessions }, (_, index) => {
    const date = new Date(start);
    // Anchor every occurrence to the original day, clamping shorter months.
    date.setUTCDate(1);
    date.setUTCMonth(start.getUTCMonth() + index);
    const lastDay = new Date(date);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(start.getUTCDate(), lastDay.getUTCDate()));
    return dateString(date);
  });
}

export function validateWorkshop(input, existing = [], { allowDataImages = !CLOUD_MODE } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkshopValidationError({ name: "Los datos del taller no son válidos." });
  }
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const workshop = {
    id: text(input.id),
    code: text(input.code).toUpperCase(),
    name: text(input.name),
    description: text(input.description),
    startDate: text(input.startDate),
    startTime: text(input.startTime),
    endTime: text(input.endTime),
    timeZone: WORKSHOP_TIME_ZONE,
    cadence: text(input.cadence),
    weekInterval: input.weekInterval,
    weekdays: input.weekdays,
    sessions: input.sessions,
    price: WORKSHOP_PRICE,
    accent: input.accent === undefined ? (input.id === "paramo" ? "moss" : input.id === "sotomonte" ? "fern" : "pine") : text(input.accent),
  };
  const errors = {};
  if (input.coverImage != null) {
    try { workshop.coverImage = validateImage(input.coverImage, { allowDataImages }); }
    catch (error) { errors.coverImage = error.message; }
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(workshop.id) || ["all", "orientacion"].includes(workshop.id)) errors.id = "El identificador del taller no es válido o está reservado.";
  if (workshop.name.length < 3 || workshop.name.length > 100) errors.name = "Escribe un nombre de entre 3 y 100 caracteres.";
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(workshop.code)) errors.code = "Usa de 2 a 24 letras, números, guiones o guiones bajos para el código.";
  if (existing.some((item) => item.id !== workshop.id && item.code.toUpperCase() === workshop.code)) errors.code = "Ya existe un taller con ese código.";
  if (!workshop.description || workshop.description.length > 1500) errors.description = "Escribe una descripción de hasta 1500 caracteres.";
  if (!Object.hasOwn(WORKSHOP_ACCENTS, workshop.accent)) errors.accent = "Elige un tono verde de la paleta.";
  try {
    parseDate(workshop.startDate);
  } catch (error) {
    errors.startDate = error.message;
  }
  if (!Object.hasOwn(CADENCES, workshop.cadence)) errors.cadence = "Elige una frecuencia válida.";
  if (!Number.isInteger(workshop.sessions) || workshop.sessions < 1 || workshop.sessions > 52) errors.sessions = "Elige de 1 a 52 encuentros.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workshop.startTime)) errors.startTime = "Indica una hora de inicio válida.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workshop.endTime)) errors.endTime = "Indica una hora de cierre válida.";
  if (!errors.startTime && !errors.endTime && workshop.endTime <= workshop.startTime) errors.endTime = "La hora de cierre debe ser posterior al inicio, en el mismo día.";
  if (!Object.keys(errors).length) {
    try {
      Object.assign(workshop, recurrence(workshop));
      sessionDates(workshop);
    } catch (error) {
      if (error instanceof WorkshopValidationError) Object.assign(errors, error.errors);
      else errors.startDate = error.message;
    }
  }
  if (Object.keys(errors).length) throw new WorkshopValidationError(errors);
  return workshop;
}

export function validateCatalog(input, options) {
  if (!input || input.version !== 1 || !Array.isArray(input.workshops)) {
    throw new Error("El archivo debe ser un catálogo de talleres de la versión 1.");
  }
  const workshops = [];
  for (const candidate of input.workshops) {
    // Catalogs created before time fields use the editable example hours.
    const legacy = candidate && typeof candidate === "object" && !Object.hasOwn(candidate, "startTime") && !Object.hasOwn(candidate, "endTime");
    const workshop = validateWorkshop(legacy ? { ...candidate, ...DEFAULT_HOURS } : candidate, workshops, options);
    if (workshops.some((item) => item.id === workshop.id)) throw new Error("Hay identificadores de taller repetidos.");
    workshops.push(workshop);
  }
  return workshops;
}

export function loadWorkshops(storage) {
  const value = storage.getItem(STORAGE_KEY);
  return validateCatalog(value === null ? { version: 1, workshops: DEFAULT_WORKSHOPS } : JSON.parse(value));
}

export function saveWorkshops(storage, workshops) {
  const validated = validateCatalog({ version: 1, workshops });
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, workshops: validated }));
  return validated;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("es-419", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(value));
}

export function formatPrice(value) {
  return value === null ? "Por confirmar" : new Intl.NumberFormat("es-419", { style: "currency", currency: "USD" }).format(value) + " USD";
}

export function formatSchedule(workshop) {
  return `${workshop.startTime}–${workshop.endTime} · Costa Rica (UTC−6)`;
}

export function formatCadence(workshop) {
  const schedule = recurrence(workshop);
  if (schedule.cadence === "monthly") return "Cada mes";
  const days = new Intl.ListFormat("es", { type: "conjunction" }).format(schedule.weekdays.map((day) => WEEKDAYS[day]));
  return `${schedule.weekInterval === 1 ? "Cada semana" : `Cada ${schedule.weekInterval} semanas`} · ${days}`;
}
