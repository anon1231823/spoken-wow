-- The quests addon's settings panel: sections on one canvas, laid out by the UI/Layout.lua
-- every Spoken addon carries, rather than a Blizzard category per group of an AceConfig
-- tree. The tree itself is untouched -- it still backs every /vo command and still fills
-- the window where profiles and the pack manager live. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/SpokenQuests/"
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local Expect, Failures = H.Expecter(print)

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    stub.world.questID = 0; stub.ShowPanel(nil)
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    local SettingsPanel = stub.LoadQuestsPanel(QUESTS, VO)
    SettingsPanel:Setup()
    return VO, SettingsPanel
end

local VO, SettingsPanel = Boot()

Expect("the panel is registered as a settings category", SettingsPanel.category ~= nil, true)
-- The player registers its own first; this addon's is the one named for it.
local mine = 0
for _, registered in ipairs(stub.settingsCategories) do
    if registered.name == "Spoken Quests" then mine = mine + 1 end
end
Expect("...under the addon's name", mine, 1)
Expect("...once, not once per group of the options tree", mine, 1)

local rows, headings = {}, {}
for _, child in ipairs(SettingsPanel.panel.children) do
    if child.layoutHeading then
        table.insert(headings, { y = child.layoutY, height = child.layoutHeight, text = child.text })
    elseif child.layoutHeight then
        table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor and child.anchor.y })
    end
end

local names = {}
for _, heading in ipairs(headings) do table.insert(names, heading.text) end
Expect("the settings are grouped into sections", table.concat(names, "|"),
    "Dialogue|Sound packs|Troubleshooting|All options")

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

-- The same rhythm the other two panels keep, from the same file.
local gaps = {}
for index = 2, table.getn(rows) do
    local previous = rows[index - 1]
    local crossesHeading = false
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if not crossesHeading then table.insert(gaps, previous.y - rows[index].y - previous.height) end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)

local headingGaps = {}
for _, heading in ipairs(headings) do
    local above
    for _, row in ipairs(rows) do
        if row.y > heading.y and (not above or row.y < above.y) then above = row end
    end
    if above then table.insert(headingGaps, above.y - heading.y - above.height) end
end
Expect("every section heading the same distance below the section above", Distinct(headingGaps), 1)

---------------------------------------------------------------- the rows write the settings
-- The cycle steps through the enum by name and stores the number the addon reads.
local db = VO.Addon.db.profile
db.Audio.GossipFrequency = VO.Enums.GossipFrequency.Always
local cycle
for _, child in ipairs(SettingsPanel.panel.children) do
    if child.layoutHeight and type(child.text) == "string" and string.find(child.text, "NPC greetings") then
        cycle = child
    end
end
Expect("the greeting frequency is a cycle button", cycle ~= nil, true)
-- Opening the panel is what re-reads the setting: a value changed by a slash command
-- since the panel was built would otherwise still show the old one.
cycle:GetScript("OnShow")(cycle)
Expect("...showing the setting when the panel opens", cycle.text, "NPC greetings: Always")
cycle:Click()
Expect("...and clicking it stores the next value, as the number the addon reads",
    db.Audio.GossipFrequency, VO.Enums.GossipFrequency.OncePerQuestNPC)
Expect("...relabelled", cycle.text, "NPC greetings: Once per quest NPC")

---------------------------------------------------------------- the commands and the buttons agree
-- `/vo test` and the button on the panel run the same code, so the two cannot answer
-- differently -- which is what an inline function per command guarantees they will.
Expect("the self-test is a method both call", type(VO.Options.RunSelfTest), "function")
Expect("so are the diagnostics", type(VO.Options.PrintDiagnostics), "function")
Expect("the command table calls it", type(VO.Options.table.args.Commands.args.Test.func), "function")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests options tests passed")
