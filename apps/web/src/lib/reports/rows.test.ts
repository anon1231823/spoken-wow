/**
 * The regression this module exists for: the triage table used to copy the server's rows
 * into useState, so switching the filter re-rendered with new props and the old list. The
 * page looked frozen until a reload. Rows are derived from the server's list now, and the
 * only thing held locally is what this session resolved.
 */
import { describe, expect, it } from "vitest";

import { applyResolutions } from "./rows";
import type { Report } from "./reports";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 1,
    source: "quests",
    lineId: "q:374:accept",
    target: "quest/374/accept",
    category: "pronunciation",
    body: "said it wrong",
    status: "open",
    userId: null,
    name: null,
    email: null,
    createdAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("applyResolutions", () => {
  it("hands back the server's rows, in the server's order", () => {
    const rows = [report({ id: 2 }), report({ id: 1 })];
    expect(applyResolutions(rows, {}).map((row) => row.id)).toEqual([2, 1]);
  });

  it("shows what this session resolved in place of the row it replaced", () => {
    const resolved = report({ status: "fixed", resolvedAt: "2026-09-02T00:00:00Z" });
    expect(applyResolutions([report()], { 1: resolved })[0]).toBe(resolved);
  });

  it("drops a resolution for a row the current filter does not show", () => {
    // Resolve one under "Open", then switch to "Fixed": the stale row must not reappear.
    expect(applyResolutions([report({ id: 5 })], { 1: report({ status: "fixed" }) })).toEqual([
      report({ id: 5 }),
    ]);
  });
});
