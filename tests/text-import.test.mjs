import test from "node:test";
import assert from "node:assert/strict";
import { MAX_WORD_FILE_SIZE, validateTextUpload } from "../text-import.mjs";
import { MAX_TEXT_SIZE } from "../featured-text.mjs";

test("Word, HTML and plain-text uploads accept case-insensitive extensions without relying on MIME detection", () => {
  for (const [name, expected] of [["relato.DOC", "doc"], ["relato.DOCX", "docx"], ["relato.htm", "htm"], ["relato.html", "html"], ["relato.txt", "txt"]]) {
    assert.equal(validateTextUpload({ name, size: 100 }), expected);
  }
  assert.throws(() => validateTextUpload({ name: "relato.rtf", size: 100 }), /Usa un archivo Word/u);
  assert.throws(() => validateTextUpload({ name: "relato.docx.exe", size: 100 }), /Usa un archivo Word/u);
});

test("Word documents have a bounded 5 MB allowance while existing text uploads retain their smaller limit", () => {
  for (const extension of ["doc", "docx"]) {
    assert.equal(validateTextUpload({ name: `relato.${extension}`, size: MAX_WORD_FILE_SIZE }), extension);
    assert.throws(() => validateTextUpload({ name: `relato.${extension}`, size: MAX_WORD_FILE_SIZE + 1 }), /5 MB/u);
  }
  for (const extension of ["html", "txt"]) {
    assert.throws(() => validateTextUpload({ name: `relato.${extension}`, size: MAX_TEXT_SIZE + 1 }), /250 KB/u);
  }
});
