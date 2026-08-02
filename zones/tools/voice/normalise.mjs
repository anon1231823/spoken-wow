// Display text -> spoken text.
//
// The single rule that is not cosmetic: **no square brackets may survive**.
// Eleven v3 reads bracketed text as an audio tag -- a performance directive --
// so "[Deviate Fish]" would be acted rather than spoken. The lore carries 163
// bracketed spans, so this is load-bearing, and validate.mjs asserts it.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRONUNCIATION_PATH = join(HERE, "pronunciation.json");

// IPA blocks such as "Kalimdor [ˈkælɪmdɔɹ]" are a pronunciation guide for
// readers, not something to read out. Detected by the phonetic characters
// themselves rather than by position, since they appear mid-sentence.
const IPA = /[ˈˌːɪɛæɑɔəʊʌɹʃʒθðŋçɸβɣʁʔˑ]/;

// "[1-30]", "[90W]" -- level ranges and map coordinates lifted from the wiki.
const BRACKET_NOISE = /^[\d\s\-–—+()/,.]*[A-Za-z]?$/;

export async function loadPronunciation() {
  let raw;
  try {
    raw = JSON.parse(await readFile(PRONUNCIATION_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  // Keys beginning with _ are commentary. JSON has nowhere else to put it, and a
  // stray "_comment" rule would otherwise be a substitution like any other.
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("_")),
  );
}

function stripBrackets(text) {
  return text.replace(/\[([^\]]*)\]/g, (_, inner) => {
    if (IPA.test(inner)) return "";        // pronunciation guide: drop entirely
    if (BRACKET_NOISE.test(inner)) return ""; // level range or coordinate
    return inner;                           // item or place name: keep the words
  });
}

export function toSpokenText(text, rules = {}) {
  let out = stripBrackets(text);

  for (const [from, to] of Object.entries(rules)) {
    // Whole words only, so a rule for "Hm" cannot rewrite "Hmm" or "Chm".
    out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }

  // Paragraph breaks become a sentence pause. A literal newline in the payload
  // reads as nothing at all, running two paragraphs together mid-breath.
  out = out.replace(/\n{2,}/g, " ");
  out = out.replace(/\n/g, " ");

  // Parentheses survive as text but add nothing spoken; the words inside stay.
  out = out.replace(/[()]/g, "");

  return out.replace(/\s{2,}/g, " ").trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Used by validate.mjs and by the generator's own pre-flight.
export function hasBrackets(text) {
  return /[[\]]/.test(text);
}
