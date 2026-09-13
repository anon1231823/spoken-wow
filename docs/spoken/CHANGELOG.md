# Changelog — Spoken Player

## 1.0.0 — 2026-09-11

The player every Spoken addon speaks through: one queue, one window, one minimap button.

- Extracted from VoiceOver Redux and ZoneLore, which each carried their own copy.
- One FIFO across every addon; nothing interrupts. Gossip yields to quest dialogue at the door.
- Narration held through combat no longer blocks a quest line queued behind it.
- Every sound setting lives here: the channel everything speaks on, and silencing the
  game's own NPC dialogue while a line is read. Each feature addon used to carry its own
  channel control, so a player with both had two settings for one thing.
- 2.4.3 and 3.3.5 gain rows for the music-channel playback those clients need, and for the
  HD model patch. Both settings existed from the start with no way to reach them.
- Settings under Spoken Player; the frame's position, scale and lock, the minimap button and the sound channel migrate from either old addon on first login.
