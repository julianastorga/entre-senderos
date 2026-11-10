import { STORAGE_KEY, WORKSHOP_ACCENTS, sessionDates, formatDate, formatPrice, formatSchedule, formatCadence } from "./workshops.mjs";
import { CATALOG_KEY, loadCatalog, flattenInstances } from "./catalog-model.mjs";
import { createCalendar } from "./calendar.mjs";
import { createAdmin } from "./admin.mjs";
import { initFeaturedView } from "./featured-text.mjs";
import { createFeaturedAdmin } from "./featured-admin.mjs";
import { CLOUD_MODE } from "./app-config.mjs";
import { contentStorage, refreshCatalog, refreshShowcase, apiRequest } from "./content-store.mjs";
import { validateNewsletterEmail } from "./email-validation.mjs";
import { imageElement } from "./image-model.mjs";
import { loadContacts } from "./contact-settings.mjs";
import { createSettingsAdmin } from "./admin-settings.mjs";
import { createEnrollmentAdmin } from "./enrollment-admin.mjs";
import { initPhoneInput, validatePhone } from "./assets/phone-input.js";
import { beginLoading } from "./loading.mjs";

document.documentElement.classList.add("js");
initNavigation();
const initialCatalogLoading = [
  ...[...document.querySelectorAll("[data-workshop-cards], [data-service-cards]")].map((target) => beginLoading(target, { label: "Cargando propuestas" })),
  beginLoading(document.querySelector("[data-offering-detail]"), { label: "Cargando taller", shape: "article", count: 1 }),
  beginLoading(document.querySelector("[data-pricing-rows]")?.closest(".table-scroll"), { label: "Cargando fechas y precios", shape: "lines" }),
  beginLoading(document.querySelector("#signup-course")?.closest(".field"), { label: "Cargando ediciones disponibles", shape: "lines", count: 1 }),
];

let canAdminister = true;
if (CLOUD_MODE) {
  document.querySelector(".preview-bar").textContent = "Aplicación de demostración · Contenido compartido en Azure · Identidad por definir";
  document.querySelectorAll('.footer-links a[href="admin.html"]').forEach((link) => { link.textContent = "Administración"; });
  if (document.querySelector("[data-pricing-rows]")) document.querySelector(".page-intro > p:last-child").textContent = "Consulta la descripción, la frecuencia y las fechas de cada propuesta. Los cambios de administración se comparten aquí y en el calendario.";
  if (document.querySelector(".backup-section > p")) document.querySelector(".backup-section > p").textContent = "Exporta el catálogo como copia de seguridad. Importar reemplaza el catálogo compartido de este entorno de Azure. El archivo no incluye los textos de la muestra.";
  if (document.querySelector("#workshop-form")) {
    canAdminister = false;
    const notice = document.querySelector("main > .notice");
    const finish = beginLoading(notice, { label: "Comprobando acceso de administración", shape: "lines", count: 1 });
    try {
      const { value: session } = await apiRequest("session");
      canAdminister = session.admin;
      document.querySelector("main h1").textContent = "Administración";
      document.querySelector(".page-intro > p:last-child").textContent = "Gestiona los talleres y los textos compartidos del sitio. Los cambios se guardan en Azure.";
      notice.replaceChildren(element("p", canAdminister
        ? `Sesión: ${session.login}. Los cambios se publican en este entorno de Azure.`
        : session.loginProvider ? "Inicia sesión con una cuenta autorizada para administrar el sitio."
          : "La administración está deshabilitada hasta configurar el dominio y Microsoft Entra ID de producción."));
      const providerLabel = session.loginProvider === "aad" ? "Microsoft Entra ID" : "GitHub";
      const login = element("a", session.authenticated ? "Cerrar sesión" : `Iniciar sesión con ${providerLabel}`, "text-link");
      login.href = session.authenticated ? "/.auth/logout?post_logout_redirect_uri=/" : `/.auth/login/${session.loginProvider}?post_login_redirect_uri=/admin.html`;
      if (session.authenticated || session.loginProvider) notice.append(login);
      document.querySelector("#cloud-submissions").hidden = !canAdminister;
      document.querySelector("#demo-login-panel").hidden = canAdminister || !session.demoLoginEnabled;
      document.querySelector("#demo-login-fields").disabled = !session.demoLoginEnabled;
      if (session.authMethod === "demo") {
        login.href = "#";
        login.addEventListener("click", async (event) => {
          event.preventDefault();
          try {
            await apiRequest("auth/logout", { method: "POST", body: {} });
            location.reload();
          } catch (error) {
            notice.append(element("p", `No se pudo cerrar la sesión. ${error.message}`));
          }
        });
      }
    } catch (error) {
      notice.textContent = `No se pudo comprobar la sesión. ${error.message}`;
    } finally { finish(); }
  }
}

document.querySelector("#demo-login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#demo-login-status");
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  status.textContent = "Comprobando las credenciales…";
  try {
    await apiRequest("auth/login", { method: "POST", body: { username: form.elements.username.value, password: form.elements.password.value } });
    form.elements.password.value = "";
    location.reload();
  } catch (error) {
    form.elements.password.value = "";
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function initNavigation() {
const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#site-nav");

if (menuToggle && navigation) {
  function closeMenu() {
    menuToggle.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  }
  menuToggle.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(expanded));
    navigation.classList.toggle("is-open", expanded);
  });
  navigation.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuToggle.focus();
    }
  });
  window.matchMedia("(min-width: 801px)").addEventListener("change", closeMenu);
}
}

let contactsLoaded = false;
async function refreshContacts() {
  if (!document.querySelector("[data-whatsapp-link], [data-contact-email]")) return;
  const finish = [...document.querySelectorAll("#whatsapp, .email-card")].map((target) => beginLoading(target, { label: "Cargando contactos", shape: "lines", count: 1, show: !contactsLoaded }));
  try {
  const contact = await loadContacts();
  if (document.querySelector("#contact-error")) document.querySelector("#contact-error").hidden = true;
  document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
    if (!contact.whatsappNumber) link.removeAttribute("href");
    else link.href = `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent("Hola. Me gustaría saber más sobre los talleres de escritura.")}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = !contact.whatsappNumber;
  });
  document.querySelectorAll("[data-whatsapp-pending]").forEach((label) => { label.hidden = Boolean(contact.whatsappNumber); });
  const status = document.querySelector("#whatsapp-status");
  if (status) status.textContent = contact.whatsappNumber ? "Escribe directamente para conversar sobre los talleres." : "El número de contacto aún no está publicado.";
  document.querySelectorAll("[data-contact-email]").forEach((paragraph) => {
    if (!contact.email) { paragraph.textContent = "La dirección de correo todavía no está publicada."; return; }
    const link = document.createElement("a");
    link.href = `mailto:${contact.email}`;
    link.textContent = contact.email;
    paragraph.replaceChildren(link);
  });
  contactsLoaded = true;
  }
  catch (error) {
    let notice = document.querySelector("#contact-error");
    if (!notice) { notice = element("p", undefined, "notice error-notice"); notice.id = "contact-error"; notice.setAttribute("role", "alert"); document.querySelector("main").prepend(notice); }
    notice.hidden = false; notice.textContent = `No se pudieron cargar los contactos. ${error.message}`;
    if (!contactsLoaded) {
      document.querySelectorAll("[data-whatsapp-pending]").forEach((label) => { label.hidden = true; });
      const status = document.querySelector("#whatsapp-status");
      if (status) status.textContent = "No se pudo cargar el contacto de WhatsApp.";
      document.querySelectorAll("[data-contact-email]").forEach((paragraph) => { paragraph.textContent = "No se pudo cargar el correo público."; });
    }
  } finally { finish.forEach((done) => done()); }
}
const contactsReady = refreshContacts();
window.addEventListener("contacts-changed", refreshContacts);
window.addEventListener("storage", (event) => { if (event.key === "writing-contact-settings:v1" || event.key === null) refreshContacts(); });

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderCatalog(catalog) {
  const workshops = flattenInstances(catalog);
  for (const [selector, offerings, type] of [["[data-workshop-cards]", catalog.programs, "taller"], ["[data-service-cards]", catalog.services, "servicio"]]) {
    document.querySelectorAll(selector).forEach((container) => {
      container.replaceChildren();
      if (!offerings.length) container.append(element("p", "No hay propuestas disponibles.", "empty-state"));
      offerings.forEach((offering) => {
      const card = element("article", undefined, "course-card");
      card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[offering.accent].color);
      card.append(element("p", type === "taller" ? "Taller de escritura" : "Servicio personalizado", "eyebrow"));
      if (offering.coverImage) card.append(imageElement(offering.coverImage, "workshop-cover"));
      card.append(element("h3", offering.name), element("p", offering.description));
      const count = workshops.filter((instance) => instance.programId === offering.id).length;
      card.append(element("p", type === "servicio" ? "Consulta el formato y las condiciones." : count ? `${count} ${count === 1 ? "edición disponible" : "ediciones disponibles"} · US$50 por edición` : "Próximas fechas por anunciar.", "small-print"));
      const link = element("a", type === "taller" ? "Conocer el taller y sus ediciones" : "Conocer el servicio", "text-link");
      link.href = `propuesta.html?tipo=${type}&id=${encodeURIComponent(offering.id)}`;
      link.setAttribute("aria-label", `${link.textContent}: ${offering.name}`);
      card.append(link);
      container.append(card);
      });
    });
  }
  const detail = document.querySelector("[data-offering-detail]");
  if (detail) {
    detail.replaceChildren();
    const params = new URLSearchParams(location.search);
    const isService = params.get("tipo") === "servicio";
    const offering = (isService ? catalog.services : catalog.programs).find((item) => item.id === params.get("id"));
    if (!offering) throw new Error("Esta propuesta ya no está disponible. Consulta Talleres o Servicios para elegir otra.");
    document.title = offering.name;
    const intro = element("header", undefined, "page-intro");
    const introContent = isService ? intro : element("div", undefined, "offering-hero-content");
    introContent.append(element("p", isService ? "Servicios · Propuesta a medida" : "Talleres · Programa de escritura", "eyebrow"), element("h1", offering.name), element("p", offering.description));
    if (!isService) {
      intro.classList.add("offering-hero");
      const image = imageElement(offering.coverImage || { src: "assets/workshop-cover.svg", alt: "Ilustración provisional de un sendero entre árboles." }, "offering-hero-image");
      image.loading = "eager";
      image.fetchPriority = "high";
      intro.append(image, introContent);
    }
    detail.append(intro);
    if (isService) {
      if (offering.coverImage) detail.append(imageElement(offering.coverImage, "offering-cover"));
    } else {
      if (!offering.coverImage) detail.append(element("p", "Portada de ejemplo · Imagen del taller por definir.", "small-print offering-cover-caption"));
      for (const [id, label, value, pending] of [
        ["modality", "Modalidad", offering.modality, ""],
        ["overview", "En qué consiste", offering.overview, "La descripción de la dinámica de este taller todavía no se ha publicado."],
        ["audience", "A quién está dirigido", offering.audience, "El público al que se dirige este taller todavía no se ha publicado."],
        ["objectives", "Objetivos", offering.objectives, "Los objetivos de este taller todavía no se han publicado."],
        ["reading", "Lecturas recomendadas", offering.requiredReading, "Las lecturas recomendadas todavía no se han publicado."],
      ]) {
        const section = element("section", undefined, "offering-details offering-section");
        const heading = element("h2", label);
        heading.id = `offering-${id}`;
        section.setAttribute("aria-labelledby", heading.id);
        section.append(heading);
        if (value) for (const paragraph of value.split(/\n\s*\n/u)) section.append(element("p", paragraph));
        else section.append(element("p", pending, "empty-state"));
        detail.append(section);
      }
    }
    if (isService || offering.details) {
      const body = element("section", undefined, "offering-details section");
      body.setAttribute("aria-label", "Detalles de la propuesta");
      for (const paragraph of offering.details.split(/\n\s*\n/u).filter(Boolean)) body.append(element("p", paragraph));
      detail.append(body);
    }
    if (isService) {
      const inquiry = element("a", "Consultar por este servicio", "button");
      inquiry.href = `contacto.html?servicio=${encodeURIComponent(offering.id)}#inscripcion`;
      detail.append(inquiry);
    } else {
      const editions = element("section", undefined, "section");
      editions.append(element("h2", "Ediciones y próximas fechas"));
      const instances = workshops.filter((instance) => instance.programId === offering.id);
      if (!instances.length) editions.append(element("p", "Todavía no hay ediciones programadas. Puedes consultar futuras fechas desde Contacto.", "empty-state"));
      const grid = element("div", undefined, "course-grid");
      for (const instance of instances) {
        const dates = sessionDates(instance);
        const card = element("article", undefined, "course-card");
        card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[offering.accent].color);
        card.append(element("h3", instance.code), element("p", `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`), element("p", `${formatCadence(instance)} · ${instance.sessions} encuentros`), element("p", formatSchedule(instance)), element("p", formatPrice(instance.price)));
        const signup = element("a", "Inscribirme en esta edición", "button");
        signup.setAttribute("aria-label", `Inscribirme en esta edición: ${instance.code}`);
        signup.href = `contacto.html?edicion=${encodeURIComponent(instance.id)}#inscripcion`;
        card.append(signup); grid.append(card);
      }
      editions.append(grid); detail.append(editions);
    }
  }
  const prices = document.querySelector("[data-pricing-rows]");
  if (prices) {
    prices.replaceChildren();
    workshops.forEach((workshop) => {
      const dates = sessionDates(workshop);
      const row = element("tr");
      const title = element("th", workshop.name);
      title.className = "workshop-cell";
      title.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[workshop.accent].color);
      title.scope = "row";
      title.append(element("small", ` · ${workshop.code}`));
      row.append(title, element("td", `${formatCadence(workshop)} · ${workshop.sessions} encuentros`),
        element("td", `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`),
        element("td", formatSchedule(workshop)), element("td", formatPrice(workshop.price)));
      prices.append(row);
    });
  }
  const select = document.querySelector("#signup-course");
  if (select) {
    const params = new URLSearchParams(location.search);
    const editionId = params.get("edicion");
    const serviceId = params.get("servicio");
    const selected = select.value || params.get("curso");
    if (editionId && serviceId) throw new Error("El enlace de solicitud no es válido.");
    select.replaceChildren(new Option("Elige una opción", ""));
    if (editionId || serviceId) {
      const instance = workshops.find((item) => item.id === editionId);
      const service = catalog.services.find((item) => item.id === serviceId);
      if (!instance && !service) throw new Error("La edición o el servicio de este enlace ya no está disponible.");
      select.replaceChildren(new Option(instance ? `${instance.name} · ${instance.code} · ${formatDate(instance.startDate)}` : service.name, instance?.id || `servicio:${service.id}`, true, true));
      document.querySelector("#inscripcion h2").textContent = instance ? `Inscripción: ${instance.name} · ${instance.code}` : `Consulta: ${service.name}`;
      if (instance) document.querySelector(".form-intro").textContent = `${formatDate(instance.startDate)} · ${formatCadence(instance)} · ${formatSchedule(instance)} · US$50. La solicitud no confirma un lugar ni realiza un cobro.`;
      return;
    }
    workshops.forEach((workshop) => select.add(new Option(`${workshop.name} · ${workshop.code} · ${formatDate(workshop.startDate)}`, workshop.id)));
    catalog.services.forEach((service) => select.add(new Option(`Servicio: ${service.name}`, `servicio:${service.id}`)));
    select.add(new Option("Me gustaría recibir orientación", "orientacion"));
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }
}

document.querySelectorAll("[data-preview-form]").forEach((form) => {
  initPhoneInput(form);
  const requiredFields = [...form.querySelectorAll("[required]")];
  const status = form.querySelector(".form-status");
  let newsletterSubmitted = false;
  function validateField(field) {
    let message = "";
    if (field.type === "checkbox" && !field.checked) message = CLOUD_MODE ? "Confirma tu consentimiento para enviar la solicitud." : "Confirma que entiendes que es una demostración.";
    else if (field.type !== "checkbox" && !field.value.trim()) message = field.tagName === "SELECT" ? "Elige un taller o solicita orientación." : "Completa este campo.";
    else if (field.type === "email" && !field.validity.valid) message = "Escribe un correo válido, por ejemplo: prueba@ejemplo.com.";
    if (!message && field.name === "phone") {
      try { validatePhone({ phone: field.value, phoneCountry: form.elements.phoneCountry.value }); } catch (error) { message = error.message; }
    }
    if (!message && CLOUD_MODE && field.type === "email" && form.classList.contains("newsletter-form")) {
      try { validateNewsletterEmail(field.value); } catch (error) { message = error.message; }
    }
    const error = (field.getAttribute("aria-describedby") || "").split(/\s+/u).map((id) => document.getElementById(id)).find((node) => node?.classList.contains("field-error"));
    if (error) error.textContent = message;
    field.setAttribute("aria-invalid", String(Boolean(message)));
    return !message;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (newsletterSubmitted) return;
    const invalidFields = requiredFields.filter((field) => !validateField(field));
    if (invalidFields.length) {
      status.textContent = "Revisa los campos señalados para continuar con la prueba.";
      invalidFields[0].focus();
      return;
    }
    if (CLOUD_MODE) {
      const button = form.querySelector('[type="submit"]');
      const fields = form.querySelector("[data-preview-fields]");
      const body = Object.fromEntries(new FormData(form));
      body.consent = form.elements.consent.checked;
      button.disabled = true;
      fields.disabled = true;
      status.textContent = "Enviando la solicitud…";
      try {
        const { value } = await apiRequest(form.classList.contains("newsletter-form") ? "newsletter" : "enrollment", { method: "POST", body });
        form.reset();
        status.textContent = value.message;
        if (form.classList.contains("newsletter-form")) newsletterSubmitted = true;
      } catch (error) {
        status.textContent = `No se confirmó el envío. ${error.message}`;
      } finally {
        fields.disabled = newsletterSubmitted;
        button.disabled = newsletterSubmitted;
      }
      return;
    }
    status.textContent = form.classList.contains("newsletter-form")
      ? "Prueba completada. No se enviaron datos ni se creó una suscripción. El boletín estará disponible cuando se conecte el servicio."
      : "Prueba completada. No se enviaron ni guardaron datos y no se reservó ningún lugar. Las inscripciones todavía no están abiertas.";
  });
  form.addEventListener("input", (event) => {
    status.textContent = "";
    if (event.target instanceof Element && event.target.getAttribute("aria-invalid") === "true") validateField(event.target);
  });
  form.querySelectorAll("[data-preview-fields]").forEach((fieldset) => { fieldset.disabled = Boolean(form.elements.course); });
  if (CLOUD_MODE) {
    form.querySelector(".checkbox-label span").textContent = form.classList.contains("newsletter-form") ? "Quiero recibir el boletín y autorizo guardar mi dirección. Solo recibiré campañas después de confirmar mi correo y podré darme de baja." : "Autorizo el almacenamiento privado de estos datos para gestionar mi solicitud.";
    form.querySelector('[type="submit"]').textContent = form.classList.contains("newsletter-form") ? "Solicitar suscripción" : "Enviar solicitud";
    form.querySelector(".small-print").textContent = "Los datos se guardan de forma privada en Azure. El envío requiere una cuenta de correo configurada; las campañas requieren confirmar la suscripción. No se realizan cobros.";
    if (form.classList.contains("newsletter-form")) document.querySelector("#newsletter > div > p:last-child").textContent = "Recibe novedades de los talleres. Cuando el correo esté conectado, te enviaremos un enlace para confirmar tu dirección.";
    else {
      document.querySelector(".form-intro").textContent = "Envía tu interés en un taller. La solicitud se guarda para su revisión, pero no confirma un lugar ni realiza un cobro.";
      document.querySelector(".page-intro > p:last-child").textContent = "Consulta los talleres y envía tu solicitud de inscripción. Para probar esta demostración, utiliza datos ficticios.";
    }
    if (form.classList.contains("newsletter-form")) {
      const fields = form.querySelector("[data-preview-fields]");
      fields.disabled = true;
      apiRequest("newsletter").then(({ value }) => {
        newsletterSubmitted = value.submittedThisSession;
        fields.disabled = newsletterSubmitted;
        if (newsletterSubmitted) status.textContent = "Ya enviaste una solicitud del boletín en esta sesión.";
      }).catch((error) => { status.textContent = `No se pudo habilitar el formulario. ${error.message}`; });
    }
  }
});

const calendar = createCalendar();
const admin = canAdminister ? createAdmin(refreshWorkshops) : null;
const viewsReady = [
  contactsReady,
  initFeaturedView(contentStorage, refreshShowcase, CLOUD_MODE, async (path, options) => (await apiRequest(`editorial${path}`, options)).value),
  ...(canAdminister ? [createFeaturedAdmin(), createSettingsAdmin(), createEnrollmentAdmin()] : []),
];

const adminTabs = document.querySelector('[role="tablist"]');
if (adminTabs && canAdminister) {
  for (const [id, label, panel, hash] of [["enrollments", "Inscripciones", "enrollments-panel", "inscripciones"], ["settings", "Contactos", "settings-panel", "contactos"], ["mail", "Boletín", "mail-panel", "boletin"]]) {
    const button = element("button", label); button.id = `tab-${id}`; button.type = "button";
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", panel); button.setAttribute("aria-selected", "false"); button.tabIndex = -1; button.dataset.tabHash = hash; adminTabs.append(button);
  }
  const tabs = [...adminTabs.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
    });
    if (focus) tab.focus();
  }
  adminTabs.hidden = false;
  const requestedHash = ["#muestra", "#featured-text-admin", "#editorial"].includes(location.hash) ? "blog" : location.hash.slice(1);
  selectTab(tabs.find((tab) => tab.dataset.tabHash === requestedHash) || tabs[0]);
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      selectTab(tab);
      history.replaceState(null, "", `#${tab.dataset.tabHash}`);
    });
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[next], true);
      history.replaceState(null, "", `#${tabs[next].dataset.tabHash}`);
    });
  });
} else if (adminTabs) {
  document.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = true; });
}

let catalogLoaded = false;
async function refreshWorkshops() {
  const alert = document.querySelector("#data-error");
  const finish = [
    beginLoading(document.querySelector("#calendar-grid"), { label: "Cargando calendario", shape: "calendar", show: !catalogLoaded }),
    beginLoading(document.querySelector("[data-schedule-list]"), { label: "Cargando fechas", show: !catalogLoaded }),
    ...[...document.querySelectorAll("[data-offering-list], #admin-workshops")].map((target) => beginLoading(target, { label: "Cargando catálogo guardado", count: 2, show: !catalogLoaded })),
  ];
  try {
    await refreshCatalog();
    const catalog = loadCatalog(contentStorage);
    const workshops = flattenInstances(catalog);
    alert.hidden = true;
    alert.textContent = "";
    renderCatalog(catalog);
    calendar?.update(workshops);
    admin?.update(catalog);
    const signup = document.querySelector("#signup-course");
    if (signup) signup.closest("[data-preview-fields]").disabled = false;
    catalogLoaded = true;
  } catch (error) {
    alert.textContent = `No se pudo cargar el catálogo. ${error.message} No se han sustituido tus datos. ${CLOUD_MODE ? "Revisa la conexión y vuelve a intentarlo." : "Revisa el almacenamiento del navegador o importa una copia válida desde Administración local."}`;
    alert.hidden = false;
    document.querySelectorAll("[data-workshop-cards], [data-service-cards], [data-offering-detail], [data-pricing-rows]").forEach((container) => container.replaceChildren());
    const select = document.querySelector("#signup-course");
    if (select) select.replaceChildren(new Option("Catálogo no disponible", ""));
    calendar?.unavailable();
    admin?.lock();
  } finally {
    initialCatalogLoading.forEach((done) => done());
    finish.forEach((done) => done());
  }
}
if (document.querySelector("[data-workshop-cards], [data-service-cards], [data-offering-detail], [data-pricing-rows], #signup-course, #calendar-grid, #workshop-form")) {
  await refreshWorkshops();
  window.addEventListener("content-changed", refreshWorkshops);
  if (CLOUD_MODE) window.addEventListener("focus", refreshWorkshops);
  window.addEventListener("storage", (event) => {
    if ([STORAGE_KEY, CATALOG_KEY, null].includes(event.key)) refreshWorkshops();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshWorkshops();
  });
}

document.querySelectorAll("[data-export-submissions]").forEach((button) => {
  button.addEventListener("click", async () => {
    const status = document.querySelector("#submissions-status");
    button.disabled = true;
    try {
      const items = [];
      let token = "";
      do {
        const query = new URLSearchParams({ kind: button.dataset.exportSubmissions });
        if (token) query.set("continuationToken", token);
        const { value } = await apiRequest(`submissions?${query}`);
        items.push(...value.items);
        token = value.continuationToken;
      } while (token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }));
      const link = element("a");
      link.href = url;
      link.download = `${button.dataset.exportSubmissions}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `Se generó la descarga con ${items.length} solicitudes. Contiene datos privados: guárdala con cuidado.`;
    } catch (error) {
      status.textContent = `No se pudo exportar la información. ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
});
await Promise.all(viewsReady);
