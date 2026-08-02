"use client";

import { AlertTriangle, Check, RotateCw } from "lucide-react";

import type { ResultLine } from "@/lib/search";
import { cn } from "@/lib/utils";

type Props = {
  line: ResultLine;
  current: boolean;
  onPlay: (line: ResultLine) => void;
  onNarrowToZone: (line: ResultLine) => void;
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

export function LineRow({ line, current, onPlay, onNarrowToZone }: Props) {
  const playable = line.state !== "missing";

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
          {line.flag?.status === "bad" && (
            <span
              className="flex items-center gap-0.5 rounded bg-bad/15 px-1 text-xs text-bad"
              title={line.flag.note ?? "Flagged bad"}
            >
              <AlertTriangle size={11} /> bad
            </span>
          )}
          {line.flag?.status === "ok" && (
            <span className="flex items-center gap-0.5 text-xs text-good" title="Reviewed, sounds fine">
              <Check size={11} /> ok
            </span>
          )}
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
