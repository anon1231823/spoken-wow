## Download

### Player addon
| Client | GitHub Direct Link | Addon stores |
| ----- | ------------------ | ---------- |
| Blizzard clients (Classic Era, Anniversary, Wrath, retail) | [GitHub ZIP Download]({{ github_zip_download_blizz }}) | [Curse]({{ curse_link_blizz }}) · [Wago]({{ wago_link_blizz }}) |
| 1.12 (private Vanilla servers & Turtle) | [GitHub ZIP Download]({{ github_zip_download_112 }}) | - |
| 2.4.3 (private TBC servers) | [GitHub ZIP Download]({{ github_zip_download_243 }}) | - |
| 3.3.5 (private WotLK servers) | [GitHub ZIP Download]({{ github_zip_download_335 }}) | - |

One zip serves every Blizzard client — it carries a `.toc` per flavor and the client picks.
The three private-server clients read `SpokenQuests.toc` and nothing else, so each has a zip
of its own, carrying the vendored Ace3 that client needs.

### Sound packs
The audio ships separately and does not change with the player. Install the pack for your side
plus the shared one; gossip is optional.

| Pack | Curse Link |
| ----- | ---------- |
| Alliance | [Curse]({{ curse_link_pack_alliance }}) |
| Horde | [Curse]({{ curse_link_pack_horde }}) |
| Shared Quests | [Curse]({{ curse_link_pack_shared }}) |
| Gossip | [Curse]({{ curse_link_pack_gossip }}) |

The packs are the same files on every client — download them from the Curse website by hand if
your client is not one an addon manager supports. The player loads a pack whether or not the
client marks it out of date.

## Instructions

### Blizzard clients
- Install the [**player**]({{ curse_link_blizz }}) and the packs with your addon manager, or
  unzip them into `Interface/AddOns`.

### 1.12 (private Vanilla servers & Turtle)
- Unzip the [**1.12 player**]({{ github_zip_download_112 }}) and your packs into
  `Interface/AddOns`.

### 2.4.3 (private TBC servers)
- Unzip the [**2.4.3 player**]({{ github_zip_download_243 }}) and your packs into
  `Interface/AddOns`.

### 3.3.5 (private WotLK servers)
- Unzip the [**3.3.5 player**]({{ github_zip_download_335 }}) and your packs into
  `Interface/AddOns`.

## Support This Project
You can say thanks by donating here: {{ donation_link }}

## Community
Our Discord: {{ discord_link }}
