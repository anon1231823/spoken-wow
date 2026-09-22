import path from "node:path";

/**
 * Where the quests data lives in a checkout: the corpus, the audio archive, the voice
 * config and the three sibling caches. Two levels up from apps/web/, then into
 * pipelines/quests/ -- the monorepo move put the app one directory deeper and the data
 * under the pipeline that produces it.
 *
 * A development and test fallback only. Every export below is env-overridden in
 * production by deploy/web/ecosystem.config.js, which points each one at either the
 * current release or shared/; a release directory has no pipelines/ in it and never
 * reaches this line.
 */
//
// Assembled from a joined array rather than written as literal segments, which looks
// gratuitous and is not. Next's file tracer statically evaluates path.resolve() when
// every argument is a literal, resolves this to a real directory, and copies the whole
// directory into the standalone bundle: 127 MB of Python virtualenv, the corpus twice,
// and pipelines/quests/.env with the ElevenLabs key and the database password in it.
// The old tracing root hid that by putting this directory out of range, and widening
// the root -- which pnpm's hoisted node_modules forced -- exposed it. One segment kept
// out of the literal makes the expression opaque to the tracer and identical at runtime.
const PIPELINE_DIR = ["pipelines", "quests"].join(path.sep);
const DATA_ROOT = path.resolve(process.cwd(), "..", "..", PIPELINE_DIR);

export const CORPUS_PATH =
  process.env.SPOKEN_QUESTS_CORPUS ?? path.join(DATA_ROOT, "corpus", "corpus.json.gz");

/**
 * Clips uploaded to build a voice clone, one directory per race-gender.
 *
 * In production this points at shared/ alongside the audio archive, for the same reason: a
 * voice cannot be remade without the clips it was made from, so they must survive a deploy
 * and a rollback. Gitignored locally.
 */
export const VOICE_SAMPLES_DIR =
  process.env.SPOKEN_QUESTS_VOICE_SAMPLES ?? path.join(DATA_ROOT, "voice", "samples");

/**
 * Blizzard's own NPC greeting barks, as `<race-gender>/<flavor>/<Title>.ogg`.
 *
 * Written by tools/fetch_npc_lines.py and gitignored. This is the ground truth for what a
 * voice should sound like, and the material every clone is seeded from - which is the only
 * reason the web app can see it. In production it is shared/npc-lines, pushed from a
 * checkout with `make web-push-npc-lines`: a release never carries it.
 */
export const NPC_LINES_DIR =
  process.env.SPOKEN_QUESTS_NPC_LINES ?? path.join(DATA_ROOT, "voice", "npc-lines");

/**
 * Every take of every quests line, the live one included, one directory per file:
 * <sub>/<fileName>/, holding whatever name each take's row records in archiveFile. The
 * only place quests audio lives; which take is live is the row's `isCurrent`.
 */
export const AUDIO_HISTORY_DIR =
  process.env.SPOKEN_QUESTS_AUDIO_HISTORY ?? path.join(DATA_ROOT, "audio-history");

/**
 * Rendered pronunciation previews, as `<hash>.mp3`.
 *
 * A cache, not a store: every file here can be rebuilt by spending credits again, and
 * nothing in the addon or the corpus refers to one. It is separate from the archive, which
 * only takes belong in, and it outlives a deploy because the whole point is not paying
 * twice to hear the same entry.
 */
export const PREVIEW_DIR =
  process.env.SPOKEN_QUESTS_PREVIEWS ?? path.join(DATA_ROOT, "audio-previews");

/**
 * generation.json and pronunciation.json: how a line is voiced.
 *
 * Unlike the clips, these ship *inside* the release alongside the corpus, because they are
 * versioned data the code is written against - a rollback should restore the settings the
 * rolled-back code expects. They are also what the Python CLI reads, which is why the web
 * app treats them as defaults rather than owning them outright.
 */
export const VOICE_CONFIG_DIR =
  process.env.SPOKEN_QUESTS_VOICE_CONFIG ?? path.join(DATA_ROOT, "voice");
