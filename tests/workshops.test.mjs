import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKSHOPS, STORAGE_KEY, WorkshopValidationError, sessionDates,
  parseDate, validateWorkshop, validateCatalog, loadWorkshops, saveWorkshops, formatSchedule, upcomingEditions,
} from "../workshops.mjs";

const sample = { ...DEFAULT_WORKSHOPS[0] };

test("upcoming editions include today until midnight in Costa Rica, not UTC or the browser timezone", () => {
  const editions = [
    { ...sample, id: "yesterday", startDate: "2026-12-30" },
    { ...sample, id: "today", startDate: "2026-12-31", startTime: "08:00" },
    { ...sample, id: "tomorrow", startDate: "2027-01-01" },
  ];
  assert.deepEqual(upcomingEditions(editions, new Date("2027-01-01T05:59:59Z")).map(({ id }) => id), ["today", "tomorrow"]);
  assert.deepEqual(upcomingEditions(editions, new Date("2027-01-01T06:00:00Z")).map(({ id }) => id), ["tomorrow"]);
});

test("upcoming editions sort by start date, time and code without mutating the catalog", () => {
  const editions = [
    { ...sample, id: "later", startDate: "2027-02-01" },
    { ...sample, id: "evening", startDate: "2027-01-19", startTime: "18:00" },
    { ...sample, id: "b", code: "B-01", startDate: "2027-01-19", startTime: "08:00" },
    { ...sample, id: "a", code: "A-01", startDate: "2027-01-19", startTime: "08:00" },
  ];
  const before = structuredClone(editions);
  assert.deepEqual(upcomingEditions(editions, new Date("2027-01-01T12:00:00Z")).map(({ id }) => id), ["a", "b", "evening", "later"]);
  assert.deepEqual(editions, before);
});

test("empty or already-started catalogs have no upcoming editions, including editions still in progress", () => {
  const now = new Date("2027-01-20T12:00:00Z");
  assert.deepEqual(upcomingEditions([], now), []);
  assert.deepEqual(upcomingEditions([{ ...sample, startDate: "2027-01-19", sessions: 6 }], now), []);
});

test("weekly and fortnightly sessions cross months and years without changing the weekday", () => {
  assert.deepEqual(sessionDates({ ...sample, startDate: "2027-12-28", sessions: 3 }), ["2027-12-28", "2028-01-04", "2028-01-11"]);
  assert.deepEqual(sessionDates({ ...sample, startDate: "2028-02-22", cadence: "fortnightly", sessions: 3 }), ["2028-02-22", "2028-03-07", "2028-03-21"]);
});

test("monthly recurrence clamps short months without drifting from the original day", () => {
  assert.deepEqual(sessionDates({ ...sample, startDate: "2027-01-31", cadence: "monthly", sessions: 4 }), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  assert.deepEqual(sessionDates({ ...sample, startDate: "2028-01-31", cadence: "monthly", sessions: 3 }), ["2028-01-31", "2028-02-29", "2028-03-31"]);
  assert.deepEqual(sessionDates({ ...sample, startDate: "2027-12-31", cadence: "monthly", sessions: 2 }), ["2027-12-31", "2028-01-31"]);
});

test("a one-session workshop has the same start and end", () => {
  assert.deepEqual(sessionDates({ ...sample, sessions: 1 }), [sample.startDate]);
});

test("Tuesday and Thursday meetings repeat every other Monday-based week", () => {
  const workshop = { ...sample, startDate: "2027-01-19", weekdays: [4, 2], weekInterval: 2, sessions: 6 };
  assert.deepEqual(sessionDates(workshop), ["2027-01-19", "2027-01-21", "2027-02-02", "2027-02-04", "2027-02-16", "2027-02-18"]);
  assert.deepEqual(sessionDates({ ...workshop, sessions: 3 }), ["2027-01-19", "2027-01-21", "2027-02-02"]);
});

test("multi-day schedules cross year boundaries and reject incompatible starting days", () => {
  assert.deepEqual(sessionDates({ ...sample, startDate: "2027-12-28", weekdays: [2, 4], weekInterval: 2, sessions: 4 }),
    ["2027-12-28", "2027-12-30", "2028-01-11", "2028-01-13"]);
  for (const patch of [{ weekdays: [] }, { weekdays: [2, 2] }, { weekdays: [0] }, { weekdays: [4] }, { weekInterval: 0 }, { weekInterval: 1.5 }]) {
    assert.throws(() => validateWorkshop({ ...sample, ...patch }));
  }
});

test("invalid dates, unsupported cadence and invalid session counts are rejected", () => {
  for (const value of ["2027-02-29", "2027-04-31", "2027-13-01", "0000-01-01", "2027-1-01", "not-a-date"]) {
    assert.throws(() => parseDate(value));
  }
  for (const sessions of [0, -1, 1.5, 53, NaN, "6"]) assert.throws(() => sessionDates({ ...sample, sessions }));
  assert.throws(() => sessionDates({ ...sample, cadence: "__proto__" }));
  assert.throws(() => validateWorkshop({ ...sample, startDate: "9999-12-31", sessions: 2 }));
});

test("codes are normalized and must be unique, but an existing workshop can keep its own code", () => {
  assert.equal(validateWorkshop({ ...sample, code: " nie-01 " }, DEFAULT_WORKSHOPS).code, "NIE-01");
  assert.throws(() => validateWorkshop({ ...sample, id: "another" }, DEFAULT_WORKSHOPS), (error) =>
    error instanceof WorkshopValidationError && Boolean(error.errors.code));
  for (const code of ["", "A", "A B", "<script>"]) assert.throws(() => validateWorkshop({ ...sample, code }));
});

test("missing descriptions and blank names are rejected", () => {
  for (const patch of [{ name: " " }, { description: "" }]) {
    assert.throws(() => validateWorkshop({ ...sample, ...patch }));
  }
});

test("workshop accents accept only the coordinated green palette and preserve legacy defaults", () => {
  assert.equal(validateWorkshop({ ...sample, accent: "eucalyptus" }).accent, "eucalyptus");
  assert.throws(() => validateWorkshop({ ...sample, accent: "#ff0000" }));
  const { accent, ...legacy } = sample;
  assert.equal(validateWorkshop(legacy).accent, "pine");
});

test("new, legacy and imported workshops use the uniform USD 50 price", () => {
  for (const price of [120, 150, null, 0, undefined]) {
    assert.equal(validateWorkshop({ ...sample, price }).price, 50);
  }
  const legacy = { ...sample, price: 120 };
  const storage = { getItem: () => JSON.stringify({ version: 1, workshops: [legacy] }) };
  assert.equal(loadWorkshops(storage)[0].price, 50);
  assert.equal(validateCatalog({ version: 1, workshops: [{ ...sample, price: 150 }] })[0].price, 50);
});

test("start and end hours are required, valid and ordered within the same Costa Rica day", () => {
  for (const patch of [
    { startTime: "" }, { endTime: "" }, { startTime: "24:00" }, { endTime: "20:60" },
    { startTime: "8:00" }, { endTime: "18:00" }, { startTime: "22:00", endTime: "02:00" },
  ]) {
    assert.throws(() => validateWorkshop({ ...sample, ...patch }), WorkshopValidationError);
  }
  const workshop = validateWorkshop({ ...sample, startTime: "09:15", endTime: "11:45", timeZone: "Asia/Tokyo" });
  assert.equal(workshop.timeZone, "America/Costa_Rica");
  assert.equal(formatSchedule(workshop), "09:15–11:45 · Costa Rica (UTC−6)");
});

test("legacy catalogs without hours gain the editable examples, but partial or invalid hours are rejected", () => {
  const { startTime, endTime, timeZone, ...legacy } = sample;
  const restored = validateCatalog({ version: 1, workshops: [legacy] })[0];
  assert.equal(restored.startTime, "18:00");
  assert.equal(restored.endTime, "20:00");
  assert.equal(restored.timeZone, "America/Costa_Rica");
  assert.throws(() => validateCatalog({ version: 1, workshops: [{ ...legacy, startTime: "09:00" }] }));
  assert.throws(() => validateCatalog({ version: 1, workshops: [{ ...legacy, startTime: "", endTime: "" }] }));
});

test("catalog import validates the entire snapshot before writing, including duplicate codes and IDs", () => {
  assert.throws(() => validateCatalog({ version: 2, workshops: [] }));
  assert.throws(() => validateCatalog({ version: 1, workshops: [sample, { ...sample, code: "NEW-01" }] }));
  assert.throws(() => validateCatalog({ version: 1, workshops: [sample, { ...sample, id: "another" }] }));
  for (const id of ["all", "orientacion"]) assert.throws(() => validateCatalog({ version: 1, workshops: [{ ...sample, id }] }));
  assert.deepEqual(validateCatalog({ version: 1, workshops: [] }), []);
});

test("saved catalogs survive reload and include changes rather than reverting to initial examples", () => {
  const items = new Map();
  const storage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  const initial = loadWorkshops(storage);
  const added = { ...sample, id: "new", code: "NEW-01", startDate: "2028-03-17", cadence: "monthly" };
  saveWorkshops(storage, [...initial, added]);
  assert.equal(loadWorkshops(storage).at(-1).code, "NEW-01");
  assert.equal(items.size, 1);
  assert.ok(items.has(STORAGE_KEY));
});

test("corrupt or unavailable storage raises an error and does not silently replace data", () => {
  let writes = 0;
  const corrupt = { getItem: () => "{broken", setItem: () => { writes += 1; } };
  assert.throws(() => loadWorkshops(corrupt));
  assert.equal(writes, 0);
  assert.throws(() => saveWorkshops({ setItem: () => { throw new Error("Quota exceeded"); } }, [sample]), /Quota exceeded/);
});
