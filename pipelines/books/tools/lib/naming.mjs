// The frozen names, in one place, for the reason pipelines/zones/tools/voice/naming.mjs
// exists: AGENTS.md freezes line ids and audio filenames, so a second place deriving
// either is a second place that can drift and strand a sound pack every user has.

import { createHash } from "node:crypto";

import { normaliseText, spokenText } from "./text.mjs";

/** 'b:1381'. The addon's lookup value and the take table's lineId. */
export function lineIdFor(pageId) {
  return `b:${pageId}`;
}

/** Store-relative and extension-less, as the zones side names files: '1381'. */
export function fileFor(pageId) {
  return String(pageId);
}

// A checksum the addon can recompute in Lua.
//
// NOT a hash from a library. The addon computes this at runtime from the page the client
// is showing, so the arithmetic is deliberately plain -- multiply, add, modulo -- and uses
// no bitwise operators, which the 5.1 Lua these clients run does not have either. Changing
// the constants means re-exporting the data module, because its tables are keyed on this.
//
// It exists because a book's title does not identify it: seven books in this corpus are
// called "Decoded Twilight Text", each holding different words.
//
// The modulus is the largest signed 32-bit prime, which keeps sum * FACTOR + byte under
// 2^36 and therefore exact in the doubles Lua stores numbers as.
//
// OVER UTF-8 BYTES, NOT CHARACTERS. Lua's string.byte walks the bytes of a UTF-8 string,
// and the client's strings are UTF-8, so a checksum taken over JavaScript's UTF-16 code
// units would agree with the addon on ASCII and silently disagree on every page carrying
// an accent -- which is most of the letters signed by a night elf.
const CHECKSUM_MODULUS = 2147483647;
const CHECKSUM_FACTOR = 31;

export function pageChecksum(text) {
  const bytes = Buffer.from(normaliseText(text), "utf8");
  let sum = bytes.length % CHECKSUM_MODULUS;
  for (const byte of bytes) {
    sum = (sum * CHECKSUM_FACTOR + byte) % CHECKSUM_MODULUS;
  }
  return sum;
}

/** sha1 of what would be spoken. Compared against a take's hash to spot stale audio. */
export function textHash(text) {
  return createHash("sha1").update(spokenText(text)).digest("hex");
}
