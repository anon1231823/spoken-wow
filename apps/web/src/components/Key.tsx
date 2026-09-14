import type { ReactNode } from "react";

/**
 * One keyboard key, in the shortcut line under either explorer.
 *
 * Shared so the two sections' hint rows are the same row: both pages teach the same
 * gestures - / to search, space to play, j and k to step - and a key drawn two ways reads
 * as two apps.
 */
export default function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="bg-muted rounded border border-b-2 px-1.5 py-px font-mono text-[11px]">
      {children}
    </kbd>
  );
}
