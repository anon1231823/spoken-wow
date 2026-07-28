/**
 * What the explorer needs before it offers to generate anything: which voices exist, how
 * many characters are left, and what settings are in force.
 *
 * Fetched once per page load by anyone who can regenerate, which is why the settings come
 * along - a collaborator cannot open /voices, and "what am I about to spend, and how" should
 * not require the page that they cannot reach.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { observedRate } from "@/lib/generation/billing";
import { readSettings } from "@/lib/generation/settings";
import { generationStatus } from "@/lib/generation/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const [status, settings] = await Promise.all([generationStatus(), readSettings()]);

  // Calibrated from what this account has actually been charged for this model, because the
  // rate is a property of the plan and cannot be read from the API. See billing.ts.
  const rate = await observedRate(settings.config.modelId);

  return Response.json({
    voices: status.voices,
    subscription: status.subscription,
    error: status.error,
    settings: settings.config,
    settingsSource: settings.source,
    rate,
  });
}
