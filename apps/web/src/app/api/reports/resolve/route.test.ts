/**
 * That this route is gated at all is the point of testing it: its sibling POST is open to the
 * internet, and the two are one careless edit away from sharing an access rule.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";

const authorise = vi.fn();

vi.mock("@/lib/generation/authz", () => ({
  requireRegenerate: async () => authorise(),
}));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("https://example.com/api/reports/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await closeDb();
});

describe("POST /api/reports/resolve", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST(post({ id: 1, status: "fixed" }))).status).toBe(403);
  });

  it("rejects a status outside the closed set", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: 1, status: "resolved" }))).status).toBe(400);
  });

  it("404s an id that does not exist", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: 2147483000, status: "fixed" }))).status).toBe(404);
  });

  it("404s a malformed id without reaching the database", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: "not-a-number", status: "fixed" }))).status).toBe(404);
  });
});
