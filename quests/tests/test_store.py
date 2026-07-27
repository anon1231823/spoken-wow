import os

from tts_cli.store import (import_audio, missing_lines, store_path,
                           stored_files, unmatched_files)

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "fileName": "5-accept", "generatable": True},
        {"lineId": "q:9:accept", "fileName": "9-accept", "generatable": True},
        {"lineId": "q:7:progress", "fileName": "7-progress", "generatable": False},
        {"lineId": "g:abc123", "fileName": "abc123", "generatable": True},
    ],
}


def _source(tmp_path, names):
    root = tmp_path / "src"
    for sub in ("quests", "gossip"):
        (root / sub).mkdir(parents=True)
    for sub, name in names:
        (root / sub / f"{name}.mp3").write_bytes(b"AUDIO-" + name.encode())
    return str(root)


def test_store_path_uses_the_line_id_subfolder():
    assert store_path("/s", {"lineId": "q:5:accept", "fileName": "5-accept"}) == \
        os.path.join("/s", "quests", "5-accept.mp3")
    assert store_path("/s", {"lineId": "g:abc123", "fileName": "abc123"}) == \
        os.path.join("/s", "gossip", "abc123.mp3")


def test_imports_files_that_match_the_corpus(tmp_path):
    src = _source(tmp_path, [("quests", "5-accept"), ("gossip", "abc123")])
    store = str(tmp_path / "audio")

    report = import_audio(src, store, CORPUS)

    assert report["adopted"] == 2
    assert os.path.isfile(os.path.join(store, "quests", "5-accept.mp3"))
    assert os.path.isfile(os.path.join(store, "gossip", "abc123.mp3"))


def test_preserves_file_contents(tmp_path):
    src = _source(tmp_path, [("quests", "5-accept")])
    store = str(tmp_path / "audio")
    import_audio(src, store, CORPUS)
    with open(os.path.join(store, "quests", "5-accept.mp3"), "rb") as f:
        assert f.read() == b"AUDIO-5-accept"


def test_reports_files_with_no_corpus_line(tmp_path):
    """Audio whose text drifted out of vmangos - the addon can never reach it."""
    src = _source(tmp_path, [("quests", "5-accept"), ("quests", "404-accept")])
    store = str(tmp_path / "audio")

    report = import_audio(src, store, CORPUS)

    assert report["adopted"] == 1
    assert report["unmatched"] == ["quests/404-accept.mp3"]
    assert not os.path.exists(os.path.join(store, "quests", "404-accept.mp3"))


def test_does_not_reimport_what_is_already_stored(tmp_path):
    src = _source(tmp_path, [("quests", "5-accept")])
    store = str(tmp_path / "audio")

    import_audio(src, store, CORPUS)
    report = import_audio(src, store, CORPUS)

    assert report["adopted"] == 0
    assert report["alreadyPresent"] == 1


def test_missing_lines_lists_generatable_lines_with_no_audio(tmp_path):
    src = _source(tmp_path, [("quests", "5-accept")])
    store = str(tmp_path / "audio")
    import_audio(src, store, CORPUS)

    missing = missing_lines(store, CORPUS)

    # q:9:accept and g:abc123 are generatable and absent.
    # q:7:progress is absent too but is never synthesized, so it is not a gap.
    assert {l["lineId"] for l in missing} == {"q:9:accept", "g:abc123"}


def test_stored_files_walks_both_subfolders(tmp_path):
    src = _source(tmp_path, [("quests", "5-accept"), ("gossip", "abc123")])
    store = str(tmp_path / "audio")
    import_audio(src, store, CORPUS)

    assert sorted(stored_files(store)) == ["gossip/abc123.mp3", "quests/5-accept.mp3"]


def test_unmatched_files_finds_orphans_already_in_the_store(tmp_path):
    store = str(tmp_path / "audio")
    os.makedirs(os.path.join(store, "quests"))
    open(os.path.join(store, "quests", "5-accept.mp3"), "wb").close()
    open(os.path.join(store, "quests", "404-accept.mp3"), "wb").close()

    assert unmatched_files(store, CORPUS) == ["quests/404-accept.mp3"]


def test_missing_source_directory_is_an_error(tmp_path):
    try:
        import_audio(str(tmp_path / "nope"), str(tmp_path / "audio"), CORPUS)
    except FileNotFoundError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError("expected FileNotFoundError")
