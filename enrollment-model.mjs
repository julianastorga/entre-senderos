import { activeAndUpcomingEditions, workshopToday } from "./workshops.mjs";

export const ENROLLMENT_STATUSES = Object.freeze({
  interested: "Interesado",
  confirmed: "Confirmado",
  attending: "En asistencia",
  withdrawn: "Retirado",
  completed: "Finalizado",
});

export function validateEnrollmentStatus(status) {
  if (typeof status !== "string" || !Object.hasOwn(ENROLLMENT_STATUSES, status)) throw new Error("Elige un estado válido para la inscripción.");
  return status;
}

export function enrollmentStatus(record) {
  return validateEnrollmentStatus(record.status ?? "interested");
}

export function validateEnrollmentContact(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) throw new Error("Indica un correo electrónico válido.");
  if (!name || name.length > 100 || message.length > 2000) throw new Error("Revisa el nombre y el mensaje de la solicitud.");
  return { email, name, message };
}

export function validatePaymentMethod(value, status) {
  const method = value === undefined ? "" : value;
  if (typeof method !== "string" || method.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(method)) throw new Error("Indica un medio de pago de hasta 100 caracteres, sin datos bancarios.");
  if (status === "confirmed" && !method.trim()) throw new Error("Indica cómo se recibió el pago antes de confirmar la inscripción.");
  return method.trim();
}

export function editionAssignment(instance) {
  return { course: instance.id, programId: instance.programId, workshopName: instance.name, editionCode: instance.code, startDate: instance.startDate };
}

export function groupEnrollments(records, workshops, now = new Date()) {
  const today = workshopToday(now);
  const editions = activeAndUpcomingEditions(workshops, now).map((instance) => ({
    instance, active: instance.startDate <= today, records: [],
  }));
  const byId = new Map(editions.map((group) => [group.instance.id, group]));
  const other = [];
  for (const record of records) {
    const group = byId.get(record.value.course);
    if (group) group.records.push(record);
    else other.push(record);
  }
  return { editions, other };
}

export function validEnrollmentId(id) {
  return typeof id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(id);
}
