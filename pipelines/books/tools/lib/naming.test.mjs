import { test } from "node:test";
import assert from "node:assert/strict";

import { lineIdFor, fileFor, pageChecksum, textHash } from "./naming.mjs";

test("the line id is the frozen b:{pageTextID}", () => {
  assert.equal(lineIdFor(1381), "b:1381");
});

test("the file is the page id alone, store-relative and extension-less", () => {
  assert.equal(fileFor(1381), "1381");
});

test("the checksum is stable for the same text", () => {
  assert.equal(pageChecksum("The rains have come."), pageChecksum("The rains have come."));
});

test("the checksum separates the two Dusty Tomes", () => {
  assert.notEqual(pageChecksum("A dry account of grain shipments."), pageChecksum("A ledger of debts owed."));
});

test("the checksum ignores what normalisation removes", () => {
  assert.equal(pageChecksum("One\r\n\r\nTwo"), pageChecksum("One$B$BTwo"));
});

test("the checksum stays inside Lua's exact integer range", () => {
  const big = "x".repeat(20000);
  assert.ok(pageChecksum(big) >= 0 && pageChecksum(big) < 2 ** 31);
});

test("the text hash is a sha1 of the spoken text", () => {
  assert.match(textHash("The rains have come."), /^[0-9a-f]{40}$/);
});

test("the checksum walks UTF-8 bytes, as Lua's string.byte does", () => {
  // Computed here the way the addon will: length, then each byte, modulo the same prime.
  const bytes = Buffer.from("Voil\u00e0, l'\u00e9p\u00e9e.", "utf8");
  let expected = bytes.length % 2147483647;
  for (const byte of bytes) expected = (expected * 31 + byte) % 2147483647;
  assert.equal(pageChecksum("Voil\u00e0, l'\u00e9p\u00e9e."), expected);
});
