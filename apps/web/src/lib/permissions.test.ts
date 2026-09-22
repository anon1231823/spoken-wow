import { describe, expect, it } from "vitest";

import { CODES } from "./lang";
import {
  can,
  canGrant,
  langsWhere,
  worksIn,
  canConfigureGeneration,
  canManageVoices,
  canRegenerate,
  isAdmin,
  isRole,
  ROLES,
  roles,
  type Grant,
} from "./permissions";

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

describe("canManageVoices", () => {
  it("admits only admins", () => {
    expect(canManageVoices("admin")).toBe(true);
    expect(canManageVoices("collaborator")).toBe(false);
    expect(canManageVoices("member")).toBe(false);
    expect(canManageVoices(null)).toBe(false);
  });

  // Regenerating a line and creating a voice are deliberately different privileges; a
  // collaborator having one must not imply the other.
  it("is stricter than canRegenerate", () => {
    expect(canRegenerate("collaborator")).toBe(true);
    expect(canManageVoices("collaborator")).toBe(false);
  });
});

describe("canConfigureGeneration", () => {
  it("admits only admins", () => {
    expect(canConfigureGeneration("admin")).toBe(true);
    expect(canConfigureGeneration("collaborator")).toBe(false);
    expect(canConfigureGeneration("member")).toBe(false);
    expect(canConfigureGeneration(null)).toBe(false);
  });

  // The settings are global: changing stability changes every line anyone generates
  // afterwards, whereas a regeneration is one file and is reversible from its history.
  it("is stricter than canRegenerate", () => {
    expect(canRegenerate("collaborator")).toBe(true);
    expect(canConfigureGeneration("collaborator")).toBe(false);
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

  it("grants generation configuration to admin alone", () => {
    const permission = { voiceline: ["configure"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.collaborator.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("grants voice management to admin alone", () => {
    const permission = { voice: ["manage"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.collaborator.authorize(permission).success).toBe(false);
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

describe("per-language permissions", () => {
  const member = (grants: Grant[]) => ({ role: "member", grants });

  it("gives a global admin everything, everywhere", () => {
    expect(can({ role: "admin", grants: [] }, "configure", "ptBR")).toBe(true);
  });

  it("keeps a collaborator exactly where the role always was: English text and takes", () => {
    const collaborator = { role: "collaborator", grants: [] };
    expect(can(collaborator, "edit", "enUS")).toBe(true);
    expect(can(collaborator, "regenerate", "enUS")).toBe(true);
    expect(can(collaborator, "configure", "enUS")).toBe(false);
    expect(can(collaborator, "edit", "ptBR")).toBe(false);
  });

  it("lets a translator write their language and nothing else", () => {
    const translator = member([{ lang: "ptBR", capability: "edit" }]);
    expect(can(translator, "edit", "ptBR")).toBe(true);
    expect(can(translator, "regenerate", "ptBR")).toBe(false);
    expect(can(translator, "edit", "enUS")).toBe(false);
    expect(can(translator, "edit", "deDE")).toBe(false);
  });

  it("makes a language's admin everything in it, and a granter of edit and regenerate only", () => {
    const lead = member([{ lang: "ptBR", capability: "admin" }]);
    expect(can(lead, "ignore", "ptBR")).toBe(true);
    expect(canGrant(lead, "edit", "ptBR")).toBe(true);
    expect(canGrant(lead, "regenerate", "ptBR")).toBe(true);
    expect(canGrant(lead, "configure", "ptBR")).toBe(false);
    expect(canGrant(lead, "admin", "ptBR")).toBe(false);
    expect(canGrant(lead, "edit", "deDE")).toBe(false);
  });

  it("lists the languages somebody may act in", () => {
    expect(langsWhere({ role: "admin", grants: [] }, "regenerate")).toHaveLength(CODES.length);
    expect(langsWhere({ role: "collaborator", grants: [] }, "regenerate")).toEqual(["enUS"]);
    expect(langsWhere(member([{ lang: "ptBR", capability: "admin" }]), "regenerate")).toEqual([
      "ptBR",
    ]);
    expect(langsWhere(member([{ lang: "ptBR", capability: "edit" }]), "regenerate")).toEqual([]);
    expect(langsWhere(null, "regenerate")).toEqual([]);
  });

  it("lets somebody working in a language see it before it is switched on", () => {
    expect(worksIn(member([{ lang: "ptBR", capability: "edit" }]), "ptBR")).toBe(true);
    expect(worksIn(member([]), "ptBR")).toBe(false);
  });
});
