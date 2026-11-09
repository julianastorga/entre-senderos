import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSHOPS, sessionDates } from "../workshops.mjs";
import { migrateWorkshops, validateCatalogV2, flattenInstances, loadCatalog, saveCatalog, CATALOG_KEY } from "../catalog-model.mjs";
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
