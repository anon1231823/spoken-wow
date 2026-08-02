"use client";

import { useEffect, useRef, useState } from "react";

import { BETA_BODY, BETA_LABEL, BETA_TITLE } from "@/lib/beta";
import { SUPPORT_REASON, SUPPORT_URL } from "@/lib/support";

/**
 * The "beta" qualifier beside the logo, and the explanation behind it.
 *
 * A button and not a caption, because the word on its own is the kind of hedge that
 * tells a visitor nothing: they are hearing a voice that is going to be replaced, and
 * the badge is the only place on the site that says so. Anybody who wonders what beta
 * means here gets the actual answer in one click.
 *
 * <dialog> + showModal() for FeedbackDialog's reasons -- focus trapping and Escape come
 * with it -- and the same panel styling, so the two modals on the site are recognisably
 * the same object. It carries no form and nothing to lose, so unlike that one it closes
 * on a backdrop click.
 */
export function BetaBadge() {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open) {
      if (!node.open) node.showModal();
    } else if (node.open) {
      node.close();
    }
  }, [open]);

  return (
    <>
      {/* Lowercase and small: it qualifies the logo rather than competing with it. The
          dotted underline is what marks it as answerable -- a bare badge reads as
          decoration, and nobody clicks decoration. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-warn uppercase decoration-dotted underline-offset-2 hover:bg-panel-hover hover:underline"
      >
        {BETA_LABEL}
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the dialog element itself; one on anything
        // inside it does not, which is what separates the two here.
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="fixed top-1/2 left-1/2 w-[34rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
      >
        <h2 className="font-medium">{BETA_TITLE}</h2>
        {BETA_BODY.map((paragraph) => (
          <p key={paragraph} className="mt-2 text-muted">
            {paragraph}
          </p>
        ))}

        {/* The ask belongs here and not only in the feedback dialog's thank-you: the
            paragraph above has just explained that the redesign is waiting on money,
            and sending the reader off to find the Support button in the header would be
            leaving the sentence unfinished. */}
        <div className="mt-4">
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded bg-accent px-3 py-1 font-medium text-bg hover:opacity-90"
          >
            Support the project
          </a>
          <p className="mt-2 text-sm text-muted">{SUPPORT_REASON}</p>
        </div>

        <div className="mt-4 flex justify-end">
          {/* Secondary, matching FeedbackDialog: the one filled control on this screen
              is the ask above. */}
          <button
            type="button"
            autoFocus
            onClick={() => setOpen(false)}
            className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
