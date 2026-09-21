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
 * Flavors are derived from the corpus (facets.ts, slots.ts): they come from the game's own
 * voice sets. A race-gender the corpus does not speak yet can declare its flavors here, so its
 * voices exist on /voices and in the triage flavor select before its first line; one with
 * neither gets a bare `race-gender` voice, the way narrator-male always has.
 *
 * The corpus must stay inside this list -- voices.test.ts fails on a line whose race-gender
 * is missing, so a race added upstream in tts_cli/consts.py cannot drop out of the filters.
 *
 * Free of imports on purpose: ContributionTable.tsx is a client component and reads it.
 */
export type Gender = "male" | "female";

export type RaceGender = {
  race: string;
  gender: Gender;
  /**
   * The game's voice sets for this race-gender, busiest first -- the first is the default for
   * an NPC whose set is not known yet. Only needed while the corpus has no flavored line for it.
   */
  flavors?: readonly string[];
};

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
  // Named by their NPCSounds id until they have better names: the client ships no names for
  // them, where the older races' come from sound entries like OrcMaleShadyNPCGreetings.
  // 3773 and 3776 are the sets on 81 and 70 of the Skybourne displays, 3774 and 3775 on 8 and 10.
  { race: "skybourneelf", gender: "female", flavors: ["3773", "3774"] },
  { race: "skybourneelf", gender: "male", flavors: ["3776", "3775"] },
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

/** The flavors declared for a race-gender, busiest first; empty for one that declares none. */
export function declaredFlavors(race: string, gender: string): string[] {
  return [...(VOICES.find((voice) => voice.race === race && voice.gender === gender)?.flavors ?? [])];
}

/** Every declared race-gender-flavor, for pairing flavors with the race-gender they belong to. */
export function declaredFlavorScopes(): { race: string; gender: Gender; flavor: string }[] {
  return VOICES.flatMap(({ race, gender, flavors }) => (flavors ?? []).map((flavor) => ({ race, gender, flavor })));
}

/**
 * The voices the list names that the corpus does not speak yet: each declared flavor as
 * `race-gender-flavor`, and a bare `race-gender` for a race-gender with no flavors anywhere.
 *
 * `spokenVoices` is every voice name the corpus has, and `spokenRaceGenders` every race-gender
 * it has a voice for, so a race-gender with flavored corpus voices does not also gain an
 * unflavored one.
 */
export function unspokenVoices(spokenRaceGenders: ReadonlySet<string>, spokenVoices: ReadonlySet<string>): string[] {
  return VOICES.flatMap((voice) => {
    const raceGender = `${voice.race}-${voice.gender}`;
    if (voice.flavors?.length) {
      return voice.flavors.map((flavor) => `${raceGender}-${flavor}`).filter((name) => !spokenVoices.has(name));
    }
    return spokenRaceGenders.has(raceGender) ? [] : [raceGender];
  });
}
