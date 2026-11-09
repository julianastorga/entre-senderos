import { DEFAULT_WORKSHOPS } from "../workshops.mjs";
import { migrateWorkshops, validateCatalogV2 } from "../catalog-model.mjs";

export async function readCatalog(store) {
  const current = await store.read("catalog", null);
  if (current.value) return { ...current, value: validateCatalogV2(current.value, { allowDataImages: false }) };
  const legacy = await store.read("workshops", { version: 1, workshops: DEFAULT_WORKSHOPS });
  const migrated = migrateWorkshops(legacy.value.workshops, { allowDataImages: false });
  try { return await store.write("catalog", migrated, "initial"); }
  catch (error) {
    if (![409, 412].includes(error.statusCode)) throw error;
    const latest = await store.read("catalog", null);
    return { ...latest, value: validateCatalogV2(latest.value, { allowDataImages: false }) };
  }
}
