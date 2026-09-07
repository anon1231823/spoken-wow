/**
 * Telling our own URL writes apart from someone else's.
 *
 * The explorer keeps the search query in the URL so a result is linkable, but the input
 * has to stay ahead of it: `router.replace` re-renders the page through an RSC request,
 * so the new `?q=` only shows up in `useSearchParams` well after the keystroke that
 * caused it. Naively syncing the input from the URL therefore resets it to a value that
 * is already stale, deleting everything typed in the meantime.
 *
 * So we remember every value we write and ignore it when it comes back. Anything else
 * arriving in the URL is a real navigation - back/forward, or a pasted link - and the
 * input should follow it.
 */

/** A value we have written to the URL and not yet seen echoed back. */
export type Pending = readonly string[];

/**
 * What the URL is heading towards: the last value we wrote if a write is still in
 * flight, otherwise what it actually says. Debouncing compares against this, so holding
 * a key down doesn't queue a write for a value already on its way.
 */
export function target(pending: Pending, urlValue: string): string {
  return pending.at(-1) ?? urlValue;
}

/** Note that we are writing `value` to the URL. */
export function write(pending: Pending, value: string): Pending {
  return [...pending, value];
}

/**
 * Take a value that just appeared in the URL. `adopt` is true only for changes we didn't
 * make, which are the ones the input should follow.
 */
export function receive(
  pending: Pending,
  urlValue: string,
): { pending: Pending; adopt: boolean } {
  const at = pending.indexOf(urlValue);
  // React can coalesce transitions, so a write may never be rendered on its own; seeing
  // a later one means the ones before it will never arrive and can be dropped too.
  if (at !== -1) return { pending: pending.slice(at + 1), adopt: false };
  return { pending: [], adopt: true };
}
