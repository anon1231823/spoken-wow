# Minimal Classic offline checks

From the repository root, with Python 3:

```sh
python -m pip install lupa Pillow
python tests/minimal-classic/verify.py
```

The verifier uses Lupa's Lua 5.1 runtime. It compiles the player/library Lua
files and loads the real queue, actions, portraits and both player layouts
against `fixture.lua`, a small WoW UI/timer fixture.

Coverage includes pause/restart timing, inter-clip gaps, held gates,
queue pagination/removal, source-owned actions, hidden modes, layout switching,
reset/fades, native portrait identity and fallback, queued snapshots after
target changes, delayed appearance refresh, bounded cache size, badge opacity,
panel-corner geometry and all nine runtime textures.

These tests are portable and read the source from this checkout. They do not
need a WoW installation or local backup archive. They do not prove native
rendering behavior; an in-game visual check is still required.

For the existing addon regression suites, also run `make test-player` with
LuaJIT or Lua 5.1 installed.
