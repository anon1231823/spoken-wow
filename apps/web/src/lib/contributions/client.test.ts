import { describe, expect, it } from "vitest";

import { clientOf } from "./client";

describe("clientOf", () => {
  it.each([
    ["1.15.7/61582", "era", "Classic Era 1.15.7"],
    ["1.60.1/69913", "forever", "Forever beta 1.60.1"],
    ["2.5.5/64796", "anniversary", "TBC Anniversary 2.5.5"],
    ["12.0.5/66102", "retail", "Retail 12.0.5"],
    ["1.12.1/5875", "private", "Private server 1.12.1"],
    ["2.4.3/8606", "private", "Private server 2.4.3"],
    ["3.3.5/12340", "private", "Private server 3.3.5"],
    ["5.5.1/63000", "other", "Other 5.5.1"],
  ])("classifies %s as %s", (build, family, label) => {
    const client = clientOf(build);
    expect(client.family).toBe(family);
    expect(client.label).toBe(label);
  });

  it("keeps the two halves of the build apart", () => {
    expect(clientOf("1.60.1/69913")).toMatchObject({ version: "1.60.1", buildNumber: "69913" });
  });

  // GetBuildInfo missing on the client is written as "?/?" by every addon's envelope, and an
  // envelope from before `build` was a required field stores "".
  it.each(["?/?", "", null, undefined])("says unknown for %s rather than guessing", (build) => {
    expect(clientOf(build)).toMatchObject({ family: "other", label: "Unknown client", version: null });
  });
});
