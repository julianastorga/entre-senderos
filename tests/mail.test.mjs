import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MailService } from "../server/mail-service.mjs";
import { createApi } from "../server/app.mjs";

class Store {
  data = new Map();
  async read(name, initial) { return structuredClone(this.data.get(name) || { value: initial, version: "initial" }); }
  async write(name, value, version) {
    const current = await this.read(name, null);
    if (version !== current.version) { const error = new Error("Conflict"); error.statusCode = 412; throw error; }
    const result = { value: structuredClone(value), version: String(Number(current.version) + 1 || 1) };
    this.data.set(name, result); return structuredClone(result);
  }
  async deleteJson(name, version) {
    assert.equal((await this.read(name, null)).version, version); this.data.delete(name);
  }
  async jsonPage(prefix, token) {
    const items = [...this.data].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, record]) => ({ id: key.split("/").at(-1), ...structuredClone(record) }));
    const start = Number(token || 0);
    return { items: items.slice(start, start + 7), continuationToken: start + 7 < items.length ? String(start + 7) : null };
  }
  async rateLimit() {}
}
const sender = "news@workshops.org";
const config = { domain: "workshops.org", sender, senderName: "Talleres", replyTo: "", clientId: "test-client.apps.googleusercontent.com", clientSecret: "client-secret-unit-test-only", enabled: false };
function setup() {
  const store = new Store(); const sent = []; let fail = false; let account = sender;
  const clientFactory = () => ({
    async generateCodeVerifierAsync() { return { codeVerifier: "verifier", codeChallenge: "challenge" }; },
    generateAuthUrl(options) { assert.equal(options.access_type, "offline"); assert.equal(options.code_challenge_method, "S256"); return "https://accounts.google.com/test"; },
    async getToken() { return { tokens: { refresh_token: "unit-test-refresh-token", id_token: "verified-by-fake-client" } }; },
    async verifyIdToken() { return { getPayload: () => ({ email: account, email_verified: true, hd: "workshops.org" }) }; },
    setCredentials() {},
    async request(request) { sent.push(request); if (fail) throw new Error("Unknown delivery result"); return { data: { id: `google-${sent.length}` } }; },
  });
  const mail = new MailService({ store, secret: "unit-test-private-encryption-key-at-least-32-characters", publicOrigin: "https://workshops.org", schedulerEnabled: true, clientFactory });
  async function connect() {
    let saved = await mail.saveSettings(config, "initial");
    const oauth = await mail.startOAuth();
    await mail.finishOAuth({ state: oauth.state, code: "authorization-code", cookieState: oauth.state });
    saved = await mail.publicSettings();
    await mail.saveSettings({ ...config, clientSecret: "", enabled: true }, saved.version);
    return oauth;
  }
  return { store, mail, sent, connect, setFailure: (value) => { fail = value; }, setAccount: (value) => { account = value; } };
}
const subscriberId = (email) => createHash("sha256").update(email).digest("hex");
async function subscriber(store, email, status = "confirmed") {
  const id = subscriberId(email);
  await store.write(`submissions/newsletter/${id}`, { email, status, consent: true, createdAt: new Date().toISOString() }, "initial");
  return id;
}

test("Google authorization is browser-bound and single-use; settings keep secrets encrypted and restrict the sender", async () => {
  const { mail, store, connect } = setup();
  const oauth = await connect();
  const safe = await mail.publicSettings();
  assert.equal(safe.value.connected, true);
  assert.equal(safe.value.enabled, true);
  assert.equal(safe.value.account, sender);
  assert.equal(Object.hasOwn(safe.value, "encrypted"), false);
  assert.equal(Object.hasOwn(safe.value, "clientSecret"), false);
  const stored = JSON.stringify((await store.read("mail-settings", null)).value);
  assert.doesNotMatch(stored, /client-secret-unit-test-only|unit-test-refresh-token/u);
  await assert.rejects(mail.finishOAuth({ state: oauth.state, code: "replay", cookieState: oauth.state }), { status: 400 });
  await assert.rejects(mail.saveSettings({ ...config, sender: "another@workshops.org", enabled: true }, safe.version), { status: 400 });
  const pending = await mail.startOAuth();
  await assert.rejects(mail.finishOAuth({ state: pending.state, code: "code", cookieState: "other-browser" }), { status: 400 });
  const wrongAccount = setup();
  await wrongAccount.mail.saveSettings(config, "initial"); wrongAccount.setAccount("another@workshops.org");
  const wrong = await wrongAccount.mail.startOAuth();
  await assert.rejects(wrongAccount.mail.finishOAuth({ state: wrong.state, code: "code", cookieState: wrong.state }), { status: 403 });
});

test("confirmation tokens expire and cannot be reused or resurrect an unsubscribed address", async () => {
  const { mail, store, connect } = setup(); await connect();
  const id = await subscriber(store, "reader@workshops.org", "pending_confirmation");
  const messages = []; mail.sendMessage = async (message) => { messages.push(message); };
  await mail.requestConfirmation(id);
  const token = /token=([a-f0-9]{64}\.[\w-]{43})/u.exec(messages[0].body)[1];
  await assert.rejects(mail.confirm(token + "bad"), { status: 400 });
  await mail.confirm(token);
  assert.equal((await store.read(`submissions/newsletter/${id}`, null)).value.status, "confirmed");
  await assert.rejects(mail.confirm(token), { status: 400 });
  await mail.unsubscribe(mail.unsubscribeToken(id));
  await assert.rejects(mail.requestConfirmation(id), { status: 409 });
  await assert.rejects(mail.confirm(token), { status: 400 });
  const expiring = await subscriber(store, "expired@workshops.org", "pending_confirmation");
  await mail.requestConfirmation(expiring);
  const expired = /token=([a-f0-9]{64}\.[\w-]{43})/u.exec(messages[1].body)[1];
  mail.now = () => Date.now() + 25 * 60 * 60_000;
  await assert.rejects(mail.confirm(expired), { status: 400 });
});

test("campaigns page through subscribers, recheck consent and resume batches without duplicate sends", async () => {
  const { mail, store, sent, connect } = setup(); await connect();
  for (let index = 0; index < 25; index += 1) await subscriber(store, `reader${index}@workshops.org`);
  const optedOut = await subscriber(store, "late-optout@workshops.org");
  await subscriber(store, "pending@workshops.org", "pending_confirmation");
  const campaign = await mail.saveCampaign({ subject: "Novedades", body: "Texto autorizado." });
  await assert.rejects(mail.queueCampaign(campaign.value.id, null, "stale"), { status: 409 });
  await mail.queueCampaign(campaign.value.id, null, campaign.version);
  await mail.subscriberAction(optedOut, "unsubscribe");
  const first = await mail.dispatch(); assert.equal(first.processed, 20); assert.equal(first.remaining, true);
  const second = await mail.dispatch(); assert.equal(second.processed, 5);
  assert.equal(sent.length, 25);
  assert.equal((await store.read(`campaigns/${campaign.value.id}`, null)).value.status, "sent");
  assert.equal((await mail.dispatch()).processed, 0);
  const raw = Buffer.from(sent[0].data.raw, "base64url").toString("utf8").replace(/\r\n[ \t]+/gu, " ");
  assert.match(raw, /List-Unsubscribe: <https:\/\/workshops\.org\/api\/mail\/unsubscribe\?token=/u);
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/u);
});

test("ambiguous Gmail results pause for review rather than retry, and scheduled campaigns can be cancelled", async () => {
  const { mail, store, sent, connect, setFailure } = setup(); await connect(); await subscriber(store, "reader@workshops.org");
  const scheduled = await mail.saveCampaign({ subject: "Futura", body: "Mensaje." });
  await mail.queueCampaign(scheduled.value.id, new Date(Date.now() + 600_000).toISOString(), scheduled.version);
  assert.equal((await mail.dispatch()).processed, 0);
  await mail.cancelCampaign(scheduled.value.id);
  const campaign = await mail.saveCampaign({ subject: "Ahora", body: "Mensaje." });
  await mail.queueCampaign(campaign.value.id, null, campaign.version);
  setFailure(true); await mail.dispatch();
  assert.equal((await store.read(`campaigns/${campaign.value.id}`, null)).value.status, "needs_review");
  await mail.dispatch(); assert.equal(sent.length, 1);
  await mail.disconnect(); assert.equal(await mail.ready(), false);
});

test("mail APIs enforce administration, CSRF, safe settings, callback cookies and authenticated scheduler dispatch", async () => {
  const { store, mail } = setup();
  const key = "unit-test-scheduler-key-at-least-32-characters";
  const api = createApi({ store, mail, schedulerKey: key, adminLogins: "owner" });
  const identity = Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "owner", userRoles: ["authenticated"] })).toString("base64");
  const request = (path, method = "GET", body, headers = {}, query = {}) => ({ params: { path }, method, body, query, headers: { "content-type": "application/json", ...headers } });
  const admin = { "x-ms-client-principal": identity };
  assert.equal((await api(request("mail/settings"))).status, 401);
  assert.equal((await api(request("mail/campaigns", "POST", { subject: "X", body: "Y" }, { ...admin, "sec-fetch-site": "cross-site" }))).status, 403);
  const settings = await api(request("mail/settings", "PUT", config, { ...admin, "if-match": "initial" }));
  assert.equal(settings.status, 200); assert.equal(Object.hasOwn(settings.body, "encrypted"), false);
  const oauth = await api(request("mail/google/connect", "POST", {}, admin));
  assert.match(oauth.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax; Max-Age=600/u);
  const state = oauth.headers["Set-Cookie"].split(";")[0].split("=")[1];
  const callback = await api(request("mail/google/callback", "GET", undefined, { cookie: oauth.headers["Set-Cookie"].split(";")[0] }, { state, code: "code" }));
  assert.equal(callback.status, 302);
  assert.equal((await api(request("mail/dispatch", "POST", {}, { "x-mail-dispatch-key": "invalid" }))).status, 401);
  assert.equal((await api(request("mail/dispatch", "POST", {}, { "x-mail-dispatch-key": key }))).status, 200);
  const id = await subscriber(store, "one-click@workshops.org");
  const unsubscribe = await api(request("mail/unsubscribe", "POST", "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded" }, { token: mail.unsubscribeToken(id) }));
  assert.equal(unsubscribe.status, 200);
  assert.equal((await store.read(`submissions/newsletter/${id}`, null)).value.status, "unsubscribed");
});
