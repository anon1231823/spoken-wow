**The voice player every Spoken addon speaks through.** One queue, one window, one minimap button — whichever Spoken addons you install.

This addon plays nothing by itself. It is installed automatically as a dependency of:

| Addon | Voices |
| --- | --- |
| [Spoken Quests](https://www.curseforge.com/wow/addons/spoken-quests) | quest dialogue and NPC gossip (formerly VoiceOver Redux) |
| [Spoken Zones](https://www.curseforge.com/wow/addons/spoken-zones) | zone and subzone lore (formerly ZoneLore) |

Install one of those and your addon manager brings Spoken Player with it. Installing by hand? Get this too, or the addons above will load and tell you what is missing.

## What it does

- **One queue.** Quest lines and zone narration wait their turn behind each other; nothing interrupts anything. NPC gossip yields to a queued quest line.
- **One window.** Who is speaking, what is waiting, pause, and each addon's own buttons — Read and Report for lore, Report and Stop Gossip for quests. Movable, resizable, lockable; or hide the portrait, or the whole window.
- **One minimap button.** Left-click opens a menu with every installed Spoken addon's entries. Right-click opens settings. All three clicks are rebindable.
- **Narration waits for combat.** Zone narration held for a fight does not block a quest line queued behind it.

## Settings

Game Menu → Options → AddOns → **Spoken**, or `/spoken options`. Each Spoken addon keeps its own settings beside it. On first login the window position, scale and lock, the minimap button and the sound channel are carried over from VoiceOver Redux or ZoneLore.

```
/spoken              play/pause
/spoken stop         clear the queue
/spoken skip         skip the current line
/spoken options      settings
/spoken diagnostics  version, queue, sources
```

## Compatibility

Classic Era 1.15.9 and the Anniversary client (2.5.6). Also carries TOCs for Wrath Classic and retail, and — for private 1.12, 2.4.3 and 3.3.5 servers — ships inside Spoken Quests' zips for those clients, since they have no addon manager to install it.
