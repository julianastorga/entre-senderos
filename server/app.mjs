import sanitizeHtml from "sanitize-html";
import { flattenInstances, validateCatalogV2 } from "../catalog-model.mjs";
import { readCatalog } from "./catalog-store.mjs";
import { MAX_TEXT_SIZE, validateShowcase } from "../featured-text.mjs";
import { validateNewsletterEmail } from "../email-validation.mjs";
import { verifyMailDomain } from "./mail-domain.mjs";
import { MAX_IMAGE_BYTES, MAX_STORY_IMAGES, IMAGE_PATH, imageMime, isImageSource } from "../image-model.mjs";
import { imageSize } from "image-size";
import { validateContacts, DEFAULT_CONTACTS } from "../contact-model.mjs";
import { MailError, MAIL_OAUTH_COOKIE } from "./mail-service.mjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decodeHTML } from "entities";
import { editorialPage, externalLink, isExamplePost, postMetadata } from "../editorial-model.mjs";
import { REACTIONS, emptyReactions, reactionSummary, setReaction } from "../reaction-model.mjs";

const newsletterCookie = "__Secure-entre_senderos_newsletter";
const reactionsCookie = "__Host-entre_senderos_reactions";
const newsletterSubmitted = (cookie = "") => cookie.split(";").some((part) => part.trim() === `${newsletterCookie}=1`);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function principal(headers) {
  if (!headers["x-ms-client-principal"]) return null;
  try {
    return JSON.parse(Buffer.from(headers["x-ms-client-principal"], "base64").toString("utf8"));
  } catch {
    throw new HttpError(401, "La sesión no es válida. Inicia sesión de nuevo.");
  }
}

function sanitizeStory(html) {
  if (typeof html !== "string" || html.length > MAX_TEXT_SIZE) throw new Error("El texto supera el límite de 250.000 caracteres.");
  let images = 0;
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "u", "blockquote", "h2", "h3", "ul", "ol", "li", "img", "a"],
    allowedAttributes: { img: ["src", "alt"], a: ["href", "target", "rel"] },
    exclusiveFilter(frame) {
      if (frame.tag !== "img") return false;
      if (!isImageSource(frame.attribs.src)) return true;
      if (!frame.attribs.alt?.trim() || frame.attribs.alt.trim().length > 250) throw new Error("Describe cada imagen con entre 1 y 250 caracteres.");
      images += 1;
      if (images > MAX_STORY_IMAGES) throw new Error(`El relato admite hasta ${MAX_STORY_IMAGES} imágenes internas.`);
      return false;
    },
    transformTags: {
      b: "strong", i: "em", h1: "h2", div: "p",
      a(tagName, attributes) {
        const href = externalLink(attributes.href);
        return href ? { tagName, attribs: { href, target: "_blank", rel: "noopener noreferrer" } } : { tagName: "span", attribs: {} };
      },
    },
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "svg", "math", "iframe", "object", "template"],
  });
}

function countStoryWords(html) {
  return (storyText(html).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
}

function storyText(html) {
  return decodeHTML(sanitizeHtml(html.replace(/<br\b[^>]*>|<\/(?:p|h2|h3|li|blockquote)>/giu, "$& "), { allowedTags: [], allowedAttributes: {} })).replace(/\s+/gu, " ").trim();
}

export function createApi({
  store, adminLogins, environment = "demo", demoAuth = null,
  productionDomain = "", productionTenantId = "", verifyNewsletterDomain = verifyMailDomain,
  mail = null, schedulerKey = "",
}) {
  if (!["demo", "production"].includes(environment)) throw new Error("El entorno de la aplicación no es válido.");
  const admins = adminLogins.split(",").map((login) => login.trim().toLowerCase()).filter(Boolean);
  const domain = productionDomain.trim().toLowerCase();
  if (domain && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(domain)) throw new Error("Configura un dominio de administración válido, sin @.");
  if (productionTenantId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(productionTenantId)) throw new Error("Configura un tenant de Microsoft Entra válido.");
  const productionReady = Boolean(domain && productionTenantId);
  const enabledDemoAuth = environment === "demo" ? demoAuth : null;
  const response = (status, body, version) => ({
    status, body,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(version ? { ETag: version } : {}) },
  });
  return async function handle(req) {
    try {
      const path = (req.params?.path || "").replace(/^\/|\/$/gu, "");
      const method = req.method.toUpperCase();
      const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
      const user = principal(headers);
      const authenticated = ["github", "aad"].includes(user?.identityProvider) && Array.isArray(user.userRoles) && user.userRoles.includes("authenticated");
      const demoSession = enabledDemoAuth?.session(headers.cookie);
      const account = typeof user?.userDetails === "string" ? user.userDetails.toLowerCase() : "";
      const productionAdmin = productionReady && user?.identityProvider === "aad" && /^[^\s@]+@[^\s@]+$/u.test(account) && account.split("@")[1] === domain;
      const demoAdmin = user?.identityProvider === "github" && admins.includes(account);
      const admin = Boolean(demoSession || (authenticated && (environment === "production" ? productionAdmin : demoAdmin)));
      function requireAdmin() {
        if (!admin) throw new HttpError(authenticated ? 403 : 401, authenticated ? "Tu cuenta no tiene permisos de administración." : "Inicia sesión con una cuenta autorizada para administrar el sitio.");
      }
      function requireJson() {
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
      }
      if (path.startsWith("mail/")) {
        const callback = path === "mail/google/callback" && method === "GET";
        const subscription = ["mail/subscription/confirm", "mail/subscription/unsubscribe", "mail/unsubscribe"].includes(path) && method === "POST";
        const key = headers["x-mail-dispatch-key"] || "";
        const scheduler = path === "mail/dispatch" && schedulerKey.length >= 32 && Buffer.byteLength(key) === Buffer.byteLength(schedulerKey) && timingSafeEqual(Buffer.from(key), Buffer.from(schedulerKey));
        if (!callback && !subscription && !scheduler) requireAdmin();
        if (!mail) throw new HttpError(503, "El servicio de correo todavía no está configurado.");
        if (callback) {
          const cookieState = headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${MAIL_OAUTH_COOKIE}=`))?.slice(MAIL_OAUTH_COOKIE.length + 1);
          await mail.finishOAuth({ state: req.query?.state, code: req.query?.code, cookieState });
          return { status: 302, headers: { Location: "/admin.html?correo=conectado#boletin", "Cache-Control": "no-store", "Set-Cookie": `${MAIL_OAUTH_COOKIE}=; Path=/api/mail/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } };
        }
        if (path === "mail/unsubscribe" && subscription) {
          if (!/^application\/x-www-form-urlencoded\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía la solicitud de baja en el formato de un clic.");
          const value = typeof req.body === "string" ? new URLSearchParams(req.body).get("List-Unsubscribe") : req.body?.["List-Unsubscribe"];
          if (value !== "One-Click") throw new HttpError(400, "La solicitud de baja no es válida.");
          await mail.unsubscribe(req.query?.token);
          return response(200, { message: "Se confirmó la baja del boletín." });
        }
        if (!["GET", "POST", "PUT"].includes(method)) throw new HttpError(405, "Método no admitido.");
        if (method !== "GET") requireJson();
        if (subscription) {
          if (path.endsWith("/confirm")) await mail.confirm(req.body?.token);
          else await mail.unsubscribe(req.body?.token);
          return response(200, { message: path.endsWith("/confirm") ? "Suscripción confirmada. Gracias por sumarte al boletín." : "Se confirmó la baja. No recibirás nuevas campañas." });
        }
        if (path === "mail/settings") {
          if (method !== "GET" && method !== "PUT") throw new HttpError(405, "Método no admitido.");
          if (method === "PUT" && !headers["if-match"]) throw new HttpError(428, "Recarga la configuración antes de guardar.");
          const result = method === "GET" ? await mail.publicSettings() : await mail.saveSettings(req.body, headers["if-match"]);
          return response(200, result.value, result.version);
        }
        if (path === "mail/google/connect" && method === "POST") {
          const result = await mail.startOAuth();
          const output = response(200, { url: result.url });
          output.headers["Set-Cookie"] = `${MAIL_OAUTH_COOKIE}=${result.state}; Path=/api/mail/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
          return output;
        }
        if (path === "mail/google/disconnect" && method === "POST") {
          await mail.disconnect(); return response(200, { message: "Autorización local eliminada y envíos deshabilitados. Puedes revocar también el acceso en tu cuenta de Google." });
        }
        if (path === "mail/test" && method === "POST") {
          await mail.sendTest(); return response(200, { message: "Gmail aceptó el mensaje de prueba para la cuenta conectada. Comprueba su bandeja." });
        }
        if (path === "mail/subscribers" && method === "GET") return response(200, await mail.subscribers(req.query?.continuationToken));
        const subscriber = /^mail\/subscribers\/([a-f0-9]{64})\/(confirm-request|unsubscribe|delete)$/u.exec(path);
        if (subscriber && method === "POST") {
          if (subscriber[2] === "confirm-request") await store.rateLimit(`mail-confirm-${subscriber[1]}`, "admin", { interval: 15 * 60_000 });
          await mail.subscriberAction(subscriber[1], subscriber[2]);
          return response(200, { message: subscriber[2] === "confirm-request" ? "Gmail aceptó la solicitud de confirmación." : "Lista actualizada." });
        }
        if (path === "mail/campaigns") {
          if (method === "GET") return response(200, await mail.campaigns(req.query?.continuationToken));
          if (method === "POST") {
            const result = await mail.saveCampaign(req.body);
            return response(200, { ...result.value, version: result.version });
          }
        }
        const campaign = /^mail\/campaigns\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/(queue|cancel)$/u.exec(path);
        if (campaign && method === "POST") {
          if (campaign[2] === "cancel") await mail.cancelCampaign(campaign[1]);
          else {
            await mail.queueCampaign(campaign[1], req.body?.sendAt, req.body?.version);
            if (!req.body?.sendAt) await mail.dispatch();
          }
          return response(200, { message: "Campaña actualizada. Revisa su estado y el número aceptado por Gmail." });
        }
        if (path === "mail/dispatch" && method === "POST") return response(200, await mail.dispatch());
        throw new HttpError(404, "No encontramos esta operación de correo.");
      }
      if (method === "GET" && path === "session") {
        return response(200, {
          authenticated: Boolean(authenticated || demoSession), admin,
          login: demoSession?.login || (authenticated ? user.userDetails : null),
          authMethod: demoSession ? "demo" : authenticated ? user.identityProvider : null,
          loginProvider: environment === "production" ? productionReady ? "aad" : null : "github",
          demoLoginEnabled: Boolean(enabledDemoAuth), environment,
        });
      }
      if (path === "auth/logout" && method === "POST") {
        if (!enabledDemoAuth) throw new HttpError(404, "El acceso de demostración no está habilitado.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        const result = response(200, { message: "Sesión cerrada." });
        result.headers["Set-Cookie"] = enabledDemoAuth.clear();
        return result;
      }
      if (path === "auth/login" && method === "POST") {
        if (!enabledDemoAuth) throw new HttpError(404, "El acceso de demostración no está habilitado.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        const { username, password } = req.body || {};
        if (typeof username !== "string" || typeof password !== "string" || username.length > 100 || password.length > 256) throw new HttpError(400, "Revisa el usuario y la contraseña.");
        try {
          await store.rateLimit("login", headers["x-forwarded-for"] || "unknown", { limit: 5, interval: 15 * 60_000 });
        } catch (error) {
          if (error.statusCode === 429) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.");
          throw error;
        }
        if (!(await enabledDemoAuth.verify(username, password))) throw new HttpError(401, "Usuario o contraseña incorrectos.");
        const result = response(200, { message: "Sesión iniciada." });
        result.headers["Set-Cookie"] = enabledDemoAuth.issue();
        return result;
      }
      if (method === "GET" && path === "health") {
        await readCatalog(store);
        return response(200, { status: "ok", environment });
      }
      if (path === "editorial/reactions") {
        if (!["GET", "PUT"].includes(method)) throw new HttpError(405, "Método no admitido.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        const id = req.query?.id;
        if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(id)) throw new HttpError(400, "Elige una publicación válida.");
        if (method === "PUT") {
          requireJson();
          if (!req.body || JSON.stringify(req.body).length > 500 || !REACTIONS.some(({ id }) => id === req.body.reaction) || typeof req.body.active !== "boolean") throw new HttpError(400, "Elige una reacción válida e indica si deseas activarla.");
          await store.rateLimit("reactions", headers["x-forwarded-for"] || "unknown", { limit: 60, interval: 60_000 });
        }
        const collection = await store.read("showcase", { version: 1, texts: [] });
        if (!collection.value.texts.some((text) => text.id === id) && !(isExamplePost(id) && !collection.value.texts.length)) throw new HttpError(404, "Esta publicación ya no está disponible.");
        const cookie = (headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${reactionsCookie}=`))?.slice(reactionsCookie.length + 1);
        const token = /^[a-f0-9]{64}$/u.test(cookie || "") ? cookie : randomBytes(32).toString("hex");
        const visitor = createHash("sha256").update(token).digest("hex");
        function result(record) {
          const value = response(200, reactionSummary(record, visitor));
          if (token !== cookie) value.headers["Set-Cookie"] = `${reactionsCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
          return value;
        }
        const name = `reactions/${id}`;
        let current = await store.read(name, emptyReactions());
        if (method === "GET") return result(current.value);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const next = setReaction(current.value, visitor, req.body.reaction, req.body.active);
          if (next === current.value) return result(next);
          try {
            return result((await store.write(name, next, current.version)).value);
          } catch (error) {
            if (![409, 412].includes(error.statusCode) || attempt === 4) throw error;
            current = await store.read(name, emptyReactions());
          }
        }
      }
      if (method === "GET" && ["editorial", "editorial/entry"].includes(path)) {
        const collection = await store.read("showcase", { version: 1, texts: [] });
        const texts = validateShowcase(collection.value, { sanitize: sanitizeStory, countWords: countStoryWords, allowDataImages: false });
        if (path === "editorial/entry") {
          if (!texts.length && (!req.query?.id || isExamplePost(req.query.id))) return response(200, { example: true });
          const text = req.query?.id ? texts.find((item) => item.id === req.query.id) : editorialPage(texts).featured;
          if (!text) throw new HttpError(404, "Esta publicación ya no está disponible.");
          return response(200, { text });
        }
        const page = editorialPage(texts, { page: req.query?.pagina, tag: req.query?.etiqueta });
        function summarize({ html, permissionConfirmed, ...text }) {
          const words = storyText(html).split(/\s+/u);
          const count = countStoryWords(html);
          const minutes = Math.max(1, Math.ceil(count / 200));
          return { ...text, excerpt: words.slice(0, 40).join(" ") + (words.length > 40 ? "…" : ""), meta: `${count.toLocaleString("es-419")} palabras · ${minutes} ${minutes === 1 ? "minuto" : "minutos"} de lectura` };
        }
        return response(200, { ...page, example: !texts.length, featured: page.featured ? summarize(page.featured) : null, items: page.items.map(summarize) });
      }
      if (path === "settings/contacts") {
        if (method === "GET") {
          const result = await store.read("contact-settings", DEFAULT_CONTACTS);
          return response(200, result.value, result.version);
        }
        requireAdmin();
        if (method !== "PUT") throw new HttpError(405, "Método no admitido.");
        if (!headers["if-match"]) throw new HttpError(428, "Recarga la configuración antes de guardar.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
        let value;
        try { value = validateContacts(req.body); } catch (error) { throw new HttpError(400, error.message); }
        const saved = await store.write("contact-settings", value, headers["if-match"]);
        return response(200, saved.value, saved.version);
      }
      if (method === "GET" && IMAGE_PATH.test(`/api/${path}`)) {
        const name = path.slice("images/".length);
        try {
          const body = await store.readImage(name);
          return {
            status: 200, isRaw: true, body,
            headers: { "Content-Type": { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[name.split(".").at(-1)], "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" },
          };
        } catch (error) {
          if (error.statusCode === 404) throw new HttpError(404, "No encontramos esta imagen.");
          throw error;
        }
      }
      if (method === "POST" && path === "images") {
        requireAdmin();
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía la imagen en formato JSON.");
        const { data, mimeType } = req.body || {};
        if (typeof data !== "string" || !data.length || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/u.test(data)) throw new HttpError(400, "La imagen supera el tamaño permitido o no tiene un formato válido.");
        const bytes = Buffer.from(data, "base64");
        if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data || imageMime(bytes) !== mimeType || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new HttpError(400, "Solo se admiten imágenes JPG, PNG y WebP válidas de hasta 256 KB una vez preparadas.");
        try {
          const size = imageSize(bytes);
          if (!size.width || !size.height || size.width > 1600 || size.height > 1600) throw new Error("dimensions");
        } catch { throw new HttpError(400, "La imagen está dañada o sus dimensiones superan 1600 píxeles."); }
        return response(201, { src: await store.writeImage(bytes, mimeType) });
      }
      if (["catalog", "workshops", "showcase"].includes(path)) {
        if (method === "GET") {
          const result = path === "showcase" ? await store.read(path, { version: 1, texts: [] }) : await readCatalog(store);
          return response(200, path === "workshops" ? { version: 1, workshops: flattenInstances(result.value) } : result.value, result.version);
        }
        if (method !== "PUT") throw new HttpError(405, "Método no admitido.");
        requireAdmin();
        if (path === "workshops") throw new HttpError(409, "Recarga el sitio: ahora se definen talleres y ediciones por separado. No se guardaron cambios.");
        if (!headers["if-match"]) throw new HttpError(428, "Recarga los datos antes de guardar.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        let value;
        try {
          value = path === "catalog"
            ? validateCatalogV2(req.body, { allowDataImages: false })
            : { version: 1, texts: validateShowcase(req.body, { sanitize: sanitizeStory, countWords: countStoryWords, allowDataImages: false }) };
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        if (path === "catalog") {
          const current = await store.read("catalog", null);
          const programs = current.value ? validateCatalogV2(current.value, { allowDataImages: false }).programs : [];
          value.programs = value.programs.map((program) => {
            const previous = programs.find((item) => item.id === program.id);
            const input = req.body.programs.find((item) => item.id === program.id);
            for (const field of ["objectives", "requiredReading", "modality"]) {
              if (input[field] === undefined && previous) program[field] = previous[field];
            }
            return program;
          });
        }
        if (path === "showcase") {
          const current = await store.read("showcase", { version: 1, texts: [] });
          value.texts = value.texts.map((text) => {
            const previous = current.value.texts.find((item) => item.id === text.id);
            const input = req.body.texts.find((item) => item.id === text.id);
            const previousUrl = externalLink(previous?.authorUrl) || "";
            if (input.authorUrl === undefined && previousUrl && text.author !== previous.author) throw new HttpError(409, "Recarga el editor antes de cambiar una autoría con blog. No se guardaron cambios.");
            const previousMetadata = previous ? postMetadata(previous) : null;
            for (const field of ["subtitle", "tags"]) {
              if (input[field] === undefined && previousMetadata) text[field] = previousMetadata[field];
            }
            return { ...text, authorUrl: input.authorUrl === undefined ? previousUrl || text.authorUrl : text.authorUrl, publishedAt: previous?.publishedAt || new Date().toISOString() };
          });
        }
        const result = await store.write(path, value, headers["if-match"]);
        return response(200, result.value, result.version);
      }
      if (path === "submissions" && method === "GET") {
        requireAdmin();
        if (!["enrollment", "newsletter"].includes(req.query?.kind)) throw new HttpError(400, "Elige un tipo de solicitudes válido.");
        return response(200, await store.submissions(req.query.kind, req.query.continuationToken));
      }
      if (path === "newsletter" && method === "GET") {
        return response(200, { submittedThisSession: newsletterSubmitted(headers.cookie) });
      }
      if (["enrollment", "newsletter"].includes(path) && method === "POST") {
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        if (path === "newsletter" && newsletterSubmitted(headers.cookie)) throw new HttpError(429, "Ya enviaste una solicitud del boletín en esta sesión.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
        const body = req.body;
        if (!body || typeof body !== "object" || JSON.stringify(body).length > 10_000) throw new HttpError(400, "La solicitud no tiene un formato válido.");
        if (body.website) throw new HttpError(400, "La solicitud no es válida.");
        let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) throw new HttpError(400, "Indica un correo electrónico válido.");
        if (body.consent !== true) throw new HttpError(400, "Confirma tu consentimiento para enviar la solicitud.");
        const value = { email, consent: true, createdAt: new Date().toISOString() };
        if (path === "newsletter") {
          try {
            email = validateNewsletterEmail(email);
            await verifyNewsletterDomain(email.split("@")[1]);
          } catch (error) {
            throw new HttpError(error.status || 400, error.message);
          }
          Object.assign(value, { email, status: "pending_confirmation" });
        }
        if (path === "enrollment") {
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const message = typeof body.message === "string" ? body.message.trim() : "";
          if (!name || name.length > 100 || message.length > 2000) throw new HttpError(400, "Revisa el nombre y el mensaje de la solicitud.");
          const { value: catalog } = await readCatalog(store);
          const instance = flattenInstances(catalog).find((workshop) => workshop.id === body.course);
          const service = typeof body.course === "string" && body.course.startsWith("servicio:") ? catalog.services.find((item) => item.id === body.course.slice(9)) : null;
          if (body.course !== "orientacion" && !instance && !service) throw new HttpError(400, "La edición o el servicio seleccionado ya no está disponible.");
          if (instance) Object.assign(value, { programId: instance.programId, workshopName: instance.name, editionCode: instance.code, startDate: instance.startDate });
          if (service) Object.assign(value, { serviceId: service.id, serviceName: service.name });
          Object.assign(value, { name, course: body.course, message });
        }
        try {
          await store.rateLimit(path, headers["x-forwarded-for"] || email);
        } catch (error) {
          if (error.statusCode === 429) throw new HttpError(429, "Espera un minuto antes de enviar otra solicitud.");
          throw error;
        }
        const submission = await store.submit(path, value);
        let newsletterMessage = "Solicitud registrada, pendiente de confirmación. El envío aún no está habilitado; no recibirás campañas hasta confirmar tu dirección.";
        if (path === "newsletter" && mail) {
          try {
            if (await mail.ready()) {
              if (submission?.created) await mail.requestConfirmation(submission.id);
              newsletterMessage = "Solicitud registrada. Si tu dirección necesita confirmación, revisa tu correo. No se reenvían confirmaciones ni se reactiva una baja automáticamente.";
            }
          } catch {
            newsletterMessage = "La solicitud quedó guardada, pero no se confirmó el envío del correo de verificación. La administración deberá revisar la conexión y reenviar la confirmación.";
          }
        }
        const result = response(202, { message: path === "newsletter" ? newsletterMessage : "Solicitud recibida. Esto no confirma un lugar ni realiza un cobro." });
        if (path === "newsletter") result.headers["Set-Cookie"] = `${newsletterCookie}=1; Path=/api; HttpOnly; Secure; SameSite=Strict`;
        return result;
      }
      throw new HttpError(404, "No encontramos este recurso.");
    } catch (error) {
      if (error instanceof HttpError || error instanceof MailError) return response(error.status, { error: error.message });
      if (error.statusCode === 429) return response(429, { error: "Demasiados intentos. Espera antes de repetir esta operación." });
      if ([409, 412].includes(error.statusCode)) return response(409, { error: "Los datos cambiaron en otra sesión. Recarga antes de guardar para no sobrescribirlos." });
      throw error;
    }
  };
}
