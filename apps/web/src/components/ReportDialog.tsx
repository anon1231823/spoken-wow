"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ReportForm from "./ReportForm";
import { targetForLine } from "@/lib/reports/line-target";
import type { ResultLine } from "@/lib/search";

type Props = {
  /** The line being reported, or null when the dialog is closed. */
  line: ResultLine | null;
  onClose: () => void;
};

/**
 * Reporting a line from the table, without leaving it.
 *
 * The same ReportForm the /r/ landing page shows a player who copied an address out of the
 * game, against the same address format and the same public endpoint - so a report filed here
 * is indistinguishable from one filed from the game, which is what keeps triage one list
 * rather than two.
 *
 * It carries the lineId as well as the address, which the game cannot always do: an NPC
 * address names every line that speaker has, and a reporter coming from the game picks one by
 * hand. Here the row already knows which line it is.
 */
export default function ReportDialog({ line, onClose }: Props) {
  const target = line ? targetForLine(line) : null;

  // No address means no report: a line the addressing scheme cannot name would arrive in
  // triage as a row nobody can resolve. LineRow hides the button in the same case, so this is
  // the second half of one decision rather than a case anyone should reach.
  if (!line || !target) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Report this line</DialogTitle>
          <DialogDescription>
            {line.npcName}
            {line.questTitle ? ` — ${line.questTitle}` : ""} ({target})
          </DialogDescription>
        </DialogHeader>

        <ReportForm source="quests" target={target} lineId={line.lineId} />
      </DialogContent>
    </Dialog>
  );
}
