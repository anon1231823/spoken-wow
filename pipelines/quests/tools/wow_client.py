"""
Read game data out of a local World of Warcraft install: files by FileDataID, and DB2 tables.

Enough of CASC (the client's local archive) and WDC5 (its table format) to answer questions
the server data cannot, like which voice set an appearance speaks with. Tables are decoded
against WoWDBDefs, and encrypted content is decrypted with the community TACT key list; a
chunk whose key is not public comes back zeroed, which is what the client itself does.

Both are downloaded on first use into a cache directory. Reading only, never writing: the
install is the user's game.

Usage:
    client = Client("wow_classic_beta")            # a Product from .build.info
    rows = client.table("CreatureDisplayInfo")      # {id: {column: value}}
    data = client.read(7744795)                     # a file's bytes
"""

from __future__ import annotations

import glob
import os
import re
import struct
import urllib.request
import zlib
from pathlib import Path

DEFAULT_INSTALL = Path("/Applications/World of Warcraft")
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "spoken-wow-client"
DBD_URL = "https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/{}.dbd"
KEYS_URL = "https://raw.githubusercontent.com/wowdev/TACTKeys/master/WoW.txt"

# The FileDataIDs of the tables this project reads. Stable across builds: a table's file id
# is assigned once and kept.
TABLES = {
    "CreatureDisplayInfo": 1108759,
    "CreatureModelData": 1365368,
    "NPCSounds": 1282621,
    "SoundKitEntry": 1237435,
}


def cached(url: str, name: str) -> Path:
    path = CACHE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    return path


class Client:
    def __init__(self, product: str, install: Path = DEFAULT_INSTALL):
        self.install = install
        self.data = install / "Data"
        build_key, self.version = self._build_info(product)
        self.build = self._config(build_key)
        self._load_indices()
        self.encoding = self._parse_encoding(self._read_ekey(self.build["encoding"][1]))
        self.root = self._parse_root(self._read_ekey(self.encoding[bytes.fromhex(self.build["root"][0])]))
        self.keys = _load_keys()

    # -- .build.info and configs ----------------------------------------------------------

    def _build_info(self, product: str) -> tuple[str, str]:
        lines = (self.install / ".build.info").read_text().splitlines()
        head = [h.split("!")[0] for h in lines[0].split("|")]
        for line in lines[1:]:
            row = dict(zip(head, line.split("|")))
            if row["Product"] == product:
                return row["Build Key"], row["Version"]
        raise KeyError(f"{product} is not installed in {self.install}")

    def _config(self, key: str) -> dict[str, list[str]]:
        out = {}
        for line in (self.data / "config" / key[:2] / key[2:4] / key).read_text().splitlines():
            if " = " in line:
                name, value = line.split(" = ", 1)
                out[name] = value.split()
        return out

    # -- local archives -------------------------------------------------------------------

    def _load_indices(self) -> None:
        # One .idx per bucket is current: the highest version of each.
        latest: dict[str, tuple[int, str]] = {}
        for path in glob.glob(str(self.data / "data" / "*.idx")):
            name = os.path.basename(path)
            bucket, version = name[:2], int(name[2:10], 16)
            if bucket not in latest or latest[bucket][0] < version:
                latest[bucket] = (version, path)
        self.index: dict[bytes, tuple[int, int, int]] = {}
        for _, path in latest.values():
            raw = Path(path).read_bytes()
            header_size, _ = struct.unpack_from("<II", raw, 0)
            _, _, _, size_len, offset_len, key_len, offset_bits, _ = struct.unpack_from("<HBBBBBBQ", raw, 8)
            pos = (8 + header_size + 15) & ~15
            block_size, _ = struct.unpack_from("<II", raw, pos)
            pos += 8
            entry = key_len + offset_len + size_len
            mask = (1 << offset_bits) - 1
            for q in range(pos, pos + block_size - entry + 1, entry):
                key = raw[q : q + key_len]
                offset = int.from_bytes(raw[q + key_len : q + key_len + offset_len], "big")
                size = int.from_bytes(raw[q + key_len + offset_len : q + entry], "little")
                self.index.setdefault(key, (offset >> offset_bits, offset & mask, size))

    def _read_ekey(self, ekey: str) -> bytes:
        archive, offset, size = self.index[bytes.fromhex(ekey)[:9]]
        with open(self.data / "data" / f"data.{archive:03d}", "rb") as f:
            f.seek(offset + 30)  # past the per-file header
            return self._blte(f.read(size - 30))

    def _parse_encoding(self, raw: bytes) -> dict[bytes, str]:
        assert raw[:2] == b"EN", "not an encoding file"
        ckey_len, ekey_len = raw[3], raw[4]
        (page_kb,) = struct.unpack_from(">H", raw, 5)
        (pages,) = struct.unpack_from(">I", raw, 9)
        (espec_size,) = struct.unpack_from(">I", raw, 18)
        start = 22 + espec_size + pages * 32
        out = {}
        for page in range(pages):
            q = start + page * page_kb * 1024
            end = q + page_kb * 1024
            while q + 6 <= end and raw[q]:
                count = raw[q]
                ckey = raw[q + 6 : q + 6 + ckey_len]
                out[ckey] = raw[q + 6 + ckey_len : q + 6 + ckey_len + ekey_len].hex()
                q += 6 + ckey_len + count * ekey_len
        return out

    def _parse_root(self, raw: bytes) -> dict[int, bytes]:
        assert raw[:4] == b"TSFM", "not a WoW root file"
        header_size, version = struct.unpack_from("<II", raw, 4)
        if header_size in (0x18,) or version in (1, 2):
            pos = header_size
        else:
            version, pos = 1, 12
        out: dict[int, bytes] = {}
        while pos < len(raw):
            if version == 2:
                count, locale, flags1, flags2 = struct.unpack_from("<IIII", raw, pos)
                content = flags1 | flags2 | (raw[pos + 16] << 17)
                pos += 17
            else:
                count, content, locale = struct.unpack_from("<III", raw, pos)
                pos += 12
            deltas = struct.unpack_from(f"<{count}i", raw, pos)
            pos += 4 * count
            ckeys = [raw[pos + 16 * i : pos + 16 * i + 16] for i in range(count)]
            pos += 16 * count
            if not content & 0x10000000:  # name hashes follow unless the block has none
                pos += 8 * count
            english = locale & 0x2 or locale == 0xFFFFFFFF
            fid = -1
            for delta, ckey in zip(deltas, ckeys):
                fid += delta + 1
                if english or fid not in out:
                    out[fid] = ckey
        return out

    def read(self, fdid: int) -> bytes:
        return self._read_ekey(self.encoding[self.root[fdid]])

    # -- BLTE -----------------------------------------------------------------------------

    def _blte(self, raw: bytes) -> bytes:
        assert raw[:4] == b"BLTE", "not a BLTE stream"
        (header_size,) = struct.unpack_from(">I", raw, 4)
        if header_size == 0:
            return self._chunk(raw[8:], 0, 0)
        count = int.from_bytes(raw[9:12], "big")
        pos, data, out = 12, header_size, []
        for index in range(count):
            compressed, decompressed = struct.unpack_from(">II", raw, pos)
            pos += 24
            out.append(self._chunk(raw[data : data + compressed], index, decompressed))
            data += compressed
        return b"".join(out)

    def _chunk(self, c: bytes, index: int, size: int) -> bytes:
        mode = c[:1]
        if mode == b"N":
            return c[1:]
        if mode == b"Z":
            return zlib.decompress(c[1:])
        if mode == b"F":
            return self._blte(c[1:])
        if mode == b"E":
            name_len = c[1]
            key_name = int.from_bytes(c[2 : 2 + name_len], "little")
            p = 2 + name_len
            iv = bytearray(c[p + 1 : p + 1 + c[p]])
            p += 1 + c[p]
            if key_name not in self.keys or c[p : p + 1] != b"S":
                return bytes(size)
            for i in range(4):
                iv[i] ^= (index >> (i * 8)) & 0xFF
            return self._chunk(salsa20(self.keys[key_name], bytes(iv).ljust(8, b"\0"), c[p + 1 :]), index, size)
        raise ValueError(f"unknown BLTE chunk mode {mode!r}")

    # -- DB2 ------------------------------------------------------------------------------

    def table(self, name: str) -> dict[int, dict]:
        """Every row of a table, by id, with WoWDBDefs' column names for this build."""
        build = ".".join(self.version.split(".")[:4])
        definition = cached(DBD_URL.format(name), f"dbd/{name}.dbd").read_text()
        return read_wdc(self.read(TABLES[name]), dbd_columns(definition, build))


def _load_keys() -> dict[int, bytes]:
    keys = {}
    for line in cached(KEYS_URL, "WoW.txt").read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2 and len(parts[1]) == 32:
            keys[int(parts[0], 16)] = bytes.fromhex(parts[1])
    return keys


def _rotl(v: int, c: int) -> int:
    return ((v << c) & 0xFFFFFFFF) | (v >> (32 - c))


def salsa20(key: bytes, nonce: bytes, data: bytes) -> bytes:
    """Salsa20/20 with a 16-byte key, as TACT encrypts with it."""
    k = struct.unpack("<4I", key)
    n = struct.unpack("<2I", nonce)
    c = struct.unpack("<4I", b"expand 16-byte k")
    out = bytearray(len(data))
    for block in range((len(data) + 63) // 64):
        state = [c[0], *k, c[1], *n, block & 0xFFFFFFFF, block >> 32, c[2], *k, c[3]]
        x = state[:]
        for _ in range(10):
            for a, b, cc, d in ((0, 4, 8, 12), (5, 9, 13, 1), (10, 14, 2, 6), (15, 3, 7, 11),
                                (0, 1, 2, 3), (5, 6, 7, 4), (10, 11, 8, 9), (15, 12, 13, 14)):
                x[b] ^= _rotl((x[a] + x[d]) & 0xFFFFFFFF, 7)
                x[cc] ^= _rotl((x[b] + x[a]) & 0xFFFFFFFF, 9)
                x[d] ^= _rotl((x[cc] + x[b]) & 0xFFFFFFFF, 13)
                x[a] ^= _rotl((x[d] + x[cc]) & 0xFFFFFFFF, 18)
        stream = struct.pack("<16I", *[(x[i] + state[i]) & 0xFFFFFFFF for i in range(16)])
        lo = block * 64
        piece = data[lo : lo + 64]
        out[lo : lo + len(piece)] = bytes(p ^ q for p, q in zip(piece, stream))
    return bytes(out)


# -- WoWDBDefs and WDC5 ---------------------------------------------------------------------

COLUMN = re.compile(r"(?:\$([a-z,]+)\$)?(\w+)(?:<u?\d+>)?(?:\[(\d+)\])?")


def dbd_columns(definition: str, build: str) -> list[dict]:
    """The columns of the definition block that lists `build`, in storage order."""
    for block in definition.split("\n\n"):
        lines = block.strip().splitlines()
        if not any(line.startswith("BUILD ") and build in line for line in lines):
            continue
        columns = []
        for line in lines:
            if line.startswith(("BUILD", "LAYOUT", "COMMENT", "COLUMNS")) or not line.strip():
                continue
            match = COLUMN.match(line.strip())
            annotations = (match.group(1) or "").split(",")
            columns.append({
                "name": match.group(2),
                "array": int(match.group(3) or 1),
                "noninline": "noninline" in annotations,
                "relation": "relation" in annotations,
            })
        return columns
    raise KeyError(f"no definition for build {build}; update WoWDBDefs or the cache")


def _bits(record: bytes, offset: int, size: int) -> int:
    start = offset >> 3
    value = int.from_bytes(record[start : start + (((offset & 7) + size + 7) >> 3)], "little")
    return (value >> (offset & 7)) & ((1 << size) - 1)


def read_wdc(raw: bytes, columns: list[dict]) -> dict[int, dict]:
    magic = raw[:4]
    if magic not in (b"WDC5", b"WDC4", b"WDC3"):
        raise ValueError(f"not a WDC table ({magic!r})")
    pos = 4 + (4 + 128 if magic == b"WDC5" else 0)
    (_, field_count, record_size, _, _, _, _, _, _, flags, id_index, _, _, _,
     storage_size, common_size, pallet_size, section_count) = struct.unpack_from("<9IHH7I", raw, pos)
    if flags & 1:
        raise NotImplementedError("sparse tables are not supported")
    pos += 68
    sections = [struct.unpack_from("<Q8I", raw, pos + 40 * i) for i in range(section_count)]
    pos += 40 * section_count + 4 * field_count
    storage = [struct.unpack_from("<HHIIIII", raw, pos + 24 * i) for i in range(storage_size // 24)]
    pos += storage_size

    pallets, commons = [], []
    pallet_pos, common_pos = pos, pos + pallet_size
    for _, _, extra, kind, _, _, _ in storage:
        if kind in (3, 4):
            pallets.append(struct.unpack_from(f"<{extra // 4}I", raw, pallet_pos))
            pallet_pos += extra
        else:
            pallets.append(())
        if kind == 2:
            pairs = struct.unpack_from(f"<{extra // 4}I", raw, common_pos)
            commons.append(dict(zip(pairs[0::2], pairs[1::2])))
            common_pos += extra
        else:
            commons.append({})

    stored = [c for c in columns if not c["noninline"]]
    if len(stored) != field_count:
        raise ValueError(f"definition has {len(stored)} stored columns, table has {field_count}")
    id_name = next((c["name"] for c in columns if c["noninline"] and not c["relation"]), None)
    relation_name = next((c["name"] for c in columns if c["noninline"] and c["relation"]), None)

    rows: dict[int, dict] = {}
    for tact_key, offset, count, strings, _, id_size, relation_size, _, copy_count in sections:
        if not count:
            continue
        records = [raw[offset + i * record_size : offset + (i + 1) * record_size] for i in range(count)]
        if tact_key and not any(records[0]):
            continue  # an encrypted section this client was not given the key for
        q = offset + count * record_size + strings
        ids = struct.unpack_from(f"<{id_size // 4}I", raw, q) if id_size else None
        q += id_size
        copies = [struct.unpack_from("<II", raw, q + 8 * i) for i in range(copy_count)]
        q += 8 * copy_count
        relations = {}
        if relation_size:
            (entries,) = struct.unpack_from("<I", raw, q)
            for i in range(entries):
                foreign, index = struct.unpack_from("<II", raw, q + 12 + 8 * i)
                relations[index] = foreign
        for i, record in enumerate(records):
            values: dict[str, list] = {}
            for column, (bit_offset, bit_size, _, kind, default, _, array) in zip(stored, storage):
                if kind == 0:
                    each = bit_size // column["array"]
                    values[column["name"]] = [_bits(record, bit_offset + k * each, each) for k in range(column["array"])]
                elif kind in (1, 5):
                    values[column["name"]] = [_bits(record, bit_offset, bit_size)]
                elif kind == 3:
                    values[column["name"]] = [pallets[stored.index(column)][_bits(record, bit_offset, bit_size)]]
                elif kind == 4:
                    at = _bits(record, bit_offset, bit_size) * array
                    values[column["name"]] = list(pallets[stored.index(column)][at : at + array])
            row_id = ids[i] if ids else values[stored[id_index]["name"]][0]
            for fi, column in enumerate(stored):
                if storage[fi][3] == 2:
                    values[column["name"]] = [commons[fi].get(row_id, storage[fi][4])]
            if relation_name:
                values[relation_name] = [relations.get(i)]
            if id_name:
                values[id_name] = [row_id]
            rows[row_id] = {k: v[0] if len(v) == 1 else v for k, v in values.items()}
        for new, old in copies:
            if old in rows:
                rows[new] = {**rows[old], **({id_name: new} if id_name else {})}
    return rows
