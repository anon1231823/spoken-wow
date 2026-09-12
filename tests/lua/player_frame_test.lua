-- The player's UI, as far as it can be seen without a client: the frame loads on a
-- current client and on 1.12, shows and hides with the queue, names the head and lists
-- the rows with their held reason, picks a portrait renderer and falls back, lays out the
-- actions a clip brings, owns the one minimap button, and registers its settings.
-- Run with `make test-player`. Layout and pixels are checked in game.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local function Boot(client)
    stub.SetClient(client or "11509"); stub.ResetSound(); stub.ResetTimers()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()   -- what PLAYER_LOGIN does: builds the frame, the button, the panel
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "SpokenQuests", order = 1 })
    local zones = env.Sources:Register("zones", { title = "Zones", addon = "SpokenZones", order = 2 })
    return env, quests, zones
end

---------------------------------------------------------------- a settings link registered before the panel exists
-- Feature addons register their link from ADDON_LOADED; the panel is built at PLAYER_LOGIN.
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
local early = stub.LoadSpoken(SPOKEN)
_G.Spoken:AddSettingsLink("Quests settings", function() end)
early.Addon:Enable()
Expect("a link registered before the panel is built with it", #_G.SpokenOptionsPanel.links, 1)
Expect("...with its text", _G.SpokenOptionsPanel.links[1]:GetText(), "Quests settings")

---------------------------------------------------------------- loads, shows, hides
local env, quests, zones = Boot()
local F = env.PlayerFrame
Expect("the frame exists after Enable", F.frame ~= nil, true)
Expect("hidden while the queue is empty", F.frame:IsShown(), false)
local a = H.Clip({ present = { header = "Eagan Peltskinner", label = "Wolves Across the Border",
    bullet = "quest-accept", portrait = { kind = "none" } } })
quests:Enqueue(a)
Expect("shown once something is queued", F.frame:IsShown(), true)
Expect("the header is the clip's", F.frame.container.name:GetText(), "Eagan Peltskinner")
Expect("the first row is the clip's label", F.frame.container.buttons[1].textWidget:GetText(), "Wolves Across the Border")
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("hidden again when the queue empties", F.frame:IsShown(), false)

env.Addon.db.profile.Frame.HideFrame = true
quests:Enqueue(H.Clip())
Expect("HideFrame keeps it hidden with a queue", F.frame:IsShown(), false)
env.Addon.db.profile.Frame.HideFrame = false
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- rows and held reason
env, quests, zones = Boot(); F = env.PlayerFrame
zones:AddGate(function() return "in combat" end)
local held = H.Clip({ present = { header = "Durotar", label = "Valley of Trials", bullet = "zone", portrait = { kind = "none" } } })
local free = H.Clip({ present = { header = "Thrall", label = "Warchief", bullet = "quest-accept", portrait = { kind = "none" } } })
zones:Enqueue(held); quests:Enqueue(free)
Expect("the speaking clip is row 1 even if queued second", F.frame.container.buttons[1].textWidget:GetText(), "Warchief")
Expect("a held row says why", F.frame.container.buttons[2].textWidget:GetText(), "Valley of Trials |cff888888(in combat)|r")
Expect("the header follows the head", F.frame.container.name:GetText(), "Thrall")

---------------------------------------------------------------- bullets
env, quests, zones = Boot(); F = env.PlayerFrame
_G.Spoken:RegisterBullet("quest-accept", [[Interface\AddOns\SpokenQuests\Textures\Accept]], 14)
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "quest-accept", portrait = { kind = "none" } } }))
Expect("a row uses its registered bullet", F.frame.container.buttons[1].iconWidget:GetTexture(), [[Interface\AddOns\SpokenQuests\Textures\Accept]])
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "nope", portrait = { kind = "none" } } }))
Expect("an unknown bullet falls back to the queue bullet", F.frame.container.buttons[2].iconWidget:GetTexture(), [[Interface\AddOns\Spoken\Textures\SoundQueueBulletQueue]])

---------------------------------------------------------------- portrait dispatch
env, quests, zones = Boot(); F = env.PlayerFrame
local P = env.Portrait
zones:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } }))
Expect("kind=texture shows a texture", F.frame.portrait.active, "texture")
Expect("...the one asked for", F.frame.portrait.texture:GetTexture(), [[Interface\AddOns\Spoken\Textures\Book]])
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = 196 } } }))
Expect("kind=model shows the model renderer", F.frame.portrait.active, "model")
Expect("...with the creature set", F.frame.portrait.model.creature, 196)
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = nil,
        fallback = { kind = "texture", texture = [[Interface\AddOns\Spoken\Textures\Book]] } } } }))
Expect("a model with nothing to load falls back", F.frame.portrait.active, "texture")
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "unknown" } } }))
Expect("an unknown kind draws nothing rather than erroring", F.frame.portrait.active, "none")
env.SoundQueue:RemoveAllSoundsFromQueue()

env.Addon.db.profile.Frame.HidePortrait = true
F:RefreshConfig()
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "model", creatureID = 1 } } }))
Expect("HidePortrait hides the portrait", F.frame.portrait:IsShown(), false)
Expect("...and shows the line and mini pause instead", F.frame.miniPause:IsShown(), true)
env.Addon.db.profile.Frame.HidePortrait = false
F:RefreshConfig()

---------------------------------------------------------------- actions
env, quests, zones = Boot(); F = env.PlayerFrame
local clicked
zones:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" },
    actions = {
        { id = "read", text = "Read", onClick = function(clip) clicked = "read:" .. clip.key end },
        { id = "report", text = function() return "Report" end, onClick = function() clicked = "report" end },
    } } }))
Expect("two actions make two buttons", F.frame.actions.shown, 2)
Expect("...labelled", F.frame.actions.buttons[1]:GetText(), "Read")
Expect("...a text function is called", F.frame.actions.buttons[2]:GetText(), "Report")
F.frame.actions.buttons[1]:Click()
Expect("clicking passes the clip", clicked ~= nil and clicked:sub(1, 5), "read:")
env.SoundQueue:RemoveAllSoundsFromQueue()
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }))
Expect("no actions, no strip", F.frame.actions.shown, 0)

---------------------------------------------------------------- one minimap button
env, quests, zones = Boot()
Expect("exactly one LDB object, named Spoken", stub.ldbObjects.Spoken ~= nil and stub.dbIcons.Spoken ~= nil, true)
Expect("...registered against the player's saved position", stub.dbIcons.Spoken.db, env.Addon.db.profile.Minimap.LibDBIcon)
env.Minimap:AddEntry("zones", { id = "lore", text = "Open lore window", order = 1, onClick = function() end })
env.Minimap:AddEntry("quests", { id = "opts", text = "Quest settings", order = 1, onClick = function() end })
local menu = env.Minimap:BuildMenu()
local labels = {}
for _, entry in ipairs(menu) do table.insert(labels, entry.text) end
Expect("the menu is the player's entries then each source's in order", table.concat(labels, "|"),
    "Play/Pause|Stop|Settings|Quest settings|Open lore window")
env.Minimap:RemoveEntry("zones", "lore")
Expect("RemoveEntry", getn(env.Minimap:BuildMenu()), 4)

---------------------------------------------------------------- settings
env = Boot()
Expect("a Settings category is registered", stub.settingsCategories[1] and stub.settingsCategories[1].name, "Spoken")
Expect("...and exposed for feature addons to nest under", _G.Spoken:GetSettingsCategory(), stub.settingsCategories[1])

---------------------------------------------------------------- 1.12 loads too
env, quests, zones = Boot("1.12"); F = env.PlayerFrame
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }))
Expect("1.12: the frame builds and shows", F.frame:IsShown(), true)
Expect("1.12: no Settings API, so no category", getn(stub.settingsCategories), 0)
Expect("1.12: GetSettingsCategory is nil rather than an error", _G.Spoken:GetSettingsCategory(), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player frame tests passed")
