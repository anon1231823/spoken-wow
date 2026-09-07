# Per-user ElevenLabs API key

Approved 2026-08-11.

## Purpose

Every paid action in the explorer currently spends credits from one key:
`ELEVENLABS_API_KEY`, read out of the repo's `.env` by
`tools/voice/elevenlabs.mjs`. Whoever holds the `editor` role spends the
deployer's money, and nothing in the corpus records whose click did it.

This makes the key personal. Editors and admins set their own key on a profile
page; the app seals it before storing it and unseals it only to build the
outgoing request. Anyone without one is refused, with an explanation, before
any request reaches ElevenLabs.

## Access

- Setting, replacing and removing a key: the account's owner, and only for
  roles that can spend — `canRegenerate`, i.e. editor and admin. A member has
  no action a key would unblock, so the section is not drawn for them.
- Seeing whether another account has a key, and clearing it: admin. The
  Users page shows presence, never a value — not even the redacted hint. An
  admin who can hand out the `editor` role should be able to revoke a departed
  collaborator's stored secret without psql; that is the whole of the power.
- Reading a key back, in any form, by anyone: never. Once saved, the plaintext
  leaves the database only into an ElevenLabs request.

## No fallback

The web app stops reading `ELEVENLABS_API_KEY` entirely. A missing personal key
is a refusal, not a silent charge to the server's account.

Falling back would have kept today's behaviour working untouched, at the cost
of the property the feature exists for: with a fallback, "who paid for this
line" has no answer, and the shared bill stays exposed to every future editor.

The CLI is unaffected. `tools/voice/*.mjs` keeps reading `.env` — it is run by
one person on one machine, and the environment file is that person's own.

## Storage

`web/migrations/0007_elevenlabs_key.sql`:

```sql
create table "elevenlabs_key" (
  "userId" text primary key references "user" ("id") on delete cascade,
  "ciphertext" text not null,
  "iv" text not null,
  "tag" text not null,
  "hint" text not null,
  "verifiedAt" timestamptz,
  "tier" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
```

A table of its own rather than columns on `"user"`. `0003_auth.sql` is Better
Auth's generated output, and its header says regeneration goes into a *new*
file; hand-written columns in it would be lost the next time the CLI runs.
`on delete cascade` so removing an account removes its secret with it.

`hint` is the last four characters of the key, stored in the clear on purpose:
it is what the profile page shows to prove a key is set, and it is not enough
to authenticate with.

One key per user — the primary key on `userId` says so. There is one
ElevenLabs account per person here, and a key picker on every paid action would
be a UI for a problem nobody has.

## Crypto — `web/src/lib/secrets.ts`

AES-256-GCM from node's `crypto`, a fresh random 12-byte IV per write, the auth
tag stored beside the ciphertext. Two functions:

- `seal(plaintext): { ciphertext, iv, tag }`
- `open({ ciphertext, iv, tag }): string` — throws if the tag does not verify.

The master key is `ZONELORE_SECRET_KEY`: 32 random bytes, base64, living in the
droplet's `shared/app.env` next to `BETTER_AUTH_SECRET`. In production an unset
or wrong-length value throws at first use; in development it falls back to a
fixed dev-only constant, the same shape and for the same reason as the secret
in `src/lib/auth.ts` — a clone of this repo must boot without ceremony, and a
deploy that forgot the variable must fail loudly rather than encrypt with a
value committed to a public repository.

Separate from `BETTER_AUTH_SECRET` rather than derived from it. Rotating the
auth secret is a routine, recoverable act — every session is invalidated and
everyone signs in again. If keys hung off it, that same rotation would
permanently destroy every stored secret with no error until the next
regeneration attempt.

GCM, not CBC: a tampered row must fail to open rather than decrypt to garbage
that gets sent to ElevenLabs as a bearer credential.

## Threading the key

`lib/tools.ts` stops re-exporting `apiKey`, and `lib/regenerate.ts` stops
calling it. The key becomes a parameter:

- `regenerateOne(lineId, key)`
- `startBatch(lineIds, key)`

Routes resolve it from the session and pass it in. A batch captures the key
once at start and holds it for the run's lifetime — it already outlives the
request that started it, and re-reading the session mid-batch would strand a
half-finished run behind a sign-out.

The alternative was an AsyncLocalStorage request context, which would have left
the call sites unchanged. Rejected: the one thing this code should say out loud
is where the money comes from, and an ambient lookup is exactly the shape that
hides it. `quote()` and `restore()` take no key, because neither calls out.

## Refusal — 428, and one dialog

`authz.ts` gains `requireApiKey()`, run after the role guard, returning the
unsealed key or a denial. No stored key means `428` and
`{ error, code: "no_api_key" }`.

428 rather than 403 because the two failures need different words in front of
the user: 403 is "your role may not do this", which signing in differently
cannot fix, and 428 is "you have not set this up yet", which is one page away.
The existing fetch callers treat any non-ok response as failure and keep doing
so; they gain a check for 428 that opens `ApiKeyRequiredDialog` instead of the
generic error — a short modal saying that regeneration and previews spend the
signed-in user's own ElevenLabs credits, with a link to `/profile`.

Guarded:

- `POST /api/regenerate` — except `action: "quote"` and `action: "stop"`,
  which cost nothing and must keep working so a user can see the price before
  being told to go and get a key.
- `GET /api/regenerate` — unguarded. Reading a batch's progress spends nothing.
- `POST /api/voice/preview`
- `GET` and `POST /api/voice` — both list the account's voices, and the list is
  the user's own account's, so the page cannot render without a key.
- `POST /api/restore` — **not** guarded. It replays archived audio: no network
  call, no credits.

## Profile page — `/profile`

Server-rendered, signed-in only, redirecting guests to `/login`. Shows the
account's email and role for context; the key section renders only for editor
and admin.

Empty: a `type="password"` input and Save.

`POST /api/profile/api-key` takes `{ key }`, requires the session's own role to
be one that can regenerate, and verifies before storing — `GET
https://api.elevenlabs.io/v1/user` with the candidate key, which costs no
credits. A 401 comes back as "ElevenLabs rejected this key"; anything else
non-ok as the status and a truncated body, like `listVoices` already does. On
success it seals the key and upserts the row with the hint, `verifiedAt`, and
the plan name from the response.

Verifying at save time rather than storing blind: a typo'd key otherwise first
surfaces as a 401 in the middle of a batch, where `isFatal()` correctly
abandons the remaining work — a bad paste would cost a run.

Set: `sk_…••••1a2b`, the verification date, and the plan name. A Replace
(same input, same route) and a Remove (`DELETE /api/profile/api-key`). The
plaintext is never returned by any route, including immediately after a
successful save.

`DELETE /api/profile/api-key?userId=…` clears another account's key, for admins
only. Without the parameter it clears the caller's own.

`UserMenu` gains a Profile link for signed-in users. The Users page
(`UserTable`) gains a "Key" column showing ✓ or —, and a Clear action on rows
that have one.

## Verification

- `make check` (validate + lint).
- Unit tests on `secrets.ts`: round-trip, distinct IVs across two seals of the
  same input, and a flipped ciphertext byte failing to open rather than
  returning garbage.
- A test that a paid route with a role but no stored key answers 428 with the
  code, and that `action: "quote"` still answers 200.
- Not verified in a browser. The profile flow and the dialog need a human
  click-through.

## Not doing

- Key rotation tooling or re-encryption on `ZONELORE_SECRET_KEY` change. If
  that value is ever rotated, every stored key must be re-entered, and the
  deploy notes will say so.
- Per-user spend accounting. `voiceline_take` has no `userId` and inventing
  one now means backfilling it with a lie, exactly as `0003_auth.sql` says.
- Sharing one key across a team, org-level keys, or a picker at generation
  time.
- Reading the key back to the browser under any "reveal" affordance.
