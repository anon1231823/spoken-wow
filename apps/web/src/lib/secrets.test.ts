/**
 * The credential path, so a change to it fails here rather than as an unopenable row.
 *
 * Pure crypto and no database: what these check is that a sealed key comes back exactly, and
 * that everything else - a tampered ciphertext, a tampered tag, a different master key -
 * fails loudly instead of producing bytes that would be sent to ElevenLabs as a bearer
 * credential. GCM is chosen for precisely that, and a test that only checked the round trip
 * would not notice if it stopped being.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

/**
 * A fresh module per case.
 *
 * masterKey() memoises, deliberately - it is read on every request - so two cases under
 * different keys in one module instance would both see whichever ran first.
 */
async function secrets(key?: string) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv("SPOKEN_SECRET_KEY", "");
  else vi.stubEnv("SPOKEN_SECRET_KEY", key);
  return import("./secrets");
}

afterEach(() => vi.unstubAllEnvs());

describe("seal and open", () => {
  it("returns exactly what was sealed", async () => {
    const { seal, open } = await secrets(KEY);
    expect(open(seal("sk_abc123"))).toBe("sk_abc123");
  });

  it("never stores the plaintext", async () => {
    const { seal } = await secrets(KEY);
    const sealed = seal("sk_abc123");
    expect(JSON.stringify(sealed)).not.toContain("sk_abc123");
  });

  it("uses a fresh IV, so the same key seals differently each time", async () => {
    const { seal } = await secrets(KEY);
    expect(seal("sk_abc123").ciphertext).not.toBe(seal("sk_abc123").ciphertext);
  });

  it("refuses a tampered ciphertext rather than decrypting it anyway", async () => {
    const { seal, open } = await secrets(KEY);
    const sealed = seal("sk_abc123");
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() => open({ ...sealed, ciphertext: bytes.toString("base64") })).toThrow();
  });

  it("refuses a tampered tag", async () => {
    const { seal, open } = await secrets(KEY);
    const sealed = seal("sk_abc123");
    const tag = Buffer.from(sealed.tag, "base64");
    tag[0] ^= 0xff;
    expect(() => open({ ...sealed, tag: tag.toString("base64") })).toThrow();
  });

  /**
   * The deployment mistake this is really about: rotating SPOKEN_SECRET_KEY strands every
   * stored credential. requireApiKey turns this throw into "set your key again" rather than
   * into "you have no key", which are different things to be told.
   */
  it("refuses a row sealed under a different master key", async () => {
    const sealed = (await secrets(KEY)).seal("sk_abc123");
    const { open } = await secrets(OTHER);
    expect(() => open(sealed)).toThrow();
  });
});

describe("the master key", () => {
  it("refuses a value that is not 32 bytes, rather than stretching it", async () => {
    const { seal } = await secrets(Buffer.alloc(16, 1).toString("base64"));
    expect(() => seal("sk_abc123")).toThrow(/32 bytes/);
  });

  /**
   * A clone of this repo has to boot without ceremony. Production is the case that must
   * fail loudly instead, and that guard is on NODE_ENV in the module itself.
   */
  it("falls back to a development key when unset outside production", async () => {
    const { seal, open } = await secrets();
    expect(open(seal("sk_abc123"))).toBe("sk_abc123");
  });
});
