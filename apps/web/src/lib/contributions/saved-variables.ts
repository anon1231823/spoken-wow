/**
 * The envelopes inside a Spoken Player saved variables file.
 *
 * The addon's background gathering (addons/SpokenPlayer/Gather.lua) keeps every envelope it
 * would have offered a Contribute link for, and the game writes them into
 * WTF/Account/<account>/SavedVariables/SpokenPlayer.lua as Lua string literals. The player
 * uploads that file as it is, so this reads it as it is: every string literal in it, decoded,
 * and kept when it is an envelope. Nothing depends on where in the table the strings sit, so a
 * later change to the store's shape cannot make an older file unreadable.
 *
 * Browser-safe on purpose: the page runs this to preview the upload before anything is sent,
 * and only the envelopes -- never the rest of the file -- leave the player's machine.
 */

const ENVELOPE_PREFIX = "!SPOKEN";

/** Gather.lua's CAP: the most a file the addon wrote can hold, and so the most one upload takes. */
export const MAX_ENVELOPES = 2000;

// A double-quoted Lua string: anything but a quote or backslash, or a backslash and whatever
// it escapes, a real newline included (Lua's own %q writes one after a backslash). The game
// writes double quotes only, so long brackets and single quotes are not looked for.
const LITERAL = /"((?:[^"\\]|\\[\s\S])*)"/g;

const SIMPLE: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  "\\": 92,
  '"': 34,
  "'": 39,
  "\n": 10,
};

/**
 * One literal's body, unescaped. Built as bytes rather than characters because a `\ddd`
 * escape is a byte, and a multi-byte character written that way only means something once
 * its bytes are decoded together.
 */
export function decodeLuaString(body: string): string {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  let run = "";
  const flush = () => {
    if (run) bytes.push(...encoder.encode(run));
    run = "";
  };

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") {
      run += char;
      continue;
    }
    const next = body[i + 1];
    const digits = /^\d{1,3}/.exec(body.slice(i + 1, i + 4));
    flush();
    if (digits) {
      bytes.push(Number(digits[0]) & 0xff);
      i += digits[0].length;
    } else if (next === "\r" && body[i + 2] === "\n") {
      bytes.push(10);
      i += 2;
    } else if (next !== undefined && next in SIMPLE) {
      bytes.push(SIMPLE[next]);
      i += 1;
    } else {
      // An escape Lua 5.1 would reject. Kept literally rather than dropped: an envelope this
      // mangles fails its checksum and is reported, which is better than one silently altered.
      run += char;
    }
  }
  flush();
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Every distinct envelope in the file, in the order the file holds them. */
export function envelopesFromSavedVariables(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(LITERAL)) {
    // Checked before decoding: almost every string in the file is a setting's value, and the
    // prefix has no escapes in it to get in the way.
    if (!match[1].startsWith(ENVELOPE_PREFIX)) continue;
    seen.add(decodeLuaString(match[1]));
  }
  return [...seen];
}
