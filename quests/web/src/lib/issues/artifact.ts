/**
 * Reading the scan's findings, from wherever they came.
 *
 * Two sources, one shape. The release ships corpus/hiccups.json.gz beside the corpus, which is
 * the ordinary path; an upload is the way in when the file on the droplet is older than the
 * scan someone has just run, and waiting for a deploy to look at it is not the point.
 *
 * gzip or plain JSON, sniffed rather than asked about: the file is written .json.gz, but it
 * arrives via a file picker and "you gunzipped it first" is not a useful thing to refuse over.
 */
import zlib from "node:zlib";

import type { Finding } from "./store";

export type Artifact = {
  schemaVersion: number;
  generatedAt: string;
  findings: Finding[];
};

/** The shape this code reads. A newer file is a scan and a release that went out of order. */
export const SCHEMA_VERSION = 1;

export class ArtifactError extends Error {}

/** gzip's magic number. Two bytes is the whole format's claim to being one. */
function isGzip(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export function parseArtifact(data: Buffer): Artifact {
  let text: string;
  try {
    text = (isGzip(data) ? zlib.gunzipSync(data) : data).toString("utf8");
  } catch (error) {
    throw new ArtifactError(`could not decompress the file: ${String(error)}`);
  }

  let artifact: Artifact;
  try {
    artifact = JSON.parse(text);
  } catch {
    throw new ArtifactError("that is not the findings file - it is not JSON");
  }

  if (!artifact || !Array.isArray(artifact.findings)) {
    throw new ArtifactError("that is not the findings file - it has no findings");
  }

  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    throw new ArtifactError(
      `the findings file is schema ${artifact.schemaVersion} and this release reads ` +
        `${SCHEMA_VERSION}. Deploy the release that ships with it rather than loading it here.`,
    );
  }

  // Checked here rather than left to Postgres, which would report a null constraint against a
  // column nobody uploading a file has heard of.
  for (const [index, finding] of artifact.findings.entries()) {
    if (
      typeof finding?.category !== "string" ||
      typeof finding?.item !== "string" ||
      typeof finding?.severity !== "number" ||
      !Array.isArray(finding?.lineIds)
    ) {
      throw new ArtifactError(`finding ${index} is missing a category, item, severity or lines`);
    }
  }

  return artifact;
}
