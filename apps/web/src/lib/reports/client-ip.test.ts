import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/reports", { headers });
}

describe("clientIp", () => {
  it("reads x-real-ip", () => {
    expect(clientIp(request({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("ignores x-forwarded-for entirely, since a client can send its own", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("unknown");
  });

  it("shares one bucket when the header is absent", () => {
    expect(clientIp(request({}))).toBe("unknown");
  });
});
