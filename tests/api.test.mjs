import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { createApi } from "../server/app.mjs";
import { createDemoAuth } from "../server/demo-auth.mjs";
import { DEFAULT_WORKSHOPS } from "../workshops.mjs";
import { validateNewsletterEmail } from "../email-validation.mjs";
import { verifyMailDomain } from "../server/mail-domain.mjs";

class MemoryStore {
  data = new Map();
  records = [];
  limited = false;
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
  assert.equal((await api(request("workshops"))).body.workshops.length, 3);
  const body = { version: 1, workshops: DEFAULT_WORKSHOPS };
  assert.equal((await api(request("workshops", "PUT", body))).status, 401);
  assert.equal((await api(request("workshops", "PUT", body, { ...admin, "x-ms-client-principal": github("someone-else") }))).status, 403);
  assert.equal((await api(request("submissions", "GET", null, {}, { kind: "enrollment" }))).status, 401);
  assert.equal((await api(request("workshops", "PUT", body, admin))).status, 200);
  assert.equal((await api(request("workshops", "PUT", body, admin))).status, 409);
  assert.equal((await api(request("workshops", "PUT", body, { ...admin, "sec-fetch-site": "cross-site" }))).status, 403);
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
    assert.equal((await disabled(request("workshops", "PUT", { version: 1, workshops: DEFAULT_WORKSHOPS }, { ...identity("writer@workshops.org"), "if-match": "initial" }))).status, 403);
  }
  assert.equal((await api(request("workshops", "PUT", { version: 1, workshops: DEFAULT_WORKSHOPS }, { ...identity("writer@workshops.org"), "if-match": "initial" }))).status, 200);
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
  const save = await api(request("workshops", "PUT", { version: 1, workshops: DEFAULT_WORKSHOPS }, { cookie, "if-match": "initial" }));
  assert.equal(save.status, 200);
  const token = cookie.split(";")[0];
  assert.equal(demoAuth.session(token.replace("=", "=tampered")), null);
  now += 2 * 60 * 60 * 1000;
  assert.equal(demoAuth.session(token), null);
  assert.equal((await create().api(request("auth/login", "POST", { username: "test-admin", password: testPassword }))).status, 404);
});
