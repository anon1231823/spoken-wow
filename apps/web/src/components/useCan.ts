"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth-client";
import { can, type Capability, type Grant } from "@/lib/permissions";

import { useLang } from "./LangProvider";

/**
 * What the viewer may do on this page, in its language.
 *
 * The role comes with the session; grants are asked for once, and only by somebody signed
 * in, so a visitor costs nothing. Until they arrive the answer is the role's alone, which
 * for everybody but a translator is already the whole answer.
 */
export function useCan(): (capability: Capability) => boolean {
  const lang = useLang();
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const [grants, setGrants] = useState<Grant[]>([]);

  useEffect(() => {
    if (!userId) {
      setGrants([]);
      return;
    }
    let live = true;
    fetch("/api/grants/mine")
      .then((response) => (response.ok ? response.json() : { grants: [] }))
      .then((body: { grants: Grant[] }) => {
        if (live) setGrants(body.grants);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId]);

  const viewer = session ? { role: session.user.role, grants } : null;
  return (capability) => can(viewer, capability, lang);
}
