/**
 * What the explorer needs before it offers to generate anything: which voices exist, how
 * many characters are left, and what settings are in force.
 *
 * Fetched once per page load by anyone who can regenerate, which is why the settings come
 * along - a collaborator cannot open /voices, and "what am I about to spend, and how" should
 * not require the page that they cannot reach.
 *
 * Not refused when the caller has no key, unlike the routes that spend. This is the answer
 * the explorer asks for on load, and the useful answer to "what can you generate" from
 * somebody who has not been to /profile is "nothing yet, and here is why" - which is what
 * `noApiKey` carries. A 428 here would leave the page unable to say it.
 */
import { readApiKey } from "@/lib/api-key";
import { requireRegenerate } from "@/lib/generation/authz";
import { observedRate } from "@/lib/generation/calibration";
import { readSettings } from "@/lib/generation/settings";
import { generationStatus } from "@/lib/generation/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  // A row that will not open reads as no key here. The distinction between the two is worth
  // making where it can be acted on, which is requireApiKey on the routes that spend; this
  // one only decides whether to draw a balance.
  const apiKey = await readApiKey(session.user.id).catch(() => null);

  const [status, settings] = await Promise.all([
    generationStatus(apiKey ? { apiKey } : {}),
    readSettings(),
  ]);

  // Calibrated from what this account has actually been charged for this model, because the
  // rate is a property of the plan and cannot be read from the API. See billing.ts.
  const rate = await observedRate(settings.config.modelId);

  return Response.json({
    voices: status.voices,
    subscription: status.subscription,
    error: status.error,
    noApiKey: !apiKey,
    settings: settings.config,
    settingsSource: settings.source,
    rate,
  });
}
