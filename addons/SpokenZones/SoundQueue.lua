setfenv(1, ZoneLoreQueue)

-- ZoneLore -- the sound queue.
--
-- Ported from AI_VoiceOver's SoundQueue.lua, which is public domain. The body is
-- kept close to upstream so its fixes can be re-applied by diff, which is also
-- why this file runs inside the private environment set up in QueueEnv.lua rather
-- than in ZoneLore's usual one. Everything that departs from upstream is listed
-- here:
--
--  * Quest and gossip logic is gone: the SoundData class doc, DataModules
--    lookup, the rule where a queued quest line rejects gossip, the
--    Sound_EnableDialog toggling, and the NPC model frame. What is left plays a
--    file and moves to the next one.
--  * The UI is not called directly. Upstream's queue and its display are
--    circular by design; ZoneLore already has ZoneLore:NotifyAudioChanged, which
--    every button, the playback bar and the queue display register into, so the
--    four SoundQueueUI calls become one notification each.
--  * The gap between clips is 0.25s, not upstream's 0.55s. Upstream's larger
--    figure absorbs inaccurate durations; ZoneLore's come from a generated lookup
--    and are exact, and a re-sync that quietly restores 0.55 adds a third of a
--    second of dead air to every autoplayed clip.
--  * `soundData.delay` is dropped. Only upstream's 2.4.3/3.3.5 music-channel path
--    ever set it, and ZoneLore targets neither client.
--  * Gates and the retry ticker are new -- see AddGate below. Upstream plays on
--    insert and has no way to say "not now".
--  * PlayNow is new: it front-inserts. See the note on it.

---@class LoreSound
---@field fileName string Pack clip file name without extension. The dedup key.
---@field filePath string Full path handed to PlaySoundFile.
---@field length number Clip duration in seconds, from the pack's lookup table.
---@field mapID number uiMapID of the area being narrated.
---@field areaKey? string Canonical subzone key, or nil for the zone itself.
---@field label string What a queue row shows.
---@field autoplay? boolean True when a producer queued this rather than the player.
---@field id? number Assigned by SoundQueue on admission.
---@field handle? number Sound handle, set by SoundUtils:PlaySound.
---@field nextSoundTimer? any Set only while the clip is actively playing.
---@field addedCallback? fun(soundData: LoreSound)
---@field startCallback? fun(soundData: LoreSound)
---@field stopCallback? fun(soundData: LoreSound)

SoundQueue = {
    soundIdCounter = 0,
    ---@type LoreSound[]
    sounds = {},
}
ZoneLore.SoundQueue = SoundQueue

-- How many clips may be waiting behind the one playing. Discoveries arrive in
-- bursts when crossing a cluster of small subzones, and narration that has fallen
-- minutes behind is describing somewhere the player already left.
local QUEUE_LIMIT = 3

-- Silence between one clip ending and the next starting. See the header.
local INTER_CLIP_GAP = 0.25

-- How often to re-check a held head. Leaving combat fires no event worth binding
-- a handler to, so this is a poll.
local RETRY_INTERVAL = 1

local retryTicker = nil

function SoundQueue:GetQueueSize()
    return getn(self.sounds)
end

-- How many are waiting behind whatever is playing. This, not the total, is what
-- "Stop becomes Next" and the three-deep cap are counted in: a player who has
-- started one clip and nothing else has an empty queue, not a queue of one.
function SoundQueue:GetWaitingCount()
    return self:GetQueueSize() - (self:IsPlaying() and 1 or 0)
end

function SoundQueue:IsEmpty()
    return self:GetQueueSize() == 0
end

function SoundQueue:GetCurrentSound()
    return self.sounds[1]
end

function SoundQueue:GetNextSound()
    return self.sounds[2]
end

---@param soundData LoreSound
function SoundQueue:Contains(soundData)
    for _, queuedSound in ipairs(self.sounds) do
        if queuedSound == soundData then
            return true
        end
    end
    return false
end

--------------------------------------------------------------------------------
-- Gates
--------------------------------------------------------------------------------
--
-- A gate is a reason the head may not start yet. Upstream has no such notion --
-- AddSoundToQueue plays immediately -- but ZoneLore holds autoplayed narration
-- through combat and cinematics rather than dropping it, and holding is only
-- possible if the queue can leave a head unplayed and come back to it.
--
-- Gates receive the item, not just the moment, because combat disqualifies only
-- what a producer queued: a player who clicks Play mid-pull means now.

local gates = {}

--- Register a predicate returning a reason to hold the given item, or nil to let
--- it play. Held items stay at the front of the queue and are retried once a
--- second until every gate allows them.
---@param fn fun(soundData: LoreSound): string?
function SoundQueue:AddGate(fn)
    table.insert(gates, fn)
end

--- Why the given item is not playing, or nil. Shown on the held row, so that
--- narration waiting out a pull is distinguishable from nothing happening.
---@param soundData LoreSound
function SoundQueue:GetHeldReason(soundData)
    for _, gate in ipairs(gates) do
        local reason = gate(soundData)
        if reason then
            return reason
        end
    end
    return nil
end

local function StopRetryTicker()
    if retryTicker then
        retryTicker:Cancel()
        retryTicker = nil
    end
end

local function StartRetryTicker()
    if retryTicker then
        return
    end
    retryTicker = C_Timer.NewTicker(RETRY_INTERVAL, function()
        SoundQueue:Advance()
    end)
end

--- Start the head if it is waiting and nothing holds it back. Safe to call at any
--- time; the ticker and every queue mutation route through here.
function SoundQueue:Advance()
    local soundData = self:GetCurrentSound()
    if not soundData or soundData.nextSoundTimer or self:IsPaused() then
        StopRetryTicker()
        return
    end

    if self:GetHeldReason(soundData) then
        StartRetryTicker()
        return
    end

    StopRetryTicker()
    self:PlaySound(soundData)
    ZoneLore:NotifyAudioChanged()
end

--------------------------------------------------------------------------------
-- Admission
--------------------------------------------------------------------------------

-- Trim the backlog, never the clip being spoken. Upstream has no cap at all;
-- ZoneLore's used to live in Autoplay, where the playing clip was held outside
-- the pending list and so could not be trimmed by accident. Here it is sounds[1],
-- hence the head exemption -- without it a burst of discoveries cuts off the
-- sentence the player is listening to.
local function TrimBacklog()
    local first = SoundQueue:IsPlaying() and 2 or 1
    while SoundQueue:GetWaitingCount() > QUEUE_LIMIT do
        local dropped = table.remove(SoundQueue.sounds, first)
        if not dropped then
            return
        end
        if dropped.stopCallback then
            dropped.stopCallback(dropped)
        end
    end
end

---@param soundData LoreSound
---@param announce? boolean Say out loud why the sound will not play. True only
---                         when a human asked for this line by name; a producer
---                         queueing an area in the background must stay quiet.
function SoundQueue:AddSoundToQueue(soundData, announce)
    if not soundData then
        return false
    end

    local channel = ZoneLore:GetVoiceChannel()
    local inaudible = Utils:WhyInaudible(channel)
    if inaudible then
        if announce then
            ZoneLore:Print("|cffffcc00cannot play lore: %s|r", inaudible)
        end
        return false
    end

    -- Already queued, or already playing. Two discoveries can name the same area
    -- -- the login greeting and a real discovery, or a subzone straddling a zone
    -- border -- and it should be narrated once.
    for _, queuedSound in ipairs(self.sounds) do
        if queuedSound.fileName == soundData.fileName then
            return false
        end
    end

    self.soundIdCounter = self.soundIdCounter + 1
    soundData.id = self.soundIdCounter

    table.insert(self.sounds, soundData)
    TrimBacklog()

    if soundData.addedCallback then
        soundData.addedCallback(soundData)
    end

    self:Advance()
    ZoneLore:NotifyAudioChanged()
    return true
end

--- Put this at the front and start it, displacing whatever was speaking.
---
--- The player pressing Play has always meant "now" in ZoneLore, and appending
--- would break that twice over: behind a backlog it is a wait, and behind a head
--- held for combat it may never arrive. Producers append; only a human
--- front-inserts.
---@param soundData LoreSound
function SoundQueue:PlayNow(soundData, announce)
    if not soundData then
        return false
    end

    -- Clicking Play on something already waiting should play it, not be swallowed
    -- by the dedup above.
    for index = self:GetQueueSize(), 1, -1 do
        if self.sounds[index].fileName == soundData.fileName then
            self:RemoveSoundFromQueue(self.sounds[index])
        end
    end

    local head = self:GetCurrentSound()
    if head then
        Utils:StopSound(head)
        if head.nextSoundTimer then
            Addon:CancelTimer(head.nextSoundTimer)
            head.nextSoundTimer = nil
        end
    end

    local channel = ZoneLore:GetVoiceChannel()
    local inaudible = Utils:WhyInaudible(channel)
    if inaudible then
        if announce then
            ZoneLore:Print("|cffffcc00cannot play lore: %s|r", inaudible)
        end
        ZoneLore:NotifyAudioChanged()
        return false
    end

    self.soundIdCounter = self.soundIdCounter + 1
    soundData.id = self.soundIdCounter
    table.insert(self.sounds, 1, soundData)
    TrimBacklog()

    if soundData.addedCallback then
        soundData.addedCallback(soundData)
    end

    -- Resuming is what a paused player expects from pressing Play on something
    -- new, and leaving the flag set would make the new clip silent.
    self:SetPaused(false)
    self:Advance()
    ZoneLore:NotifyAudioChanged()
    return self:IsPlaying()
end

--------------------------------------------------------------------------------
-- Playback
--------------------------------------------------------------------------------

---@param soundData LoreSound
function SoundQueue:PlaySound(soundData)
    local willPlay = Utils:PlaySound(soundData, ZoneLore:GetVoiceChannel())
    if not willPlay then
        ZoneLore:Print("|cffffcc00no audio for this entry|r (missing %s)", soundData.filePath)
        self:RemoveSoundFromQueue(soundData, true)
        return
    end

    if soundData.startCallback then
        soundData.startCallback(soundData)
    end

    -- The client fires no event when a sound finishes, so the recorded duration is
    -- the only signal that the clip is over.
    soundData.nextSoundTimer = Addon:ScheduleTimer(function()
        self:RemoveSoundFromQueue(soundData, true)
    end, soundData.length + INTER_CLIP_GAP)
end

function SoundQueue:IsPlaying()
    local currentSound = self:GetCurrentSound()
    return (currentSound and currentSound.nextSoundTimer) and true or false
end

function SoundQueue:IsPaused()
    return Addon.db and Addon.db.char.IsPaused or false
end

function SoundQueue:SetPaused(value)
    if Addon.db then
        Addon.db.char.IsPaused = value
    end
end

function SoundQueue:CanBePaused()
    return not self:IsPlaying() or self:GetCurrentSound().handle ~= nil
end

-- Pause is stop, and resume replays from the beginning. The client can start and
-- stop a sound file and nothing in between: there is no seek, and no way to ask
-- how far into a clip playback has reached. Upstream has the same limitation and
-- the same implementation. The tooltip says so rather than letting the player
-- discover it forty seconds in.
function SoundQueue:PauseQueue()
    if self:IsPaused() then
        return false
    end

    self:SetPaused(true)

    local currentSound = self:GetCurrentSound()
    if currentSound and self:CanBePaused() then
        Utils:StopSound(currentSound)
        Addon:CancelTimer(currentSound.nextSoundTimer)
        currentSound.nextSoundTimer = nil
    end

    StopRetryTicker()
    ZoneLore:NotifyAudioChanged()
    return true
end

function SoundQueue:ResumeQueue()
    if not self:IsPaused() then
        return false
    end

    self:SetPaused(false)
    self:Advance()
    ZoneLore:NotifyAudioChanged()
    return true
end

function SoundQueue:TogglePauseQueue()
    if self:IsPaused() then
        return self:ResumeQueue()
    end
    return self:PauseQueue()
end

---@param soundData LoreSound
function SoundQueue:RemoveSoundFromQueue(soundData, finishedPlaying)
    if not soundData then
        return false
    end

    local removedIndex = nil
    for index, queuedSound in ipairs(self.sounds) do
        if queuedSound.id == soundData.id then
            if index == 1 and not self:CanBePaused() and not finishedPlaying then
                return false
            end

            removedIndex = index
            table.remove(self.sounds, index)
            break
        end
    end

    if not removedIndex then
        return false
    end

    if soundData.stopCallback then
        soundData.stopCallback(soundData)
    end

    if removedIndex == 1 then
        Utils:StopSound(soundData)
        if soundData.nextSoundTimer then
            Addon:CancelTimer(soundData.nextSoundTimer)
            soundData.nextSoundTimer = nil
        end
        self:Advance()
    end

    ZoneLore:NotifyAudioChanged()
    return true
end

function SoundQueue:RemoveAllSoundsFromQueue()
    for i = self:GetQueueSize(), 1, -1 do
        local queuedSound = self.sounds[i]
        if queuedSound then
            if i == 1 and not self:CanBePaused() then
                return
            end

            self:RemoveSoundFromQueue(queuedSound)
        end
    end

    -- Stop means silence, not "carry on once the pull ends".
    StopRetryTicker()
    self:SetPaused(false)
end
