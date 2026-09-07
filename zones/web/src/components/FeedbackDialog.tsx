"use client";

import { useEffect, useRef, useState } from "react";

import { FeedbackForm, type FeedbackTarget } from "@/components/FeedbackForm";

/**
 * The explorer's report form, as a modal.
 *
 * Everything about the report itself lives in FeedbackForm, which the per-line page at
 * /r/... renders directly. What is left here is the modal: <dialog> + showModal(), for
 * NoteDialog's reasons -- it traps focus and takes Escape for free.
 */

export type { FeedbackTarget };

type Props = {
  target: FeedbackTarget | null;
  onClose: () => void;
};

export function FeedbackDialog({ target, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  // Only so the line's name can step aside for the form's "Thank you!". A page can
  // carry both headings; a dialog this small cannot.
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!target) {
      dialog.current?.close();
      return;
    }
    setSent(false);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [target]);

  if (!target) return null;

  const general = target === "general";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[34rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
    >
      {!sent && (
        <>
          <h2 className="font-medium">{general ? "Feedback on ZoneLore" : target.name}</h2>
          <p className="mb-3 text-xs text-faint">
            {general ? "Anything about the addon or this site." : target.zoneName}
          </p>
        </>
      )}

      <FeedbackForm
        target={target}
        onSent={() => setSent(true)}
        secondaryAction={
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
          >
            Cancel
          </button>
        }
        doneAction={
          // Secondary, matching the form's Cancel: there is one accent control on this
          // screen and it is the support ask above. Two filled buttons in a dialog this
          // small give the eye no way to tell which one is the point.
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
          >
            Done
          </button>
        }
      />
    </dialog>
  );
}
