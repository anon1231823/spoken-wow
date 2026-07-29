-- Seed the pronunciation lexicon, once.
--
-- 0007 created the table; this fills it. From here the row IS the lexicon - not an override
-- of a file, which is what it was until now.
--
-- That earlier arrangement mirrored generation_setting, and for generation settings it is
-- right: those are a handful of numbers a deploy should be able to move. A lexicon is not
-- like that. It is edited from the web UI, entry by entry, in response to hearing something
-- wrong - so a file that shipped inside the release could only ever be a stale snapshot
-- competing with the live data, and "reset to the committed lexicon" meant discarding real
-- work to return to whatever the file happened to say at deploy time.
--
-- voice/lexicon.json stays in the repo, but as provenance and as the input to
-- tools/build_lexicon.py, which generates the PLS and the rules JSON for the CLI path. The
-- web app no longer reads it at runtime, and no longer cares whether it shipped.
--
-- The entries below are therefore a SNAPSHOT taken when this migration was written, not a
-- mirror of the file. Do not regenerate it when the file changes: migrations are recorded
-- once and never re-run, so a later edit here would apply to nobody. Later changes to the
-- lexicon are made in the editor.
--
-- ON CONFLICT DO NOTHING because the row may already exist - anyone who pressed "Save and
-- upload" before this migration has a lexicon of their own, possibly already uploaded, and
-- overwriting it with a snapshot would be the data loss this file is meant to prevent.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release read the file
-- and ignored an unsaved row, so it runs against this state unchanged.

insert into "pronunciation_lexicon" ("id", "entries")
values (true, $lexicon$[
  {
    "grapheme": "Gnomeregan",
    "ipa": "ˈnoʊmɹəɡæn",
    "say": "NOME-reh-gan",
    "confidence": "high",
    "note": "silent G; the single most-mangled word in the corpus",
    "category": "place"
  },
  {
    "grapheme": "Azeroth",
    "ipa": "ˈæzəɹɒθ",
    "say": "AZ-er-oth",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Kalimdor",
    "ipa": "ˈkælɪmdɔɹ",
    "say": "KAL-im-dor",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Lordaeron",
    "ipa": "ˈlɔɹdəɹɒn",
    "say": "LOR-duh-ron",
    "confidence": "high",
    "note": "three syllables, not LOR-day-ron",
    "category": "place"
  },
  {
    "grapheme": "Quel'Thalas",
    "ipa": "kɛlˈθæləs",
    "say": "kel-THAL-us",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Eldre'Thalas",
    "ipa": "ɛlˈdɹeɪθæləs",
    "say": "el-DRAY-thal-us",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Kel'Thuzad",
    "ipa": "kɛlˈθuzæd",
    "say": "kel-THOO-zad",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Naxxramas",
    "ipa": "næksˈɹɑməs",
    "say": "nax-RAH-mus",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Ahn'Qiraj",
    "ipa": "ɑnkɪˈɹɑʒ",
    "say": "ahn-kee-RAHZH",
    "confidence": "check",
    "note": "final consonant is contested: /ʒ/ here, some say /dʒ/",
    "category": "place"
  },
  {
    "grapheme": "Qiraji",
    "ipa": "kɪˈɹɑʒi",
    "say": "kee-RAH-zhee",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "C'Thun",
    "ipa": "kəˈθun",
    "say": "kuh-THOON",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Silithus",
    "ipa": "sɪˈlɪθəs",
    "say": "sil-ITH-us",
    "confidence": "check",
    "note": "vs SIL-ith-us; pick one and keep silithid consistent with it",
    "category": "place"
  },
  {
    "grapheme": "silithid",
    "ipa": "sɪˈlɪθɪd",
    "say": "sil-ITH-id",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Zul'Farrak",
    "ipa": "zulˈfæɹæk",
    "say": "zool-FAR-ak",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Zul'Gurub",
    "ipa": "zulɡəˈɹub",
    "say": "zool-guh-ROOB",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Zandalar",
    "ipa": "ˈzændəlɑɹ",
    "say": "ZAN-duh-lar",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Atal'ai",
    "ipa": "ˈɑtəlaɪ",
    "say": "AH-tuh-lye",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Atal'Hakkar",
    "ipa": "ɑtəlˈhækɑɹ",
    "say": "ah-tal-HAK-ar",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Hakkar",
    "ipa": "ˈhækɑɹ",
    "say": "HAK-ar",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Hakkari",
    "ipa": "həˈkɑɹi",
    "say": "huh-KAR-ee",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Jin'do",
    "ipa": "ˈdʒɪndoʊ",
    "say": "JIN-doh",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Un'Goro",
    "ipa": "ʌnˈɡɔɹoʊ",
    "say": "un-GOR-oh",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Teldrassil",
    "ipa": "tɛlˈdɹæsɪl",
    "say": "tel-DRASS-il",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Darnassus",
    "ipa": "dɑɹˈnæsəs",
    "say": "dar-NASS-us",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Dolanaar",
    "ipa": "doʊləˈnɑɹ",
    "say": "doh-luh-NAR",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Auberdine",
    "ipa": "ˈɔbəɹdin",
    "say": "AW-ber-deen",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Rut'theran",
    "ipa": "ˈɹuθəɹæn",
    "say": "ROO-ther-an",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Ban'ethil",
    "ipa": "bænˈɛθɪl",
    "say": "ban-ETH-il",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Tirisfal",
    "ipa": "ˈtɪɹɪsfɑl",
    "say": "TEER-is-fall",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Desolace",
    "ipa": "ˈdɛsəleɪs",
    "say": "DESS-oh-lace",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Feralas",
    "ipa": "fəˈɹɑləs",
    "say": "fer-AH-lus",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Tanaris",
    "ipa": "təˈnæɹɪs",
    "say": "tuh-NAR-iss",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Uldaman",
    "ipa": "ˈʌldəmæn",
    "say": "UL-duh-man",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Dalaran",
    "ipa": "ˈdæləɹæn",
    "say": "DAL-uh-ran",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Alterac",
    "ipa": "ˈɔltəɹæk",
    "say": "AWL-ter-ak",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Stromgarde",
    "ipa": "ˈstɹɒmɡɑɹd",
    "say": "STROM-gard",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Arathi",
    "ipa": "əˈɹɑθi",
    "say": "uh-RAH-thee",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Arathor",
    "ipa": "ˈæɹəθɔɹ",
    "say": "AR-uh-thor",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Andorhal",
    "ipa": "ˈændɔɹhɔl",
    "say": "AN-dor-hall",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Stratholme",
    "ipa": "ˈstɹæθoʊm",
    "say": "STRATH-ohm",
    "confidence": "check",
    "note": "silent L in Blizzard's VO; plenty of players say STRATH-olm",
    "category": "place"
  },
  {
    "grapheme": "Scholomance",
    "ipa": "ˈskɒləmæns",
    "say": "SKOL-oh-mance",
    "confidence": "high",
    "note": "hard C, not SHOL-",
    "category": "place"
  },
  {
    "grapheme": "Kharanos",
    "ipa": "ˈkæɹənoʊs",
    "say": "KAIR-uh-nohs",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Morogh",
    "ipa": "ˈmɔɹoʊ",
    "say": "MOR-oh",
    "confidence": "check",
    "note": "Dun Morogh; final GH silent, but MOR-og is widely used",
    "category": "place"
  },
  {
    "grapheme": "Modan",
    "ipa": "ˈmoʊdæn",
    "say": "MOH-dan",
    "confidence": "high",
    "note": "Loch Modan",
    "category": "place"
  },
  {
    "grapheme": "Elwynn",
    "ipa": "ˈɛlwɪn",
    "say": "EL-win",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Mulgore",
    "ipa": "ˈmʌlɡɔɹ",
    "say": "MUL-gore",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Durotar",
    "ipa": "ˈdʊɹoʊtɑɹ",
    "say": "DUR-oh-tar",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Orgrimmar",
    "ipa": "ˈɔɹɡɹɪmɑɹ",
    "say": "OR-grim-mar",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Theramore",
    "ipa": "ˈθɛɹəmɔɹ",
    "say": "THER-uh-more",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Gadgetzan",
    "ipa": "ˈɡædʒɪtzæn",
    "say": "GAJ-et-zan",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Azshara",
    "ipa": "æʒˈʃɑɹə",
    "say": "azh-SHAR-uh",
    "confidence": "high",
    "note": "the ZSH is a real /ʒ/, not a plain Z",
    "category": "place"
  },
  {
    "grapheme": "Sen'jin",
    "ipa": "ˈsɛndʒɪn",
    "say": "SEN-jin",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Grom'gol",
    "ipa": "ˈɡɹɒmɡoʊl",
    "say": "GROM-gole",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Zoram",
    "ipa": "ˈzɔɹæm",
    "say": "ZOR-am",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Blackfathom",
    "ipa": "blækˈfæðəm",
    "say": "black-FATH-um",
    "confidence": "high",
    "note": "voiced TH, as in 'fathom'",
    "category": "place"
  },
  {
    "grapheme": "Kraul",
    "ipa": "kɹaʊl",
    "say": "krowl",
    "confidence": "high",
    "note": "Razorfen Kraul; rhymes with 'owl'",
    "category": "place"
  },
  {
    "grapheme": "Winterspring",
    "ipa": "ˈwɪntəɹspɹɪŋ",
    "say": "WINTER-spring",
    "confidence": "high",
    "category": "place"
  },
  {
    "grapheme": "Caer",
    "ipa": "kɑɹ",
    "say": "car",
    "confidence": "check",
    "note": "Caer Darrow; Welsh 'caer', often said 'kair'",
    "category": "place"
  },
  {
    "grapheme": "Thelsamar",
    "ipa": "θɛlˈsɑmɑɹ",
    "say": "thel-SAH-mar",
    "confidence": "check",
    "category": "place"
  },
  {
    "grapheme": "Thrall",
    "ipa": "θɹɔl",
    "say": "thrawl",
    "confidence": "high",
    "note": "kept because the TH is unvoiced and readers sometimes voice it",
    "category": "character"
  },
  {
    "grapheme": "Sylvanas",
    "ipa": "sɪlˈvɑnəs",
    "say": "sil-VAH-nus",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Tyrande",
    "ipa": "tɪˈɹɑndeɪ",
    "say": "tih-RAHN-day",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Cenarius",
    "ipa": "sɪˈnɛɹiəs",
    "say": "seh-NAIR-ee-us",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Cenarion",
    "ipa": "sɪˈnɛɹiən",
    "say": "seh-NAIR-ee-un",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Elune",
    "ipa": "ɪˈlun",
    "say": "eh-LOON",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Ragnaros",
    "ipa": "ˈɹæɡnəɹɒs",
    "say": "RAG-nuh-ross",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Nefarian",
    "ipa": "nɪˈfɛɹiən",
    "say": "neh-FAIR-ee-un",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Arthas",
    "ipa": "ˈɑɹθəs",
    "say": "AR-thus",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Uther",
    "ipa": "ˈjuθəɹ",
    "say": "YOO-ther",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Bolvar",
    "ipa": "ˈboʊlvɑɹ",
    "say": "BOHL-var",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Cairne",
    "ipa": "kɛɹn",
    "say": "cairn",
    "confidence": "high",
    "note": "one syllable, homophone of 'cairn'",
    "category": "character"
  },
  {
    "grapheme": "Magni",
    "ipa": "ˈmæɡni",
    "say": "MAG-nee",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Mekkatorque",
    "ipa": "ˈmɛkətɔɹk",
    "say": "MEK-uh-tork",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Medivh",
    "ipa": "məˈdɪv",
    "say": "meh-DIV",
    "confidence": "high",
    "note": "the VH is a plain V",
    "category": "character"
  },
  {
    "grapheme": "Ysera",
    "ipa": "ɪˈsɛɹə",
    "say": "ih-SAIR-uh",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Staghelm",
    "ipa": "ˈstæɡhɛlm",
    "say": "STAG-helm",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Malfurion",
    "ipa": "mælˈfjʊɹiən",
    "say": "mal-FYOOR-ee-un",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Arugal",
    "ipa": "ˈæɹuɡəl",
    "say": "AR-oo-gul",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Amnennar",
    "ipa": "æmˈnɛnɑɹ",
    "say": "am-NEN-ar",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Charlga",
    "ipa": "ˈtʃɑɹlɡə",
    "say": "CHARL-guh",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Razorflank",
    "ipa": "ˈɹeɪzəɹflæŋk",
    "say": "RAY-zor-flank",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Dathrohan",
    "ipa": "ˈdæθɹoʊhæn",
    "say": "DATH-roh-han",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Naralex",
    "ipa": "ˈnæɹəlɛks",
    "say": "NAR-uh-leks",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Theradras",
    "ipa": "θəˈɹɑdɹəs",
    "say": "ther-AH-drus",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Zaetar",
    "ipa": "ˈzeɪtɑɹ",
    "say": "ZAY-tar",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Valthalak",
    "ipa": "ˈvælθəlæk",
    "say": "VAL-thuh-lak",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Silverlaine",
    "ipa": "ˈsɪlvəɹleɪn",
    "say": "SIL-ver-lane",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Barov",
    "ipa": "ˈbæɹɒv",
    "say": "BAR-ov",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Norgannon",
    "ipa": "ˈnɔɹɡənɒn",
    "say": "NOR-gan-non",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Agamaggan",
    "ipa": "ˌæɡəˈmæɡən",
    "say": "ag-uh-MAG-un",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Aku'mai",
    "ipa": "ˈɑkumaɪ",
    "say": "AH-koo-my",
    "confidence": "check",
    "category": "character"
  },
  {
    "grapheme": "Thunderbrew",
    "ipa": "ˈθʌndəɹbɹu",
    "say": "THUN-der-broo",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Runetotem",
    "ipa": "ˈɹuntoʊtəm",
    "say": "ROON-toh-tum",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Bloodhoof",
    "ipa": "ˈblʌdhʊf",
    "say": "BLUD-hoof",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Trollbane",
    "ipa": "ˈtɹoʊlbeɪn",
    "say": "TROLL-bane",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Lightbringer",
    "ipa": "ˈlaɪtbɹɪŋəɹ",
    "say": "LIGHT-bring-er",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Sparklematic",
    "ipa": "ˌspɑɹkəlˈmætɪk",
    "say": "spark-uh-MAT-ik",
    "confidence": "high",
    "category": "character"
  },
  {
    "grapheme": "Sul'thraze",
    "ipa": "sʌlˈθɹeɪz",
    "say": "sul-THRAYZ",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Trol'kalar",
    "ipa": "tɹoʊlˈkɑlɑɹ",
    "say": "trol-KAH-lar",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Mosh'aru",
    "ipa": "mɒʃˈɑɹu",
    "say": "mosh-AH-roo",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Gri'lek",
    "ipa": "ˈɡɹilɛk",
    "say": "GREE-lek",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Jammal'an",
    "ipa": "dʒəˈmɑlæn",
    "say": "juh-MAH-lan",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Mai'Zoth",
    "ipa": "maɪˈzɒθ",
    "say": "my-ZOTH",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Lar'korwi",
    "ipa": "lɑɹˈkɔɹwi",
    "say": "lar-KOR-wee",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Mar'alith",
    "ipa": "mɑɹˈælɪθ",
    "say": "mar-AL-ith",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Mor'zul",
    "ipa": "mɔɹˈzul",
    "say": "mor-ZOOL",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Gor'mul",
    "ipa": "ɡɔɹˈmul",
    "say": "gor-MOOL",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Rin'ji",
    "ipa": "ˈɹɪndʒi",
    "say": "RIN-jee",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Zando'zan",
    "ipa": "ˈzændoʊzæn",
    "say": "ZAN-doh-zan",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Bath'rah",
    "ipa": "ˈbɑθɹɑ",
    "say": "BAHTH-rah",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Jen'shan",
    "ipa": "ˈdʒɛnʃæn",
    "say": "JEN-shan",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "E'ko",
    "ipa": "ˈɛkoʊ",
    "say": "EK-oh",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Pele'keiki",
    "ipa": "ˌpɛleɪˈkeɪki",
    "say": "pel-ay-KAY-kee",
    "confidence": "check",
    "note": "Hawaiian-styled troll name",
    "category": "lesser"
  },
  {
    "grapheme": "Mau'ari",
    "ipa": "maʊˈɑɹi",
    "say": "mow-AH-ree",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Throm'ka",
    "ipa": "ˈθɹɒmkɑ",
    "say": "THROM-kah",
    "confidence": "check",
    "note": "orcish greeting",
    "category": "lesser"
  },
  {
    "grapheme": "Hive'Regal",
    "ipa": "haɪvˈɹiɡəl",
    "say": "hive-REE-gul",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Hive'Zora",
    "ipa": "haɪvˈzɔɹə",
    "say": "hive-ZOR-uh",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "Hive'Ashi",
    "ipa": "haɪvˈɑʃi",
    "say": "hive-AH-shee",
    "confidence": "check",
    "category": "lesser"
  },
  {
    "grapheme": "gnoll",
    "ipa": "noʊl",
    "say": "nole",
    "confidence": "high",
    "note": "silent G, like gnome",
    "category": "creature"
  },
  {
    "grapheme": "murloc",
    "ipa": "ˈmɜɹlɒk",
    "say": "MUR-lok",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "kobold",
    "ipa": "ˈkoʊboʊld",
    "say": "KOH-bold",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "quilboar",
    "ipa": "ˈkwɪlbɔɹ",
    "say": "KWIL-bore",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "furbolg",
    "ipa": "ˈfɜɹboʊlɡ",
    "say": "FUR-bolg",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "naga",
    "ipa": "ˈnɑɡə",
    "say": "NAH-guh",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "kodo",
    "ipa": "ˈkoʊdoʊ",
    "say": "KOH-doh",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "tauren",
    "ipa": "ˈtɔɹɛn",
    "say": "TOR-en",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "satyr",
    "ipa": "ˈseɪtəɹ",
    "say": "SAY-ter",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "centaur",
    "ipa": "ˈsɛntɔɹ",
    "say": "SEN-tor",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "worgen",
    "ipa": "ˈwɔɹɡɛn",
    "say": "WOR-gen",
    "confidence": "high",
    "note": "hard G",
    "category": "creature"
  },
  {
    "grapheme": "hippogryph",
    "ipa": "ˈhɪpəɡɹɪf",
    "say": "HIP-oh-grif",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "wyvern",
    "ipa": "ˈwaɪvəɹn",
    "say": "WY-vern",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "Defias",
    "ipa": "dɪˈfaɪəs",
    "say": "deh-FY-us",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "Scourge",
    "ipa": "skɜɹdʒ",
    "say": "skurj",
    "confidence": "high",
    "category": "creature"
  },
  {
    "grapheme": "Forsaken",
    "ipa": "fɔɹˈseɪkən",
    "say": "for-SAY-ken",
    "confidence": "high",
    "category": "creature"
  }
]$lexicon$::jsonb)
on conflict ("id") do nothing;
