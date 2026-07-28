import { describe, expect, it, vi } from "vitest";

import { addVoice, deleteVoice, listVoices } from "./elevenlabs";

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

describe("addVoice", () => {
  it("posts the clips as multipart under the race-gender name", async () => {
    const fetchImpl = respondWith({ voice_id: "new1" });
    const voiceId = await addVoice(
      "orc-male",
      [
        { name: "a.mp3", data: Buffer.from("one") },
        { name: "b.ogg", data: Buffer.from("two") },
      ],
      { apiKey: "k", baseUrl: "https://stub.test", fetchImpl },
    );

    expect(voiceId).toBe("new1");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://stub.test/v1/voices/add");
    expect(init?.method).toBe("POST");

    const form = init?.body as FormData;
    expect(form.get("name")).toBe("orc-male");
    // Extracted game audio carries music and ambience, which a clone would reproduce.
    expect(form.get("remove_background_noise")).toBe("true");
    expect(form.getAll("files")).toHaveLength(2);
  });

  // fetch has to set Content-Type itself so the multipart boundary matches the body.
  it("does not set Content-Type by hand", async () => {
    const fetchImpl = respondWith({ voice_id: "x" });
    await addVoice("orc-male", [{ name: "a.mp3", data: Buffer.from("x") }], {
      apiKey: "k",
      fetchImpl,
    });

    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("surfaces the API's refusal", async () => {
    const fetchImpl = respondWith({ detail: "voice_limit_reached" }, { status: 400 });
    await expect(
      addVoice("orc-male", [{ name: "a.mp3", data: Buffer.from("x") }], { apiKey: "k", fetchImpl }),
    ).rejects.toThrow(/orc-male.*400.*voice_limit_reached/);
  });

  it("refuses a success response with no voice_id rather than recording a bad one", async () => {
    const fetchImpl = respondWith({});
    await expect(
      addVoice("orc-male", [{ name: "a.mp3", data: Buffer.from("x") }], { apiKey: "k", fetchImpl }),
    ).rejects.toThrow(/no voice_id/);
  });
});

describe("deleteVoice", () => {
  it("deletes by id", async () => {
    const fetchImpl = respondWith({ status: "ok" });
    await deleteVoice("abc123", { apiKey: "k", baseUrl: "https://stub.test", fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://stub.test/v1/voices/abc123");
    expect(init?.method).toBe("DELETE");
  });

  it("surfaces a failure", async () => {
    const fetchImpl = respondWith({ detail: "not_found" }, { status: 404 });
    await expect(deleteVoice("abc123", { apiKey: "k", fetchImpl })).rejects.toThrow(/404/);
  });
});
