-- Which line the player reads for a quest interaction, across the three ways a client can
-- present one. Run with `make test-player`.
--
-- The interesting case is the third: DialogueUI calls QuestFrame:UnregisterAllEvents() and
-- draws its own dialog, so no Blizzard quest panel is ever shown. Classifying a quest
-- interaction by which panel is visible therefore has to have a fallback, and that fallback
-- used to assume "accept" - which read the offer text again at every turn-in.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
local VO = stub.LoadQuests(here .. "/../../addons/SpokenQuests/", here .. "/../../addons/SpokenPlayer/")
local Spoken = _G.Spoken

local world = stub.world
local failures = 0

-- Observed through the player's public seam rather than by monkeypatching the queue: what
-- the client would hear is what CLIP_STARTED reports.
local played = {}
Spoken:RegisterCallback("CLIP_STARTED", function(clip)
    table.insert(played, clip.fileName)
end)

local function Expect(scenario, expected)
    local actual = table.concat(played, ", ")
    if actual == expected then
        print(string.format("ok   %s\n     played: %s", scenario, actual ~= "" and actual or "(nothing)"))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
            expected ~= "" and expected or "(nothing)", actual ~= "" and actual or "(nothing)"))
    end
end

local function StartScenario()
    for i = #played, 1, -1 do played[i] = nil end
    Spoken:StopAll()
    world.questID = 0
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
end

local quests = { 101, 102, 103 }
local lookup = {}
for _, quest in ipairs(quests) do
    lookup[string.format("%d-accept", quest)] = 1
    lookup[string.format("%d-complete", quest)] = 1
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = lookup,
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})

world.title = "Test Quest"
world.questText = "Go and do the thing."
world.progressText = "Have you done the thing?"
world.rewardText = "You have done the thing."

-- Wait out the deferred data module load that OnInitialize schedules.
stub.Advance(2)

-- A quest hand-off as the default UI presents it: the reward panel is what is on screen.
local quest = quests[1]
StartScenario()
world.questID = quest
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(3)
Expect("default UI: offer reads accept, turn-in reads complete",
    string.format("%d-accept, %d-complete", quest, quest))

-- The same hand-off on a client that keeps reporting the quest ID after its frame closes.
-- Nothing may be read once the dialog is gone.
quest = quests[2]
StartScenario()
world.questID = quest
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")   -- The quest ID is deliberately left set.
stub.Advance(3)
Expect("stale quest ID after the frame closes reads nothing more",
    string.format("%d-accept, %d-complete", quest, quest))

-- A replacement dialog addon: the client is in a quest dialog the whole time, but no
-- Blizzard panel is ever visible, so only the events say which interaction this is.
quest = quests[3]
StartScenario()
world.questID = quest
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.FireEvent("QUEST_PROGRESS")
stub.Advance(1)
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
Expect("replacement dialog UI: turn-in reads complete, not accept",
    string.format("%d-accept, %d-complete", quest, quest))

if failures > 0 then
    print(string.format("\n%d scenario(s) failed", failures))
    os.exit(1)
end
print("\nall scenarios passed")
