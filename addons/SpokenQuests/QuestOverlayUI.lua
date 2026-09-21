setfenv(1, VoiceOver)

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)

---@class QuestPlayButton : Button
---@field soundData SoundData

QuestOverlayUI = {
    ---@type table<number, QuestPlayButton>
    questPlayButtons = {},
    ---@type table<number, Button>
    questContributeButtons = {},
    ---@type QuestPlayButton[]
    displayedButtons = {},
}

--- The frame a play button is created under, before `UpdatePlayButton` reparents it to the
--- row it marks. Overridden where the quest log is not the named `QuestLogFrame` - the
--- modern map-attached log has no named frame at all.
---@return Frame parent
function QuestOverlayUI:GetPlayButtonParent()
    return QuestLogFrame
end

--- A play button with no quest attached to it yet. The quest log keeps one per quest; the
--- quest details view keeps a single one it rebinds to whichever quest it is showing.
---@return QuestPlayButton playButton
function QuestOverlayUI:MakePlayButton(parent)
    local playButton = CreateFrame("Button", nil, parent or self:GetPlayButtonParent())
    playButton:SetWidth(20)
    playButton:SetHeight(20)
    playButton:SetHitRectInsets(2, 2, 2, 2)
    playButton:SetNormalTexture((TEXTURES .. "QuestLogPlayButton"))
    playButton:SetDisabledTexture((TEXTURES .. "QuestLogPlayButton"))
    playButton:GetDisabledTexture():SetDesaturated(true)
    playButton:GetDisabledTexture():SetAlpha(0.33)
    playButton:SetHighlightTexture("Interface\\BUTTONS\\UI-Panel-MinimizeButton-Highlight")
    ---@cast playButton QuestPlayButton
    return playButton
end

function QuestOverlayUI:CreatePlayButton(questID)
    self.questPlayButtons[questID] = self:MakePlayButton()
end

--- Contribute.lua, or nil where it is not loaded: the private-server clients leave it out
--- (Contribute.xml), and this file runs on them too. rawget, so a global of the same name from
--- some other addon is never mistaken for it.
local function ContributeModule()
    return rawget(VoiceOver, "Contribute")
end

--- The Contribute button for a quest the log has no sound for, sitting where its Play would,
--- or nil when this client cannot offer one (no Contribute.lua, buttons hidden, or no sound
--- pack at all -- see Contribute:CanOfferFromLog). The client's own plus icon, the same size as
--- Play: the row has room for an icon and not for a word, and the tooltip says what it does.
---@return Button?
function QuestOverlayUI:ContributeButtonFor(questID, title)
    local contribute = ContributeModule()
    if not (contribute and contribute.CanOfferFromLog and contribute:CanOfferFromLog()) then
        return nil
    end
    local button = self.questContributeButtons[questID]
    if not button then
        button = CreateFrame("Button", nil, self:GetPlayButtonParent())
        button:SetWidth(20)
        button:SetHeight(20)
        button:SetHitRectInsets(2, 2, 2, 2)
        button:SetNormalTexture("Interface\\Buttons\\UI-PlusButton-Up")
        button:SetPushedTexture("Interface\\Buttons\\UI-PlusButton-Down")
        button:SetHighlightTexture("Interface\\Buttons\\UI-PlusButton-Hilight")
        button:SetScript("OnEnter", function(self)
            contribute:ShowTooltip(self)
        end)
        button:SetScript("OnLeave", function()
            if GameTooltip then
                GameTooltip:Hide()
            end
        end)
        self.questContributeButtons[questID] = button
    end
    button:SetScript("OnClick", function()
        contribute:ShowFromLog(questID, title)
    end)
    return button
end

local prefix
function QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
    if not prefix then
        local text = normalText:GetText()
        for i = 1, 20 do
            normalText:SetText(string.rep(" ", i))
            if normalText:GetStringWidth() >= 24 then
                prefix = normalText:GetText()
                break
            end
        end
        prefix = prefix or "  "
        normalText:SetText(text)
    end

    playButton:SetPoint("LEFT", normalText, "LEFT", 4, 0)

    local formatedText = prefix .. string.trim(normalText:GetText() or "")

    normalText:SetText(formatedText)
    QuestLogDummyText:SetText(formatedText)

    questCheck:SetPoint("LEFT", normalText, "LEFT", normalText:GetStringWidth(), 0)
end

--- Play or stop, read off the button's own sound data rather than the quest log's table:
--- the details view has a button that belongs to no quest in particular. A button that says
--- so in words rather than in a texture carries its own `setPlayState`.
function QuestOverlayUI:SetPlayButtonState(playButton)
    local isPlaying = playButton.soundData and Player:Contains(playButton.soundData) or false
    if playButton.setPlayState then
        playButton.setPlayState(playButton, isPlaying)
        return
    end
    local texturePath = isPlaying and (TEXTURES .. "QuestLogStopButton") or (TEXTURES .. "QuestLogPlayButton")
    playButton:SetNormalTexture(texturePath)
end

function QuestOverlayUI:UpdatePlayButtonTexture(questID)
    local playButton = self.questPlayButtons[questID]
    if playButton then
        self:SetPlayButtonState(playButton)
    end
end

--- What a play button does when it is clicked, for whichever quest it currently stands for.
--- Shared by the buttons in the quest log and the one in the quest details view.
function QuestOverlayUI:BindPlayButton(playButton, questID, soundTitle)
    playButton:SetScript("OnClick", function(self)
        if not self.soundData then
            local type, id = DataModules:GetQuestLogQuestGiverTypeAndID(questID)
            self.soundData = {
                event = Enums.SoundEvent.QuestAccept,
                questID = questID,
                name = id and DataModules:GetObjectName(type, id) or "Unknown Name",
                title = soundTitle,
                unitGUID = id and Enums.GUID:CanHaveID(type) and Utils:MakeGUID(type, id) or nil
            }
        end

        local soundData = self.soundData
        local isPlaying = Player:Contains(soundData)

        if not isPlaying then
            Player:Enqueue(soundData)
            QuestOverlayUI:SetPlayButtonState(self)

            soundData.stopCallback = function()
                QuestOverlayUI:SetPlayButtonState(self)
                self.soundData = nil
            end
        else
            Player:Remove(soundData)
        end
    end)
end

function QuestOverlayUI:UpdatePlayButton(soundTitle, questID, questLogTitleFrame, normalText, questCheck)
    local playButton = self.questPlayButtons[questID]
    playButton:SetParent(questLogTitleFrame:GetParent())
    playButton:SetFrameLevel(questLogTitleFrame:GetFrameLevel() + 2)

    QuestOverlayUI:UpdateQuestTitle(questLogTitleFrame, playButton, normalText, questCheck)
    self:BindPlayButton(playButton, questID, soundTitle)
end

function QuestOverlayUI:Update()
    if not QuestLogFrame:IsShown() then
        return
    end

    local numEntries, numQuests = GetNumQuestLogEntries()

    -- Hide all buttons in displayedButtons
    for _, button in pairs(self.displayedButtons) do
        button:Hide()
    end

    if numEntries == 0 then
        return
    end

    -- Clear displayedButtons
    table.wipe(self.displayedButtons)

    -- Traverse through the quests displayed in the UI
    for i = 1, QUESTS_DISPLAYED do
        local questIndex = i + Utils:GetQuestLogScrollOffset();
        if questIndex > numEntries then
            break
        end

        -- Get quest title
        local questLogTitleFrame = Utils:GetQuestLogTitleFrame(i)
        local normalText = Utils:GetQuestLogTitleNormalText(i)
        local questCheck = Utils:GetQuestLogTitleCheck(i)
        local title, level, suggestedGroup, isHeader, isCollapsed, isComplete, frequency, questID = GetQuestLogTitle(
            questIndex)

        if not isHeader then
            if not self.questPlayButtons[questID] then
                self:CreatePlayButton(questID)
            end

            local playButton = self.questPlayButtons[questID]
            local shown = playButton
            if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                self:UpdatePlayButton(title, questID, questLogTitleFrame, normalText, questCheck)
                playButton:Enable()
            else
                -- No sound: Contribute where Play would be, or Play greyed out where this
                -- client cannot contribute.
                local contribute = self:ContributeButtonFor(questID, title)
                if contribute then
                    playButton:Hide()
                    contribute:SetParent(questLogTitleFrame:GetParent())
                    contribute:SetFrameLevel(questLogTitleFrame:GetFrameLevel() + 2)
                    shown = contribute
                else
                    playButton:Disable()
                end
                self:UpdateQuestTitle(questLogTitleFrame, shown, normalText, questCheck)
            end

            shown:Show()
            if shown == playButton then
                self:UpdatePlayButtonTexture(questID)
            end

            -- Add the button to displayedButtons
            table.insert(self.displayedButtons, shown)
        end
    end
end
