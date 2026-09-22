from tools.export_display_voices import voice_from_dir


def test_names_an_older_voice_set_from_its_directory():
    assert voice_from_dir("taurenmalewarriornpc") == "tauren-male-warrior"
    assert voice_from_dir("nightelffemalepriestessnpc") == "nightelf-female-priestess"


def test_names_a_later_voice_set_the_other_way_round():
    assert voice_from_dir("npcbloodelffemalemilitary") == "bloodelf-female-military"


def test_uses_the_corpus_name_for_undead():
    assert voice_from_dir("undeadmaledarknpc") == "scourge-male-dark"


def test_drops_the_vendor_reading_of_the_same_actor():
    assert voice_from_dir("dwarfmalegrimvendornpc") == "dwarf-male-grim"


def test_names_nothing_it_cannot_read():
    assert voice_from_dir("squirrelflying") is None
    assert voice_from_dir("humanmalenpc") is None
