/**
 * Every voice this project has: each race-gender and the flavors it is voiced in.
 *
 * This is the roster, not a view of the corpus. The voice list on /voices, the triage race,
 * gender and flavor selects, and the explorer's filters all read it, so a voice is supported
 * by adding it here -- before any line uses it, which is the only way a new race can get in:
 * a moderator cannot pick a race nobody offers, and a voice has to exist on /voices to be
 * cloned before its first line is accepted. The corpus supplies the line counts and nothing
 * else; voices.test.ts fails on a corpus line whose voice is missing here, and accepting a
 * contribution refuses one (lib/contributions/accept.ts).
 *
 * A flavor is which of a race-gender's NPC voice sets an NPC speaks with -- tts_cli/flavors.py
 * recovers it from the game's sound entry names, like OrcMaleShadyNPCGreetings. `null` is a
 * voice with no flavor, named bare `race-gender`: narrator-male, which is not a race, and a
 * race-gender whose sets are not known yet.
 *
 * Free of imports on purpose: ContributionTable.tsx is a client component and reads it.
 */
export type Gender = "male" | "female";

export type Voice = { race: string; gender: Gender; flavor: string | null };

const ROSTER: Record<`${string}-${Gender}`, readonly (string | null)[]> = {
  // One line, spoken by a model from a later expansion; no NPC voice sets.
  "bloodelf-female": [null],
  // A client-guessed NPC, Elatrell Featherlight. The game has military, noble and standard
  // sets for it; none are extracted yet.
  "bloodelf-male": [null],
  "dwarf-female": ["guard", "maternal", "young"],
  "dwarf-male": ["grim", "guard", "standard"],
  "gnome-female": ["happy", "nerdy", "standard"],
  "gnome-male": ["standard", "young", "zany"],
  "goblin-female": ["zany"],
  "goblin-male": ["gruff", "guard", "zany"],
  "human-female": ["official", "standard", "warrior"],
  "human-male": ["official", "standard", "warrior"],
  // A pseudo-race: gameobjects and the stage directions inside NPC lines.
  "narrator-male": [null],
  "nightelf-female": ["priestess", "sentinel", "standard"],
  "nightelf-male": ["official", "standard", "warrior"],
  "orc-female": ["shaman", "standard", "warrior"],
  "orc-male": ["guard", "shady", "standard"],
  "scourge-female": ["magic", "standard", "warrior"],
  "scourge-male": ["dark", "standard", "warrior"],
  // The client ships no names for these sets, so they are named by NPCSounds id until they
  // have better names. Busiest first: 3773 is on 81 Skybourne displays and 3774 on 8, 3776 on
  // 70 and 3775 on 10.
  "skybourneelf-female": ["3773", "3774"],
  "skybourneelf-male": ["3776", "3775"],
  "tauren-female": ["official", "shaman", "standard"],
  "tauren-male": ["elder", "shaman", "warrior"],
  "troll-female": ["laidback", "old", "standard"],
  "troll-male": ["dark", "shaman", "standard"],
};

export const VOICES: readonly Voice[] = Object.entries(ROSTER).flatMap(([raceGender, flavors]) => {
  const [race, gender] = raceGender.split("-") as [string, Gender];
  return flavors.map((flavor) => ({ race, gender, flavor }));
});

/** The voice's name: `race-gender-flavor`, or `race-gender` with no flavor. */
export function voiceName(voice: Voice): string {
  return voice.flavor ? `${voice.race}-${voice.gender}-${voice.flavor}` : `${voice.race}-${voice.gender}`;
}

export const VOICE_NAMES: readonly string[] = VOICES.map(voiceName);

export function isVoice(name: string): boolean {
  return VOICE_NAMES.includes(name);
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export const RACES: readonly string[] = sorted(VOICES.map((voice) => voice.race));

export const GENDERS: readonly Gender[] = sorted(VOICES.map((voice) => voice.gender)) as Gender[];

/** The genders a race is voiced in, for narrowing a gender select to what can be answered. */
export function gendersOf(race: string): Gender[] {
  return sorted(VOICES.filter((voice) => voice.race === race).map((voice) => voice.gender)) as Gender[];
}

/** A race-gender's flavors in roster order; empty for one voiced without a flavor. */
export function flavorsOf(race: string, gender: string): string[] {
  return [...(ROSTER[`${race}-${gender}` as `${string}-${Gender}`] ?? [])].filter(
    (flavor): flavor is string => flavor !== null,
  );
}

/** Every flavored voice as a triple, for narrowing a flavor select to a chosen race-gender. */
export function flavorScopes(): { race: string; gender: Gender; flavor: string }[] {
  return VOICES.flatMap(({ race, gender, flavor }) => (flavor ? [{ race, gender, flavor }] : []));
}
