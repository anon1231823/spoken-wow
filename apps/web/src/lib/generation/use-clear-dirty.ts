"use client";

/**
 * Clearing pronunciation marks, for all three explorers.
 *
 * The three sections keep their own explorers, rows and filter vocabularies deliberately -
 * they show different corpora and disagree about what a line even is - but this is the same
 * gesture with the same failure mode in all three, and three copies of an optimistic write
 * is three places for the rollback to drift.
 *
 * Optimistic: the mark goes as the button is pressed and comes back if the write is refused,
 * because a control that does nothing visible for a round trip reads as broken. Keyed on the
 * file, which is what the acknowledgement is keyed on - so on the quests side, where 1,076
 * files are spoken by several NPCs, every row sharing a recording clears together.
 */
import { useCallback, useState } from "react";

import { clearDirty } from "./client";

export type DirtyClearing = {
  /** Files cleared since the current results were fetched. */
  cleared: Set<string>;
  clear: (files: string[]) => void;
};

export function useClearDirty(source: "quests" | "zones" | "books"): DirtyClearing {
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  const clear = useCallback(
    (files: string[]) => {
      if (!files.length) return;
      setCleared((current) => new Set([...current, ...files]));
      void clearDirty(source, files).then((ok) => {
        if (ok) return;
        setCleared((current) => {
          const next = new Set(current);
          for (const file of files) next.delete(file);
          return next;
        });
      });
    },
    [source],
  );

  return { cleared, clear };
}
