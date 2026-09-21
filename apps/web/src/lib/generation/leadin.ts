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

import { FFMPEG } from "@/lib/voices/merge";

const run = promisify(execFile);

export const LEAD_IN = "[clears throat] [long pause] ";

/**
 * Models that perform a bracketed tag rather than reading it.
 *
 * A model not on this list would say "clears throat" aloud, so it gets no lead-in at all
 * rather than a broken one. Note this is narrower than the codebase as a whole: audioTags
 * and accentTagged in narration.ts send their brackets to whatever model is configured,
 * without asking. So this list means "the lead-in is safe here", not "this codebase only
 * sends brackets to models that perform them".
 */
export const TAG_MODELS = ["eleven_v3"] as const;

/**
 * How long the throat clear may run.
 *
 * The lead-in is found by shape rather than by size, and this is the shape: a short opening
 * sound, then a pause, then the line. Across every clip we have that carried a lead-in, that
 * first sound ends between 0.50s and 1.19s - it is a throat clear, and a throat clear is
 * brief. A first sound that runs past this is words, so there is no lead-in to cut.
 *
 * 1.6 rather than 1.2, because a slow voice clears its throat slowly: tauren-male-elder took
 * 1.185s over it and came within 0.015s of being refused. The headroom is deliberate.
 *
 * WHY NOT BY DURATION, which is what this did until the gossip lines arrived. Every lead-in
 * gap measured, against every pause eleven_v3 inserted on its own:
 *
 *   lead-in performed  3.126 2.645 2.529 2.276 2.048 1.980 1.733 1.516 1.158 0.899
 *   no lead-in in it                     1.472 1.404 1.266 1.218 1.153
 *
 * The rows overlap. At four lead-in samples they did not, and 1.5 looked like a threshold;
 * at ten it is clear no number separates them, because the pause runs 0.9s to 3.1s depending
 * on the voice and the line. Shape is the only thing that stayed constant.
 */
export const HEAD_SECONDS = 1.6;

/**
 * The pause after it, at its shortest.
 *
 * Low, because it no longer has to carry the whole decision - HEAD_SECONDS does that. It is
 * here to skip a breath inside the throat clear: two clips opened with gaps of 0.32s and
 * 0.21s before the real one, so the search walks past short gaps rather than taking the
 * first it sees.
 */
export const GAP_SECONDS = 0.4;

/**
 * Refuse a cut past this.
 *
 * Not a discriminator, a backstop. It was 4s and it refused a real lead-in: a slow voice
 * stretches both halves of the shape, and tauren-male-elder put its throat clear at 1.185s
 * and its pause at 3.22s, for a cut at 4.36s. Measured cuts now run 1.66s to 4.36s, so 6s
 * is clear of everything real while still catching a match that is plainly not a lead-in.
 */
export const MAX_CUT_SECONDS = 6;

/**
 * How much of the clip to decode looking for it.
 *
 * Nothing starting after HEAD_SECONDS can be the lead-in, so decoding a whole book page -
 * minutes of audio, several jobs at a time - to inspect its first seconds is most of the
 * cost of the trim. The cap is well clear of the head rather than equal to it: the cut is
 * the END of a gap, and a qualifying gap has to be able to finish inside the decoded span or
 * it would be truncated into invisibility.
 */
const SCAN_SECONDS = 8;

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
 * THIS CANNOT TELL A THROAT CLEAR FROM A SHORT OPENING PHRASE, and the shape it matches is
 * one both produce: "The Tauren" is 0.67s followed by a 1.47s pause, which is indistinguish-
 * able here from a throat clear followed by the lead-in's pause. Loudness does not separate
 * them either - a cloned voice clears its throat about as loudly as it speaks, measured.
 *
 * So this is a bet that the tag is performed whenever it is sent, which it was on all ten
 * clips where we asked. When that bet loses, the opening words are cut and nothing in the
 * audio says so; `leadInSec` on the take is the only record, and an unusually large value is
 * what to look for.
 */
export function cutPoint(output: string): number | null {
  const starts = [...output.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...output.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));

  for (const [index, start] of starts.entries()) {
    const end = ends[index];
    // A start with no end is a clip that fades out into silence and never speaks again.
    if (end === undefined) return null;
    // The opening sound ran past a throat clear's length, so it was words.
    if (start > HEAD_SECONDS) return null;
    // A breath inside the throat clear rather than the pause after it: keep looking.
    if (end - start < GAP_SECONDS) continue;
    const cut = Math.max(0, end - MARGIN_SECONDS);
    return cut <= MAX_CUT_SECONDS ? cut : null;
  }
  return null;
}

export type Trimmed = {
  audio: Buffer;
  /** Whether a lead-in was sent at all, which is a property of the model. */
  leadIn: boolean;
  /**
   * Seconds removed, or null when nothing was.
   *
   * Null covers three different cases on purpose - no lead-in was sent, the model ignored
   * it, or ffmpeg failed - because the caller's response to all three is the same: store the
   * audio it has. Which one happened is in the log, and `leadIn` separates the first case
   * from the two worth chasing.
   */
  leadInSec: number | null;
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
  if (!performsTags(modelId)) return { audio, leadIn: false, leadInSec: null };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-leadin-"));
  const source = path.join(directory, "in.mp3");
  const trimmed = path.join(directory, "out.mp3");

  try {
    await fs.writeFile(source, audio);

    // silencedetect reports on stderr at info level, so -v error would hide exactly what
    // this reads. That mistake costs an hour: every clip looks clean and the conclusion is
    // that the audio has no gaps in it.
    // maxBuffer raised the way merge.ts raises it: this reads ffmpeg's own chatter, which
    // is the one thing the default 1MB was never sized for.
    const { stderr } = await run(
      FFMPEG,
      [
        "-i", source,
        "-t", String(SCAN_SECONDS),
        "-af", `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${GAP_SECONDS}`,
        "-f", "null", "-",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );

    const cut = cutPoint(stderr);
    if (cut === null) {
      console.warn("lead-in gap not found; storing the take as it arrived");
      return { audio, leadIn: true, leadInSec: null };
    }

    // Stream copy rather than re-encode: the trim must not cost a second lossy generation
    // of audio that has already been paid for. The cut lands on the nearest frame, which at
    // 44.1kHz is within 26ms - far finer than the margin above.
    await run(FFMPEG, ["-v", "error", "-y", "-ss", String(cut), "-i", source, "-c", "copy", trimmed]);

    return { audio: await fs.readFile(trimmed), leadIn: true, leadInSec: cut };
  } catch (error) {
    // Named rather than lumped in, because it is the likeliest cause of every take on a box
    // arriving untrimmed, and the generic message sends the reader looking at the audio.
    const detail = message(error);
    console.error(
      detail.includes("ENOENT") && detail.includes(FFMPEG)
        ? `ffmpeg is not installed or not on PATH (looked for "${FFMPEG}"); storing takes untrimmed`
        : `trimming the lead-in failed; storing the take as it arrived: ${detail}`,
    );
    return { audio, leadIn: true, leadInSec: null };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
