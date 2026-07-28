"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Sample } from "@/lib/voices/samples";

/**
 * The clips behind one voice.
 *
 * Duration is read from each <audio> element's metadata rather than measured on the server,
 * which keeps ffmpeg and friends out of the deployment. It is the number that matters:
 * ElevenLabs' guidance is that the number of samples is irrelevant and the combined length
 * is what decides clone quality, so that total is the thing this panel exists to show.
 */

const TARGET_MIN_SECONDS = 60;
const TARGET_MAX_SECONDS = 180;

type Props = {
  voice: string;
  samples: Sample[];
  onChange: (samples: Sample[]) => void;
};

export default function VoiceSamples({ voice, samples, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});

  async function upload(files: FileList) {
    setBusy(true);
    setError(null);

    const body = new FormData();
    for (const file of files) body.append("files", file);

    try {
      const response = await fetch(`/api/voices/${voice}/samples`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `upload failed (${response.status})`);
      onChange(payload.samples);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      // Clearing the input is what lets the same file be re-picked after a failure.
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/voices/${voice}/samples/${file}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `delete failed (${response.status})`);
      }
      onChange(samples.filter((sample) => sample.file !== file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // Only clips whose metadata has loaded contribute, so the total is marked approximate
  // until every one has reported.
  const measured = samples.filter((sample) => durations[sample.file] !== undefined);
  const total = measured.reduce((sum, sample) => sum + durations[sample.file], 0);
  const complete = measured.length === samples.length;

  return (
    <div className="bg-muted/30 border-t px-4 py-3">
      {samples.length === 0 ? (
        <p className="text-muted-foreground mb-3 text-sm">
          No clips yet. One to two minutes of clean, single-speaker audio gives the best
          clone; past three minutes makes it worse.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {samples.map((sample) => (
            <li key={sample.file} className="flex items-center gap-3 text-sm">
              <audio
                controls
                preload="metadata"
                src={`/api/voices/${voice}/samples/${sample.file}`}
                onLoadedMetadata={(event) =>
                  setDurations((current) => ({
                    ...current,
                    [sample.file]: event.currentTarget.duration,
                  }))
                }
                className="h-8 max-w-[18rem] flex-1"
              />
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {sample.file.replace(/^[0-9a-f]{8}-/, "")}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {(sample.bytes / 1024 / 1024).toFixed(1)} MiB
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                title={`Delete ${sample.file}`}
                aria-label={`Delete ${sample.file}`}
                onClick={() => remove(sample.file)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp3,.wav,.m4a,.mp4,.ogg,.flac,.webm,audio/*"
          className="hidden"
          onChange={(event) => event.target.files?.length && upload(event.target.files)}
        />
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          Add clips
        </Button>

        {samples.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {samples.length} {samples.length === 1 ? "clip" : "clips"} ·{" "}
            {complete ? "" : "≥ "}
            {formatDuration(total)}
          </span>
        )}

        <DurationHint seconds={total} known={complete && samples.length > 0} />
      </div>

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function DurationHint({ seconds, known }: { seconds: number; known: boolean }) {
  if (!known) return null;
  if (seconds > TARGET_MAX_SECONDS) {
    return (
      <span className="text-xs text-amber-400">
        over three minutes — extra audio tends to make the clone less stable
      </span>
    );
  }
  if (seconds < TARGET_MIN_SECONDS) {
    return <span className="text-muted-foreground text-xs">under a minute — add more</span>;
  }
  return <span className="text-xs text-emerald-400">good length</span>;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
