import test from "node:test";
import assert from "node:assert/strict";
import { authorCredit, externalLink, editorialPage, postMetadata, publicationMetadata, publicationDate } from "../editorial-model.mjs";

const entries = Array.from({ length: 19 }, (_, index) => ({ id: `entry-${String(index).padStart(2, "0")}`, kind: index % 2 ? "post" : "participant", publishedAt: `2026-03-${String(index + 1).padStart(2, "0")}T04:30:00.000Z` }));

test("the blog features the latest post and paginates all previous legacy kinds without duplicates", () => {
  const first = editorialPage(entries);
  const second = editorialPage(entries, { page: 2 });
  assert.equal(first.items.length, 6);
  assert.equal(first.pages, 3);
  assert.equal(first.featured.id, "entry-18");
  assert.equal(first.items[0].id, "entry-17");
  assert.equal(first.archiveTotal, 18);
  assert.deepEqual(second.featured, first.featured);
  const all = [first.featured, ...first.items, ...second.items, ...editorialPage(entries, { page: 3 }).items];
  assert.equal(new Set(all.map((item) => item.id)).size, entries.length);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 12);
  const legacyQuery = editorialPage(entries, { kind: "post", page: 2 });
  assert.equal(legacyQuery.total, 19);
  assert.equal(legacyQuery.pages, 3);
  assert.deepEqual(legacyQuery.items, second.items);
  assert.ok(!Object.hasOwn(legacyQuery, "kind"));
  assert.equal(editorialPage(entries, { kind: "participant", page: 999 }).page, 3);
});

test("invalid pages normalize safely, ties are deterministic, and an empty blog never produces page zero", () => {
  for (const page of [0, -1, "2bad", "1.5", Infinity, "90071992547409999", "01"]) assert.equal(editorialPage(entries, { page }).page, 1);
  assert.equal(editorialPage([], { page: 3 }).page, 1);
  assert.equal(editorialPage([], { page: 3 }).pages, 1);
  assert.equal(editorialPage([]).featured, null);
  assert.equal(editorialPage([entries[0]]).archiveTotal, 0);
  assert.deepEqual(editorialPage([entries[0]], { page: 999 }).items, []);
  const tied = [{ id: "b", kind: "post", publishedAt: null }, { id: "a", kind: "post", publishedAt: null }];
  assert.equal(editorialPage(tied).featured.id, "a");
  assert.deepEqual(editorialPage(tied).items.map((item) => item.id), ["b"]);
});

test("tag filtering features the newest match and keeps global per-post cloud counts across pages", () => {
  const tagged = entries.map((entry, index) => ({ ...entry, tags: index % 2 ? ["Poesía", "Lecturas"] : ["Lecturas"] }));
  tagged[1].tags.push("POESI\u0301A");
  const filtered = editorialPage(tagged, { tag: "  POESI\u0301A  ", page: 999 });
  assert.equal(filtered.tag, "poesía");
  assert.equal(filtered.featured.id, "entry-17");
  assert.equal(filtered.page, 2);
  assert.equal(filtered.pages, 2);
  assert.equal(filtered.total, 9);
  assert.equal(filtered.archiveTotal, 8);
  assert.equal(filtered.allTotal, 19);
  assert.deepEqual(filtered.items.map((item) => item.id), ["entry-03", "entry-01"]);
  assert.deepEqual(filtered.tags, [{ key: "lecturas", name: "Lecturas", count: 19 }, { key: "poesía", name: "Poesía", count: 9 }]);
  const missing = editorialPage(tagged, { tag: "Sin coincidencias", page: 3 });
  assert.equal(missing.featured, null);
  assert.equal(missing.total, 0);
  assert.equal(missing.page, 1);
  assert.deepEqual(missing.items, []);
  assert.deepEqual(missing.tags, filtered.tags);
});

test("subtitle and tag validation preserves legacy posts and normalizes bounded editable metadata", () => {
  assert.deepEqual(postMetadata({}), { subtitle: "", tags: [] });
  assert.deepEqual(postMetadata({ subtitle: " Un subtítulo ", tags: [" Poesía ", "POESI\u0301A", "Escritura  creativa"] }), { subtitle: "Un subtítulo", tags: ["Poesía", "Escritura creativa"] });
  for (const input of [{ subtitle: 42 }, { subtitle: "x".repeat(301) }, { tags: "Poesía" }, { tags: Array(11).fill("tag") }, { tags: [42] }, { tags: [""] }, { tags: ["x".repeat(41)] }, { tags: ["uno,dos"] }, { tags: ["una\netiqueta"] }]) {
    assert.throws(() => postMetadata(input));
  }
});

test("old categories are ignored and publication time crosses the UTC date boundary in Costa Rica", () => {
  assert.deepEqual(publicationMetadata({}), { publishedAt: null });
  assert.deepEqual(publicationMetadata({ kind: "participant" }), publicationMetadata({ kind: "post" }));
  assert.throws(() => publicationMetadata({ publishedAt: "2026-02-30T00:00:00.000Z" }));
  assert.throws(() => publicationMetadata({ publishedAt: "2026-01-01" }));
  const date = publicationDate("2026-07-02T03:30:00.000Z");
  assert.match(date, /1 de julio de 2026/u);
  assert.match(date, /Costa Rica/u);
  assert.doesNotMatch(date, /2 de julio/u);
});

test("every post can carry an optional credit and a separate safe author website", () => {
  assert.deepEqual(authorCredit({}), { author: "", authorUrl: "" });
  assert.deepEqual(authorCredit({ author: " Una autora ", authorUrl: " https://blog.example.org " }), { author: "Una autora", authorUrl: "https://blog.example.org/" });
  assert.deepEqual(authorCredit({ author: "Firma sin blog" }), { author: "Firma sin blog", authorUrl: "" });
  assert.throws(() => authorCredit({ authorUrl: "https://blog.example.org" }), /crédito/u);
  assert.throws(() => authorCredit({ author: "a".repeat(151) }));
  assert.throws(() => authorCredit({ author: 42 }));
  for (const authorUrl of ["javascript:alert(1)", "//blog.example.org", "data:text/html,test", "https://", "https://[invalid", "https://user:password@blog.example.org", "https://blog.example.org/\npath", "https://blog.example.org\\path", 42]) {
    assert.throws(() => authorCredit({ author: "Autora", authorUrl }), `Reject ${authorUrl}`);
    assert.equal(externalLink(authorUrl), null);
  }
  assert.equal(externalLink("http://blog.example.org/lecturas?q=1#texto"), "http://blog.example.org/lecturas?q=1#texto");
});
