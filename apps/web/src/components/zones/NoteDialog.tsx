"use client";

import { useEffect, useRef, useState } from "react";

import type { ResultLine } from "@/lib/zones/search";

// Why a line is bad, in words. "3 lines flagged" is not actionable; "swallows the
// second half of Kalimdor" tells you whether the fix is a pronunciation rule, a
// re-roll, or the text itself. ../wow-voiceover makes the same argument about listing
// failures rather than counting them.

type Props = {
  line: ResultLine | null;
  onClose: () => void;
  onSave: (line: ResultLine, note: string) => void;
};

export function NoteDialog({ line, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!line) {
      dialog.current?.close();
      return;
    }
    setText(line.flag?.note ?? "");
    // showModal, not open: it traps focus and takes Escape for free, which is the
    // whole reason this is a <dialog> and not a positioned div.
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [line]);

  if (!line) return null;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[32rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-muted p-4 text-foreground backdrop:bg-black/60"
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(line, text.trim());
        }}
      >
        <h2 className="font-medium">{line.name}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{line.zoneName}</p>

        <textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What is wrong with it?"
          rows={4}
          className="w-full rounded border border-border bg-background p-2"
          onKeyDown={(event) => {
            // Enter alone inserts a newline; the note is prose and often more than one
            // sentence. Cmd/Ctrl+Enter saves, which is the convention everywhere else.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave(line, text.trim());
            }
          }}
        />

        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">⌘↵ to save</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 hover:bg-accent"
          >
            Cancel
          </button>
          <button type="submit" className="rounded bg-primary px-3 py-1 text-primary-foreground hover:opacity-90">
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
