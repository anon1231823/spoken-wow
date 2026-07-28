import path from "node:path";

/** The repo root, one level up from web/. */
const REPO_ROOT = path.resolve(process.cwd(), "..");

export const CORPUS_PATH =
  process.env.VOICEOVER_CORPUS ?? path.join(REPO_ROOT, "corpus", "corpus.json.gz");

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
