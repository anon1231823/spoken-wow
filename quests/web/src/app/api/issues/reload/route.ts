/**
 * Load the scan's findings into the database.
 *
 * Two ways in. With no body it reads corpus/hiccups.json.gz off disk - the artifact that ships
 * inside the release beside the corpus - which is the ordinary path and the one that works on
 * a droplet where nobody has the scan's Python. With a file attached it reads that instead,
 * for when the release's copy is older than a scan someone has just run and waiting for a
 * deploy to look at it is not the point.
 *
 * Findings are still not something a browser gets to invent: an upload is validated to the
 * same schema, and this is `admin` either way, because it replaces what the explorer marks for
 * everyone.
 */
import fs from "node:fs";

import { requireConfigure } from "@/lib/generation/authz";
import { ArtifactError, parseArtifact, type Artifact } from "@/lib/issues/artifact";
import { loadFindings } from "@/lib/issues/store";
import { HICCUPS_PATH } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** The artifact is ~200 KB. Well clear of that, and short of a file that is not one at all. */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  let artifact: Artifact;
  let source: string;

  const upload = request.headers.get("content-type")?.includes("multipart/form-data")
    ? ((await request.formData()).get("file") as File | null)
    : null;

  try {
    if (upload) {
      if (upload.size > MAX_UPLOAD_BYTES) {
        return Response.json({ error: "that file is too large to be a scan" }, { status: 400 });
      }
      artifact = parseArtifact(Buffer.from(await upload.arrayBuffer()));
      source = upload.name || "an upload";
    } else {
      artifact = parseArtifact(fs.readFileSync(HICCUPS_PATH));
      source = HICCUPS_PATH;
    }
  } catch (error) {
    if (error instanceof ArtifactError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // Reading the file failed, which is this deployment's problem rather than the caller's -
    // most often a release that shipped before the scan did. Say where it looked, because the
    // path is derived and the answer is usually in it.
    console.error("[issues] could not read the findings artifact:", error);
    return Response.json(
      {
        error:
          `could not read ${HICCUPS_PATH}. Run tools/scan_corpus_hiccups.py, ` +
          `or upload a hiccups.json.gz here.`,
      },
      { status: 500 },
    );
  }

  const report = await loadFindings(artifact.findings);
  return Response.json({ ...report, generatedAt: artifact.generatedAt, source });
}
