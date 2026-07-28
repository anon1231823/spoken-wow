import { describe, expect, it, vi } from "vitest";

import { listVoices } from "./elevenlabs";

// Declared with the fetch parameters it stands in for, so mock.calls stays typed and the
// assertions below can read the url and headers without a cast.
function respondWith(body: unknown, init: { status?: number } = {}) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: init.status ?? 200 }),
  );
}

// The names ElevenLabs returns for a fresh account, alongside two the project can use.
const ACCOUNT = {
  voices: [
    { name: "Roger - Laid-Back, Casual, Resonant", voice_id: "stock1" },
    { name: "orc-male", voice_id: "orc1" },
    { name: "Bill - Wise, Mature, Balanced", voice_id: "stock2" },
    { name: "narrator-male", voice_id: "narr1" },
  ],
};

describe("listVoices", () => {
  it("keeps race-gender voices and ignores stock ones", async () => {
    const fetchImpl = respondWith(ACCOUNT);
    const found = await listVoices({ apiKey: "k", fetchImpl });

    expect([...found.keys()].sort()).toEqual(["narrator-male", "orc-male"]);
    expect(found.get("orc-male")).toBe("orc1");
  });

  // A name that looks right but is not a voice the corpus needs must not be adopted: the
  // Python side would never ask for it, so surfacing it as "created" would be a lie.
  it("ignores a race-gender name the corpus does not use", async () => {
    const fetchImpl = respondWith({ voices: [{ name: "murloc-male", voice_id: "x" }] });
    expect((await listVoices({ apiKey: "k", fetchImpl })).size).toBe(0);
  });

  it("sends the api key and asks the right endpoint", async () => {
    const fetchImpl = respondWith(ACCOUNT);
    await listVoices({ apiKey: "secret", baseUrl: "https://stub.test", fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://stub.test/v1/voices");
    expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe("secret");
  });

  it("tolerates a response with no voices", async () => {
    const fetchImpl = respondWith({});
    expect((await listVoices({ apiKey: "k", fetchImpl })).size).toBe(0);
  });

  it("surfaces the API's own error text", async () => {
    const fetchImpl = respondWith({ detail: "invalid_api_key" }, { status: 401 });
    await expect(listVoices({ apiKey: "k", fetchImpl })).rejects.toThrow(/401.*invalid_api_key/);
  });

  it("refuses to run without a key rather than calling anonymously", async () => {
    const fetchImpl = respondWith(ACCOUNT);
    const previous = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      await expect(listVoices({ fetchImpl })).rejects.toThrow(/ELEVENLABS_API_KEY/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.ELEVENLABS_API_KEY = previous;
    }
  });
});
