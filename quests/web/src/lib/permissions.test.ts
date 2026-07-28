import { describe, expect, it } from "vitest";

import { canRegenerate, isAdmin, isRole, ROLES, roles } from "./permissions";

describe("canRegenerate", () => {
  it("admits collaborators and admins", () => {
    expect(canRegenerate("collaborator")).toBe(true);
    expect(canRegenerate("admin")).toBe(true);
  });

  it("refuses members and the signed out", () => {
    expect(canRegenerate("member")).toBe(false);
    expect(canRegenerate(null)).toBe(false);
    expect(canRegenerate(undefined)).toBe(false);
  });

  it("refuses an unknown role rather than defaulting open", () => {
    expect(canRegenerate("moderator")).toBe(false);
  });
});

describe("isAdmin", () => {
  it("admits only the admin role", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("collaborator")).toBe(false);
    expect(isAdmin("member")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts every declared role and nothing else", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

// The access-control grants are what the admin plugin itself enforces, so they have to
// agree with the canRegenerate/isAdmin helpers the UI uses.
describe("access control", () => {
  it("grants voiceline regeneration to exactly collaborator and admin", () => {
    const permission = { voiceline: ["regenerate"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.collaborator.authorize(permission).success).toBe(true);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("keeps user management on admin alone", () => {
    const permission = { user: ["set-role", "list"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.collaborator.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("declares a role object for every name in ROLES", () => {
    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort());
  });
});
