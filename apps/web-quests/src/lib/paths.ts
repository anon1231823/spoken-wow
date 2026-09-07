import path from "node:path";

/**
 * Where the quests data lives in a checkout: the corpus, the audio store, the voice
 * config and the three sibling caches. Two levels up from apps/web-quests/, then into
 * pipelines/quests/ -- the monorepo move put the app one directory deeper and the data
 * under the pipeline that produces it.
 *
 * A development and test fallback only. Every export below is env-overridden in
 * production by deploy/quests/ecosystem.config.js, which points each one at either the
 * current release or shared/; a release directory has no pipelines/ in it and never
 * reaches this line.
 */
const DATA_ROOT = path.resolve(process.cwd(), "..", "..", "pipelines", "quests");

export const CORPUS_PATH =
  process.env.VOICEOVER_CORPUS ?? path.join(DATA_ROOT, "corpus", "corpus.json.gz");

/**
 * The hiccup scan's findings, written by tools/scan_corpus_hiccups.py.
 *
 * Beside the corpus, because it is derived from exactly that corpus: a release whose corpus
 * and findings came from different scans would mark the wrong lines.
 *
 * Derived from CORPUS_PATH rather than given an env var of its own, which it had until this
 * cost an afternoon. VOICEOVER_CORPUS is set on the droplet and points into the release;
 * VOICEOVER_HICCUPS was new, so it lived in shared/ecosystem.config.js and only reached the
 * process after someone remembered `make deploy-scripts`. Until then this resolved against
 * DATA_ROOT - which is cwd/../../pipelines/quests - and the standalone server's cwd is the
 * release directory, so
 * it looked for /srv/voiceover/releases/corpus/hiccups.json.gz: a directory that holds
 * releases and has never held a corpus. Two paths that must agree should be one path.
 *
 * Read only by the issue loader, never on the search path - the findings that matter at
 * request time live in Postgres, where a verdict can be recorded against them.
 */
export const HICCUPS_PATH =
  process.env.VOICEOVER_HICCUPS ?? path.join(path.dirname(CORPUS_PATH), "hiccups.json.gz");

export const AUDIO_DIR =
  process.env.VOICEOVER_AUDIO ?? path.join(DATA_ROOT, "audio");

/**
 * Clips uploaded to build a voice clone, one directory per race-gender.
 *
 * In production this points at shared/ alongside the audio store, for the same reason: a
 * voice cannot be remade without the clips it was made from, so they must survive a deploy
 * and a rollback. Gitignored locally.
 */
export const VOICE_SAMPLES_DIR =
  process.env.VOICEOVER_VOICE_SAMPLES ?? path.join(DATA_ROOT, "voice", "samples");

/**
 * Blizzard's own NPC greeting barks, as `<race-gender>/<flavor>/<Title>.ogg`.
 *
 * Written by tools/fetch_npc_lines.py and gitignored. This is the ground truth for what a
 * voice should sound like, and the material every clone is seeded from - which is the only
 * reason the web app can see it. Local only: unlike the clips, it is not synced to the
 * droplet, so seeding is something you do from a checkout.
 */
export const NPC_LINES_DIR =
  process.env.VOICEOVER_NPC_LINES ?? path.join(DATA_ROOT, "voice", "npc-lines");

/**
 * Previous takes of a regenerated line: <sub>/<fileName>/<version>.mp3.
 *
 * A sibling of the store rather than a directory inside it, and deliberately so:
 * readStoreIndex walks audio/{quests,gossip} and `make push` rsyncs audio/, so anything
 * living under there would be mistaken for the store's own contents by both.
 */
export const AUDIO_HISTORY_DIR =
  process.env.VOICEOVER_AUDIO_HISTORY ?? path.join(DATA_ROOT, "audio-history");

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
  process.env.VOICEOVER_PREVIEWS ?? path.join(DATA_ROOT, "audio-previews");

/**
 * generation.json and pronunciation.json: how a line is voiced.
 *
 * Unlike the clips, these ship *inside* the release alongside the corpus, because they are
 * versioned data the code is written against - a rollback should restore the settings the
 * rolled-back code expects. They are also what the Python CLI reads, which is why the web
 * app treats them as defaults rather than owning them outright.
 */
export const VOICE_CONFIG_DIR =
  process.env.VOICEOVER_VOICE_CONFIG ?? path.join(DATA_ROOT, "voice");
