/**
 * Load the scan's findings into the database.
 *
 * Reads corpus/hiccups.json.gz off disk - the artifact that ships inside the release beside
 * the corpus - rather than taking a body. The findings are derived data with exactly one
 * correct source, and accepting an upload would let a browser decide what is wrong with 3,716
 * lines. It also means the button works on the droplet, where nobody has the scan's Python.
 *
 * `admin`: this replaces what the explorer marks for everyone.
 */
import fs from "node:fs";
import zlib from "node:zlib";

import { requireConfigure } from "@/lib/generation/authz";
import { loadFindings, type Finding } from "@/lib/issues/store";
import { HICCUPS_PATH } from "@/lib/paths";

export const dynamic = "force-dynamic";

type Artifact = { schemaVersion: number; generatedAt: string; findings: Finding[] };

/** The shape this code was written against. A newer file is a deploy that went out of order. */
const SCHEMA_VERSION = 1;

export async function POST() {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  let artifact: Artifact;
  try {
    artifact = JSON.parse(zlib.gunzipSync(fs.readFileSync(HICCUPS_PATH)).toString());
  } catch (error) {
    console.error("[issues] could not read the findings artifact:", error);
    return Response.json(
      { error: `could not read ${HICCUPS_PATH}. Run tools/scan_corpus_hiccups.py.` },
      { status: 500 },
    );
  }

  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    return Response.json(
      {
        error:
          `the findings file is schema ${artifact.schemaVersion} and this release reads ` +
          `${SCHEMA_VERSION}. Deploy the release that ships with it rather than loading it here.`,
      },
      { status: 409 },
    );
  }

  const report = await loadFindings(artifact.findings);
  return Response.json({ ...report, generatedAt: artifact.generatedAt });
}
