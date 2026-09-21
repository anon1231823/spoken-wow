-- The play button beside a quest in the quest log, on the client whose quest log is the
-- modern map-attached one: the Forever client (1.60.1, interface 16001) reports itself as
-- mainline and has no QuestLogFrame, no QuestLog_Update and no GetQuestLogTitle at all, so
-- the overlay had nothing to walk and no hook to run from, and the button was missing.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

-- Two quests in the log: one the sound pack has a line for, one it does not.
stub.SetModernQuestLog({
    { questID = 748, title = "Poison Water", level = 8 },
    { questID = 96130, title = "Chakuyak", level = 9, description = "Bring me the tusks, and be quick about it." },
})

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/SpokenQuests/", here .. "/../../addons/SpokenPlayer/")
local Spoken = _G.Spoken
local failures = 0

local played = {}
Spoken:RegisterCallback("CLIP_STARTED", function(clip)
    table.insert(played, clip.fileName)
end)

local function Expect(what, actual, expected)
    if actual == expected then
        print(string.format("ok   %s\n     %s", what, tostring(actual)))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", what, tostring(expected),
            tostring(actual)))
    end
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
-- Wait out the deferred data module load that OnInitialize schedules.
stub.Advance(2)

-- Contribute buttons hidden in the Spoken Player settings: a quest with no line is exactly the
-- greyed-out Play it always was. The Contribute half is checked further down.
local SpokenEnv = _G.SpokenEnv
SpokenEnv.Addon.db.profile.Contribute.HideButtons = true

-- What the client does when it draws the list.
QuestLogQuests_Update()

local buttons = VO.QuestOverlayUI.questPlayButtons
Expect("a quest with a line has a button", buttons[748] ~= nil, true)
Expect("...shown", buttons[748] and buttons[748]:IsShown(), true)
Expect("...and enabled", buttons[748] and buttons[748]:IsEnabled(), true)
Expect("a quest with no line has one too", buttons[96130] ~= nil, true)
Expect("...greyed out rather than absent", buttons[96130] and buttons[96130]:IsEnabled(), false)

-- Nothing below can say anything useful without a button, and a hard error there reads as a
-- broken test rather than as the missing play button it is.
if not (buttons[748] and buttons[96130]) then
    print("\nno play button was created at all; the remaining checks cannot run")
    os.exit(1)
end

-- The button marks the row, not the quest log: the rows have no names to anchor to.
local row = stub.questLogRows[1]
local anchor = buttons[748] and buttons[748].anchor
Expect("the button sits on its own row", anchor and anchor.relativeTo == row, true)
Expect("...left of the title", anchor and anchor.point, "TOPLEFT")

-- "Quest objectives" puts an icon of the client's own in exactly that spot, so the button
-- moves to the other end of the row, beside the tracking checkbox.
stub.SetQuestLogPOIIcons(true)
QuestLogQuests_Update()
anchor = buttons[748].anchor
Expect("the objective icon takes the left of the row", anchor and anchor.relativeTo == row.Checkbox, true)
Expect("...and the play button moves beside the checkbox", anchor and anchor.point, "RIGHT")
Expect("...against its left edge", anchor and anchor.relativePoint, "LEFT")

stub.SetQuestLogPOIIcons(false)
QuestLogQuests_Update()
Expect("with the icons off it is back beside the title", buttons[748].anchor.relativeTo == row, true)

Expect("two rows drawn, two buttons displayed", table.getn(VO.QuestOverlayUI.displayedButtons), 2)

-- Clicking it reads the quest's accept line, under the title the client reports rather than
-- the one the row draws with its level prefix.
buttons[748]:Click()
-- Read before the clip ends: the button drops its sound data when playback stops.
Expect("...under the quest's own title", buttons[748].soundData.title, "Poison Water")
stub.Advance(3)
Expect("clicking play reads the accept line", table.concat(played, ", "), "748-accept")

-- A quest with no line stays silent when clicked.
local before = table.getn(played)
buttons[96130]:Click()
stub.Advance(3)
Expect("a greyed out button plays nothing", table.getn(played), before)

-- The details view is the other place a quest is read from, and the list's own buttons cannot
-- follow it there.
QuestMapFrame_ShowQuestDetails(748)
local detailsButton = VO.QuestOverlayUI.detailsPlayButton
Expect("the details view has a play button", detailsButton ~= nil, true)
Expect("...on the side opposite Back", detailsButton and detailsButton.anchor.point, "RIGHT")
Expect("...on Back's own line", detailsButton and detailsButton.anchor.y, 4)
Expect("...on the panel's own header strip, where the Back button hangs",
    detailsButton and detailsButton:GetParent() == QuestMapFrame.DetailsFrame.BackFrame, true)
Expect("...lit for a quest with a line", detailsButton and detailsButton:IsEnabled(), true)
Expect("...saying what it does in words", detailsButton and detailsButton:GetText(), "Play")

before = table.getn(played)
detailsButton:Click()
Expect("...and offers to stop it once it is reading", detailsButton:GetText(), "Stop")
stub.Advance(3)
Expect("clicking it reads the same line", table.getn(played), before + 1)
Expect("...and offers to play again once it has finished", detailsButton:GetText(), "Play")

-- One button, rebound: showing another quest's details must not read the last one.
QuestMapFrame_ShowQuestDetails(96130)
Expect("a quest with no line greys the same button", detailsButton:IsEnabled(), false)
before = table.getn(played)
detailsButton:Click()
stub.Advance(3)
Expect("...and plays nothing", table.getn(played), before)

-- Contributing on: a quest the pack has no line for offers Contribute where its Play would be.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
QuestLogQuests_Update()
local contribute = VO.QuestOverlayUI.questContributeButtons[96130]
Expect("with contributing on, a quest with no line gets a Contribute button", contribute ~= nil, true)
Expect("...shown", contribute and contribute:IsShown(), true)
Expect("...in place of its Play", buttons[96130]:IsShown(), false)
Expect("...where Play sits", contribute and contribute.anchor and contribute.anchor.point, "TOPLEFT")
Expect("a quest with a line keeps its Play", buttons[748]:IsShown(), true)
Expect("...and gets no Contribute", VO.QuestOverlayUI.questContributeButtons[748], nil)

if contribute then
    contribute:GetScript("OnEnter")(contribute)
    Expect("the tooltip says what is missing", GameTooltip.text, "Spoken Quests doesn't have this quest")
    contribute:Click()
    local box = Spoken.ContributeBox
    Expect("clicking it opens the contribute box", box and box.frame:IsShown(), true)
    local link = box and box.editBox:GetText() or ""
    Expect("...holding a link to the contribute page", link:match("^https://spoken%.rusty%.one/contribute#e1=") ~= nil, true)
    local envelope = VO.Contribute:CaptureFromLog(96130, "Chakuyak")
    Expect("the log's envelope carries the quest", envelope:match("\nquest=96130\n") ~= nil, true)
    Expect("...as its accept moment", envelope:match("\nevent=accept\n") ~= nil, true)
    Expect("...says it came from the log", envelope:match("\nfrom=log\n") ~= nil, true)
    Expect("...and carries the quest's own text", envelope:match("Bring me the tusks, and be quick about it%.") ~= nil, true)
    Expect("...but no NPC, which the log does not know", envelope:match("\nnpc=") == nil, true)
end

-- The details view says Contribute on the same button instead of greying out.
QuestMapFrame_ShowQuestDetails(96130)
Expect("the details button offers Contribute for a quest with no line", detailsButton:GetText(), "Contribute")
Expect("...lit", detailsButton:IsEnabled(), true)
QuestMapFrame_ShowQuestDetails(748)
Expect("...and says Play again for a quest with one", detailsButton:GetText(), "Play")

if failures > 0 then
    print(string.format("\n%d check(s) failed", failures))
    os.exit(1)
end
print("\nall checks passed")
