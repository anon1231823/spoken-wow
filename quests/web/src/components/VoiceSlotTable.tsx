import { Badge } from "@/components/ui/badge";
import type { VoiceSlot } from "@/lib/voices/slots";

type Props = {
  slots: VoiceSlot[];
  /** Voice names present in the account, or null when it could not be read. */
  existing: string[] | null;
};

/**
 * The roster: every voice the corpus needs, and whether it exists yet.
 *
 * Ordered by NPC count rather than alphabetically, because that is the order the voices are
 * worth creating in — narrator-male alone carries a fifth of the NPCs.
 */
export default function VoiceSlotTable({ slots, existing }: Props) {
  const present = existing === null ? null : new Set(existing);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Voice</th>
            <th className="px-3 py-2 text-right font-medium">NPCs</th>
            <th className="px-3 py-2 text-right font-medium">Lines</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.name} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-medium">{slot.name}</td>
              <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                {slot.npcCount.toLocaleString()}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                {slot.lineCount.toLocaleString()}
              </td>
              <td className="px-3 py-2">
                {present === null ? (
                  <span className="text-muted-foreground text-xs">unknown</span>
                ) : present.has(slot.name) ? (
                  <Badge variant="outline" className="text-emerald-400">
                    created
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">not created</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
