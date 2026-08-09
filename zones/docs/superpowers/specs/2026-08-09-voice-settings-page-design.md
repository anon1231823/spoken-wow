# Voice settings page

Approved 2026-08-09.

## Purpose

A `/voice` page in the explorer for choosing the narrator voice and its
generation settings, with a paid single-line preview, instead of hand-editing
`tools/voice/config.json`.

## Access

- Page and config read/write: admin (`canConfigure`) — the voice and its
  settings are global config, like the pronunciation rules: a change alters
  every future generation and what a full regen pass produces.
- Preview: `requireRegenerate` on the route (it spends credits; same power an
  editor already has), but only admins reach the page.

## Server

`GET /api/voice` — current config slice (`voiceName`, `voiceId`, `modelId`,
`voiceSettings`), the account voices whose name starts with `narrator-`
(name, id, category), and the measured credit rate for the preview estimate.

`POST /api/voice` — `{ voiceId, voiceSettings }`. Validates: voiceId present in
the narrator list; `stability` ∈ {0, 0.5, 1} (Creative / Natural / Robust — all
v3 honours); `similarity_boost` ∈ [0, 1]; `use_speaker_boost` boolean. Writes
config.json via `saveConfig()`, syncing `voiceName` to the picked voice's
current name. Model, output format, dictionary pins untouched.

`POST /api/voice/preview` — `{ text, voiceId, voiceSettings }`. Applies the
pronunciation rules, synthesizes once with the ad-hoc config (same model,
dictionary, format), returns `audio/mpeg` inline. Not stored: no take row, no
archive, no publish. Text capped at 1000 characters.

`tools/voice/elevenlabs.mjs` gains `listVoices(key)`; `resolveVoiceId` reuses
it. `web/src/lib/tools.ts` re-exports `saveConfig` and `listVoices`.

## UI (`VoiceSettings.tsx`, patterned on `LexiconEditor`)

- Voice dropdown of narrator-* voices, current one selected.
- Stability as a three-way segmented control labelled Creative / Natural /
  Robust.
- Similarity slider 0–1, speaker-boost checkbox.
- Preview textarea prefilled with a corpus-style line; char count and credit
  estimate (chars × measured rate); Preview button plays the returned audio.
- Save disabled until dirty; unsaved-changes indicator.
- Warning: a voice change does not mark takes stale (staleness is text-hash),
  so it only reaches the corpus through a regeneration pass.
- "Voice" link in the header for admins, next to Pronunciation.

## Not doing

Model picker, style/speed knobs v3 ignores, voice search, per-line voice
overrides, config history.
