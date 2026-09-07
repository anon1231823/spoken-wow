/**
 * The role model, shared by the server and the browser so the roles are defined once.
 *
 * Four kinds of visitor, three of which are roles:
 *
 *   guest    not signed in. Browse, filter, play, and file feedback. Nothing else.
 *   member   signed in, and that is all it means. The same view as a guest.
 *   editor   may review lines, spend credits regenerating them, and triage the feedback
 *            anyone else has filed.
 *   admin    may also edit the pronunciation rules and hand out roles.
 *
 * Filing feedback is deliberately not a permission: it is the one thing a guest may write,
 * and a report is a claim rather than a decision. Reading and resolving those reports is
 * a permission, because a resolved report is a claim someone has ruled on.
 *
 * `member` deliberately carries no permission at all. It is the landing state for anyone
 * who registers, and the point of it is that opening the site to the world does not open
 * the ElevenLabs bill to it -- ../wow-voiceover calls the same role by the same name for
 * the same reason, and calls this app's `editor` a `collaborator`.
 *
 * The split between `editor` and `admin` follows theirs too: regenerating one line spends
 * a known amount and the archive makes it reversible, whereas a pronunciation rule changes
 * the spoken text of every line that contains the word -- and therefore how many lines are
 * stale, and therefore what a regeneration pass costs next.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

const statement = {
  ...defaultStatements,
  voiceline: ["review", "regenerate"],
  // Separate from `voiceline` because pronunciation.json is global: a rule is not one
  // line's problem, and it is the input to the staleness calculation the addon pipeline
  // reads.
  lexicon: ["configure"],
  // Reading what visitors reported, and ruling on it. Separate from `voiceline` because
  // a report is not a verdict: an editor who marks a report "not an issue" has not
  // touched the line, and an editor who flags a line has not answered anybody.
  feedback: ["read", "resolve"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  member: ac.newRole({}),
  editor: ac.newRole({ voiceline: ["review", "regenerate"], feedback: ["read", "resolve"] }),
  // Spreading adminAc keeps the admin plugin's own statements (user: set-role, list, ...).
  // Declaring a custom `admin` role REPLACES the built-in one, so without this the admin
  // loses access to the very page that hands out roles.
  admin: ac.newRole({
    ...adminAc.statements,
    voiceline: ["review", "regenerate"],
    lexicon: ["configure"],
    feedback: ["read", "resolve"],
  }),
};

export const ROLES = ["member", "editor", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The one definition of who may flag lines and write notes. */
export function canReview(role: string | null | undefined): boolean {
  return role === "editor" || role === "admin";
}

/** The one definition of who may spend credits, and who may restore an earlier take. */
export function canRegenerate(role: string | null | undefined): boolean {
  return role === "editor" || role === "admin";
}

/** The one definition of who may read visitor feedback and rule on it. */
export function canTriageFeedback(role: string | null | undefined): boolean {
  return role === "editor" || role === "admin";
}

/** The one definition of who may edit the pronunciation rules. */
export function canConfigure(role: string | null | undefined): boolean {
  return role === "admin";
}

/** The one definition of who may reach /admin. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}
