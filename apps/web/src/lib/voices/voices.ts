/**
 * The race-genders this project voices.
 *
 * Hand-kept rather than derived from the corpus, because a race has to be offered before any
 * line uses it: a moderator cannot resolve the first Skybourne elf in triage from a picker that
 * only lists what the corpus already says, and /voices has to show the slot before a line
 * exists so there is a voice to clone by the time one is accepted. Adding a race-gender here
 * is the whole of supporting it -- the voice list, the triage selects and the explorer filters
 * all read this.
 *
 * Flavors stay derived from the corpus (facets.ts, slots.ts): they come from the game's own
 * voice sets, and a race-gender with none gets a bare `race-gender` voice, the way
 * narrator-male always has.
 *
 * The corpus must stay inside this list -- voices.test.ts fails on a line whose race-gender
 * is missing, so a race added upstream in tts_cli/consts.py cannot drop out of the filters.
 *
 * Free of imports on purpose: ContributionTable.tsx is a client component and reads it.
 */
export type Gender = "male" | "female";

export type RaceGender = { race: string; gender: Gender };

export const VOICES: readonly RaceGender[] = [
  { race: "bloodelf", gender: "female" },
  { race: "bloodelf", gender: "male" },
  { race: "dwarf", gender: "female" },
  { race: "dwarf", gender: "male" },
  { race: "gnome", gender: "female" },
  { race: "gnome", gender: "male" },
  { race: "goblin", gender: "female" },
  { race: "goblin", gender: "male" },
  { race: "human", gender: "female" },
  { race: "human", gender: "male" },
  // A pseudo-race: gameobjects and the stage directions inside NPC lines.
  { race: "narrator", gender: "male" },
  { race: "nightelf", gender: "female" },
  { race: "nightelf", gender: "male" },
  { race: "orc", gender: "female" },
  { race: "orc", gender: "male" },
  { race: "scourge", gender: "female" },
  { race: "scourge", gender: "male" },
  { race: "skybourneelf", gender: "female" },
  { race: "skybourneelf", gender: "male" },
  { race: "tauren", gender: "female" },
  { race: "tauren", gender: "male" },
  { race: "troll", gender: "female" },
  { race: "troll", gender: "male" },
];

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export const RACES: readonly string[] = sorted(VOICES.map((voice) => voice.race));

export const GENDERS: readonly Gender[] = sorted(VOICES.map((voice) => voice.gender)) as Gender[];

/** The genders a race is voiced in, for narrowing a gender select to what can be answered. */
export function gendersOf(race: string): Gender[] {
  return VOICES.filter((voice) => voice.race === race).map((voice) => voice.gender);
}

export function isVoiced(race: string, gender: string): boolean {
  return VOICES.some((voice) => voice.race === race && voice.gender === gender);
}

/**
 * The voice a race-gender gets while the corpus has no line for it: bare `race-gender`, since
 * nothing has said which of the game's voice sets it would use yet.
 *
 * `spoken` is every race-gender the corpus already has a voice for, as `race-gender`, so a
 * race-gender with flavored corpus voices does not also gain an unflavored one.
 */
export function unspokenVoices(spoken: ReadonlySet<string>): string[] {
  return VOICES.map((voice) => `${voice.race}-${voice.gender}`).filter((name) => !spoken.has(name));
}
