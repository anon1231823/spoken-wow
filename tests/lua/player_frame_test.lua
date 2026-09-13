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
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local Expect, Failures = H.Expecter(print)

local function Boot(client)
    stub.SetClient(client or "11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
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
Expect("an unknown bullet falls back to the queue bullet", F.frame.container.buttons[2].iconWidget:GetTexture(), [[Interface\AddOns\SpokenPlayer\Textures\SoundQueueBulletQueue]])

---------------------------------------------------------------- portrait dispatch
env, quests, zones = Boot(); F = env.PlayerFrame
local P = env.Portrait
zones:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "texture", texture = [[Interface\AddOns\SpokenPlayer\Textures\Book]] } } }))
Expect("kind=texture shows a texture", F.frame.portrait.active, "texture")
Expect("...the one asked for", F.frame.portrait.texture:GetTexture(), [[Interface\AddOns\SpokenPlayer\Textures\Book]])
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = 196 } } }))
Expect("kind=model shows the model renderer", F.frame.portrait.active, "model")
Expect("...with the creature set", F.frame.portrait.model.creature, 196)
env.SoundQueue:RemoveAllSoundsFromQueue()

quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b",
    portrait = { kind = "model", creatureID = nil,
        fallback = { kind = "texture", texture = [[Interface\AddOns\SpokenPlayer\Textures\Book]] } } } }))
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

-- Opening it: the menu is a frame of its own, so it has to draw its own background. A
-- frame asking for BackdropTemplate and never setting one is transparent -- the rows read
-- as text floating over the world.
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
local frame = _G.SpokenMinimapMenu
Expect("left-clicking opens the menu", frame ~= nil and frame:IsShown(), true)
Expect("...on a background of its own", frame and frame:GetBackdrop() ~= nil, true)
Expect("...with an edge", frame and frame:GetBackdrop() and frame:GetBackdrop().edgeFile ~= nil, true)
Expect("...sized to its rows", frame and frame.height > 60, true)
-- The border is 32 pixels of art, about 12 of it inside the frame. A row placed at the
-- very edge sits under it.
local firstRow = frame.rows[1]
Expect("...and the rows clear the border", firstRow and firstRow.anchor and firstRow.anchor.x >= 12, true)

-- A menu opened by a button closes on the next click of it. Anything else leaves the
-- player clicking the button to no visible effect.
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("clicking the button again closes the menu", frame:IsShown(), false)
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("...and again opens it", frame:IsShown(), true)

-- Every row highlights under the cursor, or the menu gives no sign of what a click will hit.
Expect("a row highlights under the cursor", firstRow and firstRow:GetHighlightTexture() ~= nil
    and firstRow:GetHighlightTexture():GetTexture() ~= nil, true)

-- Clicking anywhere else closes it, which is what every other menu in the game does.
Expect("something catches a click outside", _G.SpokenMinimapMenuCatcher ~= nil, true)
Expect("...only while the menu is open", _G.SpokenMinimapMenuCatcher:IsShown(), true)
_G.SpokenMinimapMenuCatcher:Click()
Expect("...and that click closes the menu", frame:IsShown(), false)
Expect("...taking the catcher with it", _G.SpokenMinimapMenuCatcher:IsShown(), false)

-- Choosing an entry closes it too, and runs what was chosen.
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
local chose = false
frame.rows[1].entry.onClick = function() chose = true end
frame.rows[1]:Click()
Expect("choosing an entry runs it", chose, true)
Expect("...and closes the menu", frame:IsShown(), false)

---------------------------------------------------------------- settings
env = Boot()
Expect("a Settings category is registered, named for the addon and not the family",
    stub.settingsCategories[1] and stub.settingsCategories[1].name, "Spoken Player")
Expect("...and exposed for feature addons to nest under", _G.Spoken:GetSettingsCategory(), stub.settingsCategories[1])

---------------------------------------------------------------- 1.12 loads too
env, quests, zones = Boot("1.12"); F = env.PlayerFrame
quests:Enqueue(H.Clip({ present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }))
Expect("1.12: the frame builds and shows", F.frame:IsShown(), true)
Expect("1.12: no Settings API, so no category", getn(stub.settingsCategories), 0)
Expect("1.12: GetSettingsCategory is nil rather than an error", _G.Spoken:GetSettingsCategory(), nil)

---------------------------------------------------------------- the panel keeps one rhythm
-- Every row used to place itself by adding a hand-tuned fudge to a running offset, so no
-- two sections were spaced alike. One layout owns the offset now: a row knows its own
-- height and the gap that follows it, and no caller does arithmetic.
Boot("11509")
local rows, headings = {}, {}
for _, child in ipairs(_G.SpokenOptionsPanel.children) do
    if child.anchor and child.anchor.y then
        if child.layoutHeading then
            table.insert(headings, { y = child.layoutY, height = child.layoutHeight })
        elseif child.layoutHeight then
            table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor.y })
        end
    end
end

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        -- Rounded: the fractional halves of a row height are not a difference anyone sees.
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

Expect("the panel has rows to space", #rows > 4, true)
local gaps = {}
for index = 2, #rows do
    local previous = rows[index - 1]
    -- Top-anchored and downward, so the gap is the drop less the height already used.
    local gap = previous.y - rows[index].y - previous.height
    -- Only within a section: a heading in between adds its own space.
    local crossesHeading = false
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if not crossesHeading then table.insert(gaps, gap) end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)

-- A control may sit inside its row: a slider's bar hangs below its own label. None may sit
-- outside it, which is how the scale slider's label used to land on the row above.
local escaped = 0
for _, row in ipairs(rows) do
    if row.anchor > row.y or row.anchor < row.y - row.height then escaped = escaped + 1 end
end
Expect("no control escapes the row it was given", escaped, 0)

-- Label on the left, control on the right, at the same column for every row: a panel
-- whose controls start at different places reads as several panels.
local columns, captioned = {}, 0
for _, child in ipairs(_G.SpokenOptionsPanel.children) do
    if child.layoutColumn then
        captioned = captioned + 1
        columns[string.format("%.1f", child.layoutColumn)] = true
    end
end
Expect("there are labelled controls to line up", captioned > 1, true)
local distinctColumns = 0
for _ in pairs(columns) do distinctColumns = distinctColumns + 1 end
Expect("...and every one of them starts at the same column", distinctColumns, 1)

local headingGaps = {}
for _, heading in ipairs(headings) do
    local above
    for _, row in ipairs(rows) do
        if row.y > heading.y and (not above or row.y < above.y) then above = row end
    end
    if above then table.insert(headingGaps, above.y - heading.y - above.height) end
end
Expect("every section heading the same distance below the section above", Distinct(headingGaps), 1)

-- A heading introduces the section under it. Sit it midway and it reads as belonging to
-- neither: the space above it has to be clearly the larger of the two.
local below
for _, heading in ipairs(headings) do
    local first
    for _, row in ipairs(rows) do
        if row.y < heading.y and (not first or row.y > first.y) then first = row end
    end
    if first then below = below or (heading.y - heading.height - first.y) end
end
Expect("a heading sits nearer its own section than the one above",
    below ~= nil and headingGaps[1] >= below * 3, true)

---------------------------------------------------------------- every sound setting is on this panel
-- The two feature addons each used to carry a channel control of their own, so a player
-- with both had two settings for one thing and no way to tell which won. Everything about
-- how a line is played is read here, whichever addon queued it.
local function PanelLabels(client)
    Boot(client)
    local labels = {}
    for _, text in ipairs(stub.LabelsUnder(_G.SpokenOptionsPanel)) do
        labels[text] = true
    end
    return labels
end

local labels = PanelLabels("11509")
-- "Up next" is the queue window's own title. As a settings heading it named nothing.
Expect("the window settings are headed as such", labels["Player window"], true)
Expect("...not by the queue's title", labels["Up next"], nil)
-- The scale slider was built with no height and no orientation, so it drew nothing: the
-- setting sat on the panel invisible, with a gap where it should have been. The zones
-- addon's own sliders, which do render, set both.
-- Label on the left, control on the right, value beside it: one row, not two.
Expect("the scale slider is labelled", labels["Player scale"], true)
Expect("...with its value beside the bar", labels["70%"], true)
local scale
for _, child in ipairs(_G.SpokenOptionsPanel.children) do
    if child.frameType == "Slider" then scale = scale or child end
end
Expect("the scale slider is a slider", scale ~= nil, true)
Expect("...with a height, or it draws nothing", scale and scale.height, 16)
Expect("...and an orientation", scale and scale:GetOrientation(), "HORIZONTAL")
Expect("the channel is chosen here", labels["Sound channel"], true)
Expect("...and so is silencing the game's own dialogue",
    labels["Silence the game's own dialogue while speaking"], true)
Expect("a current client is offered nothing about the music channel",
    labels["Play through the music channel"], nil)

-- 2.4.3 and 3.3.5 route speech through the music channel, because those clients cannot
-- stop a sound any other way. Those settings existed from the start and had no row at
-- all: the only way to change one was to edit the saved variables by hand.
labels = PanelLabels("3.3.5")
Expect("a legacy client can reach the music channel", labels["Play through the music channel"], true)
Expect("...its volume", labels["Speech volume"], true)
Expect("...its fade, as a duration and not a percentage", labels["0.5s"], true)
Expect("...and the HD model patch", labels["HD model patch installed"], true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player frame tests passed")
