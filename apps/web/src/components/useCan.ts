"use client";

import { useSession } from "@/lib/auth-client";
import { can, type Capability } from "@/lib/permissions";

import { useGrants } from "./GrantsProvider";
import { useLang } from "./LangProvider";

/**
 * What the viewer may do on this page, in its language: the session's role and the grants
 * GrantsProvider fetched. Until the grants arrive the answer is the role's alone, which for
 * everybody but a translator is already the whole answer.
 */
export function useCan(): (capability: Capability) => boolean {
  const lang = useLang();
  const { data: session } = useSession();
  const grants = useGrants();
  const viewer = session ? { role: session.user.role, grants } : null;
  return (capability) => can(viewer, capability, lang);
}
