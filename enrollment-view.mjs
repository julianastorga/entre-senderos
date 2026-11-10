import { enrollmentOpen } from "./workshops.mjs";

export function newsletterInvitation(message = "Esta edición ya comenzó. Suscríbete al boletín para conocer los próximos talleres.") {
  const card = document.createElement("div");
  card.className = "newsletter-invitation";
  const title = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = "Próximas convocatorias";
  title.append(strong);
  const description = document.createElement("p");
  description.textContent = message;
  const link = document.createElement("a");
  link.className = "button button-outline";
  link.textContent = "Suscribirme al boletín";
  link.href = "index.html#newsletter";
  card.append(title, description, link);
  return card;
}

export function editionSignup(workshop, { label = "Inscribirme", className = "button" } = {}) {
  if (!enrollmentOpen(workshop)) return newsletterInvitation();
  const link = document.createElement("a");
  link.className = className;
  link.textContent = label;
  link.setAttribute("aria-label", `${label}: ${workshop.name} · ${workshop.code}`);
  link.href = `contacto.html?edicion=${encodeURIComponent(workshop.id)}#inscripcion`;
  return link;
}
