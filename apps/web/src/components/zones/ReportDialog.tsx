"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ReportForm from "@/components/ReportForm";

/**
 * Reporting a zone line from the table, without leaving it.
 *
 * The same ReportForm the /zones/r/ landing page shows a player who copied an address out
 * of the game, against the same public endpoint and the same table -- so a report filed
 * here is indistinguishable from one filed from the game, which is what keeps triage one
 * list rather than two.
 *
 * `target` is the file path rather than an addon-built address. The zones report link is
 * already /zones/r/{mapID}/{slug}, which is that path, so a report from either route
 * carries the same string.
 */
export type ReportTarget = { lineId: string; file: string; name: string } | "general";

export default function ZoneReportDialog({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;

  const general = target === "general";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{general ? "Report a problem" : "Report this line"}</DialogTitle>
          <DialogDescription>
            {general
              ? "Something wrong with the addon or the site, rather than one line."
              : `${target.name} (${target.file})`}
          </DialogDescription>
        </DialogHeader>

        <ReportForm
          source="zones"
          target={general ? null : target.file}
          lineId={general ? null : target.lineId}
        />
      </DialogContent>
    </Dialog>
  );
}
