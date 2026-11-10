import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync, createHash, randomUUID } from "node:crypto";
import { createApi } from "../server/app.mjs";
import { createDemoAuth } from "../server/demo-auth.mjs";
import { migrateWorkshops } from "../catalog-model.mjs";
import { DEFAULT_WORKSHOPS } from "../workshops.mjs";
import { validateNewsletterEmail } from "../email-validation.mjs";
import { verifyMailDomain } from "../server/mail-domain.mjs";
import { DEFAULT_PAGE_COPY } from "../page-copy-model.mjs";

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
  async submit(kind, value) {
    const id = kind === "newsletter" ? createHash("sha256").update(value.email).digest("hex") : `${new Date().toISOString()}-${randomUUID()}`;
    await this.write(`submissions/${kind}/${id}`, value, "initial");
    this.records.push({ id, kind, value });
    return { id, created: true };
  }
  async jsonPage(prefix, token) {
    const items = [...this.data.entries()].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([name, record]) => ({ id: name.slice(prefix.length), ...structuredClone(record) }));
    const start = Number(token || 0);
    return { items: items.slice(start, start + 2), continuationToken: items.length > start + 2 ? String(start + 2) : null };
  }
  async submissions(kind) { return { items: [...this.data.entries()].filter(([name]) => name.startsWith(`submissions/${kind}/`)).map(([, record]) => structuredClone(record.value)), continuationToken: null }; }
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
  const body = { email: "lectora@dominio.org", name: "Prueba", consent: true, message: "", phone: "+1 202 555 0123", phoneCountry: "US" };
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

test("public enrollment rejects started editions and stale legacy IDs, without blocking future editions or private administration", async () => {
  let instant = new Date("2027-01-19T23:59:59.999Z");
  const { api, store } = create(new MemoryStore(), { now: () => instant });
  const body = { email: "lectora@dominio.org", name: "Prueba", consent: true, phone: "+1 202 555 0123", phoneCountry: "US", course: "niebla" };
  assert.equal((await api(request("enrollment", "POST", body))).status, 202);
  const catalog = await api(request("catalog"));
  const instances = [...catalog.body.instances, { ...catalog.body.instances[0], id: "next-niebla", code: "NIE-02", startDate: "2027-01-26" }];
  assert.equal((await api(request("catalog", "PUT", { ...catalog.body, instances }, { ...admin, "if-match": catalog.headers.ETag }))).status, 200);
  instant = new Date("2027-01-20T00:00:00Z");
  for (const headers of [{}, admin]) {
    const closed = await api(request("enrollment", "POST", body, headers));
    assert.equal(closed.status, 409);
    assert.match(closed.body.error, /ya comenzó.*boletín/u);
  }
  assert.equal(store.records.length, 1);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "next-niebla" }))).status, 202);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "servicio:talleres-personalizados" }))).status, 202);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "orientacion" }))).status, 202);
  assert.equal((await api(request("enrollment", "POST", { ...body, course: "sotobosque" }))).status, 400);
  assert.equal(store.records.length, 4);
  const id = `${instant.toISOString()}-${randomUUID()}`;
  const manual = await api(request("enrollments", "POST", { ...body, id }, admin));
  assert.equal(manual.status, 201);
  assert.equal(manual.body.value.editionCode, "NIE-01");
  assert.equal(manual.body.value.source, "admin");
  const moved = await api(request("enrollments", "PUT", { status: "interested", course: "next-niebla" }, { ...admin, "if-match": manual.headers.ETag }, { id }));
  assert.equal(moved.status, 200);
  const returned = await api(request("enrollments", "PUT", { status: "interested", course: "niebla" }, { ...admin, "if-match": moved.headers.ETag }, { id }));
  assert.equal(returned.status, 200);
  assert.equal(returned.body.editionCode, "NIE-01");
});

test("workshop sections are shared and validated, and older edition editors cannot erase them", async () => {
  const { api } = create();
  const initial = await api(request("catalog"));
  const catalog = structuredClone(initial.body);
  Object.assign(catalog.programs[0], { overview: "Ejercicios y lectura compartida.", audience: "Personas que desean empezar a escribir.", objectives: "Practicar escenas.\n\nRevisar un texto.", requiredReading: "Lectura de muestra.", modality: "Taller corto · En línea" });
  const saved = await api(request("catalog", "PUT", catalog, { ...admin, "if-match": initial.headers.ETag }));
  assert.equal(saved.status, 200);
  const publicCatalog = await api(request("catalog"));
  assert.equal(publicCatalog.body.programs[0].objectives, catalog.programs[0].objectives);
  assert.equal(publicCatalog.body.programs[0].requiredReading, catalog.programs[0].requiredReading);
  assert.equal(publicCatalog.body.programs[0].modality, catalog.programs[0].modality);
  assert.equal(publicCatalog.body.programs[0].overview, catalog.programs[0].overview);
  assert.equal(publicCatalog.body.programs[0].audience, catalog.programs[0].audience);
  const oldClient = { ...catalog, programs: catalog.programs.map(({ overview, audience, objectives, requiredReading, modality, ...program }) => program) };
  oldClient.instances[0].code = "NIE-UPDATED";
  const retained = await api(request("catalog", "PUT", oldClient, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal(retained.status, 200);
  assert.deepEqual(retained.body.programs[0], saved.body.programs[0]);
  assert.equal(retained.body.instances[0].code, "NIE-UPDATED");
  assert.deepEqual(retained.body.services, initial.body.services);
  const headers = { ...admin, "if-match": retained.headers.ETag };
  assert.equal((await api(request("catalog", "PUT", { ...catalog, programs: [{ ...catalog.programs[0], modality: "" }, ...catalog.programs.slice(1)] }, headers))).status, 400);
  const clear = structuredClone(retained.body);
  clear.programs[0].objectives = "";
  clear.programs[0].requiredReading = "";
  clear.programs[0].overview = "";
  clear.programs[0].audience = "";
  const cleared = await api(request("catalog", "PUT", clear, headers));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.programs[0].objectives, "");
  assert.equal(cleared.body.programs[0].requiredReading, "");
  assert.equal(cleared.body.programs[0].modality, catalog.programs[0].modality);
  assert.equal(cleared.body.programs[0].overview, "");
  assert.equal(cleared.body.programs[0].audience, "");
});

test("workshop prices are admin-editable in both currencies, inherited by editions and preserved for older editors", async () => {
  const { api } = create();
  const initial = await api(request("catalog"));
  const catalog = structuredClone(initial.body);
  catalog.programs[0].priceCRC = 32500.25;
  catalog.programs[0].priceUSD = 72.5;
  catalog.instances.push({ ...catalog.instances[0], id: "niebla-two", code: "NIE-02", startDate: "2027-02-02", price: 999 });
  assert.equal((await api(request("catalog", "PUT", catalog))).status, 401);
  const saved = await api(request("catalog", "PUT", catalog, { ...admin, "if-match": initial.headers.ETag }));
  assert.equal(saved.status, 200);
  const publicCatalog = await api(request("catalog"));
  assert.equal(publicCatalog.body.programs[0].priceCRC, 32500.25);
  assert.equal(publicCatalog.body.programs[0].priceUSD, 72.5);
  const publicEditions = (await api(request("workshops"))).body.workshops.filter(({ programId }) => programId === "niebla");
  assert.deepEqual(publicEditions.map(({ priceCRC, priceUSD, price }) => [priceCRC, priceUSD, price]), [[32500.25, 72.5, 72.5], [32500.25, 72.5, 72.5]]);
  const oldClient = { ...saved.body, programs: saved.body.programs.map(({ priceCRC, priceUSD, ...program }) => program) };
  oldClient.instances[0].code = "NIE-UPDATED";
  oldClient.instances[0].price = 50;
  const retained = await api(request("catalog", "PUT", oldClient, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal(retained.status, 200);
  assert.deepEqual(retained.body.programs, saved.body.programs);
  assert.equal(retained.body.instances[0].code, "NIE-UPDATED");
  assert.equal(retained.body.instances[0].price, 72.5);
  const partial = structuredClone(retained.body);
  delete partial.programs[0].priceUSD;
  partial.programs[0].priceCRC = 0;
  const changed = await api(request("catalog", "PUT", partial, { ...admin, "if-match": retained.headers.ETag }));
  assert.equal(changed.status, 200);
  assert.equal(changed.body.programs[0].priceCRC, 0);
  assert.equal(changed.body.programs[0].priceUSD, 72.5);
  const cleared = structuredClone(changed.body);
  cleared.programs[0].priceCRC = null;
  cleared.programs[0].priceUSD = null;
  const result = await api(request("catalog", "PUT", cleared, { ...admin, "if-match": changed.headers.ETag }));
  assert.equal(result.status, 200);
  assert.equal(result.body.programs[0].priceCRC, null);
  assert.equal(result.body.programs[0].priceUSD, null);
  assert.equal(result.body.instances[0].price, null);
  assert.equal((await api(request("catalog", "PUT", catalog, { ...admin, "if-match": changed.headers.ETag }))).status, 409);
});

test("invalid workshop prices reject the entire catalog write without altering saved prices", async () => {
  const { api } = create();
  const initial = await api(request("catalog"));
  for (const field of ["priceCRC", "priceUSD"]) {
    for (const value of [-1, "45", "", true, 0.001, Number.MAX_SAFE_INTEGER]) {
      const catalog = structuredClone(initial.body);
      catalog.programs[0][field] = value;
      const result = await api(request("catalog", "PUT", catalog, { ...admin, "if-match": initial.headers.ETag }));
      assert.equal(result.status, 400, `${field}: ${String(value)}`);
      assert.match(result.body.error, /precio/u);
    }
  }
  assert.deepEqual((await api(request("catalog"))).body, initial.body);
});

test("public blog pages summarize both the latest and archived posts and assign publication dates on the server", async () => {
  const { api } = create();
  const texts = Array.from({ length: 15 }, (_, index) => ({ version: 1, id: `blog-${index}`, title: `Entrada ${index}`, author: "Autoría", permissionConfirmed: true, kind: index < 8 ? "post" : "participant", html: "<p>Una historia &amp; otra.</p><p>Final.</p>", publishedAt: "2020-01-01T00:00:00.000Z" }));
  const saved = await api(request("showcase", "PUT", { version: 1, texts }, admin));
  assert.equal(saved.status, 200);
  assert.ok(saved.body.texts.every((item) => item.publishedAt !== texts[0].publishedAt));
  const page = await api(request("editorial", "GET", null, {}, { tipo: "post", pagina: "2" }));
  assert.equal(page.body.total, 15);
  assert.equal(page.body.items.length, 6);
  assert.equal(page.body.archiveTotal, 14);
  assert.ok([page.body.featured, ...page.body.items].every((item) => !Object.hasOwn(item, "kind") && !Object.hasOwn(item, "html") && !Object.hasOwn(item, "permissionConfirmed")));
  assert.ok(!page.body.items.some((item) => item.id === page.body.featured.id));
  assert.equal(page.body.items[0].excerpt, "Una historia & otra. Final.");
  assert.equal((await api(request("editorial/entry"))).body.text.id, page.body.featured.id);
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
  const card = (await api(request("editorial"))).body.featured;
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

test("blog subtitles and tags survive saves, public filtering and older cached editors but can be explicitly cleared", async () => {
  const { api } = create();
  const text = { version: 1, id: "tagged", title: "Lecturas para compartir", subtitle: " Una invitación ", tags: [" Poesía ", "POESI\u0301A", "Lecturas"], permissionConfirmed: true, html: "<p>Texto completo con sus imágenes y enlaces.</p>" };
  const saved = await api(request("showcase", "PUT", { version: 1, texts: [text] }, admin));
  assert.equal(saved.status, 200);
  const entry = saved.body.texts[0];
  const filtered = (await api(request("editorial", "GET", null, {}, { etiqueta: "POESI\u0301A", pagina: "999" }))).body;
  assert.equal(filtered.featured.subtitle, "Una invitación");
  assert.deepEqual(filtered.featured.tags, ["Poesía", "Lecturas"]);
  assert.equal(filtered.page, 1);
  assert.equal(filtered.archiveTotal, 0);
  assert.equal(Object.hasOwn(filtered.featured, "html"), false);
  assert.equal((await api(request("editorial/entry", "GET", null, {}, { id: text.id }))).body.text.subtitle, entry.subtitle);
  const missing = (await api(request("editorial", "GET", null, {}, { etiqueta: "Desconocida" }))).body;
  assert.equal(missing.featured, null);
  assert.deepEqual(missing.items, []);
  assert.equal(missing.tags.length, 2);
  const { subtitle, tags, ...oldClient } = entry;
  const preserved = await api(request("showcase", "PUT", { version: 1, texts: [{ ...oldClient, title: "Título actualizado" }] }, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal(preserved.status, 200);
  assert.equal(preserved.body.texts[0].subtitle, subtitle);
  assert.deepEqual(preserved.body.texts[0].tags, tags);
  const headers = { ...admin, "if-match": preserved.headers.ETag };
  for (const invalid of [{ subtitle: "x".repeat(301) }, { tags: Array(11).fill("tema") }, { tags: "tema" }, { tags: ["x".repeat(41)] }]) {
    assert.equal((await api(request("showcase", "PUT", { version: 1, texts: [{ ...entry, ...invalid }] }, headers))).status, 400);
  }
  const cleared = await api(request("showcase", "PUT", { version: 1, texts: [{ ...entry, subtitle: "", tags: [] }] }, headers));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.texts[0].subtitle, "");
  assert.deepEqual(cleared.body.texts[0].tags, []);
  assert.equal(cleared.body.texts[0].publishedAt, entry.publishedAt);
  assert.equal(cleared.body.texts[0].html, entry.html);
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

test("initial blog samples are manageable publications and explicit deletion never resurrects them", async () => {
  const { api, store } = create();
  const query = { id: "ejemplo-coautoria" };
  const [first, concurrent] = await Promise.all([api(request("showcase")), api(request("showcase"))]);
  assert.equal(first.headers.ETag, concurrent.headers.ETag);
  assert.equal(first.body.texts.length, 2);
  const entry = (await api(request("editorial/entry", "GET", null, {}, query))).body.text;
  assert.equal(entry.sample, true);
  assert.equal(entry.authorUrl, "https://example.org/");
  const reactions = await api(request("editorial/reactions", "GET", null, {}, query));
  assert.equal(reactions.status, 200);
  const cookie = reactions.headers["Set-Cookie"].split(";")[0];
  const liked = await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { cookie }, query));
  assert.equal(liked.body.counts.heart, 1);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, { id: "ejemplo" }))).body.counts.heart, 0);
  assert.equal(store.data.get("showcase").version, first.headers.ETag, "reacting must not rewrite managed publications");
  const edited = await api(request("showcase", "PUT", { version: 1, texts: first.body.texts.map((text) => text.id === entry.id ? { ...text, title: "Coautoría editada", sample: false } : text) }, { ...admin, "if-match": first.headers.ETag }));
  assert.equal(edited.status, 200);
  const changed = edited.body.texts.find((text) => text.id === entry.id);
  assert.equal(changed.title, "Coautoría editada");
  assert.equal(changed.sample, false);
  assert.equal(changed.authorUrl, entry.authorUrl);
  assert.equal(changed.publishedAt, entry.publishedAt);
  assert.equal((await api(request("editorial/reactions", "GET", null, { cookie }, query))).body.counts.heart, 1);
  const removed = await api(request("showcase", "PUT", { version: 1, texts: [] }, { ...admin, "if-match": edited.headers.ETag }));
  assert.equal(removed.status, 200);
  assert.deepEqual((await api(request("showcase"))).body.texts, []);
  assert.equal((await api(request("editorial"))).body.featured, null);
  assert.equal((await api(request("editorial/entry", "GET", null, {}, query))).status, 404);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, query))).status, 404);
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, { cookie }, query))).status, 404);
  assert.equal((await api(request("showcase", "PUT", { version: 1, texts: first.body.texts }, { ...admin, "if-match": first.headers.ETag }))).status, 409);
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
  assert.equal(store.data.get("showcase").value.texts.length, 2);
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
  assert.equal(store.data.has("reactions/ejemplo"), false);
  store.limited = false;
  const text = { version: 1, id: "published", title: "Una publicación", html: "<p>Una lectura.</p>", permissionConfirmed: true };
  const saved = await api(request("showcase", "PUT", { version: 1, texts: [text] }, { ...admin, "if-match": (await api(request("showcase"))).headers.ETag }));
  assert.equal(saved.status, 200);
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, query))).status, 404, "the demo is not a real post when the blog has publications");
  assert.equal((await api(request("editorial/reactions", "GET", null, {}, { id: text.id }))).status, 200);
  await api(request("showcase", "PUT", { version: 1, texts: [] }, { ...admin, "if-match": saved.headers.ETag }));
  assert.equal((await api(request("editorial/reactions", "PUT", { reaction: "heart", active: true }, {}, { id: text.id }))).status, 404);
});

test("page copy is publicly readable, independently versioned and writable only by authorized administrators", async () => {
  const { api, store } = create();
  const initial = await api(request("settings/pages"));
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, DEFAULT_PAGE_COPY);
  assert.equal(initial.headers["Cache-Control"], "no-store");
  assert.equal(store.data.has("page-copy"), false);
  const catalog = await api(request("catalog"));
  const input = structuredClone(initial.body);
  input.pages.home.title = "Un nuevo espacio";
  input.pages.services.intro = "Una propuesta a medida.";
  input.pages.workshops.eyebrow = "";
  input.pages.team.body = "Primera parte.\n\nSegunda parte.";
  assert.equal((await api(request("settings/pages", "PUT", input))).status, 401);
  assert.equal((await api(request("settings/pages", "PUT", input, { ...admin, "x-ms-client-principal": github("another-user") }))).status, 403);
  assert.equal((await api(request("settings/pages", "PUT", input, { "x-ms-client-principal": admin["x-ms-client-principal"] }))).status, 428);
  assert.equal((await api(request("settings/pages", "PUT", input, { ...admin, "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await api(request("settings/pages", "PUT", input, { ...admin, "content-type": "text/plain" }))).status, 415);
  assert.equal((await api(request("settings/pages", "POST", input, admin))).status, 405);
  const saved = await api(request("settings/pages", "PUT", input, { ...admin, "if-match": initial.headers.ETag }));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, input);
  assert.equal(saved.headers["Cache-Control"], "no-store");
  assert.notEqual(saved.headers.ETag, initial.headers.ETag);
  assert.deepEqual((await api(request("settings/pages"))).body, input);
  assert.deepEqual((await api(request("catalog"))).body, catalog.body);
  assert.equal((await api(request("settings/pages", "PUT", initial.body, { ...admin, "if-match": initial.headers.ETag }))).status, 409);
  assert.deepEqual((await api(request("settings/pages"))).body, input);
});

test("invalid page copy cannot replace saved public text or expose unrelated configuration", async () => {
  const { api } = create();
  const initial = await api(request("settings/pages"));
  for (const invalid of [null, { version: 1, pages: [] }, { ...initial.body, internal: "private" },
    { version: 1, pages: { unknown: {} } }, { version: 1, pages: { home: { title: "" } } },
    { version: 1, pages: { home: { title: "x".repeat(151) } } },
    { version: 1, pages: { team: { body: "x".repeat(50001) } } }]) {
    assert.equal((await api(request("settings/pages", "PUT", invalid, admin))).status, 400);
  }
  assert.deepEqual((await api(request("settings/pages"))).body, initial.body);
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
  const body = { email: "lectora@dominio.org", name: "Prueba", course: "niebla", consent: true, message: "Solicitud ficticia", phone: "+1 202 555 0123", phoneCountry: "US" };
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

test("enrollment requires a matching international phone and contacts remain admin-only", async () => {
  const { api, store } = create();
  const body = { email: "private-enrollment@example.org", name: "Solicitud privada de prueba", course: "orientacion", consent: true, phone: "(202) 555-0123", phoneCountry: "US", status: "completed" };
  for (const invalid of [{ phone: "" }, { phone: "123" }, { phoneCountry: "ZZ" }, { phone: "+12025550123", phoneCountry: "CR" }]) {
    assert.equal((await api(request("enrollment", "POST", { ...body, ...invalid }))).status, 400);
  }
  assert.equal(store.records.length, 0);
  assert.equal((await api(request("enrollment", "POST", body))).status, 202);
  assert.equal(store.records[0].value.phone, "+12025550123");
  assert.equal(store.records[0].value.phoneCountry, "US");
  assert.equal(store.records[0].value.status, "interested", "public callers cannot confirm their own attendance");
  assert.equal((await api(request("enrollments"))).status, 401);
  assert.equal((await api(request("enrollments", "GET", null, { "x-ms-client-principal": github("another-user") }))).status, 403);
  const authorized = await api(request("enrollments", "GET", null, admin));
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers["Cache-Control"], "no-store");
  assert.equal(authorized.body.items[0].value.email, body.email);
  assert.equal(authorized.body.items[0].value.phone, "+12025550123");
  for (const path of ["catalog", "editorial", "settings/contacts"]) {
    const publicResponse = JSON.stringify((await api(request(path))).body);
    for (const contact of [body.email, body.name, "+12025550123"]) assert.ok(!publicResponse.includes(contact));
  }
});

test("private enrollment pages preserve legacy records and lifecycle updates use protected conditional writes", async () => {
  const { api, store } = create();
  const body = { email: "enrollment@example.org", name: "Prueba", course: "niebla", consent: true, phone: "+12025550123", phoneCountry: "US", message: "Mensaje conservado" };
  await api(request("enrollment", "POST", body));
  await api(request("enrollment", "POST", { ...body, email: "second-enrollment@example.org" }));
  const legacyId = `2025-01-01T10:00:00.000Z-${randomUUID()}`;
  const legacy = { name: "Solicitud anterior", email: "legacy-enrollment@example.org", course: "deleted-edition", workshopName: "Taller anterior", editionCode: "OLD-01", createdAt: "2025-01-01T10:00:00.000Z", message: "No perder esta solicitud", consent: true };
  await store.write(`submissions/enrollment/${legacyId}`, legacy, "initial");
  const first = await api(request("enrollments", "GET", null, admin));
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.continuationToken);
  const second = await api(request("enrollments", "GET", null, admin, { continuationToken: first.body.continuationToken }));
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.continuationToken, null);
  const items = [...first.body.items, ...second.body.items];
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  const record = items.find((item) => item.id === legacyId);
  assert.equal(record.value.phone, undefined);
  assert.equal(record.value.status, "interested");
  const query = { id: record.id };
  const update = (status, headers = admin, extra = {}) => api(request("enrollments", "PUT", { status, ...extra }, headers, query));
  assert.equal((await update("confirmed", {})).status, 401);
  assert.equal((await update("confirmed", { ...admin, "x-ms-client-principal": github("another-user") })).status, 403);
  assert.equal((await update("confirmed", { "x-ms-client-principal": admin["x-ms-client-principal"] })).status, 428);
  const initialHeaders = { ...admin, "if-match": record.version };
  assert.equal((await update("confirmed", { ...initialHeaders, "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await update("confirmed", { ...initialHeaders, "content-type": "text/plain" })).status, 415);
  for (const status of ["unknown", null, 42]) assert.equal((await update(status, initialHeaders)).status, 400);
  assert.equal((await api(request("enrollments", "PUT", { status: "confirmed" }, initialHeaders, { id: "../mail-settings" }))).status, 400);
  assert.equal((await api(request("enrollments", "PUT", { status: "confirmed" }, initialHeaders, { id: `2025-01-01T10:00:00.000Z-${randomUUID()}` }))).status, 404);
  let version = record.version;
  for (const status of ["confirmed", "attending", "withdrawn", "completed", "interested"]) {
    const saved = await update(status, { ...admin, "if-match": version }, { ...(status === "confirmed" ? { paymentMethod: "SINPE Móvil" } : {}), email: "must-not-replace@example.org", workshopName: "Must not replace snapshot" });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers["Cache-Control"], "no-store");
    const { status: savedStatus, updatedAt, paymentMethod, ...snapshot } = saved.body;
    assert.equal(savedStatus, status);
    assert.ok(Number.isFinite(Date.parse(updatedAt)));
    assert.equal(paymentMethod, "SINPE Móvil");
    assert.deepEqual(snapshot, legacy);
    version = saved.headers.ETag;
  }
  assert.equal((await update("confirmed", initialHeaders)).status, 409);
  assert.equal(store.data.get(`submissions/enrollment/${legacyId}`).value.status, "interested");
  const exported = await api(request("submissions", "GET", null, admin, { kind: "enrollment" }));
  assert.equal(exported.body.items.find((item) => item.email === legacy.email).status, "interested");
});

test("manual enrollments require administration and authorization, validate contacts and payment, and prevent duplicate retries", async () => {
  const { api, store } = create();
  const id = `${new Date().toISOString()}-${randomUUID()}`;
  const body = { id, name: " Participante manual ", email: " Manual@Example.org ", phone: "(202) 555-0123", phoneCountry: "US", course: "niebla", consent: true, status: "confirmed", paymentMethod: " Transferencia ", message: " Nota privada " };
  assert.equal((await api(request("enrollments", "POST", body))).status, 401);
  assert.equal((await api(request("enrollments", "POST", body, { ...admin, "x-ms-client-principal": github("another-user") }))).status, 403);
  assert.equal((await api(request("enrollments", "POST", body, { ...admin, "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await api(request("enrollments", "POST", body, { ...admin, "content-type": "text/plain" }))).status, 415);
  for (const invalid of [{ id: "../bad" }, { consent: false }, { course: "missing" }, { course: "servicio:talleres-personalizados" }, { name: "" }, { email: "bad" }, { phone: "123" }, { phoneCountry: "CR" }, { status: "unknown" }, { paymentMethod: "" }, { paymentMethod: null }, { paymentMethod: "x".repeat(101) }, { paymentMethod: "not\nvalid" }, { message: "x".repeat(2001) }]) {
    assert.equal((await api(request("enrollments", "POST", { ...body, ...invalid }, admin))).status, 400, JSON.stringify(invalid));
  }
  assert.equal([...store.data.keys()].filter((name) => name.startsWith("submissions/enrollment/")).length, 0);
  const saved = await api(request("enrollments", "POST", body, admin));
  assert.equal(saved.status, 201);
  assert.equal(saved.body.id, id);
  assert.equal(saved.body.value.name, "Participante manual");
  assert.equal(saved.body.value.email, "manual@example.org");
  assert.equal(saved.body.value.phone, "+12025550123");
  assert.equal(saved.body.value.phoneCountry, "US");
  assert.equal(saved.body.value.editionCode, "NIE-01");
  assert.equal(saved.body.value.paymentMethod, "Transferencia");
  assert.equal(saved.body.value.status, "confirmed");
  assert.equal(saved.body.value.source, "admin");
  assert.equal(saved.headers["Cache-Control"], "no-store");
  assert.ok(saved.headers.ETag);
  assert.equal((await api(request("enrollments", "POST", body, admin))).status, 409);
  assert.equal([...store.data.keys()].filter((name) => name.startsWith("submissions/enrollment/")).length, 1);
  const publicBody = { ...body, email: "public@example.org" };
  assert.equal((await api(request("enrollment", "POST", publicBody))).status, 202);
  const publicRecord = store.records[0].value;
  assert.equal(publicRecord.status, "interested");
  assert.equal(publicRecord.paymentMethod, undefined);
  assert.equal(publicRecord.source, undefined);
  for (const path of ["catalog", "workshops", "editorial"]) {
    const response = JSON.stringify((await api(request(path))).body);
    for (const privateValue of ["manual@example.org", "Participante manual", "Nota privada", "Transferencia"]) assert.ok(!response.includes(privateValue));
  }
});

test("confirming requires a payment method, transfers preserve contacts and provenance, and stale changes cannot overwrite assignments", async () => {
  const { api, store } = create();
  const body = { email: "move@example.org", name: "Prueba de traslado", course: "niebla", consent: true, phone: "+12025550123", phoneCountry: "US", message: "Mensaje original" };
  await api(request("enrollment", "POST", body));
  const record = (await api(request("enrollments", "GET", null, admin))).body.items[0];
  const query = { id: record.id };
  const headers = { ...admin, "if-match": record.version };
  for (const paymentMethod of [undefined, "", " ", 42, null, "x".repeat(101), "bad\nmethod"]) {
    assert.equal((await api(request("enrollments", "PUT", { status: "confirmed", paymentMethod }, headers, query))).status, 400);
  }
  const confirmed = await api(request("enrollments", "PUT", { status: "confirmed", paymentMethod: " SINPE Móvil " }, headers, query));
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.paymentMethod, "SINPE Móvil");
  const currentHeaders = { ...admin, "if-match": confirmed.headers.ETag };
  for (const course of ["missing", "servicio:talleres-personalizados", "../bad", null, {}]) {
    assert.equal((await api(request("enrollments", "PUT", { status: "confirmed", course }, currentHeaders, query))).status, 400);
  }
  const moved = await api(request("enrollments", "PUT", { status: "confirmed", course: "paramo", email: "ignore@example.org", originalAssignment: { course: "forged" } }, currentHeaders, query));
  assert.equal(moved.status, 200);
  for (const key of ["name", "email", "phone", "phoneCountry", "message", "consent", "createdAt"]) assert.equal(moved.body[key], record.value[key]);
  assert.equal(moved.body.course, "paramo");
  assert.equal(moved.body.programId, "paramo");
  assert.equal(moved.body.editionCode, "PAR-01");
  assert.equal(moved.body.paymentMethod, "SINPE Móvil");
  assert.equal(moved.body.originalAssignment.course, "niebla");
  assert.equal(moved.body.originalAssignment.editionCode, "NIE-01");
  assert.equal((await api(request("enrollments", "PUT", { status: "withdrawn", course: "sotomonte" }, currentHeaders, query))).status, 409);
  const again = await api(request("enrollments", "PUT", { status: "attending", course: "sotomonte" }, { ...admin, "if-match": moved.headers.ETag }, query));
  assert.equal(again.status, 200);
  assert.equal(again.body.originalAssignment.course, "niebla");
  assert.equal(again.body.course, "sotomonte");
  assert.equal(again.body.paymentMethod, "SINPE Móvil");
  assert.equal([...store.data.keys()].filter((name) => name.startsWith("submissions/enrollment/")).length, 1);
  await api(request("enrollment", "POST", { ...body, course: "servicio:talleres-personalizados" }));
  const service = store.records[1];
  const serviceRecord = await store.read(`submissions/enrollment/${service.id}`);
  const assigned = await api(request("enrollments", "PUT", { status: "interested", course: "paramo" }, { ...admin, "if-match": serviceRecord.version }, { id: service.id }));
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.serviceId, undefined);
  assert.equal(assigned.body.serviceName, undefined);
  assert.equal(assigned.body.originalAssignment.serviceId, "talleres-personalizados");
  const legacyId = `2025-01-01T10:00:00.000Z-${randomUUID()}`;
  await store.write(`submissions/enrollment/${legacyId}`, { ...body, status: "confirmed" }, "initial");
  const legacy = (await api(request("enrollments", "GET", null, admin))).body.items.find(({ id }) => id === legacyId);
  assert.equal(legacy.value.status, "confirmed");
  assert.equal(legacy.value.paymentMethod, undefined);
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
