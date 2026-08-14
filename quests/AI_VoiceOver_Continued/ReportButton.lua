setfenv(1, VoiceOver)

--- The Report button and the copy box behind it.
---
--- The game cannot open a URL or send anything anywhere, so the only way a player can report a
--- bad line is to copy an address and open it themselves. Everything here serves that: the
--- button builds an address, the popup makes it selectable.
---
--- The address is built from what the client can see - a quest id and an event, or a unit GUID
--- - and never from soundData. When the data module fails to load there is no soundData at
--- all, and a quest that plays nothing is the report most worth having.

local SITE_URL = "https://voiceover.rusty.one"

local COPY_DIALOG = "VOICEOVER_COPY_REPORT_LINK"

ReportButton =
{
    ---@type Button[]
    buttons = {},
}

-- A copy of VoiceOver.lua's helper of the same name, which is a local there and so not
-- reachable from this file. IsVisible is absent on the oldest clients, where IsShown is the
-- closest equivalent.
local function IsFrameVisible(frame)
    if not frame then
        return false
    elseif frame.IsVisible then
        return frame:IsVisible()
    end
    return frame:IsShown()
end

local EVENT_PATHS =
{
    [Enums.SoundEvent.QuestAccept] = "accept",
    [Enums.SoundEvent.QuestProgress] = "progress",
    [Enums.SoundEvent.QuestComplete] = "complete",
}

function ReportButton:TargetForQuest(questID, event)
    local path = EVENT_PATHS[event]
    if not path or not questID or questID == 0 then
        return nil
    end
    return format("quest/%d/%s", questID, path)
end

--- The creature behind a GUID, or nil when this client cannot tell us.
---
--- Guarded twice over: Utils:GetIDFromGUID is absent on 1.12 and asserts on a GUID carrying no
--- id, and an error thrown here would land on a player who only wanted to complain about audio.
function ReportButton:TargetForGUID(guid)
    if not guid or not Utils.GetGUIDType or not Utils.GetIDFromGUID then
        return nil
    end

    local readType, guidType = pcall(Utils.GetGUIDType, Utils, guid)
    if not readType or not guidType or not Enums.GUID:CanHaveID(guidType) then
        return nil
    end

    local readID, id = pcall(Utils.GetIDFromGUID, Utils, guid)
    if not readID or not id then
        return nil
    end
    return format("npc/%d", id)
end

--- What the player is looking at, preferring the quest they can see over the NPC showing it.
function ReportButton:CurrentTarget()
    local event
    if IsFrameVisible(QuestFrameRewardPanel) then
        event = Enums.SoundEvent.QuestComplete
    elseif IsFrameVisible(QuestFrameProgressPanel) then
        event = Enums.SoundEvent.QuestProgress
    elseif IsFrameVisible(QuestFrameDetailPanel) then
        event = Enums.SoundEvent.QuestAccept
    end

    local target = event and self:TargetForQuest(GetQuestID and GetQuestID(), event)
    if target then
        return target
    end

    -- Gossip, or a client reporting quest id 0: fall back to the NPC, which the landing page
    -- can list every line for.
    return self:TargetForGUID(Utils:GetNPCGUID())
end

function ReportButton:ShowLink(target)
    StaticPopup_Show(COPY_DIALOG, nil, nil, format("%s/r/%s", SITE_URL, target))
end

function ReportButton:Create(parent)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetWidth(64)
    button:SetHeight(22)
    button:SetText("Report")
    button:SetScript("OnClick", function()
        local target = ReportButton:CurrentTarget()
        if target then
            ReportButton:ShowLink(target)
        else
            StaticPopup_Show("VOICEOVER_ERROR",
                "This client cannot tell which line that was, so there is no address to report.")
        end
    end)
    table.insert(self.buttons, button)
    return button
end

function ReportButton:Initialize()
    -- A genuinely read-only edit box cannot be mouse-selected, so the text is restored on any
    -- keystroke instead. Making the player select the text first is the difference between a
    -- link people use and a link people read.
    StaticPopupDialogs[COPY_DIALOG] =
    {
        text = "VoiceOver|n|nCopy this address and open it in your browser to report this line.",
        button1 = OKAY,
        timeout = 0,
        whileDead = 1,
        hasEditBox = true,
        editBoxWidth = 260,
        OnShow = function(dialog, data)
            local editBox = dialog.editBox or _G[dialog:GetName() .. "EditBox"]
            if not editBox then
                return
            end
            editBox.voiceoverLink = data
            editBox:SetText(data or "")
            editBox:SetFocus()
            editBox:HighlightText()
        end,
        EditBoxOnTextChanged = function(editBox)
            if editBox.voiceoverLink and editBox:GetText() ~= editBox.voiceoverLink then
                editBox:SetText(editBox.voiceoverLink)
                editBox:HighlightText()
            end
        end,
        EditBoxOnEscapePressed = function(editBox)
            editBox:GetParent():Hide()
        end,
    }

    -- Accept and Decline together span nearly the whole panel, so Report sits above Decline
    -- rather than beside it, where the frame is empty.
    if QuestFrameDetailPanel and QuestFrameDeclineButton then
        local button = self:Create(QuestFrameDetailPanel)
        button:SetPoint("BOTTOMRIGHT", QuestFrameDeclineButton, "TOPRIGHT", 0, 4)
    end

    -- The only surface present for gossip, for progress and completion text, and while audio
    -- is playing - which is when the complaint usually occurs to someone.
    if SoundQueueUI and SoundQueueUI.frame and SoundQueueUI.frame.container then
        local button = self:Create(SoundQueueUI.frame.container)
        button:SetWidth(52)
        button:SetHeight(18)
        button:SetPoint("BOTTOMRIGHT", SoundQueueUI.frame.container, "BOTTOMRIGHT", -4, 4)
    end
end
