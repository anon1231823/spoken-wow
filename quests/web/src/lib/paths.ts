import path from "node:path";

/** The repo root, one level up from web/. */
const REPO_ROOT = path.resolve(process.cwd(), "..");

export const CORPUS_PATH =
  process.env.VOICEOVER_CORPUS ?? path.join(REPO_ROOT, "corpus", "corpus.json.gz");

export const AUDIO_DIR =
  process.env.VOICEOVER_AUDIO ?? path.join(REPO_ROOT, "audio");
