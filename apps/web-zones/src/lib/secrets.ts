// Sealing a secret so the database never holds one in the clear.
//
// AES-256-GCM, a fresh random IV per write, and the auth tag kept beside the
// ciphertext. GCM rather than CBC because a tampered row must FAIL to open: garbage
// that decrypts anyway would be sent to ElevenLabs as a bearer credential.
//
// The only caller is lib/api-key.ts. Nothing here logs, and open() is called on one
// path only -- building an outgoing request.

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; tag: string };

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * A fixed key for local work, and only for local work.
 *
 * Guarded on NODE_ENV for the reason src/lib/auth.ts guards its secret: a clone of this
 * repo has to boot without ceremony, and a deploy that forgot ZONELORE_SECRET_KEY must
 * fail loudly rather than seal every contributor's credential under a constant that is
 * committed to a public repository.
 *
 * Deliberately NOT derived from BETTER_AUTH_SECRET. Rotating that secret is routine and
 * recoverable -- everyone signs in again. If keys hung off it, the same rotation would
 * destroy every stored credential silently, and nothing would say so until the next
 * regeneration failed to decrypt.
 *
 * Generate one with:  openssl rand -base64 32
 */
// Plain ASCII, exactly 32 characters, rather than base64: the length AES needs is then
// visible in the literal, which is what a base64 constant hid until createCipheriv
// refused it.
const DEVELOPMENT_KEY = "zonelore-development-key-0000000";

let cached: Buffer | null = null;

function masterKey(): Buffer {
  if (cached) return cached;

  const raw = process.env.ZONELORE_SECRET_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ZONELORE_SECRET_KEY is unset. It is the master key for stored ElevenLabs " +
          "credentials; generate one with `openssl rand -base64 32`.",
      );
    }
    cached = Buffer.from(DEVELOPMENT_KEY, "utf8");
    return cached;
  }

  const key = Buffer.from(raw, "base64");
  // Length-checked rather than hashed into shape: silently stretching a short value
  // would make a truncated paste look like it worked.
  if (key.length !== 32) {
    throw new Error(
      `ZONELORE_SECRET_KEY must be 32 bytes of base64, got ${key.length}. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }

  cached = key;
  return cached;
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Throws if the row was written under a different master key, or altered since. */
export function open(sealed: Sealed): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));

  return (
    decipher.update(Buffer.from(sealed.ciphertext, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}
