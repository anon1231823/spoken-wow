/**
 * Putting an archived zone take back.
 *
 * GET lists what is on disk to go back to; POST installs one. Free either way -- the bytes
 * are already there -- which is why this is a route of its own rather than a mode of
 * regenerate: nothing here can spend a credit, so nothing here needs a key.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { archivedVersions } from "@/lib/zones/audio";
import { catalogue } from "@/lib/zones/catalogue";
import { BASE_LANG } from "@/lib/zones/lang";
import { publish, restoreZoneTake } from "@/lib/zones/regenerate";

export const dynamic = "force-dynamic";

async function fileOf(lineId: string): Promise<string | undefined> {
  return (await catalogue(BASE_LANG)).find((entry) => entry.id === lineId)?.file;
}

export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId) return Response.json({ error: "lineId is required" }, { status: 400 });

  const file = await fileOf(lineId);
  if (!file) return Response.json({ error: `unknown lineId ${lineId}` }, { status: 404 });

  return Response.json({ versions: await archivedVersions(file, BASE_LANG) });
}

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    version?: unknown;
  };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    return Response.json({ error: "version must be an integer" }, { status: 400 });
  }

  try {
    const version = await restoreZoneTake(body.lineId, body.version, BASE_LANG);
    await publish().catch((error: unknown) => {
      console.error("zones: could not rebuild the lookup after a restore", error);
    });
    return Response.json({ version });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
