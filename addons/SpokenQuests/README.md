# AI VoiceOver Redux

This is a separate repaired player addon based on AI VoiceOver 1.4.3. It reuses the existing `AI_VoiceOverData_Vanilla` sound pack; no audio data is duplicated.

## What broke

The local player was last built for Classic Era interface 11500 and Burning Crusade interface 20504. The current July 2026 clients are Classic Era 1.15.9 (interface 11509) and Burning Crusade 2.5.6 (interface 20506).

The stale TOCs explain why the player is marked out of date, but the fatal problem is API drift. The player enumerates and force-loads its data modules with global functions such as `GetNumAddOns`, `GetAddOnMetadata`, and `LoadAddOn`. Blizzard moved these calls to `C_AddOns` and later removed the deprecated globals. Enumeration therefore errors before `AI_VoiceOverData_Vanilla` can register, leaving the player with no sound data. `C_AddOns.GetAddOnEnableState` also reverses the old argument order, so a direct alias is not sufficient.

Modern Classic clients also use `C_GossipInfo`. The original compatibility code covered Era, Wrath, and Mainline, but omitted the modern Burning Crusade branch. The July shared-UI source comparison shows that the quest text, gossip, sound, and model APIs used by the addon still exist, so replacing the player or the 1.1 GB voice pack is unnecessary.

## Workaround included

- Uses private compatibility wrappers for `C_AddOns` without modifying the game-wide global table.
- Correctly adapts `GetAddOnEnableState(character, addon)` to `C_AddOns.GetAddOnEnableState(addon, character)`.
- Preserves the old loaded-only behavior when adapting the two-result `C_AddOns.IsAddOnLoaded` call.
- Uses `C_GossipInfo` on every modern Classic branch, including Burning Crusade.
- Targets Classic Era 11509 and Burning Crusade 20506.
- Temporarily permits the old Vanilla Data TOC while loading it, then restores the player's addon-version setting.
- Reports data-module load failures in `/spq diagnostics` and in the no-sound-pack popup.
- Falls back to the Data module's title/NPC/text index when the current client reports quest ID `0` during `QUEST_DETAIL`.
- Uses current sound-channel semantics; Master playback no longer incorrectly depends on the SFX toggle.
- Keeps synchronous quest-text events away from immediate handlers because Classic Era can expose the previous quest's globals during those callbacks.
- Coalesces and briefly defers NPC greeting event/frame signals so Blizzard can populate the new NPC and gossip text before lookup.
- Installs a `GetQuestID()` polling fallback and standalone `/voread` command before any optional AceEvent or Blizzard-frame hook, so a rejected registration cannot stop quest narration initialization.
- Uses AceTimer polling instead of a newly created frame's `OnUpdate`, debounces until the quest panel has finished populating, and retries premature dispatches instead of permanently marking them as handled.
- Captures automatic polling errors as `auto-watcher-error` diagnostics instead of allowing AceAddon's safe-call behavior to hide them.
- Polls `GetQuestID()` ten times per second for responsive automatic playback. The release build contains no polling trace buffer or verbose automatic-playback logging.
- Uses the stabilized watcher as the only automatic source for quest acceptance, progress, and completion, preventing synchronous events from replaying stale quest data.
- Prioritizes visible reward/progress panels over retained detail panels so turning in a quest cannot replay its acceptance text or wrong player-gender variant.
- Loads the large Vanilla lookup tables one second after entering the world, outside AceAddon's shared login callback, for clients with stricter script-time limits such as Hardcore.
- Treats legacy Blizzard settings-panel and AceGUI construction as optional on Classic Era 1.15.9. Any settings failure is logged, but automatic polling, quest events, slash commands, data loading, and playback continue initializing.
- Guards every optional quest-event registration/hook and reports failures as `Bridge warning` lines in `/spq diagnostics`.
- Uses a distinct Ace addon/config/minimap identity, so accidentally enabling the original player does not cause the old duplicate-addon crash. It disables that player for the next login.
- Restores quest-progress voice lines and refreshes the bundled libraries from the maintained 1.4.7 player fork.

## Install

Place these two folders directly under the game's `Interface/AddOns` directory:

```text
VoiceOverRedux
AI_VoiceOverData_Vanilla
```

Disable the old **AI VoiceOver** player (`AI_VoiceOver`). Do not disable or rename **AI VoiceOverData Vanilla**. The new player preserves the existing `VoiceOverDB` settings.

At the character screen, enable **VoiceOver Redux**. Log in and run:

```text
/spq diagnostics
```

The expected final line is `1 detected, 1 loaded`. If the old player was enabled at the same time, reload once after the new addon disables it.

If the module loads but quests remain silent, run `/spq test`. This plays a short known Vanilla sound through the configured channel. While a quest is visible, use the standalone `/voread` command; it does not depend on AceConsole's `/vo` parser. Then run `/spq diagnostics`; the `Last runtime stage` line distinguishes a missing quest ID, hidden handler error, absent Data entry, paused queue, disabled channel, rejected file, and successful playback. Any optional API registration failures are printed as `Bridge warning` lines.

NPC greeting repetition is controlled by **NPC Greeting Playback Frequency**. The default **Once per Quest NPC** choice is remembered per character across revisits and logins; select **Always** if greetings should replay whenever the NPC is opened.

## Validation scope

`tests/Test-Addon.ps1` validates TOC selection, XML includes, renamed asset paths, API adapters, unique addon identities, and the presence of the existing Vanilla Data module. A live WoW client is still required to validate audio playback and frame behavior during an actual quest.

## Research sources

- Original player: <https://www.curseforge.com/wow/addons/voiceover>
- Maintained player fork and its continued use of the original Vanilla Data pack: <https://www.curseforge.com/wow/addons/voiceover-tbc-wotlk>
- AddOn API namespace migration: <https://warcraft.wiki.gg/wiki/Patch_10.2.0/API_changes>
- Removal of the deprecated global AddOn APIs: <https://warcraft.wiki.gg/wiki/Patch_11.0.2/API_changes>
- Current `C_AddOns.GetAddOnEnableState` signature: <https://warcraft.wiki.gg/wiki/API_C_AddOns.GetAddOnEnableState>
- Classic Era 1.15.9: <https://warcraft.wiki.gg/wiki/Patch_1.15.9>
- Burning Crusade 2.5.6: <https://warcraft.wiki.gg/wiki/Patch_2.5.6>

## Bundled audio

`Sounds/og-thrall.mp3` is AI VoiceOver's own recording of Thrall's "All members of the Horde are
equal in my eyes" speech, taken byte for byte from the `AI_VoiceOverData_Vanilla` sound pack. The
"OG Thrall" option under Audio plays it in place of this project's own take on that line.

The upstream projects identify their code as MIT-licensed. This folder retains their original structure and credits.
