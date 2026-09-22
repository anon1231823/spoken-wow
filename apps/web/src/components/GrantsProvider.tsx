"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { useSession } from "@/lib/auth-client";
import type { Grant } from "@/lib/permissions";

/**
 * What the signed-in person holds in each language, asked for once per page.
 *
 * The header's menu and the explorer below it both need it, and each asking on its own was
 * the same request twice on every page a translator opened. Empty for a visitor, who costs
 * no request at all. The server checks again on every write: this only decides what to draw.
 */
const GrantsContext = createContext<readonly Grant[]>([]);

export function GrantsProvider({ children }: { children: React.ReactNode }) {
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

  return <GrantsContext.Provider value={grants}>{children}</GrantsContext.Provider>;
}

export function useGrants(): readonly Grant[] {
  return useContext(GrantsContext);
}
