import { describe, expect, it } from "vitest";

import { type Pending, receive, target, write } from "./url-echo";

/** Types `value` into an input the URL is lagging behind, and reports what it holds. */
function type(pending: Pending, value: string) {
  return write(pending, value);
}

describe("target", () => {
  it("is the URL when nothing is in flight", () => {
    expect(target([], "thrall")).toBe("thrall");
  });

  it("is the newest write while the URL lags behind", () => {
    expect(target(["th", "thra"], "")).toBe("thra");
  });
});

describe("receive", () => {
  it("adopts a URL nobody here wrote", () => {
    // Back/forward, or opening a link with ?q= already on it.
    expect(receive([], "thrall")).toEqual({ pending: [], adopt: true });
  });

  it("ignores our own write coming back", () => {
    expect(receive(["thrall"], "thrall")).toEqual({ pending: [], adopt: false });
  });

  it("ignores an echo that is already stale", () => {
    // The bug: "th" lands while the input is on "thrall". Adopting it would delete
    // "rall", and the next echo would do it again.
    const pending = ["th", "thrall"];
    const first = receive(pending, "th");
    expect(first.adopt).toBe(false);
    expect(receive(first.pending, "thrall")).toEqual({ pending: [], adopt: false });
  });

  it("drops writes React coalesced past", () => {
    // Only the last transition renders, so "th" and "thra" never arrive on their own.
    expect(receive(["th", "thra", "thrall"], "thrall")).toEqual({
      pending: [],
      adopt: false,
    });
  });

  it("still adopts once the echoes have drained", () => {
    const { pending } = receive(["thrall"], "thrall");
    expect(receive(pending, "sylvanas")).toEqual({ pending: [], adopt: true });
  });

  it("matches the first echo when a query is retyped", () => {
    // "th" -> "thrall" -> back to "th": echoes arrive in the order they were sent, so
    // the first "th" is the one being acknowledged and the second stays outstanding.
    const { pending } = receive(["th", "thrall", "th"], "th");
    expect(pending).toEqual(["thrall", "th"]);
  });
});

describe("a burst of typing", () => {
  it("never adopts a stale value mid-word", () => {
    // Each debounced commit outruns the RSC round trip it started.
    let pending: Pending = [];
    for (const value of ["t", "th", "thra", "thrall"]) pending = type(pending, value);

    for (const echo of ["t", "th", "thra", "thrall"]) {
      const step = receive(pending, echo);
      expect(step.adopt).toBe(false);
      pending = step.pending;
    }

    expect(pending).toEqual([]);
  });

  it("leaves the input alone until the URL genuinely diverges", () => {
    let pending = write([], "thrall");
    expect(receive(pending, "thrall").adopt).toBe(false);
    pending = receive(pending, "thrall").pending;
    // Now the user hits back, landing on the empty query.
    expect(receive(pending, "")).toEqual({ pending: [], adopt: true });
  });
});
