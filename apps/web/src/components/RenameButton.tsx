"use client";

import { Languages } from "lucide-react";

/**
 * Naming something in the page's language, beside the name. Small and quiet, since on a
 * translator's screen it sits on every row; stopPropagation because the row toggles on click.
 */
export function RenameButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="text-muted-foreground/50 hover:text-foreground ml-1 inline-flex align-middle"
    >
      <Languages className="size-3" />
    </button>
  );
}
