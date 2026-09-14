// The one definition of "you have the role, but no ElevenLabs key on file", shared by
// the routes that answer it and the components that draw it.
//
// 428 rather than 403 because the two failures need different words in front of the
// user: 403 is "your role may not do this", which nothing they can do will fix, and this
// is "you have not set this up yet", which is one page away. The body carries the code
// as well, so a client never has to infer the meaning from the number alone.

export const NO_API_KEY = 428;

export type NoApiKeyBody = { error?: string; code?: string };

/**
 * The message to show, or null if this response was not a missing-key refusal.
 *
 * Takes an already-parsed body, because the callers all need to read it for their own
 * error paths anyway and a Response body can only be read once.
 */
export function noApiKeyMessage(status: number, body: NoApiKeyBody | null): string | null {
  if (status !== NO_API_KEY || body?.code !== "no_api_key") return null;
  return body.error ?? "This spends ElevenLabs credits, and you have no key set.";
}
