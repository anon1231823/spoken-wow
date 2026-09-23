-- The language axis of the books addon: which pack reads a page, which index finds it, and
-- where a report goes. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

local PAGE, ONLY_ENGLISH = 15, 16

--- Load the addon on a client in `locale`, with the given packs installed.
local function Install(packs, locale)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.SetLocale(locale or "enUS")
    _G.SpokenBooksDB = nil
    _G.SpokenBooksAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenBooksAudioPacks[pack.addon] = { version = 1, addon = pack.addon,
            language = pack.language, pages = pack.pages }
    end
    _G.SpokenBooksData = {
        version = 1,
        index = { ["Registry"] = { [1] = {} } },
        loose = {},
        pages = { [PAGE] = { book = 1, number = 1 }, [ONLY_ENGLISH] = { book = 1, number = 2 } },
        books = { [1] = { title = "Registry", pages = { PAGE, ONLY_ENGLISH } } },
    }
    local B = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio" }) do
        assert(loadfile(BOOKS .. file .. ".lua"))("SpokenBooks", B)
    end
    B:InitDB()
    return B
end

local ENGLISH = { addon = "SpokenBooksAudio", pages = {
    [PAGE] = { file = "15", len = 2 }, [ONLY_ENGLISH] = { file = "16", len = 2 } } }
local GERMAN = { addon = "SpokenBooksAudio_deDE", language = "deDE", pages = {
    [PAGE] = { file = "15", len = 2 } } }

---------------------------------------------------------------- A. the install that exists today
local B = Install({ ENGLISH })
local clip = B:ClipFor(PAGE)
Expect("A. an English pack declaring nothing reads on an English client",
    clip and clip.path, [[Interface\AddOns\SpokenBooksAudio\Sounds\15.mp3]])
Expect("A. ...as English", clip and clip.language, "enUS")
B = Install({ ENGLISH }, "deDE")
Expect("A. a German client with only English packs still hears English",
    B:ClipFor(PAGE) and B:ClipFor(PAGE).language, "enUS")

---------------------------------------------------------------- B. the voice language, then the fallback
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("B. a German client hears the German pack", B:ClipFor(PAGE).path,
    [[Interface\AddOns\SpokenBooksAudio_deDE\Sounds\15.mp3]])
Expect("B. a page the German pack lacks falls back to English", B:ClipFor(ONLY_ENGLISH).language, "enUS")
SpokenBooksDB.fallbackLanguage = "none"
Expect("B. ...and is silent with no fallback", B:ClipFor(ONLY_ENGLISH), nil)

B = Install({ ENGLISH, GERMAN }, "enUS")
Expect("B. an English client hears English", B:ClipFor(PAGE).language, "enUS")
SpokenBooksDB.voiceLanguage = "deDE"
Expect("B. ...unless it chose German", B:ClipFor(PAGE).language, "deDE")

---------------------------------------------------------------- C. the language the packs speak
B = Install({ ENGLISH }, "deDE")
Expect("C. a German client with only English packs hears English", B:GetPackLanguage(), "enUS")
B = Install({ ENGLISH, GERMAN }, "deDE")
Expect("C. ...and German once a German pack is installed", B:GetPackLanguage(), "deDE")

---------------------------------------------------------------- D. the page on screen, in the client's words
local GERMAN_TEXT = "Das Register der Stadt Hillsbrad."
B = Install({ ENGLISH }, "deDE")
stub.ShowPage({ title = "Stadtregister", number = 1, text = GERMAN_TEXT })
Expect("D. without a German index a German page is not recognised", B:PageOnScreen(), nil)
SpokenBooksData.locales = { deDE = {
    index = { ["Stadtregister"] = { [1] = { [B:ChecksumOf(GERMAN_TEXT)] = PAGE } } },
    loose = {},
} }
Expect("D. with one, it is found by the German title and words", B:PageOnScreen(), PAGE)
stub.SetLocale("enUS")
Expect("D. ...and only on a German client", B:PageOnScreen(), nil)

---------------------------------------------------------------- E. reports
B = Install({ ENGLISH })
Expect("E. an English report keeps its address", B:ReportURL(PAGE, "enUS"),
    "https://spoken.rusty.one/books/r/15")
Expect("E. ...as does one with no language", B:ReportURL(PAGE), "https://spoken.rusty.one/books/r/15")
Expect("E. a German report goes to the German page", B:ReportURL(PAGE, "deDE"),
    "https://spoken.rusty.one/deDE/books/r/15")

---------------------------------------------------------------- in step with SpokenZones
local booksCodes = {}
for _, locale in ipairs(B.LOCALES) do table.insert(booksCodes, locale.code) end
Expect("the language list matches SpokenZones'", table.concat(booksCodes, " "), H.ZonesLocaleCodes(here))

stub.SetLocale("enUS")
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll books language tests passed")
