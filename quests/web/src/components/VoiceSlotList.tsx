"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import VoiceSamples from "./VoiceSamples";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Sample } from "@/lib/voices/samples";
import type { VoiceSlot } from "@/lib/voices/slots";

/**
 * The roster: every voice the corpus needs, and the clips gathered for each.
 *
 * Ordered by NPC count rather than alphabetically, because that is the order the voices are
 * worth creating in - narrator-male alone carries a fifth of the NPCs. One row expands at a
 * time: the clips carry <audio> elements, and twenty slots' worth open at once would be
 * both unreadable and a lot of metadata requests.
 */

type Props = {
  slots: VoiceSlot[];
  /** Voice names present in the ElevenLabs account, or null when it could not be read. */
  existing: string[] | null;
  initialSamples: Record<string, Sample[]>;
};

export default function VoiceSlotList({ slots, existing, initialSamples }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [samples, setSamples] = useState(initialSamples);
  // Held as state so a slot flips to "created" without a reload; the server value is the
  // account, read fresh on every page view.
  const [present, setPresent] = useState(existing === null ? null : new Set(existing));

  return (
    <div className="divide-y overflow-hidden rounded-md border">
      {slots.map((slot) => {
        const clips = samples[slot.name] ?? [];
        const expanded = open === slot.name;

        return (
          <div key={slot.name}>
            <button
              onClick={() => setOpen(expanded ? null : slot.name)}
              aria-expanded={expanded}
              className={cn(
                "hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                expanded && "bg-muted/50",
              )}
            >
              {expanded ? (
                <ChevronDown className="size-4 shrink-0" />
              ) : (
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 font-medium">{slot.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {slot.npcCount.toLocaleString()} NPCs · {slot.lineCount.toLocaleString()} lines
              </span>
              {clips.length > 0 && (
                <Badge variant="outline" className="shrink-0">
                  {clips.length} {clips.length === 1 ? "clip" : "clips"}
                </Badge>
              )}
              <span className="w-24 shrink-0 text-right">
                {present === null ? (
                  <span className="text-muted-foreground text-xs">unknown</span>
                ) : present.has(slot.name) ? (
                  <Badge variant="outline" className="text-emerald-400">
                    created
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">not created</span>
                )}
              </span>
            </button>

            {expanded && (
              <VoiceSamples
                voice={slot.name}
                samples={clips}
                exists={present?.has(slot.name) ?? false}
                onChange={(next) => setSamples((current) => ({ ...current, [slot.name]: next }))}
                onCloned={() =>
                  setPresent((current) => new Set(current ?? []).add(slot.name))
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
