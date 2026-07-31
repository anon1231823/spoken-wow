"use client";

import { RefreshCw, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { EffectiveLexicon } from "@/lib/generation/dictionary";
import { PREVIEW_MODES, type PreviewMode } from "@/lib/generation/preview-modes";
import type { CacheState } from "@/lib/generation/preview";
import { Toaster, useToast } from "@/components/ui/toast";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  honoursPhonemes,
  kindOf,
  LexiconError,
  validateLexicon,
  type Category,
  type LexiconEntry,
} from "@/lib/generation/lexicon";

type Saved = EffectiveLexicon & { syncError?: string | null };

const MODE_LABELS: Record<PreviewMode, string> = {
  word: "Word",
  sentence: "In a line",
};

const EMPTY_CACHE: CacheState = { word: false, sentence: false };

/**
 * Where this name is spoken, in the explorer.
 *
 * `filter=text` is the explorer's "Line text only", which is the question being asked here:
 * not which NPC is called Gnomeregan, but which lines say it. The URL is the explorer's own
 * source of truth for a search, so this is a working deep link rather than a page that
 * arrives blank and has to be retyped into.
 */
function explorerHref(grapheme: string): string {
  return `/?${new URLSearchParams({ q: grapheme, filter: "text" })}`;
}

// Starts as a respelling, not IPA. Anyone who can write IPA can switch in one click, and
// everyone else would otherwise meet an empty box they have no way to fill.
const BLANK: LexiconEntry = {
  grapheme: "",
  alias: "",
  confidence: "check",
  category: "place",
};

/**
 * Which input the form should show.
 *
 * Read from which key is PRESENT rather than from which is non-empty, so a half-typed
 * respelling does not flip the form back to IPA between keystrokes.
 */
function formKind(entry: LexiconEntry): "ipa" | "alias" {
  return entry.ipa !== undefined ? "ipa" : "alias";
}

function key(entry: LexiconEntry): string {
  return entry.grapheme.toLowerCase();
}

// `base` so Aku'mai and Aku'Mai sort together rather than by code point, and `numeric` for
// the day a name ends in a digit. A new entry's grapheme is empty, which collates first -
// which is where it should be, since it is the one being typed.
const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function same(a: LexiconEntry[], b: LexiconEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type PreviewMeta = {
  mode: PreviewMode;
  spoken: string;
  sentence: string;
  source: { npcName: string; lineId: string } | null;
  cached: boolean;
  characters: number;
  credits: number | null;
};

/**
 * Rendering one entry and playing it.
 *
 * Owned here rather than by each row so that only one preview is ever audible: starting a
 * second stops the first, because two pronunciations played over each other is worse than
 * useless for the one thing this is for. Only the pressed button is disabled, though -
 * waiting on a render is no reason the rest of the table should go dead.
 *
 * What it costs is reported by toast rather than in the row. A line of text under the row
 * would push everything below it down, moving the next button just as someone reaches for
 * it, and a preview served from cache has nothing to say at all - it just plays.
 */
function usePreview(onCached: (grapheme: string, mode: PreviewMode) => void) {
  const [busy, setBusy] = useState<{ index: number; mode: PreviewMode } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const toast = useToast();

  function release() {
    audio.current?.pause();
    // Object URLs are not garbage collected while the document lives, so a page left open
    // through fifty previews would hold fifty mp3s in memory.
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }

  useEffect(() => release, []);

  async function play(entry: LexiconEntry, mode: PreviewMode, index: number, force = false) {
    release();
    setBusy({ index, mode });
    try {
      const response = await fetch("/api/generation/lexicon/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry, mode, force }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({
          tone: "error",
          title: `Could not preview ${entry.grapheme}`,
          detail: body.error ?? `request failed (${response.status})`,
        });
        return;
      }

      const header = response.headers.get("X-Preview");
      const meta = header ? (JSON.parse(decodeURIComponent(header)) as PreviewMeta) : null;

      // Silence on a cache hit is the point: nothing was spent, so there is nothing to say.
      if (meta && !meta.cached) {
        toast({
          tone: "info",
          title: `${meta.characters} characters${
            meta.credits === null ? "" : `, ${meta.credits} credits`
          }`,
          detail:
            meta.mode === "word"
              ? `${entry.grapheme}, on its own`
              : meta.source
                ? `${meta.source.npcName}: “${meta.sentence}”`
                : `No corpus line is short enough, so this is an invented sentence.`,
        });
      }
      if (meta) onCached(entry.grapheme, meta.mode);

      url.current = URL.createObjectURL(await response.blob());
      audio.current = new Audio(url.current);
      await audio.current.play();
    } catch (caught) {
      toast({
        tone: "error",
        title: `Could not preview ${entry.grapheme}`,
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy(null);
    }
  }

  return { play, busy };
}

/**
 * The pronunciation lexicon, and the one place it can be corrected without a deploy.
 *
 * Admin-only, on its own page rather than beside the generation settings: 134 entries is a
 * list you search, and a name is fixed in response to hearing it rather than while setting
 * up a batch.
 *
 * Rows are read-only until one is opened. A page of 134 simultaneously editable rows is
 * both slower and harder to review - an accidental keystroke in a field nobody meant to
 * touch would ship as a mispronunciation, and the diff against the committed file is what
 * makes that visible.
 */
export default function LexiconEditor(props: {
  initial: EffectiveLexicon;
  modelId: string;
  initialCache: Record<string, CacheState>;
}) {
  // A shell, because useToast has to find a provider above the component that calls it and
  // the editor itself is what raises the toasts.
  return (
    <Toaster>
      <Editor {...props} />
    </Toaster>
  );
}

function Editor({
  initial,
  modelId,
  initialCache,
}: {
  initial: EffectiveLexicon;
  /** The model generation actually uses, which decides whether any of this takes effect. */
  modelId: string;
  /** Which previews already exist, resolved on the server. See previewCache. */
  initialCache: Record<string, CacheState>;
}) {
  const [saved, setSaved] = useState<Saved>(initial);
  const [draft, setDraft] = useState<LexiconEntry[]>(initial.entries);
  // Identified by position, not by grapheme. A grapheme is editable, so keying the open row
  // on its value would close the form the moment the first character of a name was changed.
  const [editing, setEditing] = useState<number | null>(null);
  // The name the open row sorted under when it was opened. Rows are ordered by grapheme, so
  // without this an open form would move on every keystroke of the name being typed - out
  // from under the cursor, and past whichever rows the new spelling had overtaken.
  const [pinned, setPinned] = useState("");
  const [query, setQuery] = useState("");
  const [onlyChecks, setOnlyChecks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the server and kept up to date as previews are rendered, so a re-roll button
  // lights up the moment the take it would replace exists.
  const [cache, setCache] = useState(initialCache);
  const preview = usePreview((grapheme, mode) =>
    setCache((current) => ({
      ...current,
      [grapheme]: { ...(current[grapheme] ?? EMPTY_CACHE), [mode]: true },
    })),
  );

  const dirty = !same(draft, saved.entries);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return draft
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (onlyChecks && entry.confidence !== "check") return false;
        if (!needle) return true;
        return [entry.grapheme, entry.ipa ?? entry.alias ?? "", entry.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      // Alphabetical, and note this sorts the VIEW rather than the draft: `index` is the
      // position in the draft array and stays with its entry, so editing and removal keep
      // pointing at the right one. Sorting the draft itself would also rewrite the stored
      // order on every save, turning a one-word fix into a 134-entry diff.
      .sort((a, b) => COLLATOR.compare(sortName(a), sortName(b)));

    function sortName({ entry, index }: { entry: LexiconEntry; index: number }): string {
      return index === editing ? pinned : entry.grapheme;
    }
  }, [draft, query, onlyChecks, editing, pinned]);

  const checks = draft.filter((entry) => entry.confidence === "check").length;

  function patch(target: number, change: Partial<LexiconEntry>) {
    setDraft((current) =>
      current.map((entry, index) => (index === target ? { ...entry, ...change } : entry)),
    );
  }

  function openRow(index: number, entry: LexiconEntry) {
    setEditing(index);
    setPinned(entry.grapheme);
  }

  function remove(target: number) {
    setDraft((current) => current.filter((_, index) => index !== target));
    setEditing(null);
  }

  function add(grapheme = "") {
    const entry = { ...BLANK, grapheme };
    // Prepended and opened, so a new entry is never added below the fold of a filtered list
    // where it would look as though nothing happened.
    setDraft((current) => [entry, ...current]);
    // Pinned to the name it was opened with, so a new entry stays where it started while it
    // is being typed instead of sliding away as the name takes shape.
    openRow(0, entry);
    setQuery("");
    setOnlyChecks(false);
  }

  /**
   * Arrive with a name already in the box.
   *
   * /issues links here with ?grapheme=Kel'Theril, so "this name is mispronounced" and "here
   * is how to say it" are one click apart rather than a name to retype. Only ever on the
   * first render for a given name: re-running it would reopen a row someone had closed, and
   * re-adding one they had deliberately removed.
   */
  const requested = useSearchParams().get("grapheme");
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!requested || seeded.current === requested) return;
    seeded.current = requested;

    // An entry may already exist for it - the finding was loaded before the lexicon grew, or
    // someone followed the link twice. Open that rather than adding a duplicate the validator
    // would reject on save.
    const existing = draft.findIndex(
      (entry) => entry.grapheme.toLowerCase() === requested.toLowerCase(),
    );
    if (existing >= 0) openRow(existing, draft[existing]);
    else add(requested);
    // draft is deliberately not a dependency: this runs once per requested name, and reacting
    // to every edit of the draft is exactly what the guard above exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  async function send(method: "PUT" | "POST" | "DELETE") {
    // Checked here as well as on the server so a malformed draft is a message next to the
    // field rather than a round trip: the server's copy is the one that counts, but it is
    // not the one that can point at the entry.
    if (method === "PUT") {
      try {
        validateLexicon(draft);
      } catch (caught) {
        setError(caught instanceof LexiconError ? caught.message : String(caught));
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/generation/lexicon", {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify(draft) : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      const next = body as Saved;
      setSaved(next);
      setDraft(next.entries);
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SyncBanner
        saved={saved}
        modelId={modelId}
        phonemes={draft.filter((entry) => kindOf(entry) === "ipa").length}
        busy={busy}
        onRetry={() => void send("POST")}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, sound, or note"
          className="max-w-xs"
          aria-label="Filter entries"
        />
        <Button
          size="sm"
          variant={onlyChecks ? "secondary" : "ghost"}
          aria-pressed={onlyChecks}
          onClick={() => setOnlyChecks((value) => !value)}
        >
          Unconfirmed · {checks}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => add()}>
          Add name
        </Button>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {shown.length === draft.length
            ? `${draft.length} entries`
            : `${shown.length} of ${draft.length}`}
        </span>
      </div>

      <div className="divide-y rounded-md border">
        {/* Column names, aligned to the widths the rows below use. Not a <table>, because a
            row expands into a form in place and a form inside a table cell inherits the
            column widths it needs to escape. */}
        <div
          aria-hidden
          className="text-muted-foreground bg-muted/40 flex items-center gap-3 px-3 py-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
        >
          {/* Matches the checkbox's own width, so the columns below line up under their names. */}
          <span className="w-4 shrink-0" title="Confirmed">
            OK
          </span>
          <span className="flex flex-1 gap-3 overflow-hidden">
            <span className="w-40 shrink-0">Written</span>
            <span className="w-44 shrink-0">Sound</span>
            <span className="truncate">Note</span>
          </span>
          <span className="shrink-0">Find · hear · re-roll</span>
        </div>

        {shown.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            Nothing matches that filter.
          </p>
        )}

        {shown.map(({ entry, index }) =>
          editing === index ? (
            <EntryForm
              key={index}
              entry={entry}
              onChange={(change) => patch(index, change)}
              onClose={() => setEditing(null)}
              onRemove={() => remove(index)}
            />
          ) : (
            <Row
              key={index}
              entry={entry}
              index={index}
              cached={cache[entry.grapheme] ?? EMPTY_CACHE}
              preview={preview}
              onOpen={() => openRow(index, entry)}
              onConfirm={(confirmed) =>
                patch(index, { confidence: confirmed ? "high" : "check" })
              }
            />
          ),
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!dirty || busy} onClick={() => void send("PUT")}>
          {busy ? "Saving…" : "Save and upload"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(saved.entries);
            setEditing(null);
          }}
        >
          Discard
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        Saving uploads a new dictionary and every line generated afterwards uses it. Audio
        already in the store is untouched: its version row records the dictionary it was made
        with, so a line generated before a fix stays playable and identifiable as stale.
      </p>
    </div>
  );
}

/**
 * Whether the entries on this page are the ones ElevenLabs is actually applying.
 *
 * Its own component because there are three independent ways this page can be showing
 * pronunciations that no generation will use — never uploaded, upload failed, or a model
 * that ignores phoneme rules — and each of them needs a different sentence.
 */
function SyncBanner({
  saved,
  modelId,
  phonemes,
  busy,
  onRetry,
}: {
  saved: Saved;
  modelId: string;
  /** How many entries are IPA, and so depend on the model honouring phoneme rules. */
  phonemes: number;
  busy: boolean;
  onRetry: () => void;
}) {
  // Counted rather than stated as a blanket warning: on a model without phoneme support the
  // respelled entries still work, so "nothing on this page reaches the audio" would be false
  // and would send someone hunting for a problem in the wrong place.
  if (!honoursPhonemes(modelId) && phonemes > 0) {
    return (
      <Banner tone="warn">
        <span>
          Generation uses <code>{modelId}</code>, which ignores phoneme rules — only{" "}
          <code>eleven_v3</code> and <code>eleven_flash_v2</code> honour them. {phonemes} entries
          written in IPA are skipped; the respelled ones still apply. Switch the model on Voices,
          or respell those entries.
        </span>
      </Banner>
    );
  }

  if (!saved.seeded) {
    return (
      <Banner tone="error">
        <span>
          The lexicon table is empty. Migration <code>0008</code> seeds it — if you are seeing
          this, migrations have not run against this database. Do not retype the entries;
          run them.
        </span>
      </Banner>
    );
  }

  if (saved.sync === "never") {
    return (
      <Banner tone="warn">
        <span>
          No dictionary has been uploaded yet, so lines are generated without one. Save to put
          these {saved.entries.length} pronunciations in force.
        </span>
      </Banner>
    );
  }

  // Louder than a footnote, because this is the shape of the bug that made the whole page a
  // no-op for weeks: a dictionary in force, reporting success, holding a fraction of its rules.
  if (
    saved.sync === "synced" &&
    saved.rulesKept !== null &&
    saved.rulesSent !== null &&
    saved.rulesKept < saved.rulesSent
  ) {
    return (
      <Banner tone="error">
        <span>
          ElevenLabs kept only {saved.rulesKept} of the {saved.rulesSent} rules uploaded. The
          dictionary is in force but incomplete, so some names below are not being applied.
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {busy ? "Uploading…" : "Upload again"}
        </Button>
      </Banner>
    );
  }

  if (saved.sync === "pending") {
    return (
      <Banner tone="error">
        <span>
          Saved, but not uploaded{saved.syncError ? `: ${saved.syncError}` : ""}. Generation is
          still applying the previous dictionary, so the entries below are not what lines
          currently sound like.
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {busy ? "Uploading…" : "Retry upload"}
        </Button>
      </Banner>
    );
  }

  return (
    <p className="text-muted-foreground text-xs">
      In force since {saved.syncedAt ? new Date(saved.syncedAt).toLocaleString() : "—"} · version{" "}
      <code>{saved.locator?.versionId}</code>
      {saved.rulesKept !== null && <> · {saved.rulesKept} rules</>}
    </p>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm",
        tone === "warn"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

/**
 * One entry at rest: confirm it, hear it, re-roll it, or open it.
 *
 * A row of controls rather than one big button. It used to be a single <button> covering the
 * whole row, which is no longer possible - a checkbox and four buttons cannot be nested
 * inside a button, and browsers do not agree on what happens if you try. The clickable
 * region that opens the editor is now just the text.
 */
function Row({
  entry,
  index,
  cached,
  preview,
  onOpen,
  onConfirm,
}: {
  entry: LexiconEntry;
  index: number;
  cached: CacheState;
  preview: ReturnType<typeof usePreview>;
  onOpen: () => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  const playable = Boolean(entry.grapheme.trim() && (entry.ipa ?? entry.alias ?? "").trim());

  return (
    <div className="hover:bg-muted/50 flex items-center gap-3 px-3 py-1.5">
      <Checkbox
        checked={entry.confidence === "high"}
        onCheckedChange={(value) => onConfirm(value === true)}
        aria-label={`Confirmed pronunciation for ${entry.grapheme || "this entry"}`}
        className="shrink-0"
      />

      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 items-baseline gap-3 overflow-hidden text-left"
      >
        <span className="w-40 shrink-0 truncate text-sm font-medium">
          {entry.grapheme || <span className="text-muted-foreground">(new entry)</span>}
        </span>
        <span className="text-primary w-44 shrink-0 truncate text-sm">
          {entry.alias ? `“${entry.alias}”` : `/${entry.ipa}/`}
        </span>
        <span className="text-muted-foreground truncate text-xs">{entry.note}</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* A new tab, deliberately. The editor holds an unsaved draft - navigating away in
            this one would discard every edit made since the last save, which is a steep
            price for looking something up.

            Split rather than one Button with `disabled`, because `disabled` on a Button
            rendering `asChild` styles an anchor without disabling it: the link would still
            be clickable, and would open the explorer searching for nothing. */}
        {entry.grapheme.trim() ? (
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="text-muted-foreground size-6"
            title={`Find lines that say ${entry.grapheme}`}
          >
            <a
              href={explorerHref(entry.grapheme)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Find lines that say ${entry.grapheme}`}
            >
              <Search className="size-3" aria-hidden />
            </a>
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground/30 size-6"
            disabled
            title="Name this entry first"
          >
            <Search className="size-3" aria-hidden />
          </Button>
        )}

        {PREVIEW_MODES.map((mode) => {
          // Only the pressed button waits. Disabling the whole table while one render is in
          // flight punishes everyone for a request that concerns one row.
          const rendering = preview.busy?.index === index && preview.busy.mode === mode;
          const onDisk = cached[mode];

          return (
            <span key={mode} className="flex items-center">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={!playable || rendering}
                title={
                  onDisk
                    ? "Already rendered — plays for free"
                    : mode === "word"
                      ? "Hear the name on its own. Costs credits."
                      : "Hear it in a line from the corpus. Costs credits."
                }
                onClick={() => void preview.play(entry, mode, index)}
              >
                {rendering ? "…" : MODE_LABELS[mode]}
              </Button>

              {/* Greyed until there is something to replace: re-rolling a take that does not
                  exist is just rendering it, which the button to the left already does. */}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Re-roll the ${mode} preview for ${entry.grapheme}`}
                title={
                  onDisk
                    ? "Discard the cached take and pay for a fresh one"
                    : "Nothing cached to re-roll yet"
                }
                className={cn(
                  "size-6",
                  onDisk ? "text-muted-foreground" : "text-muted-foreground/30",
                )}
                disabled={!playable || !onDisk || rendering}
                onClick={() => void preview.play(entry, mode, index, true)}
              >
                <RefreshCw className="size-3" aria-hidden />
              </Button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function EntryForm({
  entry,
  onChange,
  onClose,
  onRemove,
}: {
  entry: LexiconEntry;
  onChange: (change: Partial<LexiconEntry>) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-muted/30 space-y-3 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Written" hint="Exactly as the corpus spells it. Matching ignores case.">
          <Input
            value={entry.grapheme}
            onChange={(event) => onChange({ grapheme: event.target.value })}
            placeholder="Gnomeregan"
          />
        </Field>
        <Field
          label="How it sounds"
          hint={
            formKind(entry) === "ipa"
              ? "Bare phonemes — no slashes or brackets. Only eleven_v3 and eleven_flash_v2 honour these."
              : "Respell it as it should be said — “nomeregan”, not “NOME-reh-gan”. Works on every model."
          }
        >
          <div className="flex gap-1.5">
            {formKind(entry) === "ipa" ? (
              <Input
                value={entry.ipa ?? ""}
                onChange={(event) => onChange({ ipa: event.target.value })}
                placeholder="ˈnoʊmɹəɡæn"
              />
            ) : (
              <Input
                value={entry.alias ?? ""}
                onChange={(event) => onChange({ alias: event.target.value })}
                placeholder="nomeregan"
              />
            )}
            {/* Switching clears the other field rather than keeping it, because an entry
                holding both is one ElevenLabs would resolve arbitrarily. */}
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() =>
                onChange(
                  formKind(entry) === "ipa"
                    ? { ipa: undefined, alias: "" }
                    : { alias: undefined, ipa: "" },
                )
              }
            >
              {formKind(entry) === "ipa" ? "Use spelling" : "Use IPA"}
            </Button>
          </div>
        </Field>
        <Field label="Note" hint="Why this entry exists, or what is disputed about it.">
          <Input
            value={entry.note ?? ""}
            onChange={(event) => onChange({ note: event.target.value })}
            placeholder="silent G"
          />
        </Field>
        <Field label="Category" hint="Grouping for this page only.">
          <Select
            value={entry.category}
            onValueChange={(value) => onChange({ category: value as Category })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
