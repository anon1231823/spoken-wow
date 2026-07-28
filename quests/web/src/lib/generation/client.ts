/**
 * The browser's half of regeneration.
 *
 * Deliberately free of node imports: this is loaded into the client bundle, so anything it
 * touches is too. Types are re-declared rather than imported from the server modules for the
 * same reason - importing a type is erased, but importing the module it lives beside is not
 * always, and the production build is the only thing that catches the difference.
 */

export type FailureKind =
  | "quota"
  | "auth"
  | "rate-limit"
  | "voice-missing"
  | "bad-request"
  | "upstream";

export type RegenerateOk = {
  ok: true;
  lineId: string;
  file: string;
  version: number;
  bytes: number;
  characters: number;
  seed: number | null;
  voice: string;
  spokenText: string;
  sharedWith: number;
  archivedInherited: boolean;
};

export type RegenerateFailed = {
  ok: false;
  kind: FailureKind;
  message: string;
  /** Whether the rest of a batch is worth attempting. */
  fatal: boolean;
};

export type RegenerateResponse = RegenerateOk | RegenerateFailed;

export type GenerationStatusResponse = {
  voices: string[];
  subscription: {
    tier: string;
    characterCount: number;
    characterLimit: number;
    resetAt: string | null;
  } | null;
  error: string | null;
  settings: {
    modelId: string;
    voiceSettings: Record<string, number | boolean>;
    seedStrategy: string;
  };
  settingsSource: "file" | "database";
};

export async function fetchGenerationStatus(
  signal?: AbortSignal,
): Promise<GenerationStatusResponse | null> {
  try {
    const response = await fetch("/api/generation/status", { signal });
    if (!response.ok) return null;
    return (await response.json()) as GenerationStatusResponse;
  } catch {
    // The page works without it: the balance goes unshown and no button is pre-disabled.
    return null;
  }
}

export async function regenerate(
  lineId: string,
  signal?: AbortSignal,
): Promise<RegenerateResponse> {
  let response: Response;
  try {
    response = await fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, kind: "upstream", message: message(error), fatal: false };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    return {
      ok: false,
      kind: (body.kind as FailureKind) ?? "upstream",
      message: (body.error as string) ?? `request failed (${response.status})`,
      // Defaults to stopping: an unrecognised failure repeated ninety more times is worse
      // than a batch that stops early and can be restarted.
      fatal: body.fatal !== false,
    };
  }

  return body as unknown as RegenerateOk;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
