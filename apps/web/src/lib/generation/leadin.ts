/**
 * The lead-in: a throat clear the narrator performs and nothing keeps.
 *
 * ElevenLabs voices ramp up. The first second or two of a clip is audibly worse than the
 * rest, and the narrator then settles - which on a book is a drop in quality at the top of
 * every page. The documented fix is previous_text, which hands the model the text that came
 * before so the opening is continuous with it; eleven_v3 rejects it outright:
 *
 *   400 unsupported_model
 *   "Providing previous_text or next_text is not yet supported with the 'eleven_v3' model."
 *
 * Same answer on the streaming endpoint, and the same for previous_request_ids. So the
 * ramp-up is given something to happen to instead. `[clears throat] [long pause]` in front of
 * the text spends the model's settling on a throat clear, and the pause after it leaves a gap
 * wide enough to find and cut. Measured over three draws: the gap ran 1.98s to 2.53s and
 * speech resumed between 3.11s and 3.32s, against a longest natural pause of 0.48s in the
 * same clips. That ratio is what makes the cut unambiguous, and it is why the tag is
 * `[long pause]` rather than `[pause]` - the short one gave 0.86s, which is separable but
 * without much room.
 *
 * BOTH TAGS ARE LOAD-BEARING. `[long pause]` on its own was tried, to save 16 of the 29
 * characters: three draws produced no leading gap at all, and each one began speaking
 * immediately. With nothing before it there is nothing for the model to pause between, and
 * the tag is dropped - so the gap this cuts at is not the pause standing alone, it is the
 * pause AFTER the throat clear. The throat clear is also what the ramp-up happens to, which
 * is the point of the exercise.
 *
 * The 29 characters are billed as ordinary text, which is roughly 11% on top of a full
 * corpus regeneration and far more on a short line - a 50-character greeting pays 58%. That
 * was weighed and accepted rather than gated on length: the tag is what makes the opening
 * usable, and a line too short to warrant it is also a line that is nearly all ramp-up.
 *
 * The lead-in is NOT part of the spoken text. It is prepended at the request and nowhere
 * else, so `characters`, the staleness hash and the file name all describe what the line
 * actually says. Folding it in would restate every take in the corpus as stale at once.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Shared with lib/voices/merge.ts, which is the other caller that needs ffmpeg. */
export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

export const LEAD_IN = "[clears throat] [long pause] ";

/**
 * Models that perform a bracketed tag rather than reading it.
 *
 * The same distinction narration.ts relies on for `<hic>`. A model that is not on this list
 * would say "clears throat" aloud, so it gets no lead-in at all rather than a broken one.
 */
export const TAG_MODELS = ["eleven_v3"] as const;

/**
 * A gap at least this long is the lead-in; anything shorter is punctuation.
 *
 * Set between two measurements rather than at a round number. The lead-in gap ran 1.98s at
 * its shortest over three draws. eleven_v3 also inserts pauses nobody asked for - a separate
 * defect, seen mid-phrase and at the top of a clip - and the longest of those measured 1.47s.
 * 1.8 sits between the two, which is the whole margin there is: a spurious pause longer than
 * this, early in a clip, would be cut as though it were the lead-in, taking the opening words
 * with it.
 */
export const GAP_SECONDS = 1.8;

/** How far into the clip to look. The measured lead-in ends by 3.4s. */
export const WINDOW_SECONDS = 6;

/** Cut this much before speech resumes, so the first phoneme survives the trim. */
export const MARGIN_SECONDS = 0.05;

/** Anything quieter than this counts as silence. Measured against known-good clips. */
const NOISE_FLOOR_DB = -30;

export function performsTags(modelId: string): boolean {
  return (TAG_MODELS as readonly string[]).includes(modelId);
}

export function withLeadIn(text: string, modelId: string): string {
  return performsTags(modelId) ? `${LEAD_IN}${text}` : text;
}

/**
 * Where to cut, from silencedetect's own output, or null if the lead-in is not in there.
 *
 * The first qualifying gap wins rather than the longest. A dramatic mid-clip pause can be
 * longer than the lead-in - we have measured 1.4s ones - and cutting at the longest would
 * throw away the opening sentences of exactly the takes that needed help.
 */
export function cutPoint(output: string): number | null {
  const starts = [...output.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...output.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));

  for (const [index, start] of starts.entries()) {
    const end = ends[index];
    // A start with no end is a clip that fades out into silence and never speaks again.
    if (end === undefined) return null;
    if (start > WINDOW_SECONDS) return null;
    if (end - start >= GAP_SECONDS) return Math.max(0, end - MARGIN_SECONDS);
  }
  return null;
}

export type Trimmed = {
  audio: Buffer;
  /**
   * Seconds removed, or null when nothing was.
   *
   * Null covers three different cases on purpose - no lead-in was sent, the model ignored
   * it, or ffmpeg failed - because the caller's response to all three is the same: store the
   * audio it has. Which one happened is in the log, and `leadIn` on the take says whether
   * one was asked for at all.
   */
  trimmedSec: number | null;
};

/**
 * Cut the lead-in off a clip, or return it untouched.
 *
 * Never throws. A missing ffmpeg, a clip the model spoke without the throat clear, an
 * unreadable temp directory - none of them are worth failing a generation that has already
 * been paid for, so each one stores the audio as it arrived and says so in `trimmedSec`.
 * The take then carries `leadIn: true` with no `leadInSec`, which is how these are found.
 */
export async function trimLeadIn(audio: Buffer, modelId: string): Promise<Trimmed> {
  if (!performsTags(modelId)) return { audio, trimmedSec: null };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-leadin-"));
  const source = path.join(directory, "in.mp3");
  const trimmed = path.join(directory, "out.mp3");

  try {
    await fs.writeFile(source, audio);

    // silencedetect reports on stderr at info level, so -v error would hide exactly what
    // this reads. That mistake costs an hour: every clip looks clean and the conclusion is
    // that the audio has no gaps in it.
    const { stderr } = await run(FFMPEG, [
      "-i", source,
      "-af", `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${GAP_SECONDS}`,
      "-f", "null", "-",
    ]);

    const cut = cutPoint(stderr);
    if (cut === null) {
      console.warn(`lead-in gap not found; storing the take as it arrived`);
      return { audio, trimmedSec: null };
    }

    // Stream copy rather than re-encode: the trim must not cost a second lossy generation
    // of audio that has already been paid for. The cut lands on the nearest frame, which at
    // 44.1kHz is within 26ms - far finer than the margin above.
    await run(FFMPEG, ["-v", "error", "-y", "-ss", String(cut), "-i", source, "-c", "copy", trimmed]);

    return { audio: await fs.readFile(trimmed), trimmedSec: cut };
  } catch (error) {
    console.error("trimming the lead-in failed; storing the take as it arrived", error);
    return { audio, trimmedSec: null };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
