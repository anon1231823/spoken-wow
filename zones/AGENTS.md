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
