import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { validateNewsletterEmail } from "../email-validation.mjs";

export class MailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const initialSettings = { domain: "", sender: "", senderName: "", replyTo: "", clientId: "", enabled: false, encrypted: null };
export const MAIL_OAUTH_COOKIE = "__Secure-entre_senderos_mail_oauth";

export class MailService {
  constructor({ store, secret, publicOrigin, schedulerEnabled = false, clientFactory = (options) => new OAuth2Client(options), now = Date.now }) {
    this.store = store;
    this.secret = secret || "";
    this.origin = publicOrigin || "";
    this.schedulerEnabled = schedulerEnabled;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  requireSecret() {
    if (this.secret.length < 32 || !/^https:\/\/[^/?#]+$/u.test(this.origin)) throw new MailError(503, "Falta configurar la clave privada y el origen público del servicio de correo en Azure.");
  }

  encrypt(value) {
    this.requireSecret();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(this.secret).digest(), iv);
    return { iv: iv.toString("base64"), data: Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]).toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }

  decrypt(value) {
    if (!value) return {};
    this.requireSecret();
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(this.secret).digest(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8"));
  }

  async settings() { return this.store.read("mail-settings", initialSettings); }

  async publicSettings() {
    const { value, version } = await this.settings();
    const secrets = this.decrypt(value.encrypted);
    const { encrypted, ...safe } = value;
    return { value: { ...safe, hasClientSecret: Boolean(secrets.clientSecret), connected: Boolean(secrets.refreshToken), account: secrets.account || "", schedulerEnabled: this.schedulerEnabled, secretReady: this.secret.length >= 32 }, version };
  }

  async saveSettings(input, version) {
    const current = await this.settings();
    const domain = typeof input?.domain === "string" ? input.domain.trim().toLowerCase() : "";
    const senderName = typeof input?.senderName === "string" ? input.senderName.trim() : "";
    const clientId = typeof input?.clientId === "string" ? input.clientId.trim() : "";
    let sender, replyTo;
    try {
      validateNewsletterEmail(`validation@${domain}`);
      sender = validateNewsletterEmail(input.sender);
      replyTo = input.replyTo ? validateNewsletterEmail(input.replyTo) : "";
    } catch (error) { throw new MailError(400, error.message); }
    if (sender.split("@")[1] !== domain || senderName.length > 100 || /[\r\n]/u.test(senderName) || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/u.test(clientId)) throw new MailError(400, "Revisa el dominio, el remitente y el ID de cliente OAuth de Google.");
    if (typeof input.enabled !== "boolean" || (input.clientSecret !== undefined && (typeof input.clientSecret !== "string" || input.clientSecret.length > 1024))) throw new MailError(400, "La configuración de correo no es válida.");
    const secrets = this.decrypt(current.value.encrypted);
    if (clientId !== current.value.clientId && !input.clientSecret?.trim()) throw new MailError(400, "Indica el secreto del nuevo cliente OAuth.");
    if (clientId !== current.value.clientId || domain !== current.value.domain) { delete secrets.refreshToken; delete secrets.account; }
    if (input.clientSecret?.trim()) secrets.clientSecret = input.clientSecret.trim();
    if (!secrets.clientSecret) throw new MailError(400, "Indica el secreto de cliente OAuth de Google.");
    if (secrets.refreshToken && sender !== secrets.account) throw new MailError(400, "El remitente debe coincidir con la cuenta conectada. Desconecta primero para cambiar de buzón.");
    if (input.enabled && !secrets.refreshToken) throw new MailError(400, "Conecta primero una cuenta de Google Workspace.");
    await this.store.write("mail-settings", { domain, sender, senderName, replyTo, clientId, enabled: input.enabled, encrypted: this.encrypt(secrets) }, version);
    return this.publicSettings();
  }

  client(settings, secrets) {
    return this.clientFactory({ clientId: settings.clientId, clientSecret: secrets.clientSecret, redirectUri: `${this.origin}/api/mail/google/callback` });
  }

  async startOAuth() {
    this.requireSecret();
    const { value, version } = await this.settings();
    const secrets = this.decrypt(value.encrypted);
    if (!value.clientId || !secrets.clientSecret || !value.domain) throw new MailError(400, "Guarda primero la configuración OAuth y el dominio.");
    const client = this.client(value, secrets);
    const proof = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString("base64url");
    await this.store.write(`mail-oauth/${digest(state)}`, { verifier: proof.codeVerifier, settingsVersion: version, expiresAt: this.now() + 600_000, consumed: false }, "initial");
    return {
      state,
      url: client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"], hd: value.domain, state, code_challenge_method: "S256", code_challenge: proof.codeChallenge }),
    };
  }

  async finishOAuth({ state, code, cookieState }) {
    if (!/^[\w-]{43}$/u.test(state || "") || !equal(state, cookieState) || typeof code !== "string" || !code || code.length > 4096) throw new MailError(400, "La autorización no es válida. Inicia la conexión de nuevo.");
    const pending = await this.store.read(`mail-oauth/${digest(state)}`, null);
    if (!pending.value || pending.value.consumed || pending.value.expiresAt <= this.now()) throw new MailError(400, "La autorización caducó o ya se utilizó.");
    await this.store.write(`mail-oauth/${digest(state)}`, { ...pending.value, consumed: true, verifier: "" }, pending.version);
    const current = await this.settings();
    if (current.version !== pending.value.settingsVersion) throw new MailError(409, "La configuración cambió durante la autorización. Conecta de nuevo.");
    const secrets = this.decrypt(current.value.encrypted);
    const client = this.client(current.value, secrets);
    const { tokens } = await client.getToken({ code, codeVerifier: pending.value.verifier });
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: current.value.clientId });
    const claims = ticket.getPayload();
    if (claims?.email_verified !== true || claims.hd?.toLowerCase() !== current.value.domain || !tokens.refresh_token) throw new MailError(403, "Autoriza una cuenta verificada del dominio de Google Workspace configurado y permite el acceso sin conexión.");
    const account = validateNewsletterEmail(claims.email);
    if (account.split("@")[1] !== current.value.domain) throw new MailError(403, "La cuenta no pertenece al dominio configurado.");
    if (account !== current.value.sender) throw new MailError(403, "Conecta el mismo buzón indicado como remitente.");
    await this.store.write("mail-settings", { ...current.value, enabled: false, encrypted: this.encrypt({ ...secrets, refreshToken: tokens.refresh_token, account }) }, current.version);
  }

  async disconnect() {
    const current = await this.settings();
    const secrets = this.decrypt(current.value.encrypted);
    delete secrets.refreshToken;
    delete secrets.account;
    await this.store.write("mail-settings", { ...current.value, enabled: false, encrypted: this.encrypt(secrets) }, current.version);
  }

  async ready() {
    const { value } = await this.settings();
    return value.enabled && Boolean(this.decrypt(value.encrypted).refreshToken);
  }

  unsubscribeToken(id) {
    this.requireSecret();
    return `${id}.${createHmac("sha256", this.secret).update(`newsletter-unsubscribe:${id}`).digest("hex")}`;
  }

  async sendMessage({ to, subject, body, subscriberId, test = false }) {
    const { value } = await this.settings();
    const secrets = this.decrypt(value.encrypted);
    if (!secrets.refreshToken || (!test && !value.enabled)) throw new MailError(400, "Conecta y habilita Google Workspace antes de enviar correos.");
    const recipient = validateNewsletterEmail(to);
    const unsubscribe = subscriberId ? `${this.origin}/newsletter.html?action=unsubscribe&token=${this.unsubscribeToken(subscriberId)}` : null;
    const message = new MailComposer({
      from: { name: value.senderName, address: value.sender }, to: recipient, replyTo: value.replyTo || undefined,
      subject, text: `${body}${unsubscribe ? `\n\nPara dejar de recibir estos correos:\n${unsubscribe}` : ""}`,
      ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${this.origin}/api/mail/unsubscribe?token=${encodeURIComponent(this.unsubscribeToken(subscriberId))}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      disableFileAccess: true, disableUrlAccess: true,
    });
    const raw = (await message.compile().build()).toString("base64url");
    const client = this.client(value, secrets);
    client.setCredentials({ refresh_token: secrets.refreshToken });
    const result = await client.request({ url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", method: "POST", data: { raw }, timeout: 10000, retry: false });
    if (!result.data?.id) throw new MailError(502, "Google no confirmó el resultado del envío.");
    return result.data.id;
  }

  async sendTest() {
    const { value } = await this.publicSettings();
    if (!value.account) throw new MailError(400, "Conecta Google Workspace antes de enviar una prueba.");
    await this.sendMessage({ to: value.account, subject: "Prueba de correo del sitio de talleres", body: "Esta es una prueba solicitada desde la administración. No se envió ninguna campaña a la lista.", test: true });
  }

  async subscribers(token) {
    const page = await this.store.jsonPage("submissions/newsletter/", token);
    return { items: page.items.filter((item) => item.value).map(({ id, value }) => ({ id, email: value.email, status: value.status || "pending_confirmation", createdAt: value.createdAt })), continuationToken: page.continuationToken };
  }

  async requestConfirmation(id) {
    const record = await this.store.read(`submissions/newsletter/${id}`, null);
    if (!record.value) throw new MailError(404, "No encontramos esta dirección.");
    if (record.value.status === "confirmed") return;
    if (record.value.status === "unsubscribed") throw new MailError(409, "Esta dirección solicitó la baja. No se reenviará una confirmación.");
    const token = randomBytes(32).toString("base64url");
    await this.store.write(`submissions/newsletter/${id}`, { ...record.value, status: "pending_confirmation", confirmationHash: digest(token), confirmationExpiresAt: this.now() + 24 * 60 * 60_000 }, record.version);
    try {
      await this.sendMessage({ to: record.value.email, subject: "Confirma tu suscripción al boletín", body: `Solicitaste recibir novedades de los talleres. Confirma tu dirección en este enlace antes de 24 horas:\n\n${this.origin}/newsletter.html?action=confirm&token=${id}.${token}\n\nSi no lo solicitaste, no confirmes el enlace. No recibirás campañas sin confirmación.` });
    } catch (error) {
      if (error instanceof MailError) throw error;
      throw new MailError(502, "La dirección quedó pendiente, pero Google no confirmó el envío de la confirmación. Revisa la conexión antes de reenviar.");
    }
  }

  async confirm(token) {
    const match = /^([a-f0-9]{64})\.([\w-]{43})$/u.exec(token || "");
    if (!match) throw new MailError(400, "El enlace de confirmación no es válido.");
    const record = await this.store.read(`submissions/newsletter/${match[1]}`, null);
    if (!record.value || record.value.confirmationExpiresAt <= this.now() || !equal(record.value.confirmationHash, digest(match[2]))) throw new MailError(400, "El enlace caducó o ya se utilizó.");
    const { confirmationHash, confirmationExpiresAt, ...value } = record.value;
    await this.store.write(`submissions/newsletter/${match[1]}`, { ...value, status: "confirmed", confirmedAt: new Date(this.now()).toISOString() }, record.version);
  }

  async unsubscribe(token) {
    const match = /^([a-f0-9]{64})\.[a-f0-9]{64}$/u.exec(token || "");
    if (!match || !equal(token, this.unsubscribeToken(match[1]))) throw new MailError(400, "El enlace de baja no es válido.");
    await this.subscriberAction(match[1], "unsubscribe");
  }

  async subscriberAction(id, action) {
    if (!/^[a-f0-9]{64}$/u.test(id) || !["confirm-request", "unsubscribe", "delete"].includes(action)) throw new MailError(400, "La acción de lista no es válida.");
    const name = `submissions/newsletter/${id}`;
    const record = await this.store.read(name, null);
    if (!record.value) throw new MailError(404, "No encontramos esta dirección.");
    if (action === "confirm-request") return this.requestConfirmation(id);
    if (action === "delete") return this.store.deleteJson(name, record.version);
    const { confirmationHash, confirmationExpiresAt, ...value } = record.value;
    await this.store.write(name, { ...value, status: "unsubscribed", unsubscribedAt: new Date(this.now()).toISOString() }, record.version);
  }

  async campaigns(token) { return this.store.jsonPage("campaigns/", token); }

  async saveCampaign(input) {
    const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
    const body = typeof input?.body === "string" ? input.body.trim() : "";
    if (!subject || subject.length > 150 || /[\r\n]/u.test(subject) || !body || body.length > 10000) throw new MailError(400, "Indica un asunto de hasta 150 caracteres y contenido de hasta 10.000 caracteres.");
    const id = input.id || randomUUID();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id)) throw new MailError(400, "La campaña no es válida.");
    const current = await this.store.read(`campaigns/${id}`, null);
    if (current.value && current.value.status !== "draft") throw new MailError(409, "Solo se pueden editar borradores. Cancela primero una campaña programada.");
    if (current.value && input.version !== current.version) throw new MailError(409, "El borrador cambió en otra sesión. Vuelve a abrirlo.");
    return this.store.write(`campaigns/${id}`, { id, subject, body, status: "draft", createdAt: current.value?.createdAt || new Date(this.now()).toISOString() }, current.version);
  }

  async queueCampaign(id, sendAt, version) {
    if (!(await this.ready())) throw new MailError(400, "Conecta y habilita el correo antes de enviar o programar una campaña.");
    if (sendAt && (!this.schedulerEnabled || !Number.isFinite(Date.parse(sendAt)) || Date.parse(sendAt) <= this.now())) throw new MailError(400, "Habilita el programador de Azure e indica una fecha futura.");
    const current = await this.store.read(`campaigns/${id}`, null);
    if (!current.value || current.value.status !== "draft") throw new MailError(409, "Solo se pueden enviar o programar borradores.");
    if (version !== current.version) throw new MailError(409, "El borrador cambió. Vuelve a abrirlo antes de enviarlo.");
    const recipients = [];
    let continuationToken;
    do {
      const page = await this.subscribers(continuationToken);
      recipients.push(...page.items.filter((item) => item.status === "confirmed").map((item) => item.id));
      continuationToken = page.continuationToken;
    } while (continuationToken);
    if (!recipients.length) throw new MailError(400, "No hay suscriptores confirmados para esta campaña.");
    await this.store.write(`campaigns/${id}`, { ...current.value, status: sendAt ? "scheduled" : "queued", sendAt: sendAt || new Date(this.now()).toISOString(), recipientIds: recipients, sentCount: 0, nextRecipient: 0 }, current.version);
  }

  async cancelCampaign(id) {
    const current = await this.store.read(`campaigns/${id}`, null);
    if (!current.value || !["scheduled", "queued"].includes(current.value.status)) throw new MailError(409, "La campaña ya se está enviando o no se puede cancelar.");
    await this.store.write(`campaigns/${id}`, { ...current.value, status: "cancelled" }, current.version);
  }

  async dispatch() {
    if (!(await this.ready())) return { processed: 0, waitingForProvider: true };
    const lock = await this.store.read("mail-dispatch-lock", null);
    if (lock.value?.until > this.now()) return { processed: 0, busy: true };
    let held;
    try { held = await this.store.write("mail-dispatch-lock", { until: this.now() + 120_000 }, lock.version); }
    catch (error) { if ([409, 412].includes(error.statusCode)) return { processed: 0, busy: true }; throw error; }
    let processed = 0;
    const started = Date.now();
    try {
      let continuationToken;
      do {
        const page = await this.campaigns(continuationToken);
        for (const item of page.items) {
          let current = await this.store.read(`campaigns/${item.id}`, null);
          if (!current.value || !["queued", "scheduled", "sending"].includes(current.value.status) || Date.parse(current.value.sendAt) > this.now()) continue;
          if (current.value.status !== "sending") current = await this.store.write(`campaigns/${item.id}`, { ...current.value, status: "sending" }, current.version);
          for (let index = current.value.nextRecipient || 0; index < current.value.recipientIds.length; index += 1) {
            if (processed >= 20 || Date.now() - started > 15000) return { processed, remaining: true };
            const id = current.value.recipientIds[index];
            const recipient = await this.store.read(`submissions/newsletter/${id}`, null);
            if (recipient.value?.status !== "confirmed") {
              current = await this.store.write(`campaigns/${item.id}`, { ...current.value, nextRecipient: index + 1 }, current.version);
              continue;
            }
            const name = `deliveries/${item.id}/${id}`;
            const receipt = await this.store.read(name, null);
            if (receipt.value?.status === "accepted") {
              current = await this.store.write(`campaigns/${item.id}`, { ...current.value, nextRecipient: index + 1, sentCount: current.value.sentCount + 1 }, current.version);
              continue;
            }
            if (receipt.value) {
              await this.store.write(`campaigns/${item.id}`, { ...current.value, status: "needs_review", error: "Hay un envío sin resultado confirmado. Revísalo en Gmail antes de intentar otra campaña." }, current.version);
              break;
            }
            const reserved = await this.store.write(name, { status: "in_flight" }, receipt.version);
            try {
              const providerId = await this.sendMessage({ to: recipient.value.email, subject: current.value.subject, body: current.value.body, subscriberId: id });
              await this.store.write(name, { status: "accepted", providerId }, reserved.version);
              processed += 1;
              current = await this.store.write(`campaigns/${item.id}`, { ...current.value, sentCount: current.value.sentCount + 1, nextRecipient: index + 1 }, current.version);
            } catch {
              await this.store.write(`campaigns/${item.id}`, { ...current.value, status: "needs_review", error: "Google no confirmó un envío. No lo reintentamos automáticamente para evitar duplicados; revisa la carpeta Enviados y la autorización." }, current.version);
              break;
            }
          }
          const latest = await this.store.read(`campaigns/${item.id}`, null);
          if (latest.value.status === "sending") await this.store.write(`campaigns/${item.id}`, { ...latest.value, status: "sent", completedAt: new Date(this.now()).toISOString() }, latest.version);
        }
        continuationToken = page.continuationToken;
      } while (continuationToken && processed < 20 && Date.now() - started <= 15000);
      return { processed };
    } finally {
      try { await this.store.write("mail-dispatch-lock", { until: 0 }, held.version); }
      catch (error) { if (![409, 412].includes(error.statusCode)) throw error; }
    }
  }
}
