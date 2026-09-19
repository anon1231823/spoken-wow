/**
 * What the triage table renders, given what the server sent and what this session did.
 *
 * A function rather than component state, because state was the bug: the table copied the
 * server's list into useState, and a filter link - which is a navigation, not a click
 * handler - re-rendered it with new props and the same stale copy. The list only caught up
 * on a reload. Deriving means the server's list always wins, and a resolution is an overlay
 * on top of it rather than a second source of truth.
 */
import type { Report } from "./reports";

export function applyResolutions(
  rows: Report[],
  resolved: Record<number, Report>,
): Report[] {
  return rows.map((row) => resolved[row.id] ?? row);
}
