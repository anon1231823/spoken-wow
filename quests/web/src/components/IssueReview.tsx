"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster, useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  categoryLabel,
  ISSUE_GROUPS,
  ISSUE_GROUP_LABELS,
  SEVERITY_LABELS,
  VERDICT_LABELS,
  VERDICTS,
  type Issue,
  type Severity,
  type Verdict,
} from "@/lib/issues/issues";

/** The value a dropdown carries when it is not filtering. See SearchBar's note. */
const ANY = "any";

const TONES: Record<Severity, string> = {
  1: "bg-destructive/10 text-destructive",
  2: "bg-amber-500/10 text-amber-300",
  3: "bg-muted text-muted-foreground",
};

/**
 * Where this finding is, in the explorer.
 *
 * The explorer's URL is its own source of truth for a search, so this is a working deep link
 * rather than a page that arrives blank - the same trick LexiconEditor's explorerHref plays.
 *
 * By id, not by searching for the word. A text search cannot express what this link means: the
 * bare `--` finding and `Hearthglen--you'll` are two findings whose text both contains `--`,
 * `yer` as a substring also finds "player", and a bug-degenerate-line has nothing quotable in
 * it at all - its line's entire text is the letter x. The finding knows its own lines.
 */
function explorerHref(issue: Issue): string {
  return `/?${new URLSearchParams({ finding: String(issue.id) })}`;
}

/** The lexicon editor, with this name already filled in. */
function lexiconHref(issue: Issue): string {
  return `/lexicon?${new URLSearchParams({ grapheme: issue.item })}`;
}

type Props = {
  initial: Issue[];
  lexiconSize: number;
};

export default function IssueReview({ initial, lexiconSize }: Props) {
  return (
    <Toaster>
      <Review initial={initial} lexiconSize={lexiconSize} />
    </Toaster>
  );
}

function Review({ initial, lexiconSize }: Props) {
  const [issues, setIssues] = useState(initial);
  const [group, setGroup] = useState<string | undefined>();
  const [severity, setSeverity] = useState<string | undefined>();
  const [verdict, setVerdict] = useState<string | undefined>("open");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (group) params.set("group", group);
    if (severity) params.set("severity", severity);
    if (verdict) params.set("verdict", verdict);
    if (query.trim()) params.set("q", query.trim());

    const response = await fetch(`/api/issues?${params}`);
    if (!response.ok) {
      setError(`could not load the issues (${response.status})`);
      return;
    }
    setIssues(((await response.json()) as { issues: Issue[] }).issues);
    setError(null);
  }, [group, severity, verdict, query]);

  // Debounced, because the query box types into it. The other three settle immediately, and
  // paying 250ms for them would be a lag nobody asked for.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function decide(issue: Issue, next: Verdict) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: next }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; issue?: Issue };
      if (!response.ok || !body.issue) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      // Dropped from the list when it no longer matches the filter, patched when it does, so
      // the row does not sit there contradicting the verdict just recorded on it.
      const updated = body.issue;
      setIssues((current) =>
        verdict && updated.verdict !== verdict
          ? current.filter((i) => i.id !== updated.id)
          : current.map((i) => (i.id === updated.id ? updated : i)),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/issues/reload", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        loaded?: number;
        coveredByLexicon?: number;
        undetected?: number;
        lineLinks?: number;
      };
      if (!response.ok) {
        setError(body.error ?? `reload failed (${response.status})`);
        return;
      }
      toast({
        tone: "info",
        title: `${body.loaded?.toLocaleString()} findings over ${body.lineLinks?.toLocaleString()} lines`,
        detail:
          `${body.coveredByLexicon?.toLocaleString()} answered by the lexicon` +
          (body.undetected ? `, ${body.undetected.toLocaleString()} no longer detected` : ""),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const worst = issues.filter((i) => i.severity === 1).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by the word or the note"
          className="max-w-xs"
          aria-label="Filter issues"
        />

        <Select
          value={group ?? ANY}
          onValueChange={(value) => setGroup(value === ANY ? undefined : value)}
        >
          <SelectTrigger className="w-40" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>kind: any</SelectItem>
            {ISSUE_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {ISSUE_GROUP_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={severity ?? ANY}
          onValueChange={(value) => setSeverity(value === ANY ? undefined : value)}
        >
          <SelectTrigger className="w-40" aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>severity: any</SelectItem>
            <SelectItem value="1">{SEVERITY_LABELS[1]}</SelectItem>
            <SelectItem value="2">{SEVERITY_LABELS[2]}</SelectItem>
            <SelectItem value="3">{SEVERITY_LABELS[3]}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={verdict ?? ANY}
          onValueChange={(value) => setVerdict(value === ANY ? undefined : value)}
        >
          <SelectTrigger className="w-40" aria-label="Verdict">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>verdict: any</SelectItem>
            {VERDICTS.map((v) => (
              <SelectItem key={v} value={v}>
                {VERDICT_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reload()}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Reload scan
        </Button>

        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {issues.length.toLocaleString()} shown
          {worst > 0 && ` · ${worst.toLocaleString()} will break`}
        </span>
      </div>

      {error && (
        <p role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </p>
      )}

      {issues.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nothing here. If this is the first time, press <strong>Reload scan</strong> to read
          what <code>tools/scan_corpus_hiccups.py</code> found.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {issues.map((issue) => (
            <Row
              key={issue.id}
              issue={issue}
              busy={busy}
              onDecide={(next) => void decide(issue, next)}
            />
          ))}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        The lexicon holds {lexiconSize.toLocaleString()} pronunciations. A name it covers stops
        being a finding at the next reload — nothing here needs dismissing for that.
      </p>
    </div>
  );
}

function Row({
  issue,
  busy,
  onDecide,
}: {
  issue: Issue;
  busy: boolean;
  onDecide: (verdict: Verdict) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <Badge className={cn("shrink-0 px-1.5", TONES[issue.severity])} title={SEVERITY_LABELS[issue.severity]}>
        {issue.severity}
      </Badge>

      <span className="w-48 shrink-0 truncate font-medium" title={issue.item}>
        {issue.item}
      </span>

      <span className="text-muted-foreground w-44 shrink-0 truncate text-xs" title={issue.category}>
        {categoryLabel(issue.category)}
      </span>

      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={issue.note}>
        {issue.note}
        {issue.variants && issue.variants !== issue.item && ` · spelled ${issue.variants}`}
      </span>

      {/* Distinct lines, which the explorer will often show more rows than: a gossip line is
          one line said by however many NPCs of that race and gender, and the explorer lists a
          row per speaker. Both numbers are right; only their agreeing would be surprising. */}
      <span
        className="text-muted-foreground w-28 shrink-0 text-right text-xs tabular-nums"
        title="Distinct lines. The explorer lists one row per NPC who says them, so it can show more."
      >
        {issue.lineCount.toLocaleString()} {issue.lineCount === 1 ? "line" : "lines"}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" asChild title="Show these lines in the explorer">
          {/* New tab, deliberately: this page holds filters someone is working through, and
              navigating away from it loses their place. */}
          <a href={explorerHref(issue)} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Lines
          </a>
        </Button>

        {/* Only a name can be answered by a pronunciation rule. Offering it for `--` would be
            offering a fix that cannot work. */}
        {issue.grapheme && (
          <Button size="sm" variant="ghost" asChild title="Add this name to the lexicon">
            <a href={lexiconHref(issue)} target="_blank" rel="noreferrer">
              Pronounce
            </a>
          </Button>
        )}

        {issue.verdict === "open" ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("fixed")}>
              Fixed
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("dismissed")}>
              Not a problem
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("open")}>
            Reopen
          </Button>
        )}
      </span>
    </div>
  );
}
