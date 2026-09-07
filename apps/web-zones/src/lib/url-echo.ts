// Keeps a debounced text input in step with a URL that lags behind it.
//
// Ported from ../wow-voiceover/web/src/lib/url-echo.ts, which solves a real App Router
// problem: router.replace() re-renders through an RSC request, so useSearchParams()
// reports the new ?q= well after the keystroke that caused it. Reading the input's
// value straight from the URL therefore makes it stutter -- characters appear, vanish
// as a stale URL echoes back, then reappear.
//
// The fix is to remember every value written to the URL and not adopt an incoming URL
// value until it is one of them. Pure functions, so the stuttering case is testable
// without a browser.

export type Pending = readonly string[];

/** What the input should show, given what is in flight and what the URL says. */
export function target(pending: Pending, urlValue: string): string {
  return pending.length > 0 ? pending[pending.length - 1] : urlValue;
}

/** Record a value being written to the URL. */
export function write(pending: Pending, value: string): Pending {
  return [...pending, value];
}

/**
 * Handle a URL value arriving. `adopt` is true when the URL has caught up or diverged
 * for a reason other than our own writes -- a back button, a shared link -- and the
 * input should take its value from it.
 */
export function receive(pending: Pending, urlValue: string): { pending: Pending; adopt: boolean } {
  const index = pending.indexOf(urlValue);
  if (index === -1) {
    // Not a value we wrote: the URL changed underneath us.
    return { pending: [], adopt: true };
  }
  // Ours, and everything queued before it is now settled history.
  const rest = pending.slice(index + 1);
  return { pending: rest, adopt: rest.length === 0 };
}
