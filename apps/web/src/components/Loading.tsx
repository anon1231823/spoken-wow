import { Loader2 } from "lucide-react";

/**
 * What an explorer shows until its first page of rows arrives, and what a section's route
 * shows while the server is still rendering it (app/<section>/loading.tsx).
 *
 * One component for all three sections so a slow page looks the same wherever it is slow.
 * Tall enough to hold the space the table will take, so the pagination and the player do
 * not jump up and then back down when the rows land.
 */
export function Loading({ label = "Loading lines…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex min-h-64 items-center justify-center gap-2 text-sm"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** The small spinner beside the count while a new search replaces rows already shown. */
export function Refreshing() {
  return (
    <Loader2
      className="text-muted-foreground size-3.5 animate-spin"
      aria-label="Updating"
    />
  );
}
