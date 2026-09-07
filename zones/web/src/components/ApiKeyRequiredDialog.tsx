"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// What a 428 from a paid route looks like on screen.
//
// The refusal has to explain itself, because it is not the one people expect: the
// button was there, the role is right, and the failure is a piece of setup nobody has
// mentioned yet. So it says whose credits are spent and links to the page that fixes
// it, rather than surfacing "428" next to a row.
//
// Patterned on RegenerateDialog: a native <dialog>, opened when there is something to
// say, closed when there is not.

type Props = { message: string | null; onClose: () => void };

export function ApiKeyRequiredDialog({ message, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!message) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [message]);

  if (!message) return null;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[26rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
    >
      <h2 className="mb-1 font-medium">An ElevenLabs key is needed</h2>
      <p className="mb-3 text-muted">{message}</p>
      <p className="mb-4 text-xs text-faint">
        Generating audio spends credits from your own ElevenLabs account, not from the
        site&apos;s. Add a key to your profile and this will work; it is encrypted before it
        is stored, and never shown again.
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
        >
          Close
        </button>
        <Link
          href="/profile"
          className="rounded bg-accent px-3 py-1 font-medium text-bg hover:opacity-90"
        >
          Open profile
        </Link>
      </div>
    </dialog>
  );
}
