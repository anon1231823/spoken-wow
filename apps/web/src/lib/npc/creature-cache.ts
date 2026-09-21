/**
 * Reading a WoW client's creature cache: which appearances each NPC it has seen is drawn with.
 *
 * `creaturecache.wdb` (Cache/WDB/<locale>/ in a client's folder) keeps every creature query the
 * server answered, and those answers carry the appearance ids -- CreatureDisplayInfo rows --
 * that no client API exposes. /contributions/game-data turns them into voices with
 * display-voices.json.
 *
 * Parsed in the browser, so only ids travel to the server rather than the file.
 *
 * The file is a 24-byte header, then records of `u32 npcId, u32 length, <length bytes>`. A
 * record is the server's query response: bit-packed name lengths, the names, flags, and then
 * the display block this reads -- `u32 count, f32 totalProbability`, and per display
 * `u32 displayId, f32 scale, f32 probability`. Everything before it varies in length with the
 * names, so the block is found by its shape: a count of 1-16, entries with a non-zero id and a
 * plausible scale, and probabilities summing to the stated total. That finds one in every
 * record of a real cache (422 of 422).
 *
 * Free of imports on purpose: the game-data page is a client component and reads it.
 */
export type CachedDisplay = { displayId: number; probability: number };
export type CachedCreature = { npcId: number; displays: CachedDisplay[] };

const HEADER = 24;
const MAGIC = "BOMW"; // "WMOB" -- creature cache -- as the client writes it

export function parseCreatureCache(buffer: ArrayBuffer): CachedCreature[] {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)));
  if (magic !== MAGIC) throw new Error("not a creature cache -- pick creaturecache.wdb");

  const creatures: CachedCreature[] = [];
  let pos = HEADER;
  while (pos + 8 <= buffer.byteLength) {
    const npcId = view.getUint32(pos, true);
    const length = view.getUint32(pos + 4, true);
    if (npcId === 0 && length === 0) break;
    const start = pos + 8;
    pos = start + length;
    if (pos > buffer.byteLength) break;
    const displays = displayBlock(view, start, pos);
    if (displays) creatures.push({ npcId, displays });
  }
  return creatures;
}

function displayBlock(view: DataView, start: number, end: number): CachedDisplay[] | null {
  for (let at = start; at + 20 <= end; at++) {
    const count = view.getUint32(at, true);
    if (count < 1 || count > 16 || at + 8 + 12 * count > end) continue;
    const total = view.getFloat32(at + 4, true);
    if (!(total >= 0 && total < 1e6)) continue;

    const displays: CachedDisplay[] = [];
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const entry = at + 8 + 12 * i;
      const displayId = view.getUint32(entry, true);
      const scale = view.getFloat32(entry + 4, true);
      const probability = view.getFloat32(entry + 8, true);
      if (displayId === 0 || !(scale > 0.01 && scale < 50) || !(probability >= 0)) break;
      displays.push({ displayId, probability });
      sum += probability;
    }
    if (displays.length === count && Math.abs(sum - total) <= 0.001 * Math.max(total, 1)) return displays;
  }
  return null;
}
