/**
 * The global generation settings.
 *
 * GET is `collaborator`, because someone about to spend characters is entitled to know what
 * they are spending them on. PUT and DELETE are `admin`: these settings apply to everything
 * anyone generates afterwards.
 *
 * DELETE drops the override rather than writing the defaults back, so "reset" means the row
 * is gone and voice/generation.json is in force again - a state the page can then report
 * honestly instead of showing values that merely happen to match.
 */
import { requireIn } from "@/lib/generation/authz";
import {
  readSettings,
  resetSettings,
  SettingsError,
  validateConfig,
  writeSettings,
} from "@/lib/generation/settings";

export const dynamic = "force-dynamic";

// Per language (?lang=, English when absent): read by whoever regenerates in it, changed by
// whoever configures it. A language nobody has configured reads as English's without its
// accent tags; see readSettings.
export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  return Response.json(await readSettings(lang));
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "configure");
  if (denied) return denied;

  let config;
  try {
    config = validateConfig(await request.json());
  } catch (error) {
    // A validation failure is the caller's fault and a JSON parse failure is too, so both
    // are 400 - but only SettingsError text is safe to hand back verbatim.
    const message = error instanceof SettingsError ? error.message : "invalid settings body";
    return Response.json({ error: message }, { status: 400 });
  }

  await writeSettings(config, session.user.id, lang);
  return Response.json(await readSettings(lang));
}

export async function DELETE(request: Request) {
  const { lang, denied } = await requireIn(request, "configure");
  if (denied) return denied;

  await resetSettings(lang);
  return Response.json(await readSettings(lang));
}
