import { STORAGE_KEY, WORKSHOP_ACCENTS, loadWorkshops, sessionDates, formatDate, formatPrice, formatSchedule, formatCadence } from "./workshops.mjs";
import { createCalendar } from "./calendar.mjs";
import { createAdmin } from "./admin.mjs";
import { initFeaturedView } from "./featured-text.mjs";
import { createFeaturedAdmin } from "./featured-admin.mjs";
import { CLOUD_MODE } from "./app-config.mjs";
import { contentStorage, refreshCatalog, refreshShowcase, apiRequest } from "./content-store.mjs";
import { validateNewsletterEmail } from "./email-validation.mjs";

document.documentElement.classList.add("js");

let canAdminister = true;
if (CLOUD_MODE) {
  document.querySelector(".preview-bar").textContent = "Aplicación de demostración · Contenido compartido en Azure · Identidad por definir";
  document.querySelectorAll('.footer-links a[href="admin.html"]').forEach((link) => { link.textContent = "Administración"; });
  if (document.querySelector("[data-pricing-rows]")) document.querySelector(".page-intro > p:last-child").textContent = "Consulta la descripción, la frecuencia y las fechas de cada propuesta. Los cambios de administración se comparten aquí y en el calendario.";
  if (document.querySelector(".backup-section > p")) document.querySelector(".backup-section > p").textContent = "Exporta el catálogo como copia de seguridad. Importar reemplaza el catálogo compartido de este entorno de Azure. El archivo no incluye los textos de la muestra.";
  if (document.querySelector("#workshop-form")) {
    canAdminister = false;
    const notice = document.querySelector("main > .notice");
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
    }
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

// Add verified contact details when they are provided.
const contact = Object.freeze({ whatsappNumber: "", email: "" });
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

if (contact.whatsappNumber) {
  if (!/^[1-9]\d{6,14}$/.test(contact.whatsappNumber)) throw new Error("Configura WhatsApp con el código de país y solo dígitos.");
  document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
    link.href = `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent("Hola. Me gustaría saber más sobre los talleres de escritura.")}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = false;
  });
  document.querySelectorAll("[data-whatsapp-pending]").forEach((label) => { label.hidden = true; });
  const status = document.querySelector("#whatsapp-status");
  if (status) status.textContent = "Escribe directamente para conversar sobre los talleres.";
}
if (contact.email) {
  document.querySelectorAll("[data-contact-email]").forEach((paragraph) => {
    const link = document.createElement("a");
    link.href = `mailto:${contact.email}`;
    link.textContent = contact.email;
    paragraph.replaceChildren(link);
  });
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderCatalog(workshops) {
  document.querySelectorAll("[data-workshop-cards]").forEach((container) => {
    container.replaceChildren();
    if (!workshops.length) container.append(element("p", "No hay talleres disponibles.", "empty-state"));
    workshops.forEach((workshop) => {
      const dates = sessionDates(workshop);
      const card = element("article", undefined, "course-card");
      card.style.setProperty("--workshop-accent", WORKSHOP_ACCENTS[workshop.accent].color);
      card.append(element("p", workshop.code, "eyebrow"), element("h3", workshop.name), element("p", workshop.description));
      const details = element("dl");
      for (const [label, value] of [
        ["Frecuencia", formatCadence(workshop)], ["Encuentros", String(workshop.sessions)],
        ["Inicio", formatDate(dates[0])], ["Cierre", formatDate(dates.at(-1))],
        ["Horario", formatSchedule(workshop)], ["Precio total", formatPrice(workshop.price)],
      ]) {
        const row = element("div");
        row.append(element("dt", label), element("dd", value));
        details.append(row);
      }
      const link = element("a", "Ver formulario de inscripción", "text-link");
      link.href = `contacto.html?curso=${encodeURIComponent(workshop.id)}#inscripcion`;
      link.setAttribute("aria-label", `Ver formulario de inscripción: ${workshop.name}`);
      card.append(details, link);
      container.append(card);
    });
  });
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
    const selected = select.value || new URLSearchParams(location.search).get("curso");
    select.replaceChildren(new Option("Elige una opción", ""));
    workshops.forEach((workshop) => select.add(new Option(`${workshop.name} (${workshop.code})`, workshop.id)));
    select.add(new Option("Me gustaría recibir orientación", "orientacion"));
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }
}

document.querySelectorAll("[data-preview-form]").forEach((form) => {
  const requiredFields = [...form.querySelectorAll("[required]")];
  const status = form.querySelector(".form-status");
  let newsletterSubmitted = false;
  function validateField(field) {
    let message = "";
    if (field.type === "checkbox" && !field.checked) message = CLOUD_MODE ? "Confirma tu consentimiento para enviar la solicitud." : "Confirma que entiendes que es una demostración.";
    else if (field.type !== "checkbox" && !field.value.trim()) message = field.tagName === "SELECT" ? "Elige un taller o solicita orientación." : "Completa este campo.";
    else if (field.type === "email" && !field.validity.valid) message = "Escribe un correo válido, por ejemplo: prueba@ejemplo.com.";
    if (!message && CLOUD_MODE && field.type === "email" && form.classList.contains("newsletter-form")) {
      try { validateNewsletterEmail(field.value); } catch (error) { message = error.message; }
    }
    const error = document.getElementById(field.getAttribute("aria-describedby"));
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
  form.querySelectorAll("[data-preview-fields]").forEach((fieldset) => { fieldset.disabled = false; });
  if (CLOUD_MODE) {
    form.querySelector(".checkbox-label span").textContent = "Autorizo el almacenamiento privado de estos datos para gestionar mi solicitud. No se enviarán campañas desde esta muestra.";
    form.querySelector('[type="submit"]').textContent = form.classList.contains("newsletter-form") ? "Solicitar suscripción" : "Enviar solicitud";
    form.querySelector(".small-print").textContent = "Los datos se guardan de forma privada en Azure. Esta demostración no realiza cobros ni envía correos automáticos.";
    if (form.classList.contains("newsletter-form")) document.querySelector("#newsletter > div > p:last-child").textContent = "Registra tu interés en recibir novedades de los talleres. El envío de campañas de correo aún no está conectado.";
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
await initFeaturedView(contentStorage, refreshShowcase, CLOUD_MODE);
if (canAdminister) await createFeaturedAdmin();

const adminTabs = document.querySelector('[role="tablist"]');
if (adminTabs && canAdminister) {
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
  selectTab(tabs[location.hash === "#muestra" || location.hash === "#featured-text-admin" ? 1 : 0]);
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      selectTab(tab);
      history.replaceState(null, "", index ? "#muestra" : "#talleres");
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
      history.replaceState(null, "", next ? "#muestra" : "#talleres");
    });
  });
} else if (adminTabs) {
  document.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = true; });
}

async function refreshWorkshops() {
  const alert = document.querySelector("#data-error");
  try {
    await refreshCatalog();
    const workshops = loadWorkshops(contentStorage);
    alert.hidden = true;
    alert.textContent = "";
    renderCatalog(workshops);
    calendar?.update(workshops);
    admin?.update(workshops);
  } catch (error) {
    alert.textContent = `No se pudo cargar el catálogo. ${error.message} No se han sustituido tus datos. ${CLOUD_MODE ? "Revisa la conexión y vuelve a intentarlo." : "Revisa el almacenamiento del navegador o importa una copia válida desde Administración local."}`;
    alert.hidden = false;
    document.querySelectorAll("[data-workshop-cards], [data-pricing-rows]").forEach((container) => container.replaceChildren());
    const select = document.querySelector("#signup-course");
    if (select) select.replaceChildren(new Option("Catálogo no disponible", ""));
    calendar?.update([]);
    admin?.lock();
  }
}

if (document.querySelector("[data-workshop-cards], [data-pricing-rows], #signup-course, #calendar-grid, #workshop-form")) {
  await refreshWorkshops();
  window.addEventListener("content-changed", refreshWorkshops);
  if (CLOUD_MODE) window.addEventListener("focus", refreshWorkshops);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) refreshWorkshops();
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
