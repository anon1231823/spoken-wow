"use client";

import { AlertTriangle, Check, MessageSquare, RotateCw } from "lucide-react";

import type { ResultLine } from "@/lib/search";
import { cn } from "@/lib/utils";

type Props = {
  line: ResultLine;
  current: boolean;
  onPlay: (line: ResultLine) => void;
  onNarrowToZone: (line: ResultLine) => void;
  onFlag: (line: ResultLine, status: "bad" | "ok" | null) => void;
  onNote: (line: ResultLine) => void;
};

// The colour discipline is ../wow-voiceover's IssueChip: severity decides whether to
// look, and the label decides where to go next. Red is only ever a real problem.
const STATE_STYLE = {
  missing: "text-bad",
  stale: "text-warn",
  current: "text-faint",
} as const;

const STATE_LABEL = {
  missing: "no audio",
  stale: "text changed",
  current: "",
} as const;

export function LineRow({ line, current, onPlay, onNarrowToZone, onFlag, onNote }: Props) {
  const playable = line.state !== "missing";
  const status = line.flag?.status ?? null;

  return (
    <tr
      className={cn(
        "border-b border-border align-top",
        current && "bg-panel",
        playable && !current && "hover:bg-panel/60",
      )}
    >
      {/* Narrowing is a sibling of the play button below, never nested inside it: a
          <button> within a <button> is invalid HTML and the inner click never fires. */}
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={() => onNarrowToZone(line)}
          className="text-left hover:text-accent hover:underline"
          title={`Show only ${line.zoneName}`}
        >
          {line.zoneName}
        </button>
      </td>

      <td className="px-2 py-1.5">
        {line.kind === "zone" ? (
          <span className="text-faint italic">zone line</span>
        ) : (
          <span>{line.name}</span>
        )}
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {/* Clicking the verdict you already hold clears it, so a mis-tap is undone
              where it was made rather than through a separate control. */}
          <button
            type="button"
            aria-pressed={status === "bad"}
            onClick={() => onFlag(line, status === "bad" ? null : "bad")}
            title={line.flag?.note ?? (status === "bad" ? "Clear (u)" : "Flag as bad (f)")}
            className={cn(
              "flex items-center gap-0.5 rounded px-1 text-xs",
              status === "bad" ? "bg-bad/15 text-bad" : "text-faint/40 hover:text-bad",
            )}
          >
            <AlertTriangle size={11} />
            {status === "bad" && "bad"}
          </button>

          <button
            type="button"
            aria-pressed={status === "ok"}
            onClick={() => onFlag(line, status === "ok" ? null : "ok")}
            title={status === "ok" ? "Clear (u)" : "Reviewed, sounds fine (g)"}
            className={cn(
              "flex items-center gap-0.5 rounded px-1 text-xs",
              status === "ok" ? "text-good" : "text-faint/40 hover:text-good",
            )}
          >
            <Check size={11} />
            {status === "ok" && "ok"}
          </button>

          <button
            type="button"
            onClick={() => onNote(line)}
            title={line.flag?.note ? line.flag.note : "Add a note (n)"}
            className={cn(
              "rounded px-0.5 text-xs",
              line.flag?.note ? "text-accent" : "text-faint/40 hover:text-fg",
            )}
          >
            <MessageSquare size={11} />
          </button>

          {STATE_LABEL[line.state] && (
            <span className={cn("text-xs", STATE_STYLE[line.state])}>{STATE_LABEL[line.state]}</span>
          )}
          {line.take && line.take.takes > 1 && (
            <span
              className="flex items-center gap-0.5 text-xs text-faint"
              title={`${line.take.takes} takes; v${line.take.version} is live`}
            >
              <RotateCw size={10} /> v{line.take.version}
            </span>
          )}
        </div>
      </td>

      {/* The only click-to-play cell. data-line-key is what the keyboard handler
          scrolls into view. */}
      <td className="p-0">
        <button
          type="button"
          data-line-key={line.id}
          aria-current={current}
          disabled={!playable}
          onClick={() => onPlay(line)}
          className={cn(
            "w-full px-2 py-1.5 text-left disabled:cursor-default",
            !playable && "opacity-50",
          )}
          title={playable ? `${line.file}.mp3` : "No audio yet"}
        >
          <span className={cn("block whitespace-pre-wrap", !current && "clamp-2")}>{line.text}</span>
        </button>
      </td>

      <td className="px-2 py-1.5 text-right whitespace-nowrap font-mono text-xs text-muted">
        {line.chars}
        {line.short && (
          <span className="ml-1 text-warn" title="Under 250 characters, where v3 is least reliable">
            !
          </span>
        )}
      </td>
    </tr>
  );
}
