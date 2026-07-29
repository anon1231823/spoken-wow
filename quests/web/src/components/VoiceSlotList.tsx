"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import VoiceSamples from "./VoiceSamples";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Sample } from "@/lib/voices/samples";
import type { VoiceSlot } from "@/lib/voices/slots";

/**
 * The roster: every voice the corpus needs, and the clips gathered for each.
 *
 * Ordered by name (see slots.ts): with a voice per race, gender and flavor the list is long
 * enough that finding one row matters more than knowing which to create first. One row
 * expands at a time: the clips carry <audio> elements, and fifty slots' worth open at once
 * would be both unreadable and a lot of metadata requests.
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
  const [sweep, setSweep] = useState<{
    done: number;
    total: number;
    failed: string[];
  } | null>(null);
  const [confirmingSweep, setConfirmingSweep] = useState(false);

  // Only flavored voices have game clips - see hasGameClips in VoiceSamples.
  const seedable = slots.filter((slot) => slot.name.split("-").length === 3);

  // Voices that do not exist in the account yet. Empty while the account could not be read,
  // because "missing" would then mean "unknown" and the button would offer to rebuild
  // everything under a name that promises not to.
  const missing = present === null ? [] : seedable.filter((slot) => !present.has(slot.name));

  /**
   * Seed and clone a list of voices from the game's clips.
   *
   * Sequential rather than parallel: each iteration is an ffmpeg merge and an ElevenLabs
   * voice creation, and fifty of those at once is neither kind to the rate limit nor
   * something whose failures could be reported one at a time. A failure is recorded and the
   * sweep continues, so one bad voice does not cost the other forty-nine.
   */
  async function seed(targets: VoiceSlot[]) {
    setConfirmingSweep(false);
    setSweep({ done: 0, total: targets.length, failed: [] });

    for (const [index, slot] of targets.entries()) {
      try {
        const json = { "Content-Type": "application/json" };
        const imported = await fetch(`/api/voices/${slot.name}/samples/import`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ replace: true }),
        });
        if (!imported.ok) throw new Error(String(imported.status));

        const cloned = await fetch(`/api/voices/${slot.name}/clone`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ replace: true }),
        });
        if (!cloned.ok) throw new Error(String(cloned.status));

        const payload = await imported.json();
        setSamples((current) => ({ ...current, [slot.name]: payload.samples }));
        setPresent((current) => new Set(current ?? []).add(slot.name));
      } catch {
        setSweep((current) => current && { ...current, failed: [...current.failed, slot.name] });
      }
      setSweep((current) => current && { ...current, done: index + 1 });
    }
  }

  const sweeping = sweep !== null && sweep.done < sweep.total;

  return (
    <>
      {seedable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button
            size="xs"
            variant={confirmingSweep ? "destructive" : "outline"}
            disabled={sweeping}
            onClick={() => (confirmingSweep ? seed(seedable) : setConfirmingSweep(true))}
          >
            {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {confirmingSweep ? "Confirm — rebuild all" : "Seed all from clips"}
          </Button>

          {/* No confirmation: this only fills gaps, so nothing that exists is destroyed. */}
          {missing.length > 0 && !confirmingSweep && (
            <Button size="xs" variant="outline" disabled={sweeping} onClick={() => seed(missing)}>
              {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Seed remaining from clips ({missing.length})
            </Button>
          )}

          {confirmingSweep && (
            <>
              <span className="text-xs text-amber-400">
                This replaces the clips and the ElevenLabs voice for all {seedable.length} flavored
                voices. Existing voices are deleted and re-created, so they will not sound the same
                afterwards.
              </span>
              <Button variant="ghost" size="xs" onClick={() => setConfirmingSweep(false)}>
                Cancel
              </Button>
            </>
          )}

          {sweep && !confirmingSweep && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {sweep.done} / {sweep.total}
              {sweep.failed.length > 0 && (
                <span className="text-destructive"> · failed: {sweep.failed.join(", ")}</span>
              )}
            </span>
          )}
        </div>
      )}

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
                  onCloned={() => setPresent((current) => new Set(current ?? []).add(slot.name))}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
