# Icons

A gold **L** on a dark octagonal shield — the shape is the ZoneLore family mark, and the
`../wow-voiceover` icon is the same shield with a **V**, so the two read as siblings on a
CurseForge profile without being mistaken for each other.

| File | Used for |
|---|---|
| `zonelore-icon.svg` | the source. 256×256 viewBox, no external references, no fonts |
| `zonelore-512.png` | the CurseForge project avatar for **both** addons |
| `zonelore-64.png` | the size an in-game `## IconTexture` would want, if one is ever added |
| `zonelore-32.png`, `zonelore-16.png` | small raster fallbacks |

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
`scripts/package.sh` deliberately does not include this directory, and neither addon
folder contains an image. Upload `zonelore-512.png` on the project settings page of both
ZoneLore and ZoneLore Audio: they install as a pair, and two different icons would imply
they are alternatives to each other.

## Not the in-game addon list

Both `.toc` files carry `## IconTexture: Interface\ICONS\INV_Misc_Book_09`, a stock WoW
icon. Pointing that at this artwork instead means shipping it inside the addon as a **TGA
or BLP** — the client does not read PNG or SVG — at a power-of-two size. That is a real
option, not an oversight; it just costs a binary in the addon folder and a converter in
the toolchain, for an icon shown in one list.
