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

-- Opening it on a Blizzard client: the client's own context menu, which brings its
-- background, its highlight under the cursor, its closing on a click elsewhere and its
-- toggling with it. Nothing here reimplements any of that.
stub.ResetDropDowns()
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("left-clicking opens the client's menu", stub.openDropDown ~= nil, true)
local shown = {}
for _, entry in ipairs(stub.dropDownEntries) do
    table.insert(shown, entry.isSeparator and "---"
        or (entry.isTitle and "[" .. entry.text .. "]" or entry.text))
end
-- A rule before each addon's heading. Without one the headings are the only thing
-- separating the groups, and a heading reads as a row of the group above it.
Expect("...listing the player's entries, then each source's under its name, ruled apart",
    table.concat(shown, "|"), "Play/Pause|Stop|Settings|---|[Quests]|Quest settings")
Expect("...anchored to the button", stub.openDropDown.dropdownAnchor, _G.Minimap)

-- The menu opens under the cursor, which is still on the button, so the button's tooltip
-- is still up and the two overlap. The tooltip goes.
local tip = _G.GameTooltip
tip:SetText("stale")
tip:Show()
stub.ldbObjects.Spoken.OnTooltipShow(tip)
Expect("the tooltip says nothing while the menu is open", tip:NumLines(), 1)
Expect("...and hides itself if the cursor goes back over the button", tip:IsShown(), false)

stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
stub.ldbObjects.Spoken.OnTooltipShow(tip)
Expect("with the menu closed it says what the clicks do again", tip:NumLines() > 3, true)
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")

stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("clicking the button again closes it", stub.openDropDown, nil)

stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
local chose = false
for _, entry in ipairs(stub.dropDownEntries) do
    if entry.text == "Quest settings" then
        entry.func = entry.func
        local original = entry.func
        entry.func = function() chose = true; original() end
        entry.func()
    end
end
Expect("choosing an entry runs it", chose, true)
Expect("...and the menu closes itself", stub.openDropDown, nil)

---------------------------------------------------------------- the menu where there is no menu API
-- The three private-server clients have no UIDropDownMenu worth the name, so the player
-- draws its own: a background, a highlight, a catcher for the click that dismisses it.
env, quests, zones = Boot("1.12")
env.Minimap:AddEntry("quests", { id = "opts", text = "Quest settings", order = 1, onClick = function() end })
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
local frame = _G.SpokenMinimapMenu
Expect("a menu of its own opens", frame ~= nil and frame:IsShown(), true)
Expect("...on a background of its own", frame and frame:GetBackdrop() ~= nil, true)
Expect("...with an edge", frame and frame:GetBackdrop() and frame:GetBackdrop().edgeFile ~= nil, true)
local firstRow = frame.rows[1]
Expect("...rows that clear the border", firstRow and firstRow.anchor and firstRow.anchor.x >= 12, true)
Expect("...that highlight under the cursor", firstRow and firstRow:GetHighlightTexture() ~= nil
    and firstRow:GetHighlightTexture():GetTexture() ~= nil, true)
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("clicking the button again closes it", frame:IsShown(), false)
stub.ldbObjects.Spoken.OnClick(_G.Minimap, "LeftButton")
Expect("something catches a click outside", _G.SpokenMinimapMenuCatcher:IsShown(), true)
_G.SpokenMinimapMenuCatcher:Click()
Expect("...and that click closes the menu", frame:IsShown(), false)

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

---------------------------------------------------------------- a model portrait on a current client
-- The portrait is configured before the rows, so an error raised while resolving it
-- abandons the rest of the update: the header, every row and the actions. The frame then
-- shows a portrait over an empty band, which reads as an empty queue.
--
-- Model:GetModel returned a path and was removed from the current clients, which answer
-- GetModelFileID instead. Asking for the one this client lacks is an error, not a nil.
for _, client in ipairs({ "11509", "1.12" }) do
    env, quests, zones = Boot(client)
    local clip = H.Clip({ present = { header = "Gornek", label = "Cutting Teeth", bullet = "b",
        portrait = { kind = "model", creatureID = 3143, animation = 60,
            fallback = { kind = "texture", texture = "Book" } } } })
    local ok, err = pcall(function() quests:Enqueue(clip) end)
    Expect(client .. ": a model portrait does not abandon the update", ok, true)
    if not ok then Expect(client .. ": ...", tostring(err), "no error") end
    Expect(client .. ": ...so the header is still drawn",
        env.PlayerFrame.frame.container.name:GetText(), "Gornek")
    Expect(client .. ": ...and the row with it",
        env.PlayerFrame.frame.container.buttons[1].textWidget:GetText(), "Cutting Teeth")
end

---------------------------------------------------------------- the slash command reaches the client
-- Every file here runs inside a private environment whose metatable falls back to _G.
-- Reads fall through; writes do not. A bare `SLASH_SPOKEN1 = "/spoken"` therefore lands in
-- the environment and the client never hears of the command.
env = Boot()
Expect("the handler is registered", type(SlashCmdList.SPOKEN), "function")
Expect("...and so is the word that reaches it", rawget(_G, "SLASH_SPOKEN1"), "/spoken")

---------------------------------------------------------------- what the frame reports
-- A row that is present but drawn nowhere looks, from outside, exactly like a row that was
-- never built. /spoken diagnostics tells the two apart.
env, quests, zones = Boot()
quests:Enqueue(H.Clip({ present = { header = "Gornek", label = "Cutting Teeth", bullet = "b",
    portrait = { kind = "none" } } }))
env.PlayerFrame:Update()
local report = table.concat(env.PlayerFrame:Describe(), "\n")
Expect("it reports the header it drew", string.find(report, 'header="Gornek"', 1, true) ~= nil, true)
Expect("...the row and its width", string.find(report, 'text="Cutting Teeth"', 1, true) ~= nil, true)
Expect("...which portrait renderer is in use", string.find(report, "portrait kind=none", 1, true) ~= nil, true)
Expect("...and how much is queued", string.find(report, "queue=1", 1, true) ~= nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player frame tests passed")
