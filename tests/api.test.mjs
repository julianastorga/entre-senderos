import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync, createHash } from "node:crypto";
import { createApi } from "../server/app.mjs";
import { createDemoAuth } from "../server/demo-auth.mjs";
import { migrateWorkshops } from "../catalog-model.mjs";
import { DEFAULT_WORKSHOPS } from "../workshops.mjs";
import { validateNewsletterEmail } from "../email-validation.mjs";
import { verifyMailDomain } from "../server/mail-domain.mjs";

class MemoryStore {
  data = new Map();
  records = [];
  limited = false;
  images = new Map();
  async writeImage(bytes) {
    const src = `/api/images/${createHash("sha256").update(bytes).digest("hex")}.png`;
    this.images.set(src.slice("/api/images/".length), bytes); return src;
  }
  async readImage(name) { return this.images.get(name); }
  async read(name, initial) {
    return structuredClone(this.data.get(name) || { value: initial, version: "initial" });
  }
  async write(name, value, version) {
    const current = this.data.get(name);
    if (version !== (current?.version || "initial")) {
      const error = new Error("Conflict");
      error.statusCode = 412;
      throw error;
    }
    const result = { value: structuredClone(value), version: `"${Number(current?.version.replaceAll('"', "") || 0) + 1}"` };
    this.data.set(name, result);
    return result;
  }
  async rateLimit() {
    if (this.limited) {
      const error = new Error("Limited");
      error.statusCode = 429;
      throw error;
    }
  }
  async submit(kind, value) { this.records.push({ kind, value }); }
  async submissions(kind) { return { items: this.records.filter((record) => record.kind === kind).map((record) => record.value), continuationToken: null }; }
}

const github = (login) => Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: login, userRoles: ["authenticated"] })).toString("base64");
const request = (path, method = "GET", body, headers = {}, query = {}) => ({
  params: { path }, method, body, query,
  headers: { "content-type": "application/json", ...headers },
});
const admin = { "x-ms-client-principal": github("test-owner"), "if-match": "initial" };
const create = (store = new MemoryStore(), extra = {}) => ({ store, api: createApi({ store, adminLogins: "test-owner", verifyNewsletterDomain: async () => {}, ...extra }) });

test("shared catalog reads are public, while writes and submissions require an authorized administrator", async () => {
  const { api } = create();
  const initial = await api(request("workshops"));
  assert.equal(initial.body.workshops.length, 3);
  const currentAdmin = { ...admin, "if-match": initial.headers.ETag };
  const body = migrateWorkshops(DEFAULT_WORKSHOPS);
  assert.equal((await api(request("catalog", "PUT", body))).status, 401);
  assert.equal((await api(request("catalog", "PUT", body, { ...admin, "x-ms-client-principal": github("someone-else") }))).status, 403);
  assert.equal((await api(request("submissions", "GET", null, {}, { kind: "enrollment" }))).status, 401);
  assert.equal((await api(request("catalog", "PUT", body, currentAdmin))).status, 200);
  assert.equal((await api(request("catalog", "PUT", body, currentAdmin))).status, 409);
  assert.equal((await api(request("catalog", "PUT", body, { ...admin, "sec-fetch-site": "cross-site" }))).status, 403);
});

test("the API sanitizes rich stories and validates permission and collection identity before storing", async () => {
  const { api, store } = create();
  const text = { version: 1, id: "original", title: "Relato original", author: "Autoría de prueba", permissionConfirmed: true, html: '<p onclick="alert(1)"><strong>Siete gatos.</strong><script>alert(1)</script><img src="https://invalid.example"><iframe>contenido</iframe></p>' };
  assert.equal((await api(request("showcase", "PUT", { version: 1, texts: [{ ...text, permissionConfirmed: false }] }, admin))).status, 400);
  assert.equal((await api(request("showcase", "PUT", { version: 1, texts: [text, text] }, admin))).status, 400);
  assert.equal(store.data.size, 0);
  const saved = await api(request("showcase", "PUT", { version: 1, texts: [text] }, admin));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.texts[0].html, "<p><strong>Siete gatos.</strong></p>");
});

test("edition and service inquiries retain immutable offering references after administrator deletion", async () => {
  const { api, store } = create();
  const initial = await api(request("catalog"));
  const body = { email: "lectora@dominio.org", name: "Prueba", consent: true, message: "" };
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "niebla" }))).status, 202);
  assert.equal(store.records[0].value.programId, "niebla");
  assert.equal(store.records[0].value.editionCode, "NIE-01");
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "servicio:talleres-personalizados" }))).status, 202);
  assert.equal(store.records[1].value.serviceName, "Talleres personalizados");
  const updated = { ...initial.body, instances: [], services: [] };
  assert.equal((await api(request("catalog", "PUT", updated, { ...admin, "if-match": initial.headers.ETag }))).status, 200);
  assert.equal((await api(request("workshops"))).body.workshops.length, 0);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "niebla" }))).status, 400);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "servicio:talleres-personalizados" }))).status, 400);
  assert.equal(store.records.length, 2);
  assert.equal((await api(request("workshops", "PUT", { version: 1, workshops: DEFAULT_WORKSHOPS }, admin))).status, 409);
});

test("public Editorial pages contain only selected card metadata and publication dates are assigned by the server", async () => {
  const { api } = create();
  const texts = Array.from({ length: 15 }, (_, index) => ({ version: 1, id: `blog-${index}`, title: `Entrada ${index}`, author: "Autoría", permissionConfirmed: true, kind: index < 8 ? "post" : "participant", html: "<p>Una historia &amp; otra.</p><p>Final.</p>", publishedAt: "2020-01-01T00:00:00.000Z" }));
  const saved = await api(request("showcase", "PUT", { version: 1, texts }, admin));
  assert.equal(saved.status, 200);
  assert.ok(saved.body.texts.every((item) => item.publishedAt !== texts[0].publishedAt));
  const page = await api(request("editorial", "GET", null, {}, { tipo: "post", pagina: "2" }));
  assert.equal(page.body.total, 15);
  assert.equal(page.body.items.length, 6);
  assert.ok(page.body.items.every((item) => !Object.hasOwn(item, "kind") && !Object.hasOwn(item, "html")));
  assert.equal(page.body.items[0].excerpt, "Una historia & otra. Final.");
  assert.equal((await api(request("editorial/entry", "GET", null, {}, { id: "blog-0" }))).body.text.html, texts[0].html);
  assert.equal((await api(request("editorial/entry", "GET", null, {}, { id: "missing" }))).status, 404);
  const originalDate = saved.body.texts[0].publishedAt;
  const edited = await api(request("showcase", "PUT", { version: 1, texts: [{ ...saved.body.texts[0], publishedAt: texts[0].publishedAt }] }, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal(edited.body.texts[0].publishedAt, originalDate);
});

test("author credits and embedded links survive publication while unsafe destinations and attributes are removed", async () => {
  const { api } = create();
  const text = {
    version: 1, id: "linked", title: "Lecturas compartidas", author: "Autora invitada",
    authorUrl: "https://blog.example.org", permissionConfirmed: true, kind: "participant",
    html: '<p><a href="https://blog.example.org/lectura?q=1&amp;x=2" target="_self" onclick="alert(1)" style="color:red">Blog <strong>invitado</strong></a> <a href="javascript:alert(1)">No ejecutar</a> <a href="//blog.example.org">Sin protocolo</a> <a href="https://user:password@blog.example.org">Sin credenciales</a></p>',
  };
  const saved = await api(request("showcase", "PUT", { version: 1, texts: [text] }, admin));
  assert.equal(saved.status, 200);
  const entry = saved.body.texts[0];
  assert.equal(entry.authorUrl, "https://blog.example.org/");
  assert.equal(Object.hasOwn(entry, "kind"), false);
  assert.equal(entry.html, '<p><a href="https://blog.example.org/lectura?q=1&amp;x=2" target="_blank" rel="noopener noreferrer">Blog <strong>invitado</strong></a> No ejecutar Sin protocolo Sin credenciales</p>');
  const card = (await api(request("editorial"))).body.items[0];
  assert.equal(card.author, text.author);
  assert.equal(card.authorUrl, entry.authorUrl);
  assert.equal((await api(request("editorial/entry", "GET", null, {}, { id: text.id }))).body.text.html, entry.html);
  const { authorUrl: omittedUrl, ...legacyClientEntry } = entry;
  const preserved = await api(request("showcase", "PUT", { version: 1, texts: [legacyClientEntry] }, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal(preserved.body.texts[0].authorUrl, omittedUrl, "an older cached editor must not strip author websites from unchanged credits");
  const headers = { ...admin, "if-match": preserved.headers.ETag };
  assert.equal((await api(request("showcase", "PUT", { version: 1, texts: [{ ...legacyClientEntry, author: "Otro crédito" }] }, headers))).status, 409);
  for (const invalid of [{ author: "", authorUrl: text.authorUrl }, { authorUrl: "javascript:alert(1)" }, { authorUrl: "https://user:password@blog.example.org" }]) {
    assert.equal((await api(request("showcase", "PUT", { version: 1, texts: [{ ...entry, ...invalid }] }, headers))).status, 400);
  }
  const noCredit = await api(request("showcase", "PUT", { version: 1, texts: [{ ...entry, author: "", authorUrl: "" }] }, headers));
  assert.equal(noCredit.status, 200);
  assert.equal(noCredit.body.texts[0].publishedAt, entry.publishedAt);
});

test("anonymous reactions persist per browser, toggle independently and use idempotent desired-state writes", async () => {
  const { api, store } = create();
  const query = { id: "ejemplo" };
  const first = await api(request("editorial/reactions", "GET", null, {}, query));
  const cookie = first.headers["Set-Cookie"].split(";")[0];
  assert.match(first.headers["Set-Cookie"], /; Path=\/; HttpOnly; Secure; SameSite=Lax;/u);
  assert.equal(first.headers["Cache-Control"], "no-store");
  assert.deepEqual(first.body.selected, []);
  const change = (reaction, active, browser = cookie) => api(request("editorial/reactions", "PUT", { reaction, active }, { cookie: browser }, query));
  const liked = await change("heart", true);
  assert.equal(liked.body.counts.heart, 1);
  assert.deepEqual(liked.body.selected, ["heart"]);
  const version = store.data.get("reactions/ejemplo").version;
  assert.equal((await change("heart", true)).body.counts.heart, 1);
  assert.equal(store.data.get("reactions/ejemplo").version, version, "retrying a desired state must not add another vote");
  await change("fire", true);
  const removed = await change("heart", false);
  assert.equal(removed.body.counts.heart, 0);
  assert.equal(removed.body.counts.fire, 1);
  const reload = await api(request("editorial/reactions", "GET", null, { cookie }, query));
  assert.deepEqual(reload.body.selected, ["fire"]);
  assert.equal(Object.hasOwn(reload.body, "voters"), false);
  assert.ok(!JSON.stringify(reload.body).includes(cookie.split("=")[1]));
  const other = await api(request("editorial/reactions", "GET", null, {}, query));
  assert.deepEqual(other.body.selected, []);
  assert.equal(other.body.counts.fire, 1);
  assert.equal((await change("fire", true, other.headers["Set-Cookie"].split(";")[0])).body.counts.fire, 2);
});

test("concurrent reactions merge without lost counts or overwriting blog content", async () => {
  const { api, store } = create();
  const query = { id: "ejemplo" };
  const browser = async () => (await api(request("editorial/reactions", "GET", null, {}, query))).headers["Set-Cookie"].split(";")[0];
  const [first, second] = await Promise.all([browser(), browser()]);
  const results = await Promise.all([
    api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { cookie: first }, query)),
    api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { cookie: second }, query)),
    api(request("editorial/reactions", "PUT", { reaction: "applause", active: true }, { cookie: first }, query)),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  const state = await api(request("editorial/reactions", "GET", null, { cookie: first }, query));
  assert.equal(state.body.counts.heart, 2);
  assert.equal(state.body.counts.applause, 1);
  assert.deepEqual(state.body.selected.sort(), ["applause", "heart"]);
  assert.equal(store.data.has("showcase"), false);
  store.write = async () => { const error = new Error("Conflict"); error.statusCode = 412; throw error; };
  const conflict = await api(request("editorial/reactions", "PUT", { reaction: "heart", active: false }, { cookie: first }, query));
  assert.equal(conflict.status, 409);
  assert.equal((await api(request("editorial/reactions", "GET", null, { cookie: first }, query))).body.counts.heart, 2);
});

test("reaction writes reject invalid input, cross-site requests, unavailable posts and rate-limited attempts", async () => {
  const { api, store } = create();
  const query = { id: "ejemplo" };
  for (const body of [{ reaction: "unknown", active: true }, { reaction: "heart", active: "true" }, { reaction: "heart", active: true, extra: "x".repeat(501) }, null]) {
    assert.equal((await api(request("editorial/reactions", "PUT", body, {}, query))).status, 400);
  }
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { "content-type": "text/plain" }, query))).status, 415);
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { "sec-fetch-site": "cross-site" }, query))).status, 403);
  assert.equal((await api(request("editorial/reactions", "POST", {}, {}, query))).status, 405);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, { id: "../showcase" }))).status, 400);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, { id: "deleted" }))).status, 404);
  store.limited = true;
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, {}, query))).status, 429);
  assert.equal(store.data.size, 0);
  store.limited = false;
  const text = { version: 1, id: "published", title: "Una publicación", html: "<p>Una lectura.</p>", permissionConfirmed: true };
  const saved = await api(request("showcase", "PUT", { version: 1, texts: [text] }, admin));
  assert.equal(saved.status, 200);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, query))).status, 404, "the demo is not a real post when the blog has publications");
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, { id: text.id }))).status, 200);
  await api(request("showcase", "PUT", { version: 1, texts: [] }, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, {}, { id: text.id }))).status, 404);
});

test("managed images require authenticated uploads, bounded valid bytes and accessible covers; contacts use conditional writes", async () => {
  const { api } = create();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0yYAAAAASUVORK5CYII=";
  const body = { data: png, mimeType: "image/png" };
  assert.equal((await api(request("images", "POST", body))).status, 401);
  assert.equal((await api(request("images", "POST", { data: Buffer.from("<svg/>").toString("base64"), mimeType: "image/svg+xml" }, admin))).status, 400);
  const image = await api(request("images", "POST", body, admin));
  assert.equal(image.status, 201);
  const served = await api(request(image.body.src.slice(5)));
  assert.equal(served.headers["Content-Type"], "image/png");
  assert.deepEqual(served.body, Buffer.from(png, "base64"));
  const catalog = (await api(request("catalog"))).body;
  catalog.programs[0].coverImage = { src: "https://unsafe.org/image.png", alt: "Portada" };
  assert.equal((await api(request("catalog", "PUT", catalog, { ...admin, "if-match": '"1"' }))).status, 400);
  catalog.programs[0].coverImage = { src: image.body.src, alt: "Portada accesible" };
  assert.equal((await api(request("catalog", "PUT", catalog, { ...admin, "if-match": '"1"' }))).status, 200);
  const contacts = { whatsappNumber: "+506 8888-8888", email: "hello@workshops.org" };
  assert.equal((await api(request("settings/contacts", "PUT", contacts))).status, 401);
  assert.equal((await api(request("settings/contacts", "PUT", contacts, admin))).body.whatsappNumber, "50688888888");
  assert.equal((await api(request("settings/contacts", "PUT", contacts, admin))).status, 409);
  assert.equal((await api(request("settings/contacts"))).body.email, contacts.email);
});

test("enrollment and newsletter requests require consent, valid inputs and rate limits; exported records remain private", async () => {
  const { api, store } = create();
  const body = { email: "lectora@dominio.org", name: "Prueba", course: "niebla", consent: true, message: "Solicitud ficticia" };
  assert.equal((await api(request("enrollment", "POST", { ...body, consent: false }))).status, 400);
  assert.equal((await api(request("enrollment", "POST", { ...body, email: "invalid" }))).status, 400);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "deleted" }))).status, 400);
  assert.equal((await api(request("newsletter", "POST", { ...body, website: "spam" }))).status, 400);
  assert.equal(store.records.length, 0);
  assert.equal((await api(request("enrollment", "POST", body))).status, 202);
  assert.equal((await api(request("newsletter", "POST", body))).status, 202);
  assert.equal((await api(request("submissions", "GET", null, admin, { kind: "enrollment" }))).body.items.length, 1);
  store.limited = true;
  assert.equal((await api(request("newsletter", "POST", body))).status, 429);
  assert.equal(store.records.length, 2);
});

test("production administration requires configured Entra tenant and exact domain, never demo or GitHub credentials", async () => {
  const tenant = "00000000-1111-2222-3333-444444444444";
  const identity = (account, provider = "aad", roles = ["authenticated"]) => ({
    "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: provider, userDetails: account, userRoles: roles })).toString("base64"),
  });
  const options = { environment: "production", productionDomain: "Workshops.org", productionTenantId: tenant, demoAuth: { session: () => ({ login: "test-admin" }) } };
  const { api } = create(undefined, options);
  for (const [account, provider, allowed] of [
    ["writer@workshops.org", "aad", true],
    ["WRITER@WORKSHOPS.ORG", "aad", true],
    ["writer@sub.workshops.org", "aad", false],
    ["writer@notworkshops.org", "aad", false],
    ["writer@workshops.org.attacker.org", "aad", false],
    ["writer@workshops.org", "github", false],
    ["test-owner", "github", false],
    ["invalid@@workshops.org", "aad", false],
  ]) {
    assert.equal((await api(request("session", "GET", null, identity(account, provider)))).body.admin, allowed);
  }
  assert.equal((await api(request("session", "GET", null, identity("writer@workshops.org", "aad", [])))).body.admin, false);
  assert.equal((await api(request("session", "GET", null, { cookie: "demo-cookie" }))).body.admin, false);
  assert.equal((await api(request("auth/login", "POST", { username: "test-admin", password: "wrong" }))).status, 404);
  for (const extra of [{ productionDomain: "" }, { productionTenantId: "" }]) {
    const disabled = create(undefined, { ...options, ...extra }).api;
    const session = await disabled(request("session", "GET", null, identity("writer@workshops.org")));
    assert.equal(session.body.admin, false);
    assert.equal(session.body.loginProvider, null);
    assert.equal((await disabled(request("catalog", "PUT", migrateWorkshops(DEFAULT_WORKSHOPS), { ...identity("writer@workshops.org"), "if-match": "initial" }))).status, 403);
  }
  assert.equal((await api(request("catalog", "PUT", migrateWorkshops(DEFAULT_WORKSHOPS), { ...identity("writer@workshops.org"), "if-match": "initial" }))).status, 200);
});

test("newsletter rejects placeholder addresses and domain verification failures; accepted signup is limited to one per session", async () => {
  for (const email of ["fake@example.com", "fake@sub.example.org", "fake@domain.invalid", "fake@domain.test", "bad..name@dominio.org", "name@-domain.org", "reader<@gmail.com", "reader>@gmail.com", "reader;@gmail.com", 'reader"@gmail.com', `reader@${"a".repeat(64)}.org`]) {
    assert.throws(() => validateNewsletterEmail(email));
  }
  assert.equal(validateNewsletterEmail(" Reader+news@Mail.org "), "reader+news@mail.org");
  const { api, store } = create();
  const body = { email: "reader@dominio.org", consent: true };
  assert.equal((await api(request("newsletter", "POST", { ...body, email: "fake@example.com" }))).status, 400);
  const unavailable = create(undefined, { verifyNewsletterDomain: async () => { const error = new Error("DNS unavailable"); error.status = 503; throw error; } });
  assert.equal((await unavailable.api(request("newsletter", "POST", body))).status, 503);
  assert.equal(unavailable.store.records.length, 0);
  const accepted = await api(request("newsletter", "POST", body));
  assert.equal(accepted.status, 202);
  const cookie = accepted.headers["Set-Cookie"];
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict$/u);
  assert.equal(store.records[0].value.status, "pending_confirmation");
  assert.equal((await api(request("newsletter", "GET", null, { cookie }))).body.submittedThisSession, true);
  assert.equal((await api(request("newsletter", "POST", { ...body, email: "another@dominio.org" }, { cookie }))).status, 429);
  assert.equal(store.records.length, 1);
});

test("mail-domain verification handles valid, null, nonexistent and temporarily unavailable MX records", async () => {
  await verifyMailDomain("dominio.org", async () => [{ exchange: "mx.dominio.org" }]);
  await assert.rejects(verifyMailDomain("dominio.org", async () => [{ exchange: "." }]), { status: 400 });
  await assert.rejects(verifyMailDomain("dominio.org", async () => []), { status: 400 });
  await assert.rejects(verifyMailDomain("dominio.org", async () => { const error = new Error("missing"); error.code = "ENOTFOUND"; throw error; }), { status: 400 });
  await assert.rejects(verifyMailDomain("dominio.org", async () => { const error = new Error("timeout"); error.code = "ETIMEOUT"; throw error; }), { status: 503 });
});

test("demo credentials produce secure, expiring sessions and are never enabled in production", async () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const testPassword = "unit-test-only-not-a-live-credential";
  const config = {
    enabled: true, environment: "demo", username: "test-admin",
    passwordHash: `${salt}.${scryptSync(testPassword, salt, 64).toString("hex")}`,
    sessionSecret: "unit-test-session-secret-not-used-in-any-deployment",
  };
  assert.equal(createDemoAuth({ ...config, environment: "production" }), null);
  let now = 100_000;
  const demoAuth = createDemoAuth({ ...config, now: () => now });
  const { api } = create(undefined, { demoAuth });
  assert.equal((await api(request("auth/login", "POST", { username: "test-admin", password: "wrong" }))).status, 401);
  const login = await api(request("auth/login", "POST", { username: "test-admin", password: testPassword }));
  assert.equal(login.status, 200);
  const cookie = login.headers["Set-Cookie"];
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/u);
  const session = await api(request("session", "GET", null, { cookie }));
  assert.equal(session.body.admin, true);
  const save = await api(request("catalog", "PUT", migrateWorkshops(DEFAULT_WORKSHOPS), { cookie, "if-match": "initial" }));
  assert.equal(save.status, 200);
  const token = cookie.split(";")[0];
  assert.equal(demoAuth.session(token.replace("=", "=tampered")), null);
  now += 2 * 60 * 60 * 1000;
  assert.equal(demoAuth.session(token), null);
  assert.equal((await create().api(request("auth/login", "POST", { username: "test-admin", password: testPassword }))).status, 404);
});
