setfenv(1, VoiceOver)

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)

---@class QuestPlayButton : Button
---@field soundData SoundData

QuestOverlayUI = {
    ---@type table<number, QuestPlayButton>
    questPlayButtons = {},
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

            if DataModules:PrepareSound({ event = Enums.SoundEvent.QuestAccept, questID = questID }) then
                self:UpdatePlayButton(title, questID, questLogTitleFrame, normalText, questCheck)
                self.questPlayButtons[questID]:Enable()
            else
                self:UpdateQuestTitle(questLogTitleFrame, self.questPlayButtons[questID], normalText, questCheck)
                self.questPlayButtons[questID]:Disable()
            end

            self.questPlayButtons[questID]:Show()
            self:UpdatePlayButtonTexture(questID)

            -- Add the button to displayedButtons
            table.insert(self.displayedButtons, self.questPlayButtons[questID])
        end
    end
end
