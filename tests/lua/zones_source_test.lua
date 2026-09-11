-- The zones addon speaking through the player. Audio.lua and Autoplay.lua are loaded for
-- real against a hand-built ZoneLore table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\ZoneLore\Textures\Book]]

local function NewZoneLore()
    local cfg = { voiceEnabled = true, voiceChannel = "Dialog", autoplay = true, autoplaySubzones = true,
        stopAudioOnRead = false, autoplayExplored = false, debug = false }
    local Z = { printed = {}, heard = {}, zoneChanged = {}, clientLocale = "enUS" }
    Z.L = { QUEUE_HELD_COMBAT = "Waiting for combat to end.", QUEUE_HELD_CINEMATIC = "Waiting for the cinematic to end.",
        QUEUE_HELD_OFF = "Narration is turned off.", READ = "Read", READ_INSTEAD = "Read instead",
        READ_TOOLTIP = "", READ_INSTEAD_TOOLTIP = "", READ_SETTING_HINT = "" }
    Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials" } } }
    function Z:Get(key) return cfg[key] end
    function Z:Set(key, value) cfg[key] = value end
    function Z:GetMapName(id) return ({ [1411] = "Durotar", [1426] = "Dun Morogh" })[id] end
    function Z:GetLanguage() return "enUS" end
    function Z:Print(fmt, ...) table.insert(self.printed, select("#", ...) > 0 and string.format(fmt, ...) or fmt) end
    function Z:ReportURL(mapID, areaKey) return "https://spoken.test/r/" .. mapID .. "/" .. tostring(areaKey) end
    function Z:ShowLoreFor(mapID, areaKey) self.shown = { mapID, areaKey } end
    function Z:ShowCopyLink(url) self.copied = url end
    function Z:MarkHeard(mapID, areaKey) table.insert(self.heard, tostring(mapID) .. "/" .. tostring(areaKey)) end
    function Z:OnZoneChanged(fn) table.insert(self.zoneChanged, fn) end
    function Z:ToggleLoreWindow() self.toggled = true end
    function Z:OpenOptions() self.opened = true end
    return Z
end

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
    "Play/Pause|Stop|Settings|Open lore window|ZoneLore settings")
Expect("...and registers no button of its own", stub.ldbObjects.ZoneLore, nil)

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

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones source tests passed")
