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
