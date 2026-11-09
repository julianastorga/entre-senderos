import { validateNewsletterEmail } from "./email-validation.mjs";

export const DEFAULT_CONTACTS = Object.freeze({ whatsappNumber: "", email: "" });

export function validateContacts(input) {
  if (!input || typeof input.whatsappNumber !== "string" || typeof input.email !== "string") throw new Error("La configuración de contacto no es válida.");
  const phone = input.whatsappNumber.trim();
  if (phone && (!/^\+?[\d ()-]+$/u.test(phone) || !/^[1-9]\d{6,14}$/u.test(phone.replace(/\D/gu, "")))) throw new Error("Indica WhatsApp con código de país y entre 7 y 15 dígitos.");
  return { whatsappNumber: phone.replace(/\D/gu, ""), email: input.email.trim() ? validateNewsletterEmail(input.email) : "" };
}
