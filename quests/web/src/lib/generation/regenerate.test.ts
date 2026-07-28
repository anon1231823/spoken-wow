/**
 * The whole regeneration path, against a real Postgres and a stub ElevenLabs.
 *
 * Real database for the reason history.test.ts gives; stub ElevenLabs because a test that
 * spends a month's characters to prove it can spend a month's characters is not a test the
 * project can afford to run on every commit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-regen-"));
process.env.VOICEOVER_AUDIO = path.join(root, "audio");
process.env.VOICEOVER_AUDIO_HISTORY = path.join(root, "audio-history");

const { db } = await import("@/lib/db");
const { storePath, versionPath, versionsOnDisk, writeStoreFile } = await import("./archive");
const { regenerateLine } = await import("./regenerate");
const { listVersions } = await import("./versions");
const { audioRelPath } = await import("@/lib/audio");
const { lineIndex } = await import("@/lib/corpus");

/** A quest line one NPC speaks. Jitters, human-male, in Deadwind Pass. */
const SOLO = "q:5:accept";
/** A quest line six NPCs share, so one file serves all of them. Lowest npcId is 233. */
const SHARED = "q:109:accept";
/** Progress text, which the generator never voices. */
const NEVER_VOICED = "q:6:progress";

const MP3 = Buffer.from("ID3generated-audio");

type StubOptions = {
  voices?: Record<string, string>;
  speech?: () => Response;
};

/** Stands in for the three ElevenLabs endpoints this path touches. */
function stub({ voices = { "human-male": "voice-human-male" }, speech }: StubOptions = {}) {
  const calls: { url: string; body?: unknown }[] = [];

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.endsWith("/v1/voices")) {
      return Response.json({
        voices: Object.entries(voices).map(([name, voice_id]) => ({ name, voice_id })),
      });
    }
    if (url.endsWith("/v1/user/subscription")) {
      return Response.json({ tier: "creator", character_count: 100, character_limit: 131000 });
    }
    if (url.endsWith("/v1/models")) {
      return Response.json([
        { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
      ]);
    }
    if (url.includes("/v1/text-to-speech/")) {
      return speech
        ? speech()
        : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`stub got an unexpected url: ${url}`);
  });

  return {
    calls,
    options: {
      apiKey: "test-key",
      baseUrl: "https://stub.invalid",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    },
  };
}

function fileFor(lineId: string): string {
  return audioRelPath(lineIndex().get(lineId)![0]);
}

const touched = new Set<string>();

beforeEach(() => {
  fs.mkdirSync(path.join(root, "audio", "quests"), { recursive: true });
  fs.mkdirSync(path.join(root, "audio", "gossip"), { recursive: true });
});

afterEach(async () => {
  for (const file of touched) {
    await db().query(`delete from "voiceline_version" where "file" = $1`, [file]);
  }
  touched.clear();
  fs.rmSync(path.join(root, "audio"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "audio-history"), { recursive: true, force: true });
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await db().end();
});

async function regenerate(lineId: string, options: ReturnType<typeof stub>["options"]) {
  touched.add(fileFor(lineId));
  return regenerateLine(lineId, null as unknown as string, options);
}

describe("a line with no audio yet", () => {
  it("generates it and writes it into the store", async () => {
    const { options, calls } = stub();

    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toBe("quests/5-accept.mp3");
    expect(result.version).toBe(0);
    expect(result.archivedInherited).toBe(false);
    expect(result.voice).toBe("human-male");
    expect(result.voiceId).toBe("voice-human-male");
    expect(fs.readFileSync(storePath(result.file))).toEqual(MP3);

    const speech = calls.find((call) => call.url.includes("text-to-speech"))!;
    expect(speech.url).toBe("https://stub.invalid/v1/text-to-speech/voice-human-male");
  });

  it("counts the characters it actually spoke", async () => {
    const { options, calls } = stub();
    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spoken = (calls.find((c) => c.url.includes("text-to-speech"))!.body as { text: string })
      .text;
    expect(result.spokenText).toBe(spoken);
    expect(result.characters).toBe(spoken.length);
  });
});

describe("a line whose audio already exists", () => {
  it("archives the inherited take before overwriting it", async () => {
    const file = fileFor(SOLO);
    await writeStoreFile(file, Buffer.from("the audio this project inherited"));

    const { options } = stub();
    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archivedInherited).toBe(true);
    expect(result.version).toBe(1);
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe(
      "the audio this project inherited",
    );
    expect(fs.readFileSync(storePath(file))).toEqual(MP3);
  });
});

/**
 * The reason canonicalNpcId exists. Six NPCs speak q:109:accept and share one mp3, so the
 * seed must not depend on which of them the button was pressed for - Python's seeds from
 * whichever row it happened to process.
 */
describe("a line several NPCs share", () => {
  it("seeds from the lowest npcId, and says how many others are affected", async () => {
    const { options, calls } = stub();

    const result = await regenerate(SHARED, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sharedWith).toBe(5);

    // zlib.crc32("233"), the lowest of the six.
    const { default: zlib } = await import("node:zlib");
    expect(result.seed).toBe(zlib.crc32("233"));
    expect((calls.find((c) => c.url.includes("text-to-speech"))!.body as { seed: number }).seed).toBe(
      result.seed,
    );
  });
});

describe("refusals that cost nothing", () => {
  it("404s a lineId the corpus does not have", async () => {
    const { options, calls } = stub();
    const result = await regenerateLine("q:999999:accept", "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses a line the generator never voices, without calling out", async () => {
    const { options, calls } = stub();
    const result = await regenerateLine(NEVER_VOICED, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(409);
    expect(result.failure.message).toContain("never voiced");
    expect(result.failure.message).toContain("progress");
    // One bad line must not abandon the batch around it.
    expect(result.failure.fatal).toBe(false);
    expect(calls).toHaveLength(0);
  });

  // The common case today: three of twenty voices exist, so most lines cannot be generated
  // at all. Spending a request to be told so would be pure waste.
  it("refuses a line whose voice does not exist, and points at /voices", async () => {
    const { options, calls } = stub({ voices: { "dwarf-male": "voice-dwarf" } });

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("voice-missing");
    expect(result.failure.status).toBe(409);
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("human-male");
    expect(result.failure.message).toContain("/voices");
    expect(calls.some((call) => call.url.includes("text-to-speech"))).toBe(false);
  });
});

describe("when ElevenLabs refuses", () => {
  it("passes the credit failure through as a stopping condition", async () => {
    const { options } = stub({
      speech: () =>
        new Response(
          JSON.stringify({ detail: { status: "quota_exceeded", message: "0 credits left" } }),
          { status: 401 },
        ),
    });

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota");
    expect(result.failure.status).toBe(402);
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("0 credits left");
  });

  // The property that makes a failed regeneration safe: the line still plays what it played
  // before, and nothing has been recorded that suggests otherwise.
  it("leaves the store and the history untouched", async () => {
    const file = fileFor(SOLO);
    await writeStoreFile(file, Buffer.from("the take that was already there"));

    const { options } = stub({ speech: () => new Response("nope", { status: 500 }) });
    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("the take that was already there");
    expect(await versionsOnDisk(file)).toEqual([]);
    expect(await listVersions(file)).toEqual([]);
  });
});
