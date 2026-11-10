import test from "node:test";
import assert from "node:assert/strict";
import { validatePhone } from "../phone-model.mjs";

test("national and formatted international phones normalize with the selected country", () => {
  const expected = { phone: "+12025550123", phoneCountry: "US" };
  assert.deepEqual(validatePhone({ phone: "(202) 555-0123", phoneCountry: "US" }), expected);
  assert.deepEqual(validatePhone({ phone: " +1 202 555 0123 ", phoneCountry: "US" }), expected);
  assert.deepEqual(validatePhone({ phone: "2222 2222", phoneCountry: "CR" }), { phone: "+50622222222", phoneCountry: "CR" });
  assert.deepEqual(validatePhone({ phone: "020 7946 0018", phoneCountry: "GB" }), { phone: "+442079460018", phoneCountry: "GB" });
});

test("invalid phones, country mismatches, extensions and non-phone text are rejected", () => {
  for (const input of [
    { phone: "", phoneCountry: "CR" }, { phone: "123", phoneCountry: "CR" },
    { phone: "+1 202 555 0123", phoneCountry: "CR" }, { phone: "2025550123", phoneCountry: "ZZ" },
    { phone: "Call +1 202 555 0123", phoneCountry: "US" }, { phone: "+12025550123 ext 2", phoneCountry: "US" },
    { phone: "1".repeat(41), phoneCountry: "US" }, { phone: 2025550123, phoneCountry: "US" }, null,
  ]) assert.throws(() => validatePhone(input));
});
