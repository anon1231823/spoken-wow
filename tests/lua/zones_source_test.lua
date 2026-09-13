-- The zones addon speaking through the player. Audio.lua and Autoplay.lua are loaded for
-- real against a hand-built ZoneLore table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\SpokenZones\Textures\Book]]

local NewZoneLore = H.NewZoneLore

_G.ZoneLoreAudioPacks = {
    ZoneLoreAudio = { version = 1, addon = "ZoneLoreAudio", quality = "high", bitrate = 128, language = "enUS",
        zones = { [1411] = { file = "1411\\zone", len = 81.9 } },
        subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley-of-trials", len = 35 } } } },
}

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = function() end   -- the login greeting is Autoplay's own business, not this test's
    local Z = stub.LoadZones(ZONES, NewZoneLore())
    Z:SetupAudio()
    Z:SetupAutoplay()
    return env, Z
end

---------------------------------------------------------------- registration and the clip shape
local env, Z = Boot()
local Spoken = _G.Spoken
Expect("the zones addon registers a source with the player", Spoken:GetSource("zones"), Z.source)
Expect("...with its own channel", Z.source:GetChannel(), "Dialog")
Expect("...ZoneLore's queue limit", Z.source.queueLimit, 3)
Expect("...and its own gap", Z.source.interClipGap, 0.25)

local zone = Z:NewLoreSound(1411, nil)
Expect("a zone clip keeps the frozen line id as its key", zone.key, "z:1411")
Expect("...resolves the pack path", zone.path, [[Interface\AddOns\ZoneLoreAudio\Sounds\1411\zone.mp3]])
Expect("...and the pack's duration", zone.length, 81.9)
Expect("...header is the zone", zone.present.header, "Durotar")
Expect("...label is the zone too", zone.present.label, "Durotar")
Expect("...portrait is the book", zone.present.portrait.kind .. ":" .. zone.present.portrait.texture, "texture:" .. BOOK)
Expect("...with Read and Report as actions", zone.present.actions[1].id .. "," .. zone.present.actions[2].id, "read,report")
Expect("...remembers where it came from", zone.mapID, 1411)

local sub = Z:NewLoreSound(1411, "valley of trials")
Expect("a subzone clip keeps the frozen line id", sub.key, "s:1411:valley of trials")
Expect("...header is the zone, label the subzone", sub.present.header .. " / " .. sub.present.label, "Durotar / Valley of Trials")
Expect("no pack entry, no clip", Z:NewLoreSound(1426, nil), nil)

---------------------------------------------------------------- playing through the player
env, Z = Boot(); Spoken = _G.Spoken
local changed = 0
Z:OnAudioChanged(function() changed = changed + 1 end)
Expect("PlayLore plays", Z:PlayLore(1411, nil), true)
Expect("...through the player", Spoken:IsPlaying(), true)
Expect("...on the zones channel", world.playedChannels[1], "Dialog")
Expect("IsPlayingLore for that entry", Z:IsPlayingLore(1411, nil), true)
Expect("...not for another", Z:IsPlayingLore(1411, "valley of trials"), false)
local m, a, paused = Z:GetNowPlaying()
Expect("GetNowPlaying names it", tostring(m) .. "/" .. tostring(a) .. "/" .. tostring(paused), "1411/nil/false")
Expect("the player's AUDIO_CHANGED reaches ZoneLore's own listeners", changed > 0, true)
Expect("starting marks the area heard in the per-character record", Z:HasHeard(1411, nil), true)

local F = env.PlayerFrame
Expect("the player frame shows the zone", F.frame.container.name:GetText(), "Durotar")
Expect("...and two actions", F.frame.actions.shown, 2)
Expect("...Read first", F.frame.actions.buttons[1]:GetText(), "Read")
F.frame.actions.buttons[1]:Click()
Expect("Read opens the lore window on what is playing", Z.shown and Z.shown[1], 1411)
Expect("...and keeps playing by default", Spoken:IsPlaying(), true)
Z:Set("stopAudioOnRead", true)
F:Update()
Expect("...the button relabels with the setting", F.frame.actions.buttons[1]:GetText(), "Read instead")
F.frame.actions.buttons[1]:Click()
Expect("...and then stops", Spoken:GetQueueSize(), 0)

env, Z = Boot(); Spoken = _G.Spoken
Z:PlayLore(1411, nil)
F = env.PlayerFrame
Expect("Report is the zones addon's own button", F.frame.actions.buttons[2]:GetText(), "Report")
F.frame.actions.buttons[2]:Click()
Expect("...targeting what is playing", Z.copied, "https://spoken.test/r/1411/nil")

---------------------------------------------------------------- pause, skip, stop
Z:PauseLore()
Expect("PauseLore pauses the player", Spoken:IsPaused(), true)
Expect("...and ZoneLore sees it", Z:IsPaused(), true)
Z:ResumeLore()
Expect("ResumeLore", Spoken:IsPaused(), false)

local quests = Spoken:RegisterSource("quests", { title = "Quests", addon = "SpokenQuests", order = 1 })
local q = H.Clip()
quests:Enqueue(q)
Z:EnqueueLore(Z:NewLoreSound(1411, "valley of trials"))
Expect("QueueLength counts only the zones addon's waiting clips", Z:QueueLength(), 1)
Z:StopLore()
Expect("StopLore removes the zones clips", Z:IsPlayingLore(), false)
Expect("...and leaves another source's alone", Spoken:GetQueue()[1], q)
Spoken:StopAll()

---------------------------------------------------------------- the combat gate
env, Z = Boot(); Spoken = _G.Spoken
world.inCombat = true
local held = Z:NewLoreSound(1411, nil)
held.autoplay = true
Expect("an autoplayed clip is admitted", Z:EnqueueLore(held), true)
Expect("...but held in combat", Spoken:GetHeldReason(held), "Waiting for combat to end.")
Expect("...and not speaking", Spoken:IsPlaying(), false)
Expect("a clicked clip is not held", Z:PlayLore(1411, "valley of trials"), true)
Spoken:StopAll()
world.inCombat = true
held = Z:NewLoreSound(1411, nil); held.autoplay = true
Z:EnqueueLore(held)
world.inCombat = false
stub.Advance(1)
Expect("leaving combat, the retry tick starts it", Spoken:IsPlaying(held), true)

---------------------------------------------------------------- refusals
env, Z = Boot(); Spoken = _G.Spoken
Z:Set("voiceEnabled", false)
Expect("voice off: PlayLore refuses", Z:PlayLore(1411, nil), false)
Expect("...and queues nothing", Spoken:GetQueueSize(), 0)
Z:Set("voiceEnabled", true)
Expect("no clip: PlayLore refuses", Z:PlayLore(1426, nil), false)
Expect("...and says why", Z.printed[getn(Z.printed)]:find("no narration") ~= nil, true)

---------------------------------------------------------------- the minimap
env, Z = Boot()
local labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("the zones addon adds its entries to the one button", table.concat(labels, "|"),
    "Play/Pause|Stop|Settings|Open lore window|Spoken Zones settings")
Expect("...and registers no button of its own", stub.ldbObjects.SpokenZones, nil)

---------------------------------------------------------------- without the player
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
local saved = _G.Spoken
_G.Spoken = nil
local alone = stub.LoadZones(ZONES, NewZoneLore())
alone:SetupAudio()
Expect("without Spoken, PlayLore refuses rather than erroring", alone:PlayLore(1411, nil), false)
Expect("...and says the player is missing", alone.printed[1] and alone.printed[1]:find("Spoken") ~= nil, true)
Expect("...IsPlayingLore is false", alone:IsPlayingLore(), false)
_G.Spoken = saved

---------------------------------------------------------------- both generations of the pack registry
-- A pack announces itself by writing into a global table, never by folder name, which is
-- why the packs kept their names through the rename. The table is being renamed, so both
-- are read, and a pack that writes into both is listed once.
local function Packs(spokenZones, zoneLore, legacy)
	_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData = spokenZones, zoneLore, legacy
	local Z = select(2, Boot())
	return Z:GetAudioPacks(), Z
end
local function Pack(folder, bitrate)
	return { version = 1, addon = folder, quality = "high", bitrate = bitrate or 128, language = "enUS",
		zones = {}, subzones = {} }
end
local savedPacks = _G.ZoneLoreAudioPacks

local found = Packs(nil, { ZoneLoreAudio = Pack("ZoneLoreAudio") }, nil)
Expect("a pack in the inherited registry is found", #found, 1)
Expect("...by its folder", found[1] and found[1].addon, "ZoneLoreAudio")

found = Packs({ SpokenZonesAudio = Pack("SpokenZonesAudio") }, nil, nil)
Expect("a pack in the new registry is found", #found, 1)
Expect("...by its folder", found[1] and found[1].addon, "SpokenZonesAudio")

-- What a pack built during the transition does: register in both, so an older addon
-- still finds it. It is one installed folder and must be offered once.
local shared = Pack("SpokenZonesAudio")
found = Packs({ SpokenZonesAudio = shared }, { SpokenZonesAudio = shared }, nil)
Expect("a pack registering in both is listed once", #found, 1)

found = Packs({ SpokenZonesAudio = Pack("SpokenZonesAudio", 128) },
	{ ZoneLoreAudio64 = Pack("ZoneLoreAudio64", 64) }, nil)
Expect("two packs across the two registries are both found", #found, 2)
Expect("...still ordered by bitrate", found[1] and found[1].addon, "SpokenZonesAudio")

-- The pre-registry global, which only ever named one folder.
found = Packs(nil, nil, Pack("ZoneLoreAudio"))
Expect("a pack predating either registry is still found", #found, 1)

_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioData = nil, nil
_G.ZoneLoreAudioPacks = savedPacks

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones source tests passed")
