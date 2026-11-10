import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { loadContacts, saveContacts, contactsVersion } from "./contact-settings.mjs";
import { beginLoading } from "./loading.mjs";

const el = (tag, text, className) => {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
};
const post = (path, body = {}) => apiRequest(path, { method: "POST", body });
const statusNames = { pending_confirmation: "Pendiente de confirmación", confirmed: "Confirmada", unsubscribed: "Baja", draft: "Borrador", queued: "En cola", scheduled: "Programada", sending: "En proceso", sent: "Aceptada por Gmail", cancelled: "Cancelada", needs_review: "Requiere revisión; no se reintentará automáticamente" };

export async function createSettingsAdmin() {
  const contacts = document.querySelector("#contacts-admin");
  if (!contacts) return;
  contacts.innerHTML = `
    <h2>Datos públicos de contacto</h2><p>El buzón público puede ser distinto de la cuenta que envía el boletín. Deja un campo vacío para ocultarlo.</p>
    <form id="contacts-form"><fieldset disabled><legend class="sr-only">Contacto público</legend>
    <div class="field"><label for="contact-whatsapp">WhatsApp con código de país</label><input id="contact-whatsapp" name="whatsappNumber" inputmode="tel" maxlength="24" placeholder="Ej.: +506 8888 8888"></div>
    <div class="field"><label for="contact-email">Correo público</label><input id="contact-email" name="email" type="email" maxlength="254"></div>
    <div class="button-row"><button type="submit" class="button">Guardar contactos</button><button type="button" class="button button-outline" id="reload-contacts">Recargar configuración</button></div>
    </fieldset><p role="status" class="form-status" aria-live="polite"></p></form>`;
  const contactForm = contacts.querySelector("form");
  const contactStatus = contacts.querySelector('[role="status"]');
  let version;
  async function reloadContacts() {
    try {
      const current = await loadContacts(); version = contactsVersion();
      for (const key of ["whatsappNumber", "email"]) contactForm.elements[key].value = current[key];
      contactForm.querySelector("fieldset").disabled = false;
    } catch (error) { contactStatus.textContent = `No se cargaron los contactos. ${error.message}`; }
  }
  const contactsReady = reloadContacts();
  contacts.querySelector("#reload-contacts").addEventListener("click", async () => {
    if (!confirm("¿Descartar cambios sin guardar y recargar los contactos?")) return;
    await reloadContacts();
  });
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const input = Object.fromEntries(new FormData(contactForm));
    contactForm.inert = true;
    try {
      await saveContacts(input, version); version = contactsVersion();
      contactStatus.textContent = "Contactos guardados. Las páginas públicas se actualizaron.";
    } catch (error) { contactStatus.textContent = `No se guardaron los contactos. ${error.message} Recarga la configuración antes de volver a guardar si cambió en otra sesión.`; }
    finally { contactForm.inert = false; }
  });

  const panel = document.querySelector("#mail-admin");
  panel.innerHTML = `
    <section class="section"><h2>Correo de Google Workspace</h2>
    <p>Conecta el buzón del dominio mediante OAuth. No se usa ni se guarda la contraseña de Google. Antes de conectar, crea un cliente OAuth web en tu proyecto de Google y habilita Gmail API.</p>
    <p class="notice" id="mail-readiness" role="status"></p>
    <form id="mail-settings-form"><fieldset disabled><legend class="sr-only">Configuración del remitente</legend>
    <div class="form-row"><div class="field"><label for="mail-domain">Dominio de Workspace *</label><input id="mail-domain" name="domain" required maxlength="253" placeholder="tudominio.com"></div><div class="field"><label for="mail-sender">Buzón remitente *</label><input id="mail-sender" name="sender" type="email" required maxlength="254"></div></div>
    <div class="form-row"><div class="field"><label for="mail-name">Nombre del remitente</label><input id="mail-name" name="senderName" maxlength="100"></div><div class="field"><label for="mail-reply">Dirección para respuestas</label><input id="mail-reply" name="replyTo" type="email" maxlength="254"></div></div>
    <div class="field"><label for="mail-client-id">ID de cliente OAuth de Google *</label><input id="mail-client-id" name="clientId" required maxlength="254"></div>
    <div class="field"><label for="mail-secret">Nuevo secreto del cliente (dejar vacío para conservarlo)</label><input id="mail-secret" name="clientSecret" type="password" autocomplete="new-password" maxlength="1024"></div>
    <p class="small-print">El dominio y el buzón deben coincidir con la cuenta autorizada. URI de retorno: <code id="mail-redirect"></code>. El secreto y el token se cifran en el servidor y nunca se guardan en localStorage.</p>
    <label class="checkbox-label"><input id="mail-enabled" type="checkbox" name="enabled"><span>Habilitar confirmaciones y campañas después de conectar la cuenta.</span></label>
    <div class="button-row"><button type="submit" class="button">Guardar configuración</button><button type="button" class="button button-outline" id="connect-google">Conectar Google Workspace</button><button type="button" class="button button-outline" id="test-mail">Enviar prueba a mi buzón</button><button type="button" class="text-button" id="disconnect-google">Desconectar</button></div></fieldset></form>
    <p id="mail-status" class="form-status" role="status" aria-live="polite"></p></section>
    <section class="section"><div class="section-heading"><h2>Lista de distribución</h2><button class="button button-outline" type="button" id="reload-subscribers">Actualizar lista</button></div>
    <p>Solo las direcciones confirmadas reciben campañas. Una baja nunca se reactiva desde administración. Eliminar borra el registro; conservar una baja mantiene su exclusión.</p>
    <div id="subscriber-list" class="admin-workshops"></div><button id="more-subscribers" class="text-button" type="button" hidden>Cargar más direcciones</button></section>
    <section class="section"><h2>Campañas y programación</h2><p>Los envíos usan hora de Costa Rica (UTC−6), con revisión cada cinco minutos y lotes de hasta 20 destinatarios. Gmail acepta el mensaje; no garantiza su entrega. Revisa las cuotas de tu cuenta antes de enviar.</p>
    <form id="campaign-form"><fieldset disabled><legend class="sr-only">Borrador de campaña</legend>
    <div class="field"><label for="campaign-subject">Asunto *</label><input id="campaign-subject" name="subject" required maxlength="150"></div>
    <div class="field"><label for="campaign-body">Contenido de texto *</label><textarea id="campaign-body" name="body" required rows="8" maxlength="10000"></textarea></div>
    <p class="small-print">Se añade un enlace de baja individual. El contenido se envía como texto simple.</p>
    <div class="button-row"><button type="submit" class="button">Guardar borrador</button><button id="new-campaign" type="button" class="button button-outline">Nuevo borrador</button></div></fieldset></form>
    <p id="campaign-status" class="form-status" role="status" aria-live="polite"></p>
    <div class="button-row"><button type="button" id="reload-campaigns" class="button button-outline">Actualizar campañas</button><button type="button" id="dispatch-mail" class="button button-outline">Procesar envíos pendientes</button></div>
    <div id="campaign-list" class="admin-workshops"></div><button id="more-campaigns" type="button" class="text-button" hidden>Cargar más campañas</button></section>`;
  const mailStatus = panel.querySelector("#mail-status");
  const campaignStatus = panel.querySelector("#campaign-status");
  const form = panel.querySelector("#mail-settings-form");
  const campaignForm = panel.querySelector("#campaign-form");
  let settingsVersion, settings = {}, editing = null, subscriberToken, campaignToken;
  let subscribersLoaded = false, campaignsLoaded = false;
  panel.querySelector("#mail-redirect").textContent = `${location.origin}/api/mail/google/callback`;
  if (!CLOUD_MODE) {
    panel.querySelector("#mail-readiness").textContent = "Los contactos se pueden probar localmente. La conexión de Google, la lista privada y las campañas solo están disponibles en Azure con una sesión administradora.";
    panel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    await contactsReady;
    return;
  }
  async function run(work, output = mailStatus) {
    panel.inert = true;
    try { await work(); }
    catch (error) { output.textContent = `No se completó la operación. ${error.message}`; }
    finally { panel.inert = false; }
  }
  async function loadMail() {
    const finish = beginLoading(panel.querySelector("#mail-readiness"), { label: "Cargando configuración de correo", shape: "lines", count: 1 });
    try {
    const result = await apiRequest("mail/settings");
    settings = result.value; settingsVersion = result.version;
    for (const key of ["domain", "sender", "senderName", "replyTo", "clientId"]) form.elements[key].value = settings[key];
    form.elements.enabled.checked = settings.enabled; form.elements.clientSecret.value = "";
    form.querySelector("fieldset").disabled = !settings.secretReady;
    campaignForm.querySelector("fieldset").disabled = false;
    panel.querySelector("#mail-readiness").textContent = `${settings.connected ? `Cuenta conectada: ${settings.account}.` : "Sin cuenta conectada: no se enviarán correos."} ${settings.enabled ? "Envíos habilitados." : "Envíos deshabilitados."} ${settings.schedulerEnabled ? "Programador de Azure activo." : "Sin programador: las campañas no se ejecutan automáticamente."} ${settings.secretReady ? "" : "Falta la clave privada del servicio en Azure."}`;
    panel.querySelector("#test-mail").disabled = !settings.connected;
    panel.querySelector("#disconnect-google").disabled = !settings.connected;
    panel.querySelector("#connect-google").disabled = !settings.hasClientSecret;
    } finally { finish(); }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), enabled: form.elements.enabled.checked };
    run(async () => {
      await apiRequest("mail/settings", { method: "PUT", body, headers: { "If-Match": settingsVersion } });
      form.elements.clientSecret.value = ""; await loadMail();
      await Promise.all([loadCampaigns(), loadSubscribers()]); mailStatus.textContent = "Configuración guardada. Conecta la cuenta y envía una prueba antes de habilitar campañas.";
    });
  });
  panel.querySelector("#connect-google").addEventListener("click", () => run(async () => {
    const { value } = await post("mail/google/connect"); location.assign(value.url);
  }));
  panel.querySelector("#test-mail").addEventListener("click", () => run(async () => { mailStatus.textContent = (await post("mail/test")).value.message; }));
  panel.querySelector("#disconnect-google").addEventListener("click", () => {
    if (!confirm("¿Eliminar la autorización local y detener los envíos? Las campañas pendientes se pausarán.")) return;
    run(async () => { mailStatus.textContent = (await post("mail/google/disconnect")).value.message; await loadMail(); await loadCampaigns(); });
  });
  async function loadSubscribers(append = false) {
    const finish = beginLoading(panel.querySelector("#subscriber-list"), { label: "Cargando suscripciones", count: 2, show: !subscribersLoaded });
    try {
    const { value } = await apiRequest(`mail/subscribers${append && subscriberToken ? `?continuationToken=${encodeURIComponent(subscriberToken)}` : ""}`);
    const list = panel.querySelector("#subscriber-list");
    if (!append) list.replaceChildren();
    for (const subscriber of value.items) {
      const card = el("article", undefined, "admin-workshop");
      card.append(el("h3", subscriber.email), el("p", statusNames[subscriber.status] || subscriber.status));
      const actions = el("div", undefined, "button-row");
      for (const [action, label] of [["confirm-request", "Reenviar confirmación"], ["unsubscribe", "Dar de baja"], ["delete", "Eliminar registro"]]) {
        if (action === "confirm-request" && subscriber.status !== "pending_confirmation") continue;
        if (action === "unsubscribe" && subscriber.status === "unsubscribed") continue;
        const button = el("button", label, "text-button"); button.type = "button";
        button.disabled = action === "confirm-request" && !settings.enabled;
        button.addEventListener("click", () => {
          if (!confirm(`¿${label} para ${subscriber.email}?`)) return;
          run(async () => {
            mailStatus.textContent = (await post(`mail/subscribers/${subscriber.id}/${action}`)).value.message;
            await loadSubscribers();
          });
        });
        actions.append(button);
      }
      card.append(actions); list.append(card);
    }
    subscriberToken = value.continuationToken;
    panel.querySelector("#more-subscribers").hidden = !subscriberToken;
    if (!list.children.length) list.append(el("p", "No hay solicitudes del boletín."));
    subscribersLoaded = true;
    } finally { finish(); }
  }
  async function loadCampaigns(append = false) {
    const finish = beginLoading(panel.querySelector("#campaign-list"), { label: "Cargando campañas", count: 2, show: !campaignsLoaded });
    try {
    const { value } = await apiRequest(`mail/campaigns${append && campaignToken ? `?continuationToken=${encodeURIComponent(campaignToken)}` : ""}`);
    const list = panel.querySelector("#campaign-list");
    if (!append) list.replaceChildren();
    for (const record of value.items.filter((item) => item.value)) {
      const campaign = record.value;
      const card = el("article", undefined, "admin-workshop");
      card.append(el("h3", campaign.subject), el("p", `${statusNames[campaign.status] || campaign.status} · ${campaign.sentCount || 0} aceptados por Gmail${campaign.recipientIds ? ` / ${campaign.recipientIds.length} seleccionados` : ""}`), el("p", campaign.body, "campaign-body"));
      if (campaign.sendAt) card.append(el("p", new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Costa_Rica" }).format(new Date(campaign.sendAt)) + " · Costa Rica"));
      if (campaign.error) card.append(el("p", campaign.error, "notice error-notice"));
      const actions = el("div", undefined, "button-row");
      if (campaign.status === "draft") {
        const edit = el("button", "Editar borrador", "button button-outline"); edit.type = "button";
        edit.addEventListener("click", () => {
          editing = { id: campaign.id, version: record.version };
          campaignForm.elements.subject.value = campaign.subject; campaignForm.elements.body.value = campaign.body; campaignForm.elements.subject.focus();
        });
        const send = el("button", "Enviar ahora", "button"); send.type = "button"; send.disabled = !settings.enabled;
        async function queue(sendAt) {
          if (!confirm(`¿${sendAt ? "Programar" : "Enviar"} «${campaign.subject}» a todas las direcciones confirmadas? Se respetarán las bajas antes de cada envío.`)) return;
          await run(async () => {
            campaignStatus.textContent = (await post(`mail/campaigns/${campaign.id}/queue`, { sendAt, version: record.version })).value.message;
            if (editing?.id === campaign.id) { editing = null; campaignForm.reset(); }
            await loadCampaigns();
          }, campaignStatus);
        }
        send.addEventListener("click", () => queue());
        const label = el("label", "Programar: fecha y hora de Costa Rica");
        label.htmlFor = `campaign-time-${campaign.id}`;
        const date = el("input"); date.type = "datetime-local"; date.id = label.htmlFor;
        const schedule = el("button", "Programar", "button button-outline"); schedule.type = "button"; schedule.disabled = !settings.enabled || !settings.schedulerEnabled;
        schedule.addEventListener("click", () => {
          const parsed = date.value ? new Date(`${date.value}:00-06:00`) : null;
          if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) { campaignStatus.textContent = "Elige una fecha futura en hora de Costa Rica."; date.focus(); return; }
          queue(parsed.toISOString());
        });
        const scheduling = el("div", undefined, "field"); scheduling.append(label, date, schedule);
        actions.append(edit, send); card.append(scheduling);
      }
      if (["scheduled", "queued"].includes(campaign.status)) {
        const cancel = el("button", "Cancelar campaña", "text-button"); cancel.type = "button";
        cancel.addEventListener("click", () => {
          if (!confirm(`¿Cancelar «${campaign.subject}»?`)) return;
          run(async () => { campaignStatus.textContent = (await post(`mail/campaigns/${campaign.id}/cancel`)).value.message; await loadCampaigns(); }, campaignStatus);
        }); actions.append(cancel);
      }
      card.append(actions); list.append(card);
    }
    campaignToken = value.continuationToken;
    panel.querySelector("#more-campaigns").hidden = !campaignToken;
    if (!list.children.length) list.append(el("p", "No hay campañas guardadas."));
    campaignsLoaded = true;
    } finally { finish(); }
  }
  campaignForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(campaignForm)), ...editing };
    run(async () => {
      const { value } = await post("mail/campaigns", body);
      editing = { id: value.id, version: value.version }; await loadCampaigns();
      campaignStatus.textContent = "Borrador guardado. No se envió ningún correo.";
    }, campaignStatus);
  });
  panel.querySelector("#new-campaign").addEventListener("click", () => {
    if (!confirm("¿Descartar cambios sin guardar y abrir un borrador nuevo?")) return;
    editing = null; campaignForm.reset(); campaignStatus.textContent = "";
  });
  panel.querySelector("#reload-subscribers").addEventListener("click", () => run(() => loadSubscribers()));
  panel.querySelector("#more-subscribers").addEventListener("click", () => run(() => loadSubscribers(true)));
  panel.querySelector("#reload-campaigns").addEventListener("click", () => run(() => loadCampaigns(), campaignStatus));
  panel.querySelector("#more-campaigns").addEventListener("click", () => run(() => loadCampaigns(true), campaignStatus));
  panel.querySelector("#dispatch-mail").addEventListener("click", () => run(async () => {
    const { value } = await post("mail/dispatch");
    campaignStatus.textContent = value.waitingForProvider ? "Los envíos siguen pausados: conecta y habilita Google Workspace." : value.busy ? "Otro proceso está enviando. Actualiza el estado en unos momentos." : `Se procesaron ${value.processed} destinatarios. ${value.remaining ? "Quedan pendientes; el programador continuará por lotes." : ""}`;
    await loadCampaigns();
  }, campaignStatus));
  await Promise.all([contactsReady, run(async () => { await loadMail(); await Promise.all([loadSubscribers(), loadCampaigns()]); })]);
}
