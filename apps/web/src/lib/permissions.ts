/**
 * The role model, shared by the server and the browser so the list of roles is defined once.
 *
 * Three roles: a `member` is anyone who registered, a `collaborator` may regenerate audio,
 * and an `admin` may also manage users and voices. Registration assigns `member`; the first
 * `admin` is promoted with SQL (see deploy/README.md), and every promotion after that goes
 * through /admin.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

import { BASE_LANG, CODES, type Lang } from "@/lib/lang";

const statement = {
  ...defaultStatements,
  // `configure` is separate from `regenerate` because the settings are global: changing
  // stability changes every line anyone generates afterwards, whereas a regeneration is one
  // file and is reversible from its history.
  voiceline: ["regenerate", "configure"],
  // Separate from `voiceline` because creating a voice is the heavier act: slots are capped
  // by the ElevenLabs plan (30 on Creator) and a clone spends an account resource that a
  // re-rolled line does not.
  voice: ["manage"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  member: ac.newRole({}),
  collaborator: ac.newRole({ voiceline: ["regenerate"] }),
  // Spreading adminAc keeps the admin plugin's own permissions (user: set-role, list, ...).
  // Declaring a custom `admin` role replaces the built-in one, so without this the admin
  // loses access to the very page that hands out roles.
  admin: ac.newRole({
    ...adminAc.statements,
    voiceline: ["regenerate", "configure"],
    voice: ["manage"],
  }),
};

export const ROLES = ["member", "collaborator", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The one definition of who sees the Regenerate controls. */
export function canRegenerate(role: string | null | undefined): boolean {
  return role === "collaborator" || role === "admin";
}

/** The one definition of who may reach /admin. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

/** The one definition of who may create and replace voices. */
export function canManageVoices(role: string | null | undefined): boolean {
  return role === "admin";
}

/** The one definition of who may change the global generation settings. */
export function canConfigureGeneration(role: string | null | undefined): boolean {
  return role === "admin";
}

//------------------------------------------------------------------------------
// Per language
//------------------------------------------------------------------------------

/**
 * What a grant lets somebody do in one language. See migration 0037 for each.
 *
 * `admin` in a language is every other capability there, plus handing out `edit` and
 * `regenerate` in it -- never `configure`, `ignore` or `admin`, which only a global admin
 * grants, since those decide things for everybody working in the language.
 */
export const CAPABILITIES = ["edit", "regenerate", "configure", "ignore", "admin"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

export type Grant = { lang: string; capability: Capability };

/** Who is asking: their global role, and whatever they hold in particular languages. */
export type Viewer = { role: string | null | undefined; grants: readonly Grant[] };

/**
 * The one definition of whether somebody may do something in a language.
 *
 * A global admin may do anything anywhere. A global collaborator keeps what the role has
 * always meant, which is English: editing its text and regenerating it -- so nobody who held
 * the role before languages existed needs a grant to go on. Everything else comes from a
 * grant for that language, `admin` there standing for all of them.
 */
export function can(viewer: Viewer | null, capability: Capability, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  if (
    lang === BASE_LANG &&
    viewer.role === "collaborator" &&
    (capability === "edit" || capability === "regenerate")
  ) {
    return true;
  }
  return viewer.grants.some(
    (grant) =>
      grant.lang === lang && (grant.capability === capability || grant.capability === "admin"),
  );
}

/**
 * Every language in which somebody may do something: all of them for a global admin, none
 * for somebody signed out.
 */
export function langsWhere(viewer: Viewer | null, capability: Capability): Lang[] {
  return CODES.filter((lang) => can(viewer, capability, lang));
}

/** Whether somebody may hand out `capability` in `lang`. */
export function canGrant(viewer: Viewer | null, capability: Capability, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return (capability === "edit" || capability === "regenerate") && can(viewer, "admin", lang);
}

/** Whether somebody holds anything at all in a language, which lets them see it switched off. */
export function worksIn(viewer: Viewer | null, lang: Lang): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || viewer.grants.some((grant) => grant.lang === lang);
}
