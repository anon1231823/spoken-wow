# Working agreements for agents

How Claude should behave while working in this repository. Distilled from
[Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
and narrowed to what actually applies here.

Nothing in this project calls an LLM at runtime — ElevenLabs is text-to-speech,
not a model API — so none of this is product prompt text. It is guidance for the
agent session, and it belongs in whatever system prompt, harness, or subagent
runs against this checkout.

## Scope: deliver what was asked

Deliver what was asked, at the scope intended. Make routine judgment calls
yourself, and check in only when different readings of the request would lead to
materially different work. If the request seems mistaken or a better approach
exists, say so in a sentence and continue with the task as asked rather than
quietly narrowing, widening, or transforming it. Finish the whole task, and stop
short of actions that are clearly beyond what was asked.

Opus 5 expands scope on its own more than earlier models did, and this repo
punishes that harder than most:

- `make sample`, and any `tools/voice/generate.mjs` run carrying `--generate`,
  **spend real ElevenLabs credits**. The bare targets are dry runs and cost
  nothing; adding `--generate` is the user's call, never a judgment call made
  mid-task.
- `make push`, `make pull`, `make db-push`, `make db-pull` are destructive
  (`rsync --delete`, table replacement). Confirm before running one.
- `addon/ZoneLore/Data/*.lua` and `addon/ZoneLoreAudio/Data/Sounds.lua` are
  generated. Fix the generator or `tools/seed/overrides.json`, not the output.
- Regenerating lore or voicelines because it "seemed related" to a UI fix is
  scope expansion, not thoroughness.

## Verification: run the repo's checks, skip the invented ones

Opus 5 verifies its own work without being told to, and prompts that instruct
extra verification passes ("add a final verification step," "use a subagent to
double-check") cause over-verification — more tokens, no more quality. Do not add
that scaffolding, and do not re-check work the model already checked.

This is not licence to skip the project's own gates, which are real tests, not
self-verification ritual:

```sh
make check          # validate + lint, the pre-package gate
make validate-audio # manifest, files on disk and lookup table agree
```

Run those when the change touches what they cover. Anything beyond them is
over-verification.

## Delegation

Delegate to a subagent only for large tasks that are genuinely independent and
parallelizable, such as a wide multi-file investigation. Do not delegate work you
can finish yourself in a handful of tool calls, and do not use subagents to
verify or double-check your own work. If one subagent can complete the task, use
one rather than several, and keep spawn counts low.

This repo is small enough that most work is a direct edit. A sweep across all
nine `addon/ZoneLore/UI/*.lua` files may warrant one agent; a two-file change
does not.

## Response length

Keep responses focused, brief, and concise. Keep disclaimers and caveats short,
and spend most of the response on the main answer. When asked to explain
something, give a high-level summary unless an in-depth explanation is
specifically requested.

Effort controls how much Opus 5 thinks, not how much it says — lowering effort
will not shorten the visible answer on its own. If you are assembling a long
system prompt, repeat the instruction near the end:

```text
<tone_preference>
Keep outputs reasonably concise.
</tone_preference>
```

## Progress updates

Before your first tool call, say in one sentence what you're about to do. While
working, give a brief update only when you find something important or change
direction. When you finish, lead with the outcome: the first sentence should
answer "what happened" or "what did you find," with supporting detail after it.

To change the cadence, describe the shape you want and show an example. Positive
examples of the style you want work better than lists of things not to do.

## Written deliverables

Match the length of written documents to what the task needs: cover the
substance, but do not pad with filler sections, redundant summaries, or
boilerplate.

Files Opus 5 writes to disk run long by default, and this repo has four documents
the world reads — `README.md`, `CHANGELOG.md`, and the two player-facing
`addon/*/README.md` files that become the CurseForge descriptions. They are
written in prose, with headings that state a decision ("Port 5433, not 5432",
"Characters are not credits") and a paragraph explaining why. Match that. A new
section is warranted when there is a decision to record, not when there is space
to fill.

## Corrections

Only correct an earlier statement when the error would change the user's code,
conclusions, or decisions. State corrections plainly and briefly, then continue
the task. For slips that change nothing for the user, make the fix and move on
without noting it.

Opus 5 also fixes its own mistakes reliably, so "double-check your answer" style
instructions add cost without improving the result. Leave them out.

## Effort

`low` and `medium` produce strong quality at a fraction of the tokens and
latency. Use them liberally as the primary cost and latency control wherever
quality holds; step up to `xhigh` for demanding work. Reasonable defaults here:

| Work | Effort |
|---|---|
| Lua UI tweaks, README and CHANGELOG edits, Makefile targets | `low`–`medium` |
| Scraper and era-filter changes, `web/` API routes and migrations | `medium`–`high` |
| Voice pipeline changes, anything touching the manifest/database boundary | `high`–`xhigh` |

If you carried effort settings over from an older model, re-sweep them rather
than trusting them.

## Code review

Opus 5 finds real bugs at a high rate with few false positives, and accuracy
holds at lower effort — so a fast review pass at commit time is worth running.
Do not ask it to "only report high-severity issues" or "be conservative": it
takes that literally and reports less. Ask for everything, then filter in a
separate pass.

## Deliberately not included

From the source guide, and why they do not apply:

- **Running with thinking disabled** — leaked tool calls, stray `<thinking>`
  tags. Thinking is on in the sessions that work on this repo.
- **Vision, office documents, 1M-token context** — no workload here needs them.
- **Multi-agent fleet coordination** — see Delegation; this codebase is too small
  to be worth a fleet.
