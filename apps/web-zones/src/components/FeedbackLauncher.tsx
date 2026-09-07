"use client";

import { useState } from "react";

import { FeedbackDialog } from "@/components/FeedbackDialog";

/**
 * The header's "Feedback" button, and the general-feedback dialog behind it.
 *
 * Deliberately NOT part of UserMenu. UserMenu returns null until the session resolves,
 * for the good reason that a "Sign in" link must not flash at somebody who is already
 * signed in -- but this button says the same thing to everybody, and hiding it for the
 * first moments of every page load would make it flicker for no gain.
 *
 * It is also the only route for feedback that is about no particular line: the addon
 * crashed, the site is unusable on a phone, the voice is wrong throughout. Without it
 * that report gets filed against whichever line happened to be on screen.
 */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-muted hover:text-fg">
        Feedback
      </button>
      <FeedbackDialog target={open ? "general" : null} onClose={() => setOpen(false)} />
    </>
  );
}
