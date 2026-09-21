/**
 * What a take was pronounced with, as a comparable value.
 *
 * sha-256 of the spoken text, hex. Not a cryptographic requirement - nothing here is
 * adversarial - but a stable, short, collision-free-in-practice identity for a string that
 * can run to a few thousand characters, so staleness is one column comparison rather than a
 * copy of every line's text in the take table.
 */
import { createHash } from "node:crypto";

export function spokenHash(spokenText: string): string {
  return createHash("sha256").update(spokenText, "utf8").digest("hex");
}
