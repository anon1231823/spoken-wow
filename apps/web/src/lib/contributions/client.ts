/**
 * Which game client a contribution came from, read off the envelope's `build=` field alone.
 *
 * `build` is "<version>/<build number>" straight out of GetBuildInfo() -- every addon has sent it
 * since the first envelope, so every stored row can be classified, not just new ones. The
 * version's major.minor is unique per client that is in play today:
 *
 *   1.15.x  Classic Era, Hardcore and Season of Discovery (one client; the build cannot tell
 *           them apart)
 *   1.60.x  the WoW: Forever beta (1.16 and up, allowing for its later builds)
 *   2.5.x   TBC Anniversary
 *   10+     retail
 *   1.12.1, 2.4.3, 3.3.5  the three legacy clients -- only private servers run these
 *
 * Anything else (another Classic progression, say) is "other", labelled with its version so it
 * is still readable. A private server on a modern client looks exactly like the modern client;
 * nothing in `build` can say otherwise.
 *
 * Node-free: ContributionTable, a client component, imports the family list for its dropdown.
 */
export const CLIENT_FAMILIES = ["era", "anniversary", "retail", "forever", "private", "other"] as const;

export type ClientFamily = (typeof CLIENT_FAMILIES)[number];

export const CLIENT_FAMILY_LABELS: Record<ClientFamily, string> = {
  era: "Classic Era",
  anniversary: "TBC Anniversary",
  retail: "Retail",
  forever: "Forever beta",
  private: "Private server",
  other: "Other",
};

export function isClientFamily(value: unknown): value is ClientFamily {
  return typeof value === "string" && (CLIENT_FAMILIES as readonly string[]).includes(value);
}

export type ClientSummary = {
  family: ClientFamily;
  /** e.g. "Classic Era 1.15.7" -- the family plus the version, what the table shows. */
  label: string;
  /** The version half of `build`, or null when the envelope's was missing or "?". */
  version: string | null;
  /** The build-number half, or null likewise. */
  buildNumber: string | null;
};

const LEGACY_VERSIONS = new Set(["1.12.1", "2.4.3", "3.3.5"]);

function familyOf(version: string): ClientFamily {
  if (LEGACY_VERSIONS.has(version)) return "private";
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return "other";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major >= 10) return "retail";
  if (major === 1 && minor >= 13 && minor <= 15) return "era";
  if (major === 1 && minor >= 16) return "forever";
  if (major === 2 && minor === 5) return "anniversary";
  return "other";
}

export function clientOf(build: string | null | undefined): ClientSummary {
  const [rawVersion = "", rawNumber = ""] = (build ?? "").trim().split("/", 2);
  const version = rawVersion && rawVersion !== "?" ? rawVersion : null;
  const buildNumber = rawNumber && rawNumber !== "?" ? rawNumber : null;
  if (!version) return { family: "other", label: "Unknown client", version, buildNumber };
  const family = familyOf(version);
  return { family, label: `${CLIENT_FAMILY_LABELS[family]} ${version}`, version, buildNumber };
}
