from tts_cli.store import stored_files


def _folder(tmp_path, names):
    root = tmp_path / "audio"
    for sub in ("quests", "gossip"):
        (root / sub).mkdir(parents=True)
    for sub, name in names:
        (root / sub / name).write_bytes(b"AUDIO")
    return str(root)


def test_stored_files_walks_both_subfolders(tmp_path):
    folder = _folder(tmp_path, [("quests", "5-accept.mp3"), ("gossip", "abc123.mp3")])

    assert sorted(stored_files(folder)) == ["gossip/abc123.mp3", "quests/5-accept.mp3"]


def test_stored_files_ignores_what_is_not_audio(tmp_path):
    folder = _folder(tmp_path, [("quests", "5-accept.mp3"), ("quests", ".5-accept.mp3.part"),
                                ("quests", "notes.txt")])

    assert stored_files(folder) == ["quests/5-accept.mp3"]
