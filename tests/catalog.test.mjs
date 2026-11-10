import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSHOPS, sessionDates, formatWorkshopPrices } from "../workshops.mjs";
import { migrateWorkshops, validateCatalogV2, validateProgram, flattenInstances, loadCatalog, saveCatalog, CATALOG_KEY } from "../catalog-model.mjs";
import { readCatalog } from "../server/catalog-store.mjs";

test("migration adds five reusable products, retains custom workshops, schedules and original enrollment IDs", () => {
  const custom = { ...DEFAULT_WORKSHOPS[0], id: "custom-existing", code: "CUSTOM-1", name: "Un taller existente", description: "Su descripción original." };
  const original = [...DEFAULT_WORKSHOPS, custom];
  const migrated = migrateWorkshops(original);
  assert.deepEqual(migrated.programs.slice(0, 5).map((program) => program.name), ["Sendero de la Niebla", "Sendero del Páramo", "Sendero de la Corteza", "Sotobosque", "Bosque Adentro"]);
  const instances = flattenInstances(migrated);
  assert.deepEqual(instances.map((instance) => instance.id), original.map((item) => item.id));
  assert.deepEqual(instances.map(sessionDates), original.map(sessionDates));
  assert.equal(instances[2].name, "Sotobosque");
  assert.equal(instances[3].name, custom.name);
  assert.equal(instances[3].description, custom.description);
  const legacy = DEFAULT_WORKSHOPS.map(({ startTime, endTime, accent, ...workshop }) => workshop);
  const legacyEditions = flattenInstances(migrateWorkshops(legacy));
  assert.equal(legacyEditions[0].startTime, "18:00");
  assert.equal(legacyEditions[1].accent, "moss");
});

test("multiple editions share product content but keep independent codes and recurrence; deleting editions retains the product", () => {
  const catalog = migrateWorkshops(DEFAULT_WORKSHOPS);
  catalog.instances.push({ ...catalog.instances[0], id: "niebla-2", code: "NIE-02", startDate: "2027-02-02", weekInterval: 2 });
  catalog.programs[0].name = "Sendero de la Niebla actualizado";
  const editions = flattenInstances(validateCatalogV2(catalog)).filter((item) => item.programId === "niebla");
  assert.equal(editions.length, 2);
  assert.equal(editions[0].name, editions[1].name);
  assert.notDeepEqual(sessionDates(editions[0]), sessionDates(editions[1]));
  assert.throws(() => validateCatalogV2({ ...catalog, programs: catalog.programs.slice(1) }), /edición/u);
  catalog.instances = catalog.instances.filter((instance) => instance.programId !== "niebla");
  assert.equal(validateCatalogV2(catalog).programs[0].id, "niebla");
  assert.throws(() => validateCatalogV2({ ...catalog, instances: [catalog.instances[0], { ...catalog.instances[0], id: "duplicate-code" }] }), /código/u);
});

test("services are editable offerings, do not create calendar encounters, and persisted empty catalogs remain empty", () => {
  const catalog = migrateWorkshops(DEFAULT_WORKSHOPS);
  catalog.services[0].name = "Escritura para equipos";
  catalog.services[0].details = "Formato a medida.\n\nConsulta las condiciones.";
  assert.equal(flattenInstances(validateCatalogV2(catalog)).length, 3);
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveCatalog(storage, { version: 2, programs: [], instances: [], services: [] });
  assert.deepEqual(loadCatalog(storage), { version: 2, programs: [], instances: [], services: [] });
  data.set(CATALOG_KEY, "{bad json");
  assert.throws(() => loadCatalog(storage));
});

test("legacy catalogs keep their USD prices and leave CRC pending without inventing a conversion", () => {
  const catalog = migrateWorkshops(DEFAULT_WORKSHOPS);
  const legacy = { ...catalog, programs: catalog.programs.map(({ priceCRC, priceUSD, ...program }) => program) };
  const normalized = validateCatalogV2(legacy);
  assert.ok(normalized.programs.every((program) => program.priceCRC === null && program.priceUSD === 50));
  assert.ok(flattenInstances(normalized).every((instance) => instance.priceCRC === null && instance.priceUSD === 50));
  assert.match(formatWorkshopPrices(normalized.programs[0]), /CRC: por confirmar.*50.*USD/u);
  assert.deepEqual(normalized.instances.map(sessionDates), catalog.instances.map(sessionDates));
});

test("independent workshop prices propagate to every edition and survive save/import without changing schedules", () => {
  const catalog = migrateWorkshops(DEFAULT_WORKSHOPS);
  catalog.instances.push({ ...catalog.instances[0], id: "another-edition", code: "NIE-02", startDate: "2027-02-02", price: 999 });
  catalog.programs[0].priceCRC = 27500.5;
  catalog.programs[0].priceUSD = 65.75;
  catalog.programs[1].priceCRC = 0;
  catalog.programs[1].priceUSD = null;
  const dates = catalog.instances.map(sessionDates);
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveCatalog(storage, catalog);
  const restored = validateCatalogV2(JSON.parse(JSON.stringify(loadCatalog(storage))));
  const instances = flattenInstances(restored);
  assert.deepEqual(instances.filter(({ programId }) => programId === "niebla").map(({ priceCRC, priceUSD, price }) => [priceCRC, priceUSD, price]), [[27500.5, 65.75, 65.75], [27500.5, 65.75, 65.75]]);
  assert.equal(instances[1].priceCRC, 0);
  assert.equal(instances[1].priceUSD, null);
  assert.equal(instances[1].price, null);
  assert.match(formatWorkshopPrices(instances[1]), /0.*CRC.*USD: por confirmar/u);
  assert.deepEqual(restored.instances.map(sessionDates), dates);
  assert.deepEqual(restored.services, catalog.services);
  assert.equal(Object.hasOwn(restored.services[0], "priceCRC"), false);
  const free = validateProgram({ ...restored.programs[0], priceCRC: 0, priceUSD: 0 });
  assert.doesNotMatch(formatWorkshopPrices(free), /confirmar|NaN/u);
  const pending = validateProgram({ ...free, priceCRC: null, priceUSD: null });
  assert.equal(formatWorkshopPrices(pending), "CRC: por confirmar · USD: por confirmar");
});

test("workshop prices reject negative, nonnumeric, unsafe and overprecise amounts in either currency", () => {
  const program = migrateWorkshops(DEFAULT_WORKSHOPS).programs[0];
  for (const field of ["priceCRC", "priceUSD"]) {
    for (const invalid of [-1, NaN, Infinity, -Infinity, "50", "", true, {}, [], 1.005, 0.001, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => validateProgram({ ...program, [field]: invalid }), /precio/u, `${field}: ${String(invalid)}`);
    }
    for (const valid of [0, 0.01, 0.29, 19.99, 1234567.89, null]) {
      assert.equal(validateProgram({ ...program, [field]: valid })[field], valid);
    }
  }
});

test("workshop sections normalize old catalogs and survive editing and backup without changing editions or services", () => {
  const catalog = migrateWorkshops(DEFAULT_WORKSHOPS);
  const legacy = { ...catalog, programs: catalog.programs.map(({ overview, audience, objectives, requiredReading, modality, ...program }) => program) };
  const normalized = validateCatalogV2(legacy);
  assert.ok(normalized.programs.every((program) => program.overview === "" && program.audience === "" && program.objectives === "" && program.requiredReading === "" && program.modality === "Taller corto"));
  const updated = {
    ...normalized.programs[0], overview: " Ejercicios de escritura y revisión. ", audience: " Personas que empiezan a escribir. ", objectives: " Explorar la voz propia.\n\nRevisar escenas. ",
    requiredReading: " Una lectura de muestra.\nIndicaciones para la primera sesión. ",
    modality: " Taller corto · En línea ",
    coverImage: { src: `/api/images/${"b".repeat(64)}.webp`, alt: "Portada del taller" },
  };
  normalized.programs[0] = updated;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveCatalog(storage, normalized);
  const restored = loadCatalog(storage);
  assert.equal(restored.programs[0].objectives, updated.objectives.trim());
  assert.equal(restored.programs[0].requiredReading, updated.requiredReading.trim());
  assert.equal(restored.programs[0].modality, updated.modality.trim());
  assert.equal(restored.programs[0].overview, updated.overview.trim());
  assert.equal(restored.programs[0].audience, updated.audience.trim());
  assert.deepEqual(restored.programs[0].coverImage, updated.coverImage);
  assert.deepEqual(restored.instances, catalog.instances);
  assert.deepEqual(restored.services, catalog.services);
  assert.ok(!Object.hasOwn(restored.services[0], "modality"));
  assert.deepEqual(validateCatalogV2(JSON.parse(JSON.stringify(restored))), restored);
});

test("workshop sections reject invalid or oversized values while allowing explicitly empty objectives and readings", () => {
  const program = migrateWorkshops(DEFAULT_WORKSHOPS).programs[0];
  for (const invalid of [{ overview: 42 }, { overview: "x".repeat(20001) }, { audience: null }, { audience: "x".repeat(20001) }, { modality: "" }, { modality: " " }, { modality: null }, { modality: "x".repeat(121) }, { objectives: 42 }, { objectives: "x".repeat(20001) }, { requiredReading: ["Libro"] }, { requiredReading: "x".repeat(20001) }]) {
    assert.throws(() => validateProgram({ ...program, ...invalid }));
  }
  const empty = validateProgram({ ...program, objectives: "", requiredReading: "" });
  assert.equal(empty.objectives, "");
  assert.equal(empty.requiredReading, "");
});

test("cloud migration is saved once without replacing legacy data or overwriting a concurrent migrated catalog", async () => {
  const legacy = { version: 1, workshops: DEFAULT_WORKSHOPS };
  let saved = null;
  const store = {
    async read(name, initial) { return name === "workshops" ? { value: legacy, version: '"legacy"' } : saved || { value: initial, version: "initial" }; },
    async write(name, value, version) {
      assert.equal(name, "catalog"); assert.equal(version, "initial");
      saved = { value, version: '"v2"' }; return saved;
    },
  };
  assert.equal((await readCatalog(store)).version, '"v2"');
  store.write = () => { throw new Error("Must not migrate twice"); };
  assert.equal((await readCatalog(store)).version, '"v2"');
  assert.equal(legacy.workshops, DEFAULT_WORKSHOPS);
  saved = null;
  store.write = async (name, value) => {
    saved = { value: { ...value, services: [] }, version: '"concurrent"' };
    const error = new Error("Conflict"); error.statusCode = 412; throw error;
  };
  assert.deepEqual((await readCatalog(store)).value.services, []);
});
