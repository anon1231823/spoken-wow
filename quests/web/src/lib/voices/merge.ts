/**
 * Joining several clips into one, with a pause between them.
 *
 * Wowhead NPC greetings are a second or less each, and a clone wants a minute or more of
 * audio. Uploading fifty one-second files gives ElevenLabs no prosodic context between
 * them; joining them into a single take with a beat of silence between does.
 *
 * Runs ffmpeg rather than doing it in the browser, which means the droplet needs ffmpeg
 * installed - see deploy/README.md. Arguments are passed as an array and never through a
 * shell, and every filename comes from samplePath, which only accepts names this app
 * generated.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { listSamples, samplePath, storedNameFor, voiceDir, type Sample } from "./samples";

const run = promisify(execFile);

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const MIN_PAUSE_SECONDS = 0;
export const MAX_PAUSE_SECONDS = 5;
export const DEFAULT_PAUSE_SECONDS = 1;
export const MAX_MERGE_INPUTS = 100;

// 192 kbps mono is what ElevenLabs asks for as a floor; the inputs are mixed formats and
// sample rates, so they are normalised before concat rather than assumed to match.
const OUTPUT_RATE = 44100;
const OUTPUT_BITRATE = "192k";
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${OUTPUT_RATE}:channel_layouts=mono`;

export function rejectMerge(files: string[], pauseSeconds: number): string | null {
  if (files.length < 2) return "select at least two clips to merge";
  if (files.length > MAX_MERGE_INPUTS) return `cannot merge more than ${MAX_MERGE_INPUTS} clips`;
  if (new Set(files).size !== files.length) return "the same clip was selected twice";
  if (!Number.isFinite(pauseSeconds)) return "the pause must be a number";
  if (pauseSeconds < MIN_PAUSE_SECONDS || pauseSeconds > MAX_PAUSE_SECONDS) {
    return `the pause must be between ${MIN_PAUSE_SECONDS} and ${MAX_PAUSE_SECONDS} seconds`;
  }
  return null;
}

/**
 * Build the filter graph.
 *
 * One silence source is generated and split, rather than adding an input per gap: a
 * hundred-clip merge would otherwise open a hundred lavfi inputs to produce identical
 * audio. With no pause, the clips are simply concatenated.
 */
function filterGraph(count: number, pauseSeconds: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(`[${i}:a]${FORMAT}[a${i}]`);

  const gaps = count - 1;
  const usesSilence = pauseSeconds > 0;
  if (usesSilence) {
    const labels = Array.from({ length: gaps }, (_, i) => `[s${i}]`).join("");
    parts.push(`[${count}:a]${FORMAT},asplit=${gaps}${labels}`);
  }

  const sequence: string[] = [];
  for (let i = 0; i < count; i++) {
    sequence.push(`[a${i}]`);
    if (usesSilence && i < gaps) sequence.push(`[s${i}]`);
  }
  const segments = usesSilence ? count + gaps : count;
  parts.push(`${sequence.join("")}concat=n=${segments}:v=0:a=1[out]`);

  return parts.join(";");
}

export async function mergeSamples(
  voice: string,
  files: string[],
  pauseSeconds: number,
): Promise<Sample> {
  const inputs = files.map((file) => samplePath(voice, file));
  // Fails before ffmpeg runs if a selected clip has been deleted meanwhile, so the error
  // names the file rather than being an ffmpeg exit code.
  for (const input of inputs) await fs.access(input);

  const args = inputs.flatMap((input) => ["-i", input]);
  if (pauseSeconds > 0) {
    args.push("-f", "lavfi", "-t", String(pauseSeconds), "-i", `anullsrc=r=${OUTPUT_RATE}:cl=mono`);
  }
  args.push(
    "-filter_complex",
    filterGraph(inputs.length, pauseSeconds),
    "-map",
    "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    OUTPUT_BITRATE,
    "-y",
  );

  const dir = voiceDir(voice);
  await fs.mkdir(dir, { recursive: true });

  const file = storedNameFor(`merged-${inputs.length}-clips.mp3`);
  // Built in the OS temp directory, not the voice directory: an ffmpeg failure must not
  // leave anything behind that a listing could pick up, even briefly.
  const scratch = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "voiceover-merge-")), file);

  try {
    await run(FFMPEG, [...args, scratch], { maxBuffer: 8 * 1024 * 1024 });
    await fs.rename(scratch, path.join(dir, file)).catch(async (error) => {
      // Temp and voice directories can be on different filesystems, where rename fails.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await fs.copyFile(scratch, path.join(dir, file));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") && message.includes(FFMPEG)) {
      throw new Error(`ffmpeg is not installed or not on PATH (looked for "${FFMPEG}")`);
    }
    throw new Error(`merge failed: ${message.slice(0, 400)}`);
  } finally {
    await fs.rm(path.dirname(scratch), { recursive: true, force: true });
  }

  const merged = (await listSamples(voice)).find((sample) => sample.file === file);
  if (!merged) throw new Error("merge produced no output");
  return merged;
}
