import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSHOPS } from "../workshops.mjs";
import { groupEnrollments, validateEnrollmentContact, validatePaymentMethod } from "../enrollment-model.mjs";

test("enrollment groups include active editions through their last Costa Rica day and retain every historical or unassigned request", () => {
  const sample = DEFAULT_WORKSHOPS[0];
  const workshops = [
    { ...sample, id: "future", startDate: "2027-02-02", sessions: 1 },
    { ...sample, id: "past", startDate: "2027-01-12", sessions: 2 },
    { ...sample, id: "active", startDate: "2027-01-19", sessions: 2 },
    { ...sample, id: "empty", startDate: "2027-03-02", sessions: 1 },
  ];
  const records = ["active", "past", "future", "deleted", "servicio:custom", "orientacion"].map((course, index) => ({ id: String(index), value: { course } }));
  const before = structuredClone({ workshops, records });
  const groups = groupEnrollments(records, workshops, new Date("2027-01-27T05:59:59Z"));
  assert.deepEqual(groups.editions.map(({ instance, active }) => [instance.id, active]), [["active", true], ["future", false], ["empty", false]]);
  assert.deepEqual(groups.editions.map(({ records }) => records.map(({ id }) => id)), [["0"], ["2"], []]);
  assert.deepEqual(groups.other.map(({ id }) => id), ["1", "3", "4", "5"]);
  const after = groupEnrollments(records, workshops, new Date("2027-01-27T06:00:00Z"));
  assert.deepEqual(after.editions.map(({ instance }) => instance.id), ["future", "empty"]);
  assert.deepEqual(after.other.map(({ id }) => id), ["0", "1", "3", "4", "5"]);
  assert.deepEqual({ workshops, records }, before);
  assert.deepEqual(groupEnrollments([], [], new Date("2027-01-27T06:00:00Z")), { editions: [], other: [] });
});

test("payment methods are required for confirmations and accept concise descriptions, not invalid values", () => {
  assert.equal(validatePaymentMethod(" SINPE Móvil ", "confirmed"), "SINPE Móvil");
  assert.equal(validatePaymentMethod(undefined, "interested"), "");
  for (const invalid of [undefined, "", " ", null, 42, "x".repeat(101), "bad\nmethod"]) {
    assert.throws(() => validatePaymentMethod(invalid, "confirmed"));
  }
});

test("manual and public contact validation normalizes fields and rejects invalid or oversized contact input", () => {
  const input = { name: " Persona ", email: " PERSONA@EXAMPLE.ORG ", message: " Nota " };
  assert.deepEqual(validateEnrollmentContact(input), { name: "Persona", email: "persona@example.org", message: "Nota" });
  for (const invalid of [{ name: "" }, { name: "x".repeat(101) }, { email: "invalid" }, { message: "x".repeat(2001) }]) {
    assert.throws(() => validateEnrollmentContact({ ...input, ...invalid }));
  }
});
