"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth-client";
import { BODY_MAX, CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/feedback";
import type { ResultLine } from "@/lib/search";
import { SUPPORT_REASON, SUPPORT_URL } from "@/lib/support";

/**
 * The report form itself: the fields, the POST, and the thank-you that follows it.
 *
 * Lives apart from FeedbackDialog because it has two homes now -- the explorer's modal
 * and the per-line page the addon's Report button sends people to -- and the details
 * that make it work are each easy to leave out of a second copy. The honeypot, the
 * signed-in-identity rule that stops someone typing another person's name, the
 * ⌘/Ctrl+Enter binding, and above all the success state: a reporter cannot read
 * feedback back, so a form that simply cleared itself would leave them with no evidence
 * anything happened and a decent chance of filing the same thing twice.
 *
 * Every field is an INPUT, TEXTAREA or SELECT, which is what keeps the explorer's
 * keyboard shortcuts out of the way -- Explorer's handler ignores keystrokes aimed at
 * one of those.
 */

/**
 * What the form needs to know about a line, and deliberately no more.
 *
 * A Pick rather than the whole ResultLine because the per-line page hands this to the
 * browser: a ResultLine carries `flag`, whose `note` is an editor's private judgement
 * on a take. The explorer's own rows satisfy this shape without changing.
 */
export type FeedbackLine = Pick<ResultLine, "id" | "name" | "zoneName">;

/** A line to report on, or the string 'general' for feedback about ZoneLore itself. */
export type FeedbackTarget = FeedbackLine | "general";

type Props = {
  target: FeedbackTarget;
  /** Rendered at the end of the form row; the dialog puts its Cancel button here. */
  secondaryAction?: React.ReactNode;
  /** Rendered beside Done on the thank-you screen. */
  doneAction?: React.ReactNode;
  /** Fires once the report is accepted, so a container can retitle or close itself. */
  onSent?: () => void;
};

export function FeedbackForm({ target, secondaryAction, doneAction, onSent }: Props) {
  const { data: session } = useSession();

  const general = target === "general";

  const [category, setCategory] = useState<Category>(general ? "other" : "lore");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // The honeypot's own state, so React owns the field and a bot filling it in is still
  // visible to the submit handler.
  const [website, setWebsite] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Every new target starts clean. Reusing the last report's text would be worse than
  // useless: the previous one was submitted, and this is a different line.
  const targetId = general ? "general" : target.id;
  useEffect(() => {
    setCategory(targetId === "general" ? "other" : "lore");
    setBody("");
    setName("");
    setEmail("");
    setWebsite("");
    setError(null);
    setSent(false);
    setPending(false);
  }, [targetId]);

  async function submit() {
    if (pending) return;
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
          lineId: general ? null : target.id,
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
      onSent?.();
    } catch {
      setError("That did not go through. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div>
        <h2 className="font-medium">Thank you!</h2>
        <p className="mt-2 text-muted">
          {general
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
        {doneAction && <div className="mt-4 flex justify-end">{doneAction}</div>}
      </div>
    );
  }

  return (
    <form
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
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
        <p className="mt-2 text-xs text-faint">Filed as {session.user.email}.</p>
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
        {secondaryAction}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
