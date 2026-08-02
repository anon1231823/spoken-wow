// The feedback vocabulary, shared by the form, the explorer panel and the triage page.
//
// CLIENT-SAFE ON PURPOSE, for filters.ts's reason: the dialog that submits a report and
// the route handler that validates one have to agree on the same four categories and the
// same three statuses, and one of them runs in the browser. Nothing here may import
// anything marked "server-only".

/** What the report is about. Asked up front, because it decides who looks at it. */
export const CATEGORIES = ["lore", "audio", "pronunciation", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/** 'open' is the state a report arrives in; the other two are the two ways to close it. */
export const STATUSES = ["open", "not_an_issue", "fixed"] as const;
export type Status = (typeof STATUSES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  lore: "The lore text is wrong",
  audio: "The narration sounds wrong",
  pronunciation: "A word is mispronounced",
  other: "Something else",
};

export const STATUS_LABEL: Record<Status, string> = {
  open: "open",
  not_an_issue: "not an issue",
  fixed: "fixed",
};

// Long enough for someone to quote the sentence that is wrong and say why, short enough
// that a paste of an entire log is refused rather than stored.
export const BODY_MAX = 4000;

/** One report, as the API hands it to a triager. Bodies are never sent to anyone else. */
export type FeedbackReport = {
  id: number;
  /** Null for feedback about the project rather than about a line. */
  lineId: string | null;
  category: Category;
  body: string;
  status: Status;
  createdAt: string;
  resolvedAt: string | null;
  /** The account that filed it, if the reporter was signed in. */
  reporterEmail: string | null;
  /** What an anonymous reporter chose to leave, if anything. */
  name: string | null;
  email: string | null;
  /** The account that ruled on it. */
  resolverEmail: string | null;
};

/** How to describe who filed a report, in one place so the panel and the page agree. */
export function reporterLabel(report: FeedbackReport): string {
  if (report.reporterEmail) return report.reporterEmail;
  if (report.name && report.email) return `${report.name} <${report.email}>`;
  return report.name ?? report.email ?? "anonymous";
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
