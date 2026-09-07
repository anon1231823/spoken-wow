/**
 * Reading a findings file, which now arrives from a file picker as well as from disk.
 *
 * No database: this is the half that decides whether a file is a scan at all, and the point of
 * doing it here is that a bad upload becomes a sentence rather than a constraint violation.
 */
import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { ArtifactError, parseArtifact, SCHEMA_VERSION } from "./artifact";

const FINDING = {
  category: "name-apostrophe",
  item: "Kel'Theril",
  severity: 1,
  note: "apostrophe name",
  occurrences: 7,
  variants: "Kel'Theril",
  grapheme: "kel'theril",
  lineIds: ["q:4901:accept"],
};

function file(body: unknown, gzip = true): Buffer {
  const json = Buffer.from(JSON.stringify(body));
  return gzip ? zlib.gzipSync(json) : json;
}

const VALID = { schemaVersion: SCHEMA_VERSION, generatedAt: "2026-07-31", findings: [FINDING] };

describe("parseArtifact", () => {
  it("reads the gzipped file the scan writes", () => {
    expect(parseArtifact(file(VALID)).findings).toHaveLength(1);
  });

  it("reads a file someone gunzipped on the way", () => {
    // It is named .json.gz, but it arrives through a file picker and refusing over "you
    // decompressed it first" would be a rule with nothing behind it.
    expect(parseArtifact(file(VALID, false)).findings).toHaveLength(1);
  });

  it("refuses a file that is not a scan, in words", () => {
    expect(() => parseArtifact(Buffer.from("not json at all"))).toThrow(ArtifactError);
    expect(() => parseArtifact(Buffer.from("not json at all"))).toThrow(/not JSON/);
    expect(() => parseArtifact(file({ hello: "world" }))).toThrow(/no findings/);
  });

  it("refuses a schema it was not written against, and says which way round", () => {
    const newer = file({ ...VALID, schemaVersion: SCHEMA_VERSION + 1 });
    expect(() => parseArtifact(newer)).toThrow(/Deploy the release that ships with it/);
  });

  it("names the finding that is malformed rather than letting Postgres do it", () => {
    // Otherwise this surfaces as a null constraint against a column nobody uploading a file
    // has heard of.
    const broken = file({ ...VALID, findings: [FINDING, { category: "x" }] });
    expect(() => parseArtifact(broken)).toThrow(/finding 1/);
  });

  it("survives a truncated gzip without crashing the route", () => {
    const half = file(VALID).subarray(0, 12);
    expect(() => parseArtifact(half)).toThrow(ArtifactError);
  });
});
