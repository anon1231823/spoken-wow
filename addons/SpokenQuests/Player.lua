setfenv(1, VoiceOver)

-- This addon speaking through the Spoken player. The queue, the frame, the minimap
-- button and pause are the player's; this file is the one place that knows both what a
-- quest line is and what the player wants to be handed.
--
-- A prepared SoundData IS the clip: the player reads key, path, length, priority and
-- present from it and ignores the rest, and the dispatcher keeps reading event, questID,
-- name and unitGUID from the same table. One table, two readers, no copying.
Player = { source = nil }

local TEXTURES = format([[Interface\AddOns\%s\Textures\]], AddonFolder)
local BOOK = TEXTURES .. "Book"

local BULLETS = {
    [Enums.SoundEvent.QuestAccept]   = "quest-accept",
    [Enums.SoundEvent.QuestProgress] = "quest-progress",
    [Enums.SoundEvent.QuestComplete] = "quest-complete",
    [Enums.SoundEvent.QuestGreeting] = "gossip",
    [Enums.SoundEvent.Gossip]        = "gossip",
}

--------------------------------------------------------------------------------
-- Reading the queue back
--------------------------------------------------------------------------------

--- This addon's clips, in queue order.
function Player:Queued()
    local list = {}
    if not self.source or not Spoken then
        return list
    end
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.source == self.source then
            table.insert(list, clip)
        end
    end
    return list
end

function Player:Contains(soundData)
    for _, clip in ipairs(self:Queued()) do
        if clip == soundData then
            return true
        end
    end
    return false
end

--- The head, if it is one of ours.
function Player:Current()
    local head = Spoken and Spoken:GetCurrent()
    if head and head.source == self.source then
        return head
    end
    return nil
end

local function GossipClips()
    local list = {}
    for _, clip in ipairs(Player:Queued()) do
        if Enums.SoundEvent:IsGossipEvent(clip.event) then
            table.insert(list, clip)
        end
    end
    return list
end

--------------------------------------------------------------------------------
-- Presentation
--------------------------------------------------------------------------------

-- The creature to draw, or nil for the book. The book for Items, GameObjects, players,
-- a missing GUID, and 2.4.3, which cannot show an arbitrary creature -- what
-- ShouldShowBookFor used to decide inside the frame, decided here instead and handed
-- over as a fallback.
local function CreatureFor(soundData)
    if soundData.unitIsObjectOrItem or Version.IsLegacyBurningCrusade then
        return nil
    end
    local guid = soundData.unitGUID
    if guid and Utils.GetGUIDType and Utils.GetIDFromGUID then
        local okType, guidType = pcall(Utils.GetGUIDType, Utils, guid)
        if okType and guidType and Enums.GUID:IsCreature(guidType) and Enums.GUID:CanHaveID(guidType) then
            local okID, id = pcall(Utils.GetIDFromGUID, Utils, guid)
            if okID then
                return id
            end
        end
        return nil
    end
    -- 1.12 has no GUIDs; the pooled model shows the "npc" unit and this is only what
    -- tells one clip's portrait from the next.
    if Version.IsLegacyVanilla then
        return soundData.questID or soundData.name
    end
    return nil
end

-- The Stop Gossip control, anchored to the header as it always was. The one place the
-- domain-agnostic frame is asked to host something quest-shaped.
local STOP_GOSSIP = {
    id = "stopGossip",
    anchor = "header",
    visible = function() return getn(GossipClips()) > 0 end,
    create = function(parent)
        local button = CreateFrame("Button", nil, parent)
        button:SetSize(32, 32)
        function button:SetGossipCount(gossipCount)
            local texture = gossipCount > 1 and (TEXTURES .. "StopGossipMore") or (TEXTURES .. "StopGossip")
            self:SetShown(gossipCount > 0)
            self:SetHighlightTexture(texture, "ADD")
            self:SetNormalTexture(texture)
            self:SetPushedTexture(texture)
            self.tooltip = gossipCount > 1 and "Next Gossip" or "Stop Gossip"
            if GameTooltip:GetOwner() == self then
                GameTooltip:SetText(self.tooltip)
                GameTooltip:Show()
            end
        end
        button:SetGossipCount(0)
        button:GetHighlightTexture():SetAlpha(0.5)
        button:GetPushedTexture():SetAlpha(0.5)
        button:HookScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_NONE")
            GameTooltip:SetPoint("LEFT", self, "RIGHT")
            GameTooltip:SetText(self.tooltip)
            GameTooltip:Show()
        end)
        button:HookScript("OnLeave", GameTooltip_Hide)
        button:HookScript("OnClick", function()
            PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
            local head = Player:Current()
            if head and Enums.SoundEvent:IsGossipEvent(head.event) then
                Player:Remove(head)
            else
                for _, clip in ipairs(GossipClips()) do
                    Player:Remove(clip)
                end
            end
        end)
        return button
    end,
    onClipChanged = function(clip, button)
        button:SetGossipCount(getn(GossipClips()))
    end,
}

local REPORT = {
    id = "report",
    create = function(parent)
        local button = ReportButton:Create(parent)
        button:SetWidth(52)
        button:SetHeight(18)
        return button
    end,
}

local ACTIONS = { REPORT, STOP_GOSSIP }

--- Turn a prepared SoundData into a clip, in place.
function Player:Prepare(soundData)
    local event = soundData.event
    local gossip = Enums.SoundEvent:IsGossipEvent(event)
    soundData.key = soundData.fileName
    soundData.path = soundData.filePath
    soundData.priority = gossip and "low" or "normal"
    soundData.present = {
        header = soundData.name or "",
        label = soundData.title or (event == Enums.SoundEvent.QuestGreeting and "Greeting" or (gossip and "Gossip" or "")),
        bullet = BULLETS[event],
        tint = gossip and { 1, 1, 1 } or nil,
        portrait = {
            kind = "model",
            creatureID = CreatureFor(soundData),
            animation = 60,
            fallback = { kind = "texture", texture = BOOK },
        },
        actions = ACTIONS,
    }
    return soundData
end

--------------------------------------------------------------------------------
-- Queueing
--------------------------------------------------------------------------------

--- Resolve a line through the packs and hand it to the player. Records the stage the
--- 10 Hz watcher keys on, as the queue used to.
---@param soundData SoundData
---@return boolean queued
function Player:Enqueue(soundData)
    if not self.source then
        Debug:Record("player-missing", "The Spoken player addon is not installed")
        return false
    end

    if not DataModules:PrepareSound(soundData) then
        Debug:Record("data-lookup-failed", format("No sound entry for event %s, quest ID %s, title %q",
            Enums.SoundEvent:GetName(soundData.event) or tostring(soundData.event),
            tostring(soundData.questID or "none"), soundData.title or soundData.name or ""))
        return false
    end

    self:Prepare(soundData)
    local added, reason = self.source:Enqueue(soundData)
    if not added then
        if reason == "duplicate" then
            -- Already in the queue is, for the watcher's purposes, queued.
            Debug:Record("queued", format("Already queued: %s", soundData.fileName))
        elseif reason == "missing" then
            Debug:Record("file-playback-failed", format([[The data entry exists, but PlaySoundFile rejected "%s" from module "%s"]],
                soundData.filePath, soundData.module.METADATA.AddonName))
        elseif reason == "outranked" then
            Debug:Record("queue-outranked", "Gossip yields to the quest line that is queued")
        else
            Debug:Record("sound-disabled", reason or "refused")
        end
        return false
    end

    if Spoken:IsPaused() then
        Debug:Record("queue-paused", "The voiceover is queued, but playback is paused; run /vo play")
    end
    return true
end

function Player:Remove(soundData)
    if not self.source then
        return false
    end
    return self.source:Remove(soundData)
end

--- After a setting changed something the player draws from.
function Player:RefreshConfig()
    if Spoken and Spoken.RefreshPlayer then
        Spoken:RefreshPlayer()
    end
end

--------------------------------------------------------------------------------
-- Registration
--------------------------------------------------------------------------------

function Player:Setup()
    if self.source then
        return true
    end
    if not (Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then
        Debug:Record("player-missing", "The Spoken player addon is not installed; nothing will be read aloud")
        return false
    end

    self.source = Spoken:RegisterSource("quests", {
        title = "Spoken Quests",
        addon = AddonFolder,
        order = 1,
        -- Upstream's figure: quest durations come from a lookup that has drifted across
        -- transcodes, and the extra gap absorbs one that is slightly short.
        interClipGap = 0.55,
        -- Play-and-stop the file before admitting it, as the queue always did here.
        testBeforeQueue = true,
    })

    -- What the watcher reads to know whether an event reached the speaker.
    Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == Player.source then
            Debug:Record("queued", format("Queued %s (%s)", clip.title or clip.name or clip.fileName, clip.path))
        end
    end)
    Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        if clip.source ~= Player.source then
            return
        end
        Debug:Record("playing", format("Playing %s", clip.path or clip.fileName or "voiceover"))
    end)

    Spoken:RegisterBullet("quest-accept",   TEXTURES .. "SoundQueueBulletAccept", 14)
    Spoken:RegisterBullet("quest-progress", TEXTURES .. "SoundQueueBulletProgress", 14)
    Spoken:RegisterBullet("quest-complete", TEXTURES .. "SoundQueueBulletComplete", 14)
    Spoken:RegisterBullet("gossip",         TEXTURES .. "SoundQueueBulletGossip", 14)

    Spoken.Minimap:AddEntry("quests", { id = "Read", text = "Read visible quest", order = 1,
        onClick = function() Addon:ReadVisibleQuest("minimap") end })
    Spoken.Minimap:AddEntry("quests", { id = "Options", text = "Spoken Quests settings", order = 2,
        onClick = function() Options:OpenConfigWindow() end })
    if Spoken.AddSettingsLink then
        Spoken:AddSettingsLink("Spoken Quests settings", function() Options:OpenConfigWindow() end)
    end
    return true
end
