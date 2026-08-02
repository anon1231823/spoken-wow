"use client";

import { useEffect, useRef } from "react";

import type { Quote } from "@/lib/regenerate";

// The gate between a click and a bill.
//
// ../wow-voiceover puts it exactly here and says why: "A single line goes straight
// through -- it is one click, it is cheap, and history makes it reversible. A quest or
// an NPC can be a hundred lines, so it stops here." The same split applies, with
// zones in place of quests: re-cutting Ashenvale is 60 lines and about 25,000 credits.

type Props = {
  pending: { label: string; quote: Quote } | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RegenerateDialog({ pending, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!pending) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [pending]);

  if (!pending) return null;

  const { quote } = pending;

  return (
    <dialog
      ref={dialog}
      onClose={onCancel}
      className="fixed top-1/2 left-1/2 w-[26rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
    >
      <h2 className="mb-1 font-medium">Regenerate {pending.label}?</h2>
      <p className="mb-3 text-xs text-faint">
        This spends ElevenLabs credits. The takes being replaced are archived and can be
        restored for free.
      </p>

      <dl className="mb-4 grid grid-cols-2 gap-y-1">
        <dt className="text-muted">Lines</dt>
        <dd className="text-right">{quote.lines.toLocaleString()}</dd>
        <dt className="text-muted">Characters</dt>
        <dd className="text-right">{quote.characters.toLocaleString()}</dd>
        <dt className="text-muted">Estimated cost</dt>
        <dd className="text-right font-medium">
          {quote.credits === null ? "unknown" : `~${quote.credits.toLocaleString()} credits`}
        </dd>
      </dl>

      <p className="mb-4 text-xs text-faint">
        {quote.measuredFrom > 0 ? (
          <>
            At {quote.rate?.toFixed(3)} credits/character, measured over{" "}
            {quote.measuredFrom.toLocaleString()} generated lines.
          </>
        ) : (
          <>Rate not yet measured — this estimate comes from config.json.</>
        )}
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-warn px-3 py-1 font-medium text-bg hover:opacity-90"
        >
          Spend credits
        </button>
      </div>
    </dialog>
  );
}
