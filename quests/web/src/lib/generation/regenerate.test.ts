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

const { closeDb, db } = await import("@/lib/db");
const { storePath, versionPath, versionsOnDisk, writeStoreFile } = await import("./archive");
const { regenerateLine } = await import("./regenerate");
const { listVersions } = await import("./versions");
const { audioRelPath } = await import("@/lib/audio");
const { lineIndex } = await import("@/lib/corpus");
const { clearOverride, writeOverride } = await import("@/lib/issues/overrides");

/** A quest line one NPC speaks. Jitters, human-male, in Deadwind Pass. */
const SOLO = "q:5:accept";
/** A quest line six NPCs share, so one file serves all of them. Lowest npcId is 233. */
const SHARED = "q:109:accept";
/** Progress text, which the generator never voices. */
const NEVER_VOICED = "q:6:progress";
/** A whole line of stage direction: "<Sirra begins translating…>". The narrator reads it. */
const STAGE_DIRECTION = "q:251:complete";
/** A $ token the game expands and we do not, so only an override can rescue it. */
const TEMPLATE_TOKEN = "q:8514:accept:m";

const MP3 = Buffer.from("ID3generated-audio");

type StubOptions = {
  voices?: Record<string, string>;
  speech?: () => Response;
};

/** Stands in for the three ElevenLabs endpoints this path touches. */
const DEFAULT_VOICES = {
  "human-male-standard": "voice-human-male-standard",
  // The shared line's six NPCs are all officials; the solo one is a standard.
  "human-male-official": "voice-human-male-official",
  // Not a race-gender-flavor slot: it reads stage directions, and no corpus line names it.
  "narrator-male": "voice-narrator-male",
};

function stub({ voices = DEFAULT_VOICES, speech }: StubOptions = {}) {
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
    if (url.endsWith("/v1/text-to-dialogue")) {
      return speech
        ? speech()
        : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
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

/**
 * Rows this test displaced, put back when it finishes.
 *
 * This test has to use real corpus lineIds - it is testing that a real line resolves, seeds
 * and writes correctly - so the files it touches are the real ones, and `pnpm test` runs
 * against DATABASE_URL, which is usually a developer's own database. It needs a clean slate
 * to assert on, and it must not be the thing that clears it permanently. So the fixtures'
 * rows are lifted out before each test and put back after.
 */
const FIXTURE_LINES = [SOLO, SHARED, NEVER_VOICED, STAGE_DIRECTION, TEMPLATE_TOKEN];
let displaced: Record<string, unknown>[] = [];

async function fixtureFiles(): Promise<string[]> {
  return FIXTURE_LINES.map(fileFor);
}

beforeEach(async () => {
  fs.mkdirSync(path.join(root, "audio", "quests"), { recursive: true });
  fs.mkdirSync(path.join(root, "audio", "gossip"), { recursive: true });

  const files = await fixtureFiles();
  const { rows } = await db().query(
    `delete from "voiceline_version" where "file" = any($1::text[]) returning *`,
    [files],
  );
  displaced = rows;
});

afterEach(async () => {
  const files = await fixtureFiles();
  await db().query(`delete from "voiceline_version" where "file" = any($1::text[])`, [files]);

  for (const row of displaced) {
    const columns = Object.keys(row).filter((key) => key !== "id");
    await db().query(
      `insert into "voiceline_version" (${columns.map((c) => `"${c}"`).join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        // jsonb comes back parsed and has to go in as text again.
        return value !== null && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );
  }
  displaced = [];

  fs.rmSync(path.join(root, "audio"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "audio-history"), { recursive: true, force: true });
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

async function regenerate(lineId: string, options: ReturnType<typeof stub>["options"]) {
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
    expect(result.voice).toBe("human-male-standard");
    expect(result.voiceId).toBe("voice-human-male-standard");
    expect(fs.readFileSync(storePath(result.file))).toEqual(MP3);

    const speech = calls.find((call) => call.url.includes("text-to-speech"))!;
    expect(speech.url).toBe("https://stub.invalid/v1/text-to-speech/voice-human-male-standard");
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
    expect(result.failure.message).toContain("human-male-standard");
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

/**
 * Overrides live in Postgres, so these write real rows and take them out again - the same
 * arrangement the fixture lines use, and for the same reason.
 */
describe("a line whose spoken text has been rewritten", () => {
  afterEach(async () => {
    await clearOverride(fileFor(SOLO));
    await clearOverride(fileFor(STAGE_DIRECTION));
    await clearOverride(fileFor(NEVER_VOICED));
    await clearOverride(fileFor(TEMPLATE_TOKEN));
  });

  it("speaks the rewrite rather than what the corpus says", async () => {
    const { options, calls } = stub();
    await writeOverride(fileFor(SOLO), SOLO, "Say this instead.", null);

    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sent = calls.find((c) => c.url.includes("text-to-speech"))!.body as { text: string };
    expect(sent.text).toBe("Say this instead.");
    expect(result.spokenText).toBe("Say this instead.");
    // Billed for what was sent, so the version row is not describing a different take.
    expect(result.characters).toBe("Say this instead.".length);
  });

  it("voices a line the corpus had given up on, once the template token is gone", async () => {
    const { options } = stub();

    // Untouched, it holds a $ token the game expands and we do not.
    const before = await regenerateLine(TEMPLATE_TOKEN, "user", options);
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.failure.message).toContain("rewrite it");

    await writeOverride(fileFor(TEMPLATE_TOKEN), TEMPLATE_TOKEN, "Plenty of leather.", null);
    const after = await regenerate(TEMPLATE_TOKEN, options);

    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.spokenText).toBe("Plenty of leather.");
  });

  it("sends a stage direction to the narrator, as dialogue", async () => {
    const { options, calls } = stub();

    const result = await regenerate(STAGE_DIRECTION, options);
    expect(result.ok).toBe(true);

    // The dialogue endpoint, not text-to-speech: two voices, one file.
    const dialogue = calls.find((call) => call.url.endsWith("/v1/text-to-dialogue"));
    expect(dialogue).toBeDefined();
    expect(calls.some((call) => call.url.includes("/v1/text-to-speech/"))).toBe(false);

    const body = dialogue!.body as {
      inputs: { text: string; voice_id: string }[];
      settings: Record<string, unknown>;
    };
    // The whole line is a direction, so there is one turn and the narrator speaks it, with
    // the brackets stripped rather than read aloud.
    expect(body.inputs).toEqual([
      { text: "Sirra begins translating the note...", voice_id: "voice-narrator-male" },
    ]);
    // Only stability: the endpoint documents nothing else, so nothing else is claimed.
    expect(body.settings).toEqual({ stability: expect.any(Number) });
  });

  it("records the narrator against the take", async () => {
    const { options } = stub();
    await regenerate(STAGE_DIRECTION, options);

    const { rows } = await db().query<{ narratorVoice: string | null; settings: unknown }>(
      `select "narratorVoice", "settings" from "voiceline_version" where "file" = $1`,
      [fileFor(STAGE_DIRECTION)],
    );
    expect(rows[0].narratorVoice).toBe("narrator-male");
    expect(rows[0].settings).toEqual({ stability: expect.any(Number) });
  });

  it("leaves an ordinary line on text-to-speech", async () => {
    const { options, calls } = stub();
    await regenerate(SOLO, options);

    expect(calls.some((call) => call.url.includes("/v1/text-to-speech/"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/text-to-dialogue"))).toBe(false);
  });

  it("still refuses progress text, which no rewrite can make voiceable", async () => {
    const { options, calls } = stub();
    await writeOverride(fileFor(NEVER_VOICED), NEVER_VOICED, "perfectly ordinary text", null);

    const result = await regenerateLine(NEVER_VOICED, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.message).toContain("progress");
    expect(calls).toHaveLength(0);
  });

  it("refuses a rewrite that puts the offending characters back", async () => {
    const { options, calls } = stub();
    await writeOverride(fileFor(SOLO), SOLO, "Meet me in $B Ironforge", null);

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(409);
    expect(calls).toHaveLength(0);
  });
});
