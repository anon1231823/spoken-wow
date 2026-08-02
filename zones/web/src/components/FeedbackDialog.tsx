"use client";

import { useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth-client";
import { BODY_MAX, CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/feedback";
import type { ResultLine } from "@/lib/search";
import { SUPPORT_REASON, SUPPORT_URL } from "@/lib/support";

/**
 * The one form anyone can submit, signed in or not.
 *
 * Built on <dialog> + showModal() for NoteDialog's reasons: it traps focus and takes
 * Escape for free. It is also what keeps the explorer's keyboard shortcuts out of the
 * way -- Explorer's handler ignores keystrokes aimed at an INPUT, TEXTAREA or SELECT,
 * and every field here is one of those.
 *
 * The success state matters more than it looks. A reporter cannot read feedback back,
 * so a dialog that simply vanished would leave them with no evidence anything happened
 * and a decent chance of submitting the same thing again.
 */

/** A line to report on, or the string 'general' for feedback about ZoneLore itself. */
export type FeedbackTarget = ResultLine | "general";

type Props = {
  target: FeedbackTarget | null;
  onClose: () => void;
};

export function FeedbackDialog({ target, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const { data: session } = useSession();

  const [category, setCategory] = useState<Category>("lore");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // The honeypot's own state, so React owns the field and a bot filling it in is still
  // visible to the submit handler.
  const [website, setWebsite] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!target) {
      dialog.current?.close();
      return;
    }
    // Every open starts clean. Reusing the last report's text would be worse than
    // useless: the previous one was submitted, and this is a different line.
    setCategory(target === "general" ? "other" : "lore");
    setBody("");
    setName("");
    setEmail("");
    setWebsite("");
    setError(null);
    setSent(false);
    setPending(false);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [target]);

  if (!target) return null;

  const general = target === "general";

  async function submit() {
    if (pending || !target) return;
    const text = body.trim();
    if (text === "") {
      setError("Say what is wrong with it.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: target === "general" ? null : target.id,
          category,
          body: text,
          name,
          email,
          website,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That did not go through. Try again in a moment.");
        return;
      }
      setSent(true);
    } catch {
      setError("That did not go through. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[34rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
    >
      {sent ? (
        <div>
          <h2 className="font-medium">Thank you!</h2>
          <p className="mt-2 text-muted">
            {target === "general"
              ? "Your feedback is with the editors."
              : `Your report on ${target.name} is with the editors.`}{" "}
            There is no reply address on this, so you will not hear back unless you left
            one.
          </p>
          {/* The one moment somebody has demonstrably given us their attention on
              purpose, which is why the ask lives here and not on every page. It sits
              below the confirmation and does not replace the Done button: a thank-you
              that turns out to be a donation prompt teaches people not to send the next
              report.

              Button first, reason second, and no panel around either. The ask is one
              action, so it is one control -- burying it in a sentence makes the reader
              hunt for the clickable words -- and the explanation is for the people who
              want to know why before they press it, which is a thing you read second. */}
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
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="font-medium">
            {target === "general" ? "Feedback on ZoneLore" : target.name}
          </h2>
          <p className="mb-3 text-xs text-faint">
            {target === "general" ? "Anything about the addon or this site." : target.zoneName}
          </p>

          <label className="block">
            <span className="text-xs text-faint">What is the problem?</span>
            <select
              autoFocus
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
              className="mt-1 block w-full"
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABEL[value]}
                </option>
              ))}
            </select>
          </label>

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              general
                ? "What happened, and what did you expect instead?"
                : "What is wrong with it? Quoting the sentence helps."
            }
            rows={5}
            maxLength={BODY_MAX}
            className="mt-3 w-full rounded border border-border bg-bg p-2"
            onKeyDown={(event) => {
              // Enter inserts a newline -- a report is prose. ⌘/Ctrl+Enter sends, which
              // is what NoteDialog does and what everything else here does.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />

          {/* Signed in, so the account is the identity and there is nothing to ask. */}
          {session ? (
            <p className="mt-2 text-xs text-faint">
              Filed as {session.user.email}.
            </p>
          ) : (
            <>
              <p className="mt-3 text-xs text-faint">
                Both optional. Leave them blank to report anonymously.
              </p>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name"
                  autoComplete="name"
                  className="min-w-0 flex-1"
                />
                <input
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className="min-w-0 flex-1"
                />
              </div>
            </>
          )}

          {/* The honeypot. sr-only rather than display:none or hidden: a bot that fills
              forms skips fields it can tell are unrenderable, and the point is that it
              cannot tell. Nothing a person can reach with the keyboard or a screen
              reader -- tabIndex -1 and aria-hidden -- so nobody fills it by accident. */}
          <input
            type="text"
            name="website"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            className="sr-only"
          />

          {error && (
            <p role="alert" className="mt-2 text-bad">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-faint">⌘↵ to send</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
