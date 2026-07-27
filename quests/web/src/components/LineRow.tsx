"use client";

import type { ResultLine } from "@/lib/search";

/** Why a line has no audio, or null when it does. */
function absence(line: ResultLine): { kind: "gap" | "skip"; label: string } | null {
  if (line.hasAudio) return null;
  // An ungeneratable line is an expected absence, not a gap: progress text is never
  // voiced, and text with unresolved $ / <> tokens would be read aloud verbatim.
  if (!line.generatable) {
    return { kind: "skip", label: line.skipReason ?? "not voiced" };
  }
  return { kind: "gap", label: "no audio" };
}

type Props = {
  line: ResultLine;
  current: boolean;
  onPlay: (line: ResultLine) => void;
};

export default function LineRow({ line, current, onPlay }: Props) {
  const missing = absence(line);

  return (
    <button
      className="line"
      data-line-id={line.lineId}
      data-playable={line.hasAudio}
      aria-current={current}
      disabled={!line.hasAudio}
      onClick={() => onPlay(line)}
      title={line.hasAudio ? line.audioPath : undefined}
    >
      <span className="badge" data-source={line.source}>
        {line.source}
      </span>
      <span className={current ? "line-text" : "line-text clamp"}>{line.text}</span>
      {missing && (
        <span className="line-note" data-kind={missing.kind}>
          {missing.label}
        </span>
      )}
    </button>
  );
}
