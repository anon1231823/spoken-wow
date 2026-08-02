# Working agreements for agents

## Scope

Deliver what was asked, at the scope intended. Make routine judgment calls
yourself, and check in only when different readings of the request would lead to
materially different work. If the request seems mistaken or a better approach
exists, say so in a sentence and continue with the task as asked rather than
quietly narrowing, widening, or transforming it. Finish the whole task, and stop
short of actions clearly beyond it.

Scope expansion is expensive here specifically:

- `make sample`, and any `tools/voice/generate.mjs` run carrying `--generate`,
  **spend real ElevenLabs credits**. The bare targets are dry runs and cost
  nothing. Adding `--generate` is the user's call, never a judgment call made
  mid-task.
- `make push`, `make pull`, `make db-push`, `make db-pull` are destructive
  (`rsync --delete`, table replacement). Confirm before running one.
- `addon/ZoneLore/Data/*.lua` and `addon/ZoneLoreAudio/Data/Sounds.lua` are
  generated. Fix the generator or `tools/seed/overrides.json`, not the output.
- Regenerating lore or voicelines because it seemed related to a UI fix is scope
  expansion, not thoroughness.

## Checks

Run these when the change touches what they cover:

```sh
make check          # validate + lint, the pre-package gate
make validate-audio # manifest, files on disk and lookup table agree
```

Those are the verification. Do not add extra self-review passes on top, and do
not re-check work you have already checked — it costs tokens and finds nothing.

## Versions and the changelog

A change that reaches players bumps the `## Version:` of every addon it affects
and writes that version's section of `CHANGELOG.md`, in the same PR as the change.
Not as a follow-up, and not left to whoever releases.

**The addon and the sound packs carry one version between them.**
`addon/ZoneLore/ZoneLore.toc` and `addon/ZoneLoreAudio/ZoneLoreAudio.toc` bump
together even when only one of them changed, which is what `CHANGELOG.md` means
by "both are versioned together". `scripts/release.sh` reads each .toc
independently and would happily let them drift, and drift is exactly the thing
worth avoiding: the compatibility rule players have to reason about is that
ZoneLore reads any pack sharing its **major** version, and matching numbers make
"do these two go together" answerable at a glance instead of from a table.

Bumping a pack's version does not oblige anyone to re-upload it. Re-cutting a
790 MB zip so CurseForge displays a new number is a release decision, not a
consequence of the bump — an 0.2.0 pack keeps working against 0.2.1 ZoneLore.

**There is no "Unreleased" heading.** `changelog_for()` in `scripts/release.sh`
finds the `## <version>` section matching the .toc and *exits* if there is not
one — the release notes on CurseForge and the notes in the repository are the
same text by construction, which is the point. A heading the tooling cannot find
is a release that fails at the upload step, long after the PR that caused it.
Write the real version heading, dated.

Pre-1.0, most things are a patch bump. Reserve the minor for a change to what the
addon *is* — a new surface, a new kind of content, something that changes the
answer to "what does this do". Adding a control to screens that already exist is
a patch bump, however much work it was; the number is for players judging whether
to update, not a record of effort. If a change is invisible to them — tooling,
the explorer, CI, this file — it bumps nothing and writes nothing.

What goes in a section is what someone who has the old version would want to
know: the capability, and what it replaces. The existing entries are the model.
Anything requiring a matching pack version says so.

## Code comments

- Explain the *why*, never the *what*. The code already says what it does; a
  comment carries the reasoning, intent, or context behind it.
- Never comment obvious code. Noise is worse than silence.
- Prefer readable code to a comment. If a comment is needed to explain unclear
  code, fix the naming, the function size, or the logic first.
- Never leave commented-out code. Delete it; git remembers.
- Be concise. One clear sentence beats a paragraph, and skip filler like "this
  function basically just".
- Keep comments in sync with the code they sit on. A stale comment is a bug.
- Write for a competent developer with no prior context: they understand code,
  they do not know your decisions.
- Use full sentences in block comments, and no private jargon.

The `Makefile` is the model — its targets are commented with the failure each
one exists to prevent. Read that comment before changing a target.

## Delegation

Delegate only for large tasks that are genuinely independent and parallelizable,
such as a wide multi-file investigation. Do not delegate work you can finish in a
handful of tool calls, and do not use subagents to double-check your own work. If
one subagent can do it, use one.

Most work here is a direct edit. A sweep across all nine
`addon/ZoneLore/UI/*.lua` files may warrant an agent; a two-file change does not.

## Communication

Keep responses focused and concise. Keep caveats short and spend the response on
the main answer. Explain at a high level unless depth was asked for.

Say in one sentence what you are about to do before the first tool call. While
working, speak up only when you find something important or change direction.
When you finish, lead with the outcome — the first sentence answers what happened
or what you found, detail after.

Correct an earlier statement only when the error would change the user's code,
conclusions, or decisions. State the correction plainly and move on. For slips
that change nothing, just fix them.

## Written documents

Match a document's length to what the task needs. Cover the substance; skip
filler sections, redundant summaries, and boilerplate.

`README.md`, `CHANGELOG.md`, and the two player-facing `addon/*/README.md` files
are what the world reads — the addon READMEs are the CurseForge descriptions.
They are prose, with headings that state a decision ("Port 5433, not 5432",
"Characters are not credits") and a paragraph on why. Match that. A new section
is warranted by a decision worth recording, not by space to fill.

## Pull request descriptions

A description is written for the person reviewing it and for whoever finds the
branch in a year. Prose, not a form.

- **Title states the outcome**, as a sentence: "Make the explorer's filters
  legible, clearable, and answerable by date", not "filter updates".
- **Open with the problem**, not a summary heading. What was wrong, and what
  followed from it. Then what this changes.
- **Headings say something.** "What is deliberately different from the original
  design", "The bug the chips introduced" — not "Changes" and "Testing".
- **Record the decisions, including the rejected ones.** Why this approach and
  not the obvious one; what is load-bearing and what breaks without it; what was
  found along the way that the plan never mentioned.
- **Numbers where they prove something** — real counts from a real run, in a
  table if it is more than a couple. Cite code as `path/file.lua:12`.
- **Verification is a section, and it is honest.** Say what you ran and what it
  reported. Say plainly what you did *not* check — "not looked at in-game" is
  information the reviewer needs, not an admission to bury.
- **Notes for review** at the end: what deserves the reviewer's eyes, known
  divergences, deliberate non-fixes, and anything that must land together.

Length follows the change. A one-line fix gets a paragraph.
