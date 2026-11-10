import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGE_COPY, validatePageCopy } from "../page-copy-model.mjs";

test("page copy fills only missing fields with defaults without mutating defaults or the input", () => {
  const defaults = structuredClone(DEFAULT_PAGE_COPY);
  const input = { version: 1, pages: { home: { title: " Nuestro espacio " }, team: { body: " Primera parte.\r\n\r\nSegunda parte. " } } };
  const original = structuredClone(input);
  const value = validatePageCopy(input);
  assert.equal(value.pages.home.title, "Nuestro espacio");
  assert.equal(value.pages.home.intro, defaults.pages.home.intro);
  assert.deepEqual(value.pages.services, defaults.pages.services);
  assert.equal(value.pages.team.body, "Primera parte.\n\nSegunda parte.");
  assert.deepEqual(DEFAULT_PAGE_COPY, defaults);
  assert.deepEqual(input, original);
});

test("optional copy can be explicitly cleared and remains empty after serialization and reload", () => {
  const input = structuredClone(DEFAULT_PAGE_COPY);
  input.pages.home.eyebrow = "";
  input.pages.workshops.intro = "  ";
  input.pages.team.body = "";
  const value = validatePageCopy(JSON.parse(JSON.stringify(validatePageCopy(input))));
  assert.equal(value.pages.home.eyebrow, "");
  assert.equal(value.pages.workshops.intro, "");
  assert.equal(value.pages.team.body, "");
  assert.equal(value.pages.team.sectionTitle, DEFAULT_PAGE_COPY.pages.team.sectionTitle);
});

test("page copy rejects malformed structures, unsupported pages/fields and invalid or oversized text", () => {
  for (const invalid of [null, [], {}, { version: 2, pages: {} }, { version: 1, pages: [] }, { version: 1, pages: null },
    { version: 1, pages: { other: {} } }, { ...DEFAULT_PAGE_COPY, internal: "not public" },
    { version: 1, pages: { home: { other: "not a field" } } }, { version: 1, pages: { team: null } }]) {
    assert.throws(() => validatePageCopy(invalid));
  }
  for (const [page, field, invalid] of [
    ["home", "title", ""], ["home", "title", " "], ["services", "intro", null], ["workshops", "eyebrow", 42],
    ["team", "sectionTitle", ""], ["team", "body", []], ["home", "eyebrow", "x".repeat(101)],
    ["services", "title", "x".repeat(151)], ["workshops", "intro", "x".repeat(2001)], ["team", "body", "x".repeat(10001)],
  ]) {
    const input = structuredClone(DEFAULT_PAGE_COPY);
    input.pages[page][field] = invalid;
    assert.throws(() => validatePageCopy(input), `${page}.${field}`);
  }
});

test("page copy preserves plain text without treating markup or links as HTML", () => {
  const input = structuredClone(DEFAULT_PAGE_COPY);
  input.pages.home.title = "Escribir <juntos> & compartir";
  input.pages.team.body = "<strong>Texto simple</strong>\n\nOtra voz.";
  assert.deepEqual(validatePageCopy(input), input);
});
