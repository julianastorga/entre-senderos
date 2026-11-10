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

export function validEnrollmentId(id) {
  return typeof id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(id);
}
