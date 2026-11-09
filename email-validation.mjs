export function validateNewsletterEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(email)) {
    throw new Error("Indica un correo electrónico válido.");
  }
  const [local, domain] = email.split("@");
  if (local.length > 64 || !/^[a-z0-9.!#$%&'*+\/=?^_\x60{|}~-]+$/u.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..") || domain.split(".").some((label) => label.length > 63)) {
    throw new Error("Indica un correo electrónico válido.");
  }
  if (/(?:^|\.)(?:example\.(?:com|org|net|edu)|invalid|test|localhost|example|local)$/u.test(domain)) {
    throw new Error("Usa una dirección real, no un dominio reservado para ejemplos o pruebas.");
  }
  return email;
}
