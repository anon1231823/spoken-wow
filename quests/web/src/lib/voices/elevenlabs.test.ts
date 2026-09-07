import { describe, expect, it, vi } from "vitest";

import { addVoice, deleteVoice, listModels, listVoices } from "./elevenlabs";

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
    { name: "orc-male-standard", voice_id: "orc1" },
    { name: "Bill - Wise, Mature, Balanced", voice_id: "stock2" },
    { name: "narrator-male", voice_id: "narr1" },
  ],
};

describe("listVoices", () => {
  it("keeps race-gender voices and ignores stock ones", async () => {
    const fetchImpl = respondWith(ACCOUNT);
    const found = await listVoices({ apiKey: "k", fetchImpl });

    expect([...found.keys()].sort()).toEqual(["narrator-male", "orc-male-standard"]);
    expect(found.get("orc-male-standard")).toBe("orc1");
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
      "orc-male-standard",
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
    expect(form.get("name")).toBe("orc-male-standard");
    // Extracted game audio carries music and ambience, which a clone would reproduce.
    expect(form.get("remove_background_noise")).toBe("true");
    expect(form.getAll("files")).toHaveLength(2);
  });

  // fetch has to set Content-Type itself so the multipart boundary matches the body.
  it("does not set Content-Type by hand", async () => {
    const fetchImpl = respondWith({ voice_id: "x" });
    await addVoice("orc-male-standard", [{ name: "a.mp3", data: Buffer.from("x") }], {
      apiKey: "k",
      fetchImpl,
    });

    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("surfaces the API's refusal", async () => {
    const fetchImpl = respondWith({ detail: "voice_limit_reached" }, { status: 400 });
    await expect(
      addVoice("orc-male-standard", [{ name: "a.mp3", data: Buffer.from("x") }], { apiKey: "k", fetchImpl }),
    ).rejects.toThrow(/orc-male.*400.*voice_limit_reached/);
  });

  it("refuses a success response with no voice_id rather than recording a bad one", async () => {
    const fetchImpl = respondWith({});
    await expect(
      addVoice("orc-male-standard", [{ name: "a.mp3", data: Buffer.from("x") }], { apiKey: "k", fetchImpl }),
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

/**
 * The list is read rather than hardcoded, because a list in the code goes stale the moment
 * ElevenLabs ships a model - which it had: eleven_v3 was available on the account while the
 * settings page still offered three models chosen by hand.
 */
describe("listModels", () => {
  const BODY = [
    {
      model_id: "eleven_v3",
      name: "Eleven v3",
      description: "The most expressive model.",
      can_do_text_to_speech: true,
      maximum_text_length_per_request: 5000,
      languages: new Array(74).fill({ language_id: "en" }),
    },
    {
      model_id: "eleven_multilingual_v2",
      name: "Eleven Multilingual v2",
      description: "Our most life-like model.",
      can_do_text_to_speech: true,
      maximum_text_length_per_request: 10000,
      languages: new Array(29).fill({ language_id: "en" }),
    },
    {
      model_id: "eleven_english_sts_v2",
      name: "Eleven English STS v2",
      can_do_text_to_speech: false,
      can_do_voice_conversion: true,
    },
  ];

  function client(body: unknown, status = 200) {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof globalThis.fetch;
    return { fetchImpl, options: { apiKey: "k", baseUrl: "https://stub.invalid", fetchImpl } };
  }

  it("returns the models the account may generate with", async () => {
    const { options } = client(BODY);
    const models = await listModels(options);

    expect(models.map((m) => m.id)).toEqual(["eleven_v3", "eleven_multilingual_v2"]);
    expect(models[0]).toEqual({
      id: "eleven_v3",
      name: "Eleven v3",
      description: "The most expressive model.",
      maxCharacters: 5000,
      languages: 74,
    });
  });

  // Speech-to-speech and voice-conversion models come back from the same endpoint and
  // cannot voice a line, so offering one would be offering a guaranteed failure.
  it("drops models that cannot do text to speech", async () => {
    const { options } = client(BODY);
    expect((await listModels(options)).map((m) => m.id)).not.toContain("eleven_english_sts_v2");
  });

  it("survives entries missing the optional fields", async () => {
    const { options } = client([{ model_id: "bare", can_do_text_to_speech: true }]);
    expect(await listModels(options)).toEqual([
      { id: "bare", name: "bare", description: "", maxCharacters: null, languages: 0 },
    ]);
  });

  it("returns nothing rather than throwing when the body is not a list", async () => {
    const { options } = client({ models: [] });
    expect(await listModels(options)).toEqual([]);
  });

  it("throws with the upstream text when the request fails", async () => {
    const { options } = client({ detail: "bad key" }, 401);
    await expect(listModels(options)).rejects.toThrow(/listing ElevenLabs models.*401.*bad key/s);
  });
});
