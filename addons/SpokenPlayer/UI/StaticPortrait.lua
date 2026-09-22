setfenv(1, SpokenEnv)

-- Native unit-frame portraits, captured while the speaker's unit token exists.
-- Keep the Texture region itself: generated portraits are not ordinary file IDs
-- that can safely be copied through GetTexture(). A queued line must not switch
-- to a different face just because the player changes target.
StaticPortrait = { cache = {}, count = 0, age = 0 }
local ART = [[Interface\AddOns\SpokenPlayer\Textures\]]
local UNITS = { "npc", "target", "mouseover", "focus" }
local function Identity(clip)
    local spec = clip and clip.present and clip.present.portrait
    if not spec or spec.kind ~= "model" then return end
    local guid = spec.unitGUID or clip.unitGUID
    -- Quest-log playback can carry a synthetic GUID rather than a world unit.
    if guid and string.find(guid, "^Creature%-0%-0%-0%-0%-") then guid = nil end
    return spec, guid, spec.creatureID
end
local function CreatureID(guid)
    if not guid then return end
    return tonumber(string.match(guid, "^Creature%-%d+%-%d+%-%d+%-%d+%-(%d+)%-"))
end
function StaticPortrait:InQueue(entry)
    for _, clip in ipairs(SoundQueue.sounds) do
        local spec, guid, creature = Identity(clip)
        if spec and (guid == entry.key or (not guid and creature == entry.creature)) then return true end
    end
    return false
end
function StaticPortrait:Acquire(key)
    if self.count < 32 then
        if not self.storage then
            self.storage = CreateFrame("Frame", nil, UIParent)
            self.storage:Hide()
        end
        self.count = self.count + 1
        return { texture = self.storage:CreateTexture(nil, "ARTWORK") }
    end
    local oldest
    for _, entry in pairs(self.cache) do
        if entry.texture ~= self.activeTexture and not self:InQueue(entry)
            and (not oldest or entry.age < oldest.age) then oldest = entry end
    end
    if oldest then
        self.cache[oldest.key] = nil
        oldest.texture:Hide()
        oldest.texture:SetParent(self.storage)
    end
    return oldest
end
function StaticPortrait:Capture(clip, refreshGUID)
    local spec, guid, creature = Identity(clip)
    if not spec or not SetPortraitTexture or not UnitGUID then return end
    local cached = guid and self.cache[guid]
    if not guid and creature then
        for _, entry in pairs(self.cache) do
            if entry.creature == creature and (not cached or entry.age > cached.age) then cached = entry end
        end
    end
    for _, unit in ipairs(UNITS) do
        local actual = UnitGUID(unit)
        if actual and ((guid and actual == guid) or (not guid and creature and CreatureID(actual) == creature)) then
            local entry = self.cache[actual] or self:Acquire(actual)
            if not entry then return cached end
            if entry.key ~= actual or refreshGUID == actual then
                SetPortraitTexture(entry.texture, unit)
                entry.texture:SetTexCoord(0, 1, 0, 1)
            end
            entry.key, entry.creature = actual, creature
            self.age = self.age + 1
            entry.age = self.age
            self.cache[actual] = entry
            return entry
        end
    end
    if cached then self.age = self.age + 1; cached.age = self.age end
    return cached
end
function StaticPortrait:Mask(viewport, texture)
    if not texture.AddMaskTexture then return end
    if not viewport.roundMask then
        viewport.roundMask = viewport:CreateMaskTexture()
        viewport.roundMask:SetAllPoints()
        viewport.roundMask:SetTexture(ART .. "MinimalPortraitMask", "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
    end
    if texture.minimalMask ~= viewport.roundMask then
        if texture.minimalMask then texture:RemoveMaskTexture(texture.minimalMask) end
        texture:AddMaskTexture(viewport.roundMask)
        texture.minimalMask = viewport.roundMask
    end
end
function StaticPortrait:Release(viewport)
    if viewport.active == "static" then
        if viewport.activeFrame then viewport.activeFrame:Hide() end
        viewport.active, viewport.activeFrame, self.activeTexture = nil, nil, nil
    end
end
function StaticPortrait:Configure(viewport, clip)
    local spec = Identity(clip)
    if not spec then self:Release(viewport); return false end
    local entry = self:Capture(clip)
    if entry then
        if viewport.activeFrame ~= entry.texture then
            if viewport.active == "static" then self:Release(viewport)
            elseif viewport.activeFrame then
                local renderer = Renderers[viewport.active]
                if renderer then renderer.Release(viewport.activeFrame) end
            end
            entry.texture:SetParent(viewport)
            entry.texture:ClearAllPoints()
            entry.texture:SetAllPoints()
            self:Mask(viewport, entry.texture)
        end
        viewport.active, viewport.activeFrame = "static", entry.texture
        self.activeTexture = entry.texture
        entry.texture:Show()
    else
        self:Release(viewport)
        local fallback = spec.fallback
        if not fallback or fallback.kind ~= "texture" then fallback = { kind = "texture", texture = ART .. "Book" } end
        Portrait:Configure(viewport, { present = { portrait = fallback } })
        if viewport.texture then self:Mask(viewport, viewport.texture) end
    end
    return true
end

if not Version.IsAnyLegacy then
    Callbacks:Register("CLIP_QUEUED", function(clip) StaticPortrait:Capture(clip) end)
    local watcher = CreateFrame("Frame")
    for _, event in ipairs({ "PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "GOSSIP_SHOW",
        "QUEST_DETAIL", "UNIT_PORTRAIT_UPDATE", "UNIT_MODEL_CHANGED" }) do watcher:RegisterEvent(event) end
    watcher:SetScript("OnEvent", function(_, event, unit)
        local refreshGUID = (event == "UNIT_PORTRAIT_UPDATE" or event == "UNIT_MODEL_CHANGED") and unit and UnitGUID(unit)
        for _, clip in ipairs(SoundQueue.sounds) do StaticPortrait:Capture(clip, refreshGUID) end
        if MinimalPlayer and MinimalPlayer:HasClip() then MinimalPlayer:ConfigurePortrait() end
    end)
    StaticPortrait.watcher = watcher
end
