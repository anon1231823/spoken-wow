import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);

// Probed at module load, not in beforeEach: skipIf is evaluated while tests are collected,
// which happens first, so a hook-assigned flag would always still be false.
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "voiceover-merge-test-"));
  process.env.VOICEOVER_VOICE_SAMPLES = dir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.VOICEOVER_VOICE_SAMPLES;
});

describe("rejectMerge", () => {
  it("needs at least two clips", async () => {
    const { rejectMerge } = await import("./merge");
    expect(rejectMerge(["a"], 1)).toMatch(/at least two/);
    expect(rejectMerge([], 1)).toMatch(/at least two/);
  });

  it("refuses the same clip twice", async () => {
    const { rejectMerge } = await import("./merge");
    expect(rejectMerge(["a", "a"], 1)).toMatch(/twice/);
  });

  it("bounds the pause", async () => {
    const { rejectMerge, MAX_PAUSE_SECONDS } = await import("./merge");
    expect(rejectMerge(["a", "b"], -1)).toMatch(/between/);
    expect(rejectMerge(["a", "b"], MAX_PAUSE_SECONDS + 1)).toMatch(/between/);
    expect(rejectMerge(["a", "b"], Number.NaN)).toMatch(/must be a number/);
    expect(rejectMerge(["a", "b"], 0)).toBeNull();
    expect(rejectMerge(["a", "b"], MAX_PAUSE_SECONDS)).toBeNull();
  });
});

/**
 * The merge itself runs the real ffmpeg. It is skipped where ffmpeg is absent so a laptop
 * without it still runs green, but CI and any machine that can actually merge will execute
 * it - a filter graph is exactly the kind of thing a mock would assert into permanence
 * while remaining wrong.
 */
describe("mergeSamples", () => {
  async function sine(seconds: number, frequency = 440) {
    const clip = path.join(dir, `sine-${frequency}.mp3`);
    await run("ffmpeg", [
      "-f", "lavfi", "-t", String(seconds), "-i", `sine=frequency=${frequency}:r=44100`,
      "-ac", "1", "-c:a", "libmp3lame", "-y", clip,
    ]);
    return fs.readFile(clip);
  }

  async function seed(voice: string, count: number, seconds: number) {
    const { storeSample } = await import("./samples");
    const stored = [];
    for (let i = 0; i < count; i++) {
      stored.push(await storeSample(voice, `clip${i}.mp3`, await sine(seconds, 300 + i * 100)));
    }
    return stored;
  }

  async function durationOf(file: string) {
    const { stdout } = await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]);
    return Number(stdout.trim());
  }

  it.skipIf(!hasFfmpeg)("joins clips with the requested pause", async () => {
    const { mergeSamples } = await import("./merge");
    const clips = await seed("orc-male-standard", 3, 1);

    const merged = await mergeSamples("orc-male-standard", clips.map((c) => c.file), 1);

    // 3 clips of 1s plus 2 gaps of 1s. mp3 framing makes this inexact, hence the tolerance.
    const seconds = await durationOf(path.join(dir, "orc-male-standard", merged.file));
    expect(seconds).toBeGreaterThan(4.5);
    expect(seconds).toBeLessThan(5.5);
  });

  it.skipIf(!hasFfmpeg)("concatenates with no gap when the pause is zero", async () => {
    const { mergeSamples } = await import("./merge");
    const clips = await seed("orc-male-standard", 2, 1);

    const merged = await mergeSamples("orc-male-standard", clips.map((c) => c.file), 0);

    const seconds = await durationOf(path.join(dir, "orc-male-standard", merged.file));
    expect(seconds).toBeGreaterThan(1.7);
    expect(seconds).toBeLessThan(2.4);
  });

  it.skipIf(!hasFfmpeg)("names the merge after the first selected clip", async () => {
    const { mergeSamples } = await import("./merge");
    const { storeSample, displayName } = await import("./samples");
    const first = await storeSample("orc-male-standard", "Orc-Male-NPC-Greeting-01.ogg", await sine(1));
    const second = await storeSample("orc-male-standard", "something-else.ogg", await sine(1));

    const merged = await mergeSamples("orc-male-standard", [first.file, second.file], 0);

    expect(displayName(merged.file)).toBe("merged-Orc-Male-NPC-Greeting-01.mp3");
  });

  it.skipIf(!hasFfmpeg)("leaves the sources in place", async () => {
    const { mergeSamples } = await import("./merge");
    const { listSamples } = await import("./samples");
    const clips = await seed("orc-male-standard", 2, 1);

    await mergeSamples("orc-male-standard", clips.map((c) => c.file), 1);

    expect(await listSamples("orc-male-standard")).toHaveLength(3);
  });

  it.skipIf(!hasFfmpeg)("names a clip that went missing rather than failing opaquely", async () => {
    const { mergeSamples } = await import("./merge");
    const { deleteSample } = await import("./samples");
    const clips = await seed("orc-male-standard", 2, 1);
    await deleteSample("orc-male-standard", clips[0].file);

    await expect(
      mergeSamples("orc-male-standard", clips.map((c) => c.file), 1),
    ).rejects.toThrow(/ENOENT|no such file/i);
  });

  it("refuses a clip name it did not generate, before running anything", async () => {
    const { mergeSamples } = await import("./merge");
    await expect(mergeSamples("orc-male-standard", ["../../etc/passwd", "x.mp3"], 1)).rejects.toThrow(
      /unsafe sample name/,
    );
  });
});
