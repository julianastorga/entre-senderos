import test from "node:test";
import assert from "node:assert/strict";
import { MAX_IMAGE_FILE_BYTES, validateImageFile } from "../image-model.mjs";

test("image upload preflight accepts the size boundary but rejects oversized files with an actionable limit", () => {
  for (const size of [1, MAX_IMAGE_FILE_BYTES]) assert.doesNotThrow(() => validateImageFile({ size }));
  assert.throws(() => validateImageFile({ size: MAX_IMAGE_FILE_BYTES + 1 }), /supera el límite de 8 MB.*más pequeña/u);
});

test("image upload preflight distinguishes missing and empty files before reading or uploading them", () => {
  assert.throws(() => validateImageFile(null), /Elige una imagen/u);
  for (const size of [0, -1, NaN, undefined]) assert.throws(() => validateImageFile({ size }), /archivo está vacío/u);
});
