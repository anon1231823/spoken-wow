from tts_cli.flavors import (apply_fallbacks, consensus_flavor, fallback_flavors,
                             flavor_from_sound_name, voice_name)


class TestFlavorFromSoundName:
    def test_reads_the_personality_out_of_a_greeting(self):
        assert flavor_from_sound_name("DwarfFemaleMaternalNPCGreetings") == "maternal"

    def test_reads_farewells_and_pissed_too(self):
        assert flavor_from_sound_name("OrcFemaleShamanNPCFarewells") == "shaman"
        assert flavor_from_sound_name("TrollMaleDarkNPCPissed") == "dark"

    def test_strips_the_vendor_suffix(self):
        """Vendor lines are the same actor reading shopkeeper dialogue, not a new voice."""
        assert flavor_from_sound_name("DwarfMaleGrimVendorNPCGreetings") == "grim"

    def test_reads_names_the_database_truncated(self):
        """vmangos stores sound_entries.name cut to 31 characters, which loses the kind."""
        assert flavor_from_sound_name("DwarfMaleStandardVendorNPCGreet") == "standard"
        assert flavor_from_sound_name("NightElfFemalePriestessNPCGreet") == "priestess"

    def test_maps_undead_to_the_internal_race_name(self):
        assert flavor_from_sound_name("UndeadMaleDarkNPCGreetings") == "dark"

    def test_accepts_a_sound_belonging_to_the_npcs_own_race_and_gender(self):
        assert flavor_from_sound_name("OrcFemaleShamanNPCGreetings", "orc-female") == "shaman"

    def test_rejects_another_races_voice_set(self):
        """Vethsera is a night elf wired to the human female official voice."""
        assert flavor_from_sound_name("HumanFemaleOfficialNPCGreetings", "nightelf-female") is None

    def test_ignores_sounds_that_are_not_npc_voices(self):
        assert flavor_from_sound_name("FrostImpact") is None
        assert flavor_from_sound_name("MurlocAggro") is None
        assert flavor_from_sound_name(None) is None


class TestFallbackFlavors:
    def test_prefers_standard(self):
        resolved = [("orc-male", "standard"), ("orc-male", "guard"), ("orc-male", "guard")]
        assert fallback_flavors(resolved) == {"orc-male": "standard"}

    def test_falls_back_to_the_busiest_flavor_where_there_is_no_standard(self):
        """Four race-genders have no standard voice in the game at all."""
        resolved = [("tauren-male", "warrior"), ("tauren-male", "warrior"),
                    ("tauren-male", "elder")]
        assert fallback_flavors(resolved) == {"tauren-male": "warrior"}

    def test_breaks_ties_alphabetically(self):
        resolved = [("goblin-male", "zany"), ("goblin-male", "gruff")]
        assert fallback_flavors(resolved) == {"goblin-male": "gruff"}

    def test_ignores_race_genders_with_nothing_resolved(self):
        assert fallback_flavors([("narrator-male", None)]) == {}


class TestApplyFallbacks:
    def test_fills_only_the_gaps(self):
        got = apply_fallbacks(["orc-male", "orc-male"], ["guard", None],
                              {"orc-male": "standard"})
        assert got == ["guard", "standard"]

    def test_leaves_a_race_gender_with_no_fallback_alone(self):
        assert apply_fallbacks(["narrator-male"], [None], {}) == [None]


class TestConsensusFlavor:
    def test_takes_the_most_common(self):
        assert consensus_flavor(["guard", "standard", "guard"]) == "guard"

    def test_breaks_ties_alphabetically_so_runs_agree(self):
        assert consensus_flavor(["standard", "guard"]) == "guard"

    def test_ignores_unresolved_members(self):
        assert consensus_flavor([None, "shaman"]) == "shaman"

    def test_is_none_when_nothing_resolved(self):
        assert consensus_flavor([None, None]) is None


class TestVoiceName:
    def test_three_parts_with_a_flavor(self):
        assert voice_name("orc", "female", "shaman") == "orc-female-shaman"

    def test_two_parts_without_one(self):
        assert voice_name("narrator", "male", None) == "narrator-male"
