"""Turn the project artwork into the BLP the minimap button wears.

    python3 tools/make_minimap_icon.py assets/icon/spoken-player-512.png \
        ../../addons/SpokenPlayer/Textures/MinimapButton.blp

NO FRAME. LibDBIcon draws the icon 17x17 inside "Interface\\Minimap\\MiniMap-TrackingBorder",
so the octagonal gold frame the AddOns-list mark wears would sit inside a second, rounder
frame and read as mud at that size. This crops the frame away and keeps the field and the
glyph, which is why the source is the same 512px render the TGA is made from rather than
artwork of its own: one mark, two crops. LibDBIcon also trims a further 5% off each edge
while the button is not pressed, so nothing that matters may touch the border.

WHY BLP AND NOT TGA. The AddOns-list icon is read by the client's addon list, which takes
either; a texture a frame loads is BLP on every client this ships to, and the 1.12/2.4.3
clients are the reason not to experiment. Palettized (colour encoding 1) with a full 8-bit
alpha plane: that is the BLP2 variant vanilla's own interface art uses, where DXT and the
uncompressed BGRA variant are both later arrivals.

WHY FFMPEG DOES THE QUANTIZING. Pillow is not a dependency of this pipeline and the icon is
not worth making it one; `palettegen`/`paletteuse` do median cut well enough for 1,024
pixels, and an 8-bit BMP is a header, a palette and rows of indices -- no filtering, unlike
PNG -- so reading the result back needs nothing but struct.

ONE PALETTE, EVERY MIP. BLP2 stores a single palette for the whole chain, so the palette is
generated once from the full-size render and every level is mapped through it. paletteuse
may hand back the colours in another order per level, hence the remap against level zero.

Committed rather than converted at build time, like the TGAs, so building an addon needs no
ffmpeg. Re-run it (`make quests-icon`) when the artwork changes.
"""
import argparse
import struct
import subprocess
import sys
import tempfile

SIZE = 32

# The field polygon in spoken-player.svg runs 20..236 of 256 with 42-unit corner chamfers, so
# the largest square lying wholly inside it starts at 41 -- 82 of 512. A looser crop keeps a
# sliver of frame gold in each corner, which at 17 pixels reads as dirt rather than as a frame.
CROP = 82

# The glyph reaches within a few pixels of that square's right edge and LibDBIcon trims a
# further 5% off each side while the button is idle, so the crop is scaled to 28/32 of the
# texture and the rest is field. The colour is the middle stop of the field gradient; the four
# added pixels sit against the gradient's darkest corner, where the difference does not show.
INNER = 28
FIELD = "0x121727"


def artwork(size: int) -> str:
    """The filter chain laying the mark out on a square texture `size` pixels on a side."""
    inner = max(1, round(size * INNER / SIZE))
    offset = (size - inner) // 2
    return (f"crop=in_w-{2 * CROP}:in_h-{2 * CROP}:{CROP}:{CROP},"
            f"scale={inner}:{inner}:flags=lanczos,"
            f"pad={size}:{size}:{offset}:{offset}:{FIELD}")


def render(source: str, size: int, pix_fmt: str) -> bytes:
    """The mark at `size`, as raw pixels in `pix_fmt`."""
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", source,
         "-vf", artwork(size), "-pix_fmt", pix_fmt, "-f", "rawvideo", "-"],
        check=True, capture_output=True)
    return result.stdout


def palette_file(source: str, size: int, out: str) -> None:
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", source,
         "-vf", f"{artwork(size)},format=rgba,"
                "palettegen=max_colors=256:stats_mode=full", out],
        check=True, capture_output=True)


def indexed(source: str, size: int, palette: str, out: str) -> tuple[list[int], list[tuple]]:
    """(indices top-down, palette as RGB tuples) for one mip level."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", source, "-i", palette,
         "-lavfi", f"[0:v]{artwork(size)},format=rgb24[x];"
                   "[x][1:v]paletteuse=dither=none",
         "-pix_fmt", "pal8", "-f", "image2", "-c:v", "bmp", out],
        check=True, capture_output=True)
    return read_bmp(out)


def read_bmp(path: str) -> tuple[list[int], list[tuple]]:
    data = open(path, "rb").read()
    pixel_offset, = struct.unpack("<I", data[10:14])
    header_size, width, height, planes, bpp = struct.unpack("<IiiHH", data[14:30])
    if bpp != 8:
        sys.exit(f"{path} is {bpp}-bit; ffmpeg was asked for pal8")
    table = data[14 + header_size:pixel_offset]
    palette = [tuple(table[i + 2::-1]) for i in range(0, min(len(table), 1024), 4)]

    # BMP rows are bottom-up and padded to four bytes; BLP wants them top-down and packed.
    stride = (width + 3) & ~3
    rows = [list(data[pixel_offset + y * stride:pixel_offset + y * stride + width])
            for y in range(abs(height))]
    if height > 0:
        rows.reverse()
    return [i for row in rows for i in row], palette


def remap(indices: list[int], palette: list[tuple], master: list[tuple]) -> list[int]:
    """Level indices expressed against the master palette."""
    exact = {colour: i for i, colour in enumerate(master)}
    lookup = []
    for colour in palette:
        if colour in exact:
            lookup.append(exact[colour])
        else:  # paletteuse can average two entries; the nearest master colour is the answer.
            lookup.append(min(range(len(master)),
                              key=lambda i: sum((a - b) ** 2
                                                for a, b in zip(master[i], colour))))
    return [lookup[i] for i in indices]


def blp2(levels: list[tuple[list[int], bytes]], palette: list[tuple], size: int) -> bytes:
    """BLP2, colour encoding 1 (palettized), 8-bit alpha in a plane of its own."""
    header_size = 4 + 4 + 4 + 4 + 4 + 16 * 4 + 16 * 4 + 256 * 4
    offsets, sizes, blocks = [0] * 16, [0] * 16, []
    cursor = header_size
    for i, (indices, alpha) in enumerate(levels):
        block = bytes(indices) + alpha
        offsets[i], sizes[i] = cursor, len(block)
        cursor += len(block)
        blocks.append(block)

    table = b"".join(struct.pack("<4B", c[2], c[1], c[0], 0) for c in palette)
    table += bytes(4 * (256 - len(palette)))
    header = struct.pack("<4sI4BII", b"BLP2", 1, 1, 8, 0, 1 if len(levels) > 1 else 0,
                         size, size)
    return (header + struct.pack("<16I", *offsets) + struct.pack("<16I", *sizes)
            + table + b"".join(blocks))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--size", type=int, default=SIZE,
                        help="square edge in pixels, a power of two (default: 32)")
    parser.add_argument("--scratch", default=None,
                        help="where the intermediate palette and BMPs are written "
                             "(default: a temporary directory)")
    args = parser.parse_args()

    if args.size & (args.size - 1):
        sys.exit(f"{args.size} is not a power of two; the client will not load it")

    scratch = args.scratch or tempfile.mkdtemp(prefix="spoken-minimap-")
    palette_png = f"{scratch}/spoken-minimap-palette.png"
    palette_file(args.source, args.size, palette_png)

    levels, master = [], None
    size = args.size
    while size >= 1:
        indices, palette = indexed(args.source, size, palette_png,
                                   f"{scratch}/spoken-minimap-{size}.bmp")
        if master is None:
            master = palette
        else:
            indices = remap(indices, palette, master)
        alpha = render(args.source, size, "rgba")[3::4]
        levels.append((indices, alpha))
        size //= 2

    with open(args.out, "wb") as f:
        f.write(blp2(levels, master, args.size))
    print(f"wrote {args.out} ({args.size}x{args.size}, {len(levels)} mip levels)")
