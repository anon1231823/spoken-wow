"""Turn voice/lexicon.json into the PLS file ElevenLabs consumes, and audit it.

Two jobs, because they answer the same question from opposite ends:

  build   - emit voice/lexicon.pls, the W3C Pronunciation Lexicon file uploaded to
            ElevenLabs and referenced per request by dictionary id + version id.
  rules   - emit voice/lexicon.rules.json for the add-rules API, which is the same
            content with two knobs PLS XML has no way to express.
  audit   - count how often each entry actually occurs in the corpus, and list the
            names the corpus contains that the lexicon has nothing to say about.

Prefer the rules form. PLS matching is case-sensitive with no override, and the corpus
writes the same name several ways - Aku'mai and Aku'Mai, tauren and Tauren, Qiraji and
qiraji - which is 123 occurrences a PLS file silently declines to fix. The rules API
takes case_sensitive, so one entry covers every spelling.

The audit exists because a lexicon rots in a way a diff cannot show: an entry can be
wrong, and an entry can be for a word nobody says. Frequency is the only honest way to
decide where review effort goes - one wrong rule on Gnomeregan is 117 bad lines, one
wrong rule on Pele'keiki is 18.

Usage:
    python tools/build_lexicon.py build
    python tools/build_lexicon.py rules
    python tools/build_lexicon.py audit
"""
import collections
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEXICON_PATH = os.path.join(_HERE, "voice", "lexicon.json")
PLS_PATH = os.path.join(_HERE, "voice", "lexicon.pls")
RULES_PATH = os.path.join(_HERE, "voice", "lexicon.rules.json")
CORPUS_PATH = os.path.join(_HERE, "corpus", "corpus.json.gz")

PLS_NS = "http://www.w3.org/2005/01/pronunciation-lexicon"


def load_lexicon() -> list:
    with open(LEXICON_PATH, encoding="utf-8") as f:
        return json.load(f)["entries"]


def load_corpus_text() -> list:
    with gzip.open(CORPUS_PATH, "rt", encoding="utf-8") as f:
        return [line["text"] for line in json.load(f)["lines"]]


def build() -> str:
    """Write the PLS file. Returns the path written.

    xml:lang is en-US and alphabet is ipa at the document level; ElevenLabs reads both
    off the root, and a per-lexeme override is not worth the surface area while every
    entry here is English IPA.
    """
    entries = load_lexicon()

    ET.register_namespace("", PLS_NS)
    root = ET.Element(
        f"{{{PLS_NS}}}lexicon",
        {"version": "1.0", "alphabet": "ipa", "{http://www.w3.org/XML/1998/namespace}lang": "en-US"},
    )

    seen = set()
    for entry in entries:
        grapheme = entry["grapheme"]
        if grapheme in seen:
            raise ValueError(f"duplicate grapheme {grapheme!r}; PLS matching would be ambiguous")
        seen.add(grapheme)

        lexeme = ET.SubElement(root, f"{{{PLS_NS}}}lexeme")
        ET.SubElement(lexeme, f"{{{PLS_NS}}}grapheme").text = grapheme
        # PLS spells a respelling as an <alias>, and a pronunciation as a <phoneme>. An entry
        # carries one or the other; see the lexicon's own header for why never both.
        if entry.get("alias"):
            ET.SubElement(lexeme, f"{{{PLS_NS}}}alias").text = entry["alias"]
        else:
            ET.SubElement(lexeme, f"{{{PLS_NS}}}phoneme").text = entry["ipa"]

    ET.indent(root, space="  ")
    tree = ET.ElementTree(root)
    with open(PLS_PATH, "wb") as f:
        f.write(b'<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="utf-8", xml_declaration=False)
        f.write(b"\n")
    return PLS_PATH


def rules() -> str:
    """Write the add-rules payload. Returns the path written.

    case_sensitive is false throughout. No grapheme here collides with an ordinary word
    whose casing changes how it should sound - "thrall" the English noun and Thrall the
    warchief are the same sounds - so matching every spelling costs nothing and catches
    the corpus's inconsistent capitalization.

    word_boundaries stays true: without it "Caer" would fire inside "Caern" and "E'ko"
    inside anything containing those letters.
    """
    payload = {
        "rules": [
            _rule(entry) for entry in load_lexicon()
        ]
    }
    with open(RULES_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return RULES_PATH


def _rule(entry: dict) -> dict:
    """One rule, of whichever kind the entry gives.

    A phoneme rule is exact but only eleven_v3 and eleven_flash_v2 honour it; an alias rule
    is a respelling the model reads instead, approximate but honoured by every model. Both
    can sit in one dictionary, so the lexicon does not have to pick one for all 134 names.
    """
    matching = {
        "string_to_replace": entry["grapheme"],
        "case_sensitive": False,
        "word_boundaries": True,
    }
    if entry.get("alias"):
        return {**matching, "type": "alias", "alias": entry["alias"]}
    return {**matching, "type": "phoneme", "phoneme": entry["ipa"], "alphabet": "ipa"}


def _occurrences(texts: list, grapheme: str) -> int:
    """How many times the corpus says this word.

    Bounded the way ElevenLabs bounds a rule (word_boundaries defaults to true) rather
    than as a bare substring, or "Caer" would score every "Caern" and the count would
    argue for an entry that never fires.
    """
    pattern = re.compile(rf"(?<![\w']){re.escape(grapheme)}(?![\w])")
    return sum(len(pattern.findall(text)) for text in texts)


def audit() -> None:
    entries = load_lexicon()
    texts = load_corpus_text()

    counted = sorted(
        ((_occurrences(texts, e["grapheme"]), e) for e in entries),
        key=lambda pair: -pair[0],
    )

    respelled = sum(1 for entry in entries if entry.get("alias"))
    print(f"{len(entries)} entries, {respelled} respelled and "
          f"{len(entries) - respelled} in IPA\n")
    print(f"{'count':>6}  {'confidence':<10}  {'kind':<6}  grapheme")
    print(f"{'-' * 6}  {'-' * 10}  {'-' * 6}  {'-' * 30}")
    for count, entry in counted:
        kind = "spell" if entry.get("alias") else "ipa"
        print(f"{count:>6}  {entry['confidence']:<10}  {kind:<6}  {entry['grapheme']}")

    dead = [entry["grapheme"] for count, entry in counted if count == 0]
    if dead:
        print(f"\nNever spoken in the corpus ({len(dead)}): {', '.join(dead)}")

    print(f"\nPossessives of lexicon entries ({sum(possessives(texts, known(entries)).values())} "
          "occurrences) - these only inherit the rule if ElevenLabs treats an apostrophe as a "
          "word boundary, which is worth one test render to confirm:")
    for word, count in possessives(texts, known(entries)).most_common(15):
        print(f"{count:>6}  {word}")

    unknown = unmatched_names(texts, known(entries))
    if unknown:
        print("\nApostrophe names with no entry (top 25) - candidates for the next pass:")
        for word, count in unknown.most_common(25):
            print(f"{count:>6}  {word}")


def known(entries: list) -> set:
    return {e["grapheme"] for e in entries}


#: Fictional-name shape: a capital, then letters, then an apostrophe joining another
#: chunk - "Kel'Thuzad", "Aku'mai". Deliberately not \b[A-Z][a-z']+\b, which splits
#: "Zul'Farrak" at the capital F and reports a phantom "Zul'".
APOSTROPHE_NAME = re.compile(r"\b[A-Z][a-zA-Z]*'[A-Za-z]+\b")

#: "Thrall's" is a lexicon entry wearing a suffix, not a new name.
POSSESSIVE = re.compile(r"\b([A-Z][a-zA-Z']*?)'s\b")

#: I'm, you'll, ye've. Contractions share the apostrophe shape and are not names.
CONTRACTION_TAIL = frozenset({"m", "ll", "ve", "d", "re", "s", "t"})


def possessives(texts: list, entries: set) -> collections.Counter:
    """Possessive forms whose stem is a lexicon entry."""
    found = collections.Counter()
    for text in texts:
        for match in POSSESSIVE.finditer(text):
            if match.group(1) in entries:
                found[match.group(0)] += 1
    return found


def unmatched_names(texts: list, entries: set) -> collections.Counter:
    """Apostrophe names the lexicon says nothing about."""
    found = collections.Counter()
    for text in texts:
        for match in APOSTROPHE_NAME.finditer(text):
            word = match.group(0)
            stem, _, tail = word.partition("'")
            if tail.lower() in CONTRACTION_TAIL:
                continue
            if word in entries or stem in entries:
                continue
            found[word] += 1
    return found


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "build"
    if command == "build":
        print(f"wrote {build()}")
    elif command == "rules":
        print(f"wrote {rules()}")
    elif command == "audit":
        audit()
    else:
        sys.exit(f"unknown command {command!r}; expected build, rules or audit")
