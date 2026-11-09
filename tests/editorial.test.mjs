import test from "node:test";
import assert from "node:assert/strict";
import { editorialPage, publicationMetadata, publicationDate } from "../editorial-model.mjs";

const entries = Array.from({ length: 19 }, (_, index) => ({ id: `entry-${String(index).padStart(2, "0")}`, kind: index % 2 ? "post" : "participant", publishedAt: `2026-03-${String(index + 1).padStart(2, "0")}T04:30:00.000Z` }));

test("Editorial filters before pagination, sorts newest first and returns disjoint bounded pages", () => {
  const first = editorialPage(entries);
  const second = editorialPage(entries, { page: 2 });
  assert.equal(first.items.length, 6);
  assert.equal(first.pages, 4);
  assert.equal(first.items[0].id, "entry-18");
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 12);
  const filtered = editorialPage(entries, { kind: "post", page: 2 });
  assert.equal(filtered.total, 9);
  assert.equal(filtered.pages, 2);
  assert.equal(filtered.items.length, 3);
  assert.ok(filtered.items.every((item) => item.kind === "post"));
  assert.equal(editorialPage(entries, { kind: "participant", page: 999 }).page, 2);
});

test("invalid pages normalize safely, ties are deterministic, and empty filters never produce page zero", () => {
  for (const page of [0, -1, "2bad", "1.5", Infinity, "90071992547409999", "01"]) assert.equal(editorialPage(entries, { page }).page, 1);
  assert.equal(editorialPage(entries, { kind: "invalid" }).kind, "all");
  assert.equal(editorialPage([], { page: 3 }).page, 1);
  assert.equal(editorialPage([], { page: 3 }).pages, 1);
  const tied = [{ id: "b", kind: "post", publishedAt: null }, { id: "a", kind: "post", publishedAt: null }];
  assert.deepEqual(editorialPage(tied).items.map((item) => item.id), ["a", "b"]);
});

test("legacy texts remain participant samples and publication time crosses the UTC date boundary in Costa Rica", () => {
  assert.deepEqual(publicationMetadata({}), { kind: "participant", publishedAt: null });
  assert.throws(() => publicationMetadata({ kind: "unknown" }));
  assert.throws(() => publicationMetadata({ publishedAt: "2026-02-30T00:00:00.000Z" }));
  assert.throws(() => publicationMetadata({ publishedAt: "2026-01-01" }));
  const date = publicationDate("2026-07-02T03:30:00.000Z");
  assert.match(date, /1 de julio de 2026/u);
  assert.match(date, /Costa Rica/u);
  assert.doesNotMatch(date, /2 de julio/u);
});
