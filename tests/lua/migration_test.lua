-- Renaming an addon folder orphans its SavedVariables file: the client names the file
-- after the folder and never loads it again. Tombstone folders keep the old files loading,
-- and this is what each addon does with them on first login. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local QUESTS = here .. "/../../addons/SpokenQuests/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

local function Clean()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    _G.VoiceOverDB, _G.SpokenQuestsDB, _G.SpokenPlayerDB = nil, nil, nil
    _G.ZoneLoreDB, _G.ZoneLoreCharDB, _G.ZoneLoreQueueDB, _G.SpokenZonesDB, _G.SpokenZonesCharDB = nil, nil, nil, nil, nil
end

---------------------------------------------------------------- the player seeds itself from the quests addon
Clean()
_G.VoiceOverDB = { profiles = { Default = {
    SoundQueueUI = { LockFrame = true, FrameScale = 0.9, FrameStrata = "MEDIUM", HidePortrait = true, HideFrame = false },
    MinimapButton = { LibDBIcon = { minimapPos = 123, hide = false }, Commands = { LeftButton = "Options" } },
    Audio = { SoundChannel = 5, GossipFrequency = 3, AutoToggleDialog = false },
} }, char = { ["Tester - Realm"] = { IsPaused = true } } }
local env = stub.LoadSpoken(SPOKEN)
local cfg = env.Addon.db.profile
Expect("frame scale carried over", cfg.Frame.FrameScale, 0.9)
Expect("frame lock carried over", cfg.Frame.LockFrame, true)
Expect("hide-portrait carried over", cfg.Frame.HidePortrait, true)
Expect("minimap position carried over", cfg.Minimap.LibDBIcon.minimapPos, 123)
Expect("the sound channel enum becomes its name", cfg.Audio.SoundChannel, "Dialog")
Expect("silencing the game's dialogue carries over", cfg.Audio.AutoToggleDialog, false)
Expect("the migration is recorded", env.Addon.db.global.migratedFrom, "VoiceOverRedux")
Expect("...and does not touch the quests addon's own settings", _G.VoiceOverDB.profiles.Default.Audio.GossipFrequency, 3)

-- Second login: the player's own values win from now on.
cfg.Frame.FrameScale = 1.5
_G.VoiceOverDB.profiles.Default.SoundQueueUI.FrameScale = 0.4
env = stub.LoadSpoken(SPOKEN)
Expect("a later login does not re-seed", env.Addon.db.profile.Frame.FrameScale, 1.5)

---------------------------------------------------------------- ...or from the zones addon when that is all there is
Clean()
_G.ZoneLoreQueueDB = { profiles = { Default = { SoundQueueUI = { FrameScale = 0.8, LockFrame = false } } } }
_G.ZoneLoreDB = { minimapPos = 99, hide = true, voiceChannel = "Music" }
env = stub.LoadSpoken(SPOKEN)
Expect("frame scale from the zones addon's queue settings", env.Addon.db.profile.Frame.FrameScale, 0.8)
Expect("minimap position from the zones addon's own table", env.Addon.db.profile.Minimap.LibDBIcon.minimapPos, 99)
Expect("...and its hidden state", env.Addon.db.profile.Minimap.LibDBIcon.hide, true)
Expect("the channel comes from the zones addon when it is all there is",
    env.Addon.db.profile.Audio.SoundChannel, "Music")
Expect("recorded as from ZoneLore", env.Addon.db.global.migratedFrom, "ZoneLore")

-- Both present: quests wins, being the older addon.
Clean()
_G.VoiceOverDB = { profiles = { Default = { SoundQueueUI = { FrameScale = 0.9 }, MinimapButton = { LibDBIcon = { minimapPos = 123 } }, Audio = { SoundChannel = 1 } } } }
_G.ZoneLoreQueueDB = { profiles = { Default = { SoundQueueUI = { FrameScale = 0.8 } } } }
_G.ZoneLoreDB = { minimapPos = 99, voiceChannel = "Music" }
env = stub.LoadSpoken(SPOKEN)
Expect("both present: the quests addon's frame wins", env.Addon.db.profile.Frame.FrameScale, 0.9)
Expect("both present: the quests addon's channel wins", env.Addon.db.profile.Audio.SoundChannel, "Master")
Expect("both present: the quests addon's minimap wins", env.Addon.db.profile.Minimap.LibDBIcon.minimapPos, 123)

-- Nothing old at all: defaults, and no false record.
Clean()
env = stub.LoadSpoken(SPOKEN)
Expect("fresh install: default scale", env.Addon.db.profile.Frame.FrameScale, 0.7)
Expect("fresh install: nothing recorded", env.Addon.db.global.migratedFrom, nil)

---------------------------------------------------------------- the quests addon adopts VoiceOverDB
Clean()
_G.VoiceOverDB = { profiles = { Default = { Audio = { GossipFrequency = 3, OGThrall = true } } },
    char = { ["Tester - Realm"] = { hasSeenGossipForNPC = { npc1 = true } } } }
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
Expect("SpokenQuestsDB is created from VoiceOverDB", type(_G.SpokenQuestsDB), "table")
Expect("...profile settings carried", VO.Addon.db.profile.Audio.GossipFrequency, 3)
Expect("...the easter egg option too", VO.Addon.db.profile.Audio.OGThrall, true)
Expect("...and per-character memory", VO.Addon.db.char.hasSeenGossipForNPC.npc1, true)
Expect("...recorded", _G.SpokenQuestsDB.global.migratedFrom, "VoiceOverRedux")
Expect("the old table is left for the player to read", _G.VoiceOverDB.profiles.Default.Audio.GossipFrequency, 3)

VO.Addon.db.profile.Audio.GossipFrequency = 1
_G.VoiceOverDB.profiles.Default.Audio.GossipFrequency = 4
stub.ResetTimers()
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
Expect("a later login keeps the new table", VO.Addon.db.profile.Audio.GossipFrequency, 1)

Clean()
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
Expect("fresh install: defaults", VO.Addon.db.profile.Audio.GossipFrequency, 2)
Expect("fresh install: nothing recorded", _G.SpokenQuestsDB.global.migratedFrom, nil)

---------------------------------------------------------------- the zones addon adopts ZoneLoreDB
Clean()
_G.ZoneLoreDB = { voiceChannel = "Music", autoplay = false, minimapPos = 99, language = "deDE" }
_G.ZoneLoreCharDB = { heard = { ["1411/nil"] = true } }
assert(loadfile(ZONES .. "Migration.lua"))("SpokenZones", {})
Expect("SpokenZonesDB is created from ZoneLoreDB", _G.SpokenZonesDB and _G.SpokenZonesDB.voiceChannel, "Music")
Expect("...every key", _G.SpokenZonesDB.autoplay, false)
Expect("...the language choice Language.lua reads before ADDON_LOADED", _G.SpokenZonesDB.language, "deDE")
Expect("...and the per-character record", _G.SpokenZonesCharDB.heard["1411/nil"], true)
Expect("...recorded", _G.SpokenZonesDB.migratedFrom, "ZoneLore")
_G.SpokenZonesDB.voiceChannel = "SFX"
_G.ZoneLoreDB.voiceChannel = "Ambience"
assert(loadfile(ZONES .. "Migration.lua"))("SpokenZones", {})
Expect("a later login keeps the new table", _G.SpokenZonesDB.voiceChannel, "SFX")
Clean()
assert(loadfile(ZONES .. "Migration.lua"))("SpokenZones", {})
Expect("fresh install: nothing created from nothing", _G.SpokenZonesDB, nil)

---------------------------------------------------------------- the old profile is the character's, not "Default"
-- AceDB without a default-profile flag keys the profile by "Name - Realm"; that is what
-- both old addons did, so "Default" exists only for players who chose it.
Clean()
_G.VoiceOverDB = { profileKeys = { ["Tester - Realm"] = "Tester - Realm" }, profiles = { ["Tester - Realm"] = {
    SoundQueueUI = { FrameScale = 0.6 }, MinimapButton = { LibDBIcon = { minimapPos = 45 } } } } }
env = stub.LoadSpoken(SPOKEN)
Expect("frame scale from the character's own quests profile", env.Addon.db.profile.Frame.FrameScale, 0.6)
Expect("minimap from the character's own quests profile", env.Addon.db.profile.Minimap.LibDBIcon.minimapPos, 45)
Clean()
_G.ZoneLoreQueueDB = { profileKeys = { ["Tester - Realm"] = "Tester - Realm" }, profiles = { ["Tester - Realm"] = { SoundQueueUI = { FrameScale = 0.65 } } } }
env = stub.LoadSpoken(SPOKEN)
Expect("...and from the character's own zones queue profile", env.Addon.db.profile.Frame.FrameScale, 0.65)

---------------------------------------------------------------- the tombstones are gone, the adopted copies remain
-- A feature addon disables its tombstone once it has adopted the old table. A player
-- installed only after that login finds no old table, but the adopted copy is the same
-- shape and says where it came from.
Clean()
_G.SpokenQuestsDB = { global = { migratedFrom = "VoiceOverRedux" }, profiles = { Default = {
    SoundQueueUI = { FrameScale = 0.55 }, MinimapButton = { LibDBIcon = { minimapPos = 7 } } } } }
env = stub.LoadSpoken(SPOKEN)
Expect("frame settings from the quests addon's adopted copy", env.Addon.db.profile.Frame.FrameScale, 0.55)
Expect("...recorded as from VoiceOverRedux", env.Addon.db.global.migratedFrom, "VoiceOverRedux")
Clean()
_G.SpokenQuestsDB = { profiles = { Default = { SoundQueueUI = { FrameScale = 0.55 } } } }
env = stub.LoadSpoken(SPOKEN)
Expect("a fresh quests table that adopted nothing seeds nothing", env.Addon.db.profile.Frame.FrameScale, 0.7)
Clean()
_G.SpokenZonesDB = { migratedFrom = "ZoneLore", minimapPos = 8 }
env = stub.LoadSpoken(SPOKEN)
Expect("minimap from the zones addon's adopted copy", env.Addon.db.profile.Minimap.LibDBIcon.minimapPos, 8)
-- Enable runs the migration again: on a real client the feature addons' tables load
-- after the player's ADDON_LOADED, and PLAYER_LOGIN is the first moment they exist.
Clean()
env = stub.LoadSpoken(SPOKEN)
_G.SpokenQuestsDB = { global = { migratedFrom = "VoiceOverRedux" }, profiles = { Default = { SoundQueueUI = { FrameScale = 0.45 } } } }
env.Addon:Enable()
Expect("PLAYER_LOGIN migrates from tables that loaded after the player", env.Addon.db.profile.Frame.FrameScale, 0.45)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll migration tests passed")
