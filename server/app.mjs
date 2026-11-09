import sanitizeHtml from "sanitize-html";
import { DEFAULT_WORKSHOPS, validateCatalog } from "../workshops.mjs";
import { MAX_TEXT_SIZE, validateShowcase } from "../featured-text.mjs";
import { validateNewsletterEmail } from "../email-validation.mjs";
import { verifyMailDomain } from "./mail-domain.mjs";

const newsletterCookie = "__Secure-entre_senderos_newsletter";
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
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "u", "blockquote", "h2", "h3", "ul", "ol", "li"],
    allowedAttributes: {},
    transformTags: { b: "strong", i: "em", h1: "h2", div: "p" },
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "svg", "math", "iframe", "object", "template"],
  });
}

function countStoryWords(html) {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/giu, " ");
  return (text.match(/[\p{L}\p{N}]+/gu) || []).length;
}

export function createApi({
  store, adminLogins, environment = "demo", demoAuth = null,
  productionDomain = "", productionTenantId = "", verifyNewsletterDomain = verifyMailDomain,
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
        await store.read("workshops", { version: 1, workshops: DEFAULT_WORKSHOPS });
        return response(200, { status: "ok", environment });
      }
      if (["workshops", "showcase"].includes(path)) {
        const initial = path === "workshops" ? { version: 1, workshops: DEFAULT_WORKSHOPS } : { version: 1, texts: [] };
        if (method === "GET") {
          const result = await store.read(path, initial);
          return response(200, result.value, result.version);
        }
        if (method !== "PUT") throw new HttpError(405, "Método no admitido.");
        requireAdmin();
        if (!headers["if-match"]) throw new HttpError(428, "Recarga los datos antes de guardar.");
        if (!/^application\/json\b/iu.test(headers["content-type"] || "")) throw new HttpError(415, "Envía los datos en formato JSON.");
        if (headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "El origen de la solicitud no está permitido.");
        let value;
        try {
          value = path === "workshops"
            ? { version: 1, workshops: validateCatalog(req.body) }
            : { version: 1, texts: validateShowcase(req.body, { sanitize: sanitizeStory, countWords: countStoryWords }) };
        } catch (error) {
          throw new HttpError(400, error.message);
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
          const catalog = await store.read("workshops", { version: 1, workshops: DEFAULT_WORKSHOPS });
          if (body.course !== "orientacion" && !catalog.value.workshops.some((workshop) => workshop.id === body.course)) throw new HttpError(400, "El taller seleccionado ya no está disponible.");
          Object.assign(value, { name, course: body.course, message });
        }
        try {
          await store.rateLimit(path, headers["x-forwarded-for"] || email);
        } catch (error) {
          if (error.statusCode === 429) throw new HttpError(429, "Espera un minuto antes de enviar otra solicitud.");
          throw error;
        }
        await store.submit(path, value);
        const result = response(202, { message: path === "newsletter" ? "Solicitud registrada, pendiente de confirmación. Todavía no se enviarán correos." : "Solicitud recibida. Esto no confirma un lugar ni realiza un cobro." });
        if (path === "newsletter") result.headers["Set-Cookie"] = `${newsletterCookie}=1; Path=/api; HttpOnly; Secure; SameSite=Strict`;
        return result;
      }
      throw new HttpError(404, "No encontramos este recurso.");
    } catch (error) {
      if (error instanceof HttpError) return response(error.status, { error: error.message });
      if ([409, 412].includes(error.statusCode)) return response(409, { error: "Los datos cambiaron en otra sesión. Recarga antes de guardar para no sobrescribirlos." });
      throw error;
    }
  };
}
