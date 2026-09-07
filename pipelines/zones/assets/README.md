# Icons

A gold **L** on a dark octagonal shield — the shape is the ZoneLore family mark, and the
`../wow-voiceover` icon is the same shield with a **V**, so the two read as siblings on a
CurseForge profile without being mistaken for each other.

| File | Used for |
|---|---|
| `zonelore-icon.svg` | the source. 256×256 viewBox, no external references, no fonts |
| `zonelore-512.png` | the CurseForge project avatar for **both** addons |
| `zonelore-64.png`, `zonelore-32.png`, `zonelore-16.png` | small raster fallbacks |

The SVG is the thing to edit. Every PNG here is a render of it, so a change to the shield
means re-exporting all four rather than touching them individually.

## Where they end up

**The website** does not read this directory. `web/src/app/icon.svg` is a copy, because
Next.js finds the favicon by file convention — a file at `app/icon.svg` becomes the
`<link rel="icon">` with no markup in `layout.tsx` at all, and a path into `../../assets`
would not be traced into the standalone bundle. `web/src/app/apple-icon.png` is the same
image at 180×180 for iOS home screens. Both must be re-copied by hand if the SVG changes;
there are two of them and a build step to keep them in sync would be larger than the copy.

**CurseForge avatars are uploaded through the website**, not shipped in the zip — so
`scripts/package.sh` deliberately does not include this directory. The only image either
addon folder carries is the addon-list icon below. Upload `zonelore-512.png` on the project settings page of both
ZoneLore and ZoneLore Audio: they install as a pair, and two different icons would imply
they are alternatives to each other.

## The in-game addon list

Both addons ship `Textures/AddonIcon.tga` and point `## IconTexture` at it, so the shield
appears beside their names in the client's addon list rather than the stock
`INV_Misc_Book_09` book they used to borrow.

It is a **TGA** because the client reads TGA or BLP and neither PNG nor SVG, 64×64 because
the size must be a power of two, and committed rather than converted at build time so that
building an addon needs no ffmpeg. `make icon` regenerates both copies from
`zonelore-512.png`; run it when the SVG changes and its PNG renders are re-exported.

The two copies are byte-identical on purpose. The addons install as a pair, and giving them
different icons would imply they are alternatives to each other.

`scripts/package-audio.sh` rewrites the path when it stages the standard tier: the texture
lives under the folder it ships in, and `ZoneLoreAudio64` is not `ZoneLoreAudio`. A path
pointing at an addon the player does not have installed shows no icon at all rather than
failing loudly.
