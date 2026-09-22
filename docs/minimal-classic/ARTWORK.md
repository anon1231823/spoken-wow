# Artwork sources

The Minimal Classic textures are derived from WoW UI assets and the existing
Spoken artwork. They are not covered by the project's MIT code license.
See the repository's [third-party notice](../../THIRD_PARTY.md).

- Native textures were referenced through the `classic` branch of
  [Gethe/wow-ui-textures](https://github.com/Gethe/wow-ui-textures/tree/classic)
  and the textures shipped with SpokenPlayer/SpokenQuests.
- `MinimalBackground.tga` uses the darkened `FrameGeneral/UI-Background-Rock`
  material.
- `MinimalPortraitRing.tga` uses a cleaned target-frame ring, with its old
  health/mana-bar remnants removed, desaturated and darkened.
- `MinimalBullet*.tga` uses the existing quest/gossip glyphs, alpha-trimmed
  and centered; the cast trim/background/mask complete the circular framing.
- Book and zone badges use the client's own `GossipFrame\TrainerGossipIcon`
  and `WorldMap\UI-World-Icon`; nothing is bundled for them.
- Runtime textures are power-of-two RGBA TGA files. Fonts and remaining
  native interface textures are referenced from the client at runtime.

The PNG images in this directory are browser design previews, not in-game
screenshots. Preview font files are not bundled in this repository.
