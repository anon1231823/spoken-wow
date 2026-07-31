import path from "node:path";

/** The repo root, one level up from web/. */
const REPO_ROOT = path.resolve(process.cwd(), "..");

export const CORPUS_PATH =
  process.env.VOICEOVER_CORPUS ?? path.join(REPO_ROOT, "corpus", "corpus.json.gz");

/**
 * The hiccup scan's findings, written by tools/scan_corpus_hiccups.py.
 *
 * Beside the corpus and shipped with it, because it is derived from exactly that corpus: a
 * release whose corpus and findings came from different scans would mark the wrong lines.
 * Read only by the issue loader, never on the search path - the findings that matter at
 * request time live in Postgres, where a verdict can be recorded against them.
 */
export const HICCUPS_PATH =
  process.env.VOICEOVER_HICCUPS ?? path.join(REPO_ROOT, "corpus", "hiccups.json.gz");

export const AUDIO_DIR =
  process.env.VOICEOVER_AUDIO ?? path.join(REPO_ROOT, "audio");

/**
 * Clips uploaded to build a voice clone, one directory per race-gender.
 *
 * In production this points at shared/ alongside the audio store, for the same reason: a
 * voice cannot be remade without the clips it was made from, so they must survive a deploy
 * and a rollback. Gitignored locally.
 */
export const VOICE_SAMPLES_DIR =
  process.env.VOICEOVER_VOICE_SAMPLES ?? path.join(REPO_ROOT, "voice", "samples");

/**
 * Blizzard's own NPC greeting barks, as `<race-gender>/<flavor>/<Title>.ogg`.
 *
 * Written by tools/fetch_npc_lines.py and gitignored. This is the ground truth for what a
 * voice should sound like, and the material every clone is seeded from - which is the only
 * reason the web app can see it. Local only: unlike the clips, it is not synced to the
 * droplet, so seeding is something you do from a checkout.
 */
export const NPC_LINES_DIR =
  process.env.VOICEOVER_NPC_LINES ?? path.join(REPO_ROOT, "voice", "npc-lines");

/**
 * Previous takes of a regenerated line: <sub>/<fileName>/<version>.mp3.
 *
 * A sibling of the store rather than a directory inside it, and deliberately so:
 * readStoreIndex walks audio/{quests,gossip} and `make push` rsyncs audio/, so anything
 * living under there would be mistaken for the store's own contents by both.
 */
export const AUDIO_HISTORY_DIR =
  process.env.VOICEOVER_AUDIO_HISTORY ?? path.join(REPO_ROOT, "audio-history");

/**
 * Rendered pronunciation previews, as `<hash>.mp3`.
 *
 * A cache, not a store: every file here can be rebuilt by spending credits again, and
 * nothing in the addon or the corpus refers to one. It is separate from the audio store for
 * the reason audio-history is - readStoreIndex walks audio/ and would otherwise count a
 * preview as a voiceline - and it outlives a deploy because the whole point is not paying
 * twice to hear the same entry.
 */
export const PREVIEW_DIR =
  process.env.VOICEOVER_PREVIEWS ?? path.join(REPO_ROOT, "audio-previews");

/**
 * generation.json and pronunciation.json: how a line is voiced.
 *
 * Unlike the clips, these ship *inside* the release alongside the corpus, because they are
 * versioned data the code is written against - a rollback should restore the settings the
 * rolled-back code expects. They are also what the Python CLI reads, which is why the web
 * app treats them as defaults rather than owning them outright.
 */
export const VOICE_CONFIG_DIR =
  process.env.VOICEOVER_VOICE_CONFIG ?? path.join(REPO_ROOT, "voice");
