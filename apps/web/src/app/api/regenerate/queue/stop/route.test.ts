/**
 * Stop is the one queue control that throws work away, so what it may reach is the point:
 * a translator's Stop must halt their language and nobody else's.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { authorise, cancelPending } = vi.hoisted(() => ({
  authorise: vi.fn(),
  cancelPending: vi.fn(async () => 3),
}));

vi.mock("@/lib/generation/authz", () => ({
  requireAnyRegenerate: async () => authorise(),
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {} }));
vi.mock("@/lib/generation/queue", () => ({ cancelPending }));

import { POST } from "./route";

function post(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/regenerate/queue/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/regenerate/queue/stop", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      langs: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST(post({}))).status).toBe(403);
    expect(cancelPending).not.toHaveBeenCalled();
  });

  it("cancels only the languages the caller regenerates in", async () => {
    authorise.mockResolvedValueOnce({
      session: { user: { id: "u1", name: "Ana" } },
      langs: ["ptBR"],
      denied: null,
    });

    const response = await POST(post({ batchId: "b1" }));

    expect(await response.json()).toEqual({ cancelled: 3 });
    expect(cancelPending).toHaveBeenCalledWith("Stopped by Ana", {
      batchId: "b1",
      langs: ["ptBR"],
    });
  });
});
