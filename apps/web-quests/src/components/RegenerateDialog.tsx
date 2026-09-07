"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Estimate } from "@/lib/generation/billing";
import type { GenerationStatusResponse } from "@/lib/generation/client";

function n(value: number): string {
  return value.toLocaleString();
}

type Props = {
  /** The batch awaiting confirmation, or null when nothing is pending. */
  pending: { label: string; estimate: Estimate } | null;
  status: GenerationStatusResponse | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The only thing standing between one click and a large share of a month's budget.
 *
 * A single line goes straight through - it is one click, it is cheap, and history makes it
 * reversible. A quest or an NPC can be a hundred lines, so it stops here and says what that
 * will cost against what is left.
 */
export default function RegenerateDialog({ pending, status, onConfirm, onCancel }: Props) {
  if (!pending) return null;

  const { estimate, label } = pending;
  const subscription = status?.subscription ?? null;
  const remaining = subscription ? subscription.characterLimit - subscription.characterCount : null;
  const overBudget = remaining !== null && estimate.credits > remaining;

  // Zero samples means nothing has been generated with this model yet, so the estimate is
  // using the list rate - an upper bound rather than a measurement. Saying so matters,
  // because the real figure is typically about half of it.
  const uncalibrated = estimate.rate.samples === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate {label}?</DialogTitle>
          <DialogDescription>
            This replaces audio that already exists. Every take is kept, so it can be undone
            line by line.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Lines</dt>
          <dd className="text-right font-mono">{n(estimate.lines)}</dd>

          <dt className="text-muted-foreground">Audio files</dt>
          <dd className="text-right font-mono">{n(estimate.files)}</dd>

          <dt className="text-muted-foreground">Characters</dt>
          <dd className="text-right font-mono">{n(estimate.characters)}</dd>

          <dt className="text-muted-foreground">Estimated cost</dt>
          <dd className="text-right font-mono">
            {uncalibrated ? `up to ${n(estimate.credits)}` : `~${n(estimate.credits)}`} credits
          </dd>

          {remaining !== null && (
            <>
              <dt className="text-muted-foreground">Remaining</dt>
              <dd
                className={`text-right font-mono ${overBudget ? "text-destructive" : ""}`}
              >
                {n(remaining)} credits
              </dd>
            </>
          )}
        </dl>

        {/* Files, not lines: 1,076 files in the corpus are spoken by more than one NPC, and
            each is generated once however many lines point at it. */}
        {estimate.files < estimate.lines && (
          <p className="text-muted-foreground text-xs">
            {n(estimate.lines - estimate.files)} of these lines share audio with another, so
            fewer files are generated than there are lines.
          </p>
        )}

        {uncalibrated ? (
          <p className="text-muted-foreground text-xs">
            Nothing has been generated with {estimate.rate.modelId ?? "this model"} yet, so
            this is the list rate — an upper bound. ElevenLabs bills a rate set by your plan,
            and the exact figure is reported after each line.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Calibrated from the last {estimate.rate.samples}{" "}
            {estimate.rate.samples === 1 ? "take" : "takes"} on this account at{" "}
            {estimate.rate.rate.toFixed(3)} credits per character. The exact cost is reported
            as it runs.
          </p>
        )}

        {overBudget && (
          <p role="alert" className="text-destructive text-xs">
            This is more than the plan has left. It will run until the credits are gone and
            then stop, keeping whatever it finished.
          </p>
        )}

        {subscription?.resetAt && (
          <p className="text-muted-foreground text-xs">
            Balance resets {new Date(subscription.resetAt).toLocaleDateString()}.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Regenerate {n(estimate.files)} {estimate.files === 1 ? "file" : "files"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
