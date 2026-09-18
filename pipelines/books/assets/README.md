# Icons

A gold book on a dark octagonal shield — the same shield the other Spoken addons carry, so
the four read as siblings on a CurseForge profile without being mistaken for each other.

| File | Used for |
|---|---|
| `spoken-books.svg` | the source |
| `spoken-books-512.png` | the CurseForge project avatar for **both** addons |
| `spoken-books-64.png`, `spoken-books-32.png`, `spoken-books-16.png` | small raster fallbacks |

The SVG is the thing to edit. Every PNG here is a render of it, so a change to the shield
means re-exporting all four rather than touching them individually.

## Where they end up

**The addon list** reads `addons/SpokenBooks/Textures/AddonIcon.tga`, a 64×64 uncompressed
TGA built from the 512 PNG by `make books-icon` and committed — an addon has to build on a
machine with no ffmpeg. Both addons carry the same file.

**CurseForge avatars are uploaded through the website**, not shipped in the zip, so the
packaging deliberately leaves this directory out. Upload `spoken-books-512.png` on the
project settings page of both Spoken Books (1701514) and Spoken Books Audio (1701520):
they install as a pair, and two different icons would imply they are alternatives.
