-- The zones addon's narration across languages: an entry the active pack lacks, and where a
-- report on a clip goes. Language selection itself is older than this file and lives in
-- Language.lua. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
stub.LoadSpoken(SPOKEN)
stub.SetAddOns({ { folder = "SpokenZones", meta = { Version = "9.9.9" } } })

local MAP, BOTH, ONLY_ENGLISH = 1411, "valley of trials", "sen'jin village"

--- Load the addon with these packs installed.
local function Install(packs)
    _G.SpokenZonesDB = {}
    _G.SpokenZonesAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenZonesAudioPacks[pack.addon] = pack
    end
    return H.LoadZones(ZONES)
end

local function Pack(addon, language, subzones)
    return { version = 1, addon = addon, language = language, bitrate = 128,
        zones = {}, subzones = { [MAP] = subzones } }
end

local ENGLISH = Pack("SpokenZonesAudio", "enUS", {
    [BOTH] = { file = "en-valley", len = 3 }, [ONLY_ENGLISH] = { file = "en-senjin", len = 3 } })
local GERMAN = Pack("SpokenZonesAudio_deDE", "deDE", { [BOTH] = { file = "de-valley", len = 3 } })
local FRENCH = Pack("SpokenZonesAudio_frFR", "frFR", { [ONLY_ENGLISH] = { file = "fr-senjin", len = 3 } })

---------------------------------------------------------------- A. the active pack, then English
local Z = Install({ ENGLISH, GERMAN, FRENCH })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
local _, _, pack = Z:GetAudioClip(MAP, BOTH)
Expect("A. the active pack answers what it has", pack and pack.addon, "SpokenZonesAudio_deDE")
_, _, pack = Z:GetAudioClip(MAP, ONLY_ENGLISH)
Expect("A. an entry it lacks falls back to English, not to French", pack and pack.addon, "SpokenZonesAudio")

Z = Install({ ENGLISH, FRENCH })
Z:SetActiveAudioPack("SpokenZonesAudio")
Expect("A. an English pack falls back to nothing else", Z:GetAudioClip(MAP, "durotar coast"), nil)

---------------------------------------------------------------- B. the language narration plays in
Z = Install({ ENGLISH, GERMAN })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
Expect("B. the active pack's language", Z:GetPackLanguage(), "deDE")
Z = Install({})
Expect("B. with no pack, the language being read", Z:GetPackLanguage(), Z:GetLanguage())

---------------------------------------------------------------- C. reports
Z = Install({ ENGLISH })
Expect("C. the lore window's report is filed under the language being read",
    Z:ReportURL(MAP, BOTH), "https://lore.rusty.one/" .. Z:GetLanguage() .. "/r/1411/valley-of-trials")
Expect("C. a clip's report under the language it was narrated in",
    Z:ReportURL(MAP, BOTH, "deDE"), "https://lore.rusty.one/deDE/r/1411/valley-of-trials")

---------------------------------------------------------------- D. contributions
Z = Install({ ENGLISH, GERMAN })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
Z.Zones[1537] = { name = "Ironforge", pending = true }
local envelope = Z:CaptureContribution(1537, nil)
Expect("D. the locale is the client's", envelope:match("\nlocale=enUS\n") ~= nil, true)
Expect("D. ...and the language narration plays in goes beside it", envelope:match("\npack=deDE\n") ~= nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones language tests passed")
