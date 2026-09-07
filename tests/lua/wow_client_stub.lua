-- A stand-in for the parts of the WoW client that the VoiceOver Redux player touches.
--
-- The player's quest dispatch is a 10 Hz timer reading client state, so testing it needs a
-- clock that can be stepped rather than waited on: Advance() moves time and fires the
-- AceTimer callbacks that fall inside the step, which makes a quest hand-off deterministic.
local M = {}

local world = {
    time = 0,
    questID = 0,
    title = "",
    questText = "",
    progressText = "",
    rewardText = "",
    npcName = "Innkeeper Test",
    npcGUID = "Creature-0-0-0-0-1234-0",
    panels = {},
    played = {},
}
M.world = world

local timers = {}
local allFrames = {}

--- Move the clock forward, firing every timer scheduled inside the interval.
function M.Advance(seconds, step)
    step = step or 0.05
    local target = world.time + seconds
    while world.time < target - 1e-9 do
        world.time = math.min(world.time + step, target)
        for _, timer in ipairs(timers) do
            while timer.at and world.time >= timer.at - 1e-9 do
                if timer.interval then
                    timer.at = timer.at + timer.interval
                else
                    timer.at = nil
                end
                timer.fn()
            end
        end
    end
end

--- Show one Blizzard quest panel, or none at all. Passing nil is what an addon that
--- replaces the quest frame - DialogueUI calls QuestFrame:UnregisterAllEvents() - leaves
--- behind: the client is in a quest dialog, but no Blizzard panel is ever shown.
function M.ShowPanel(name)
    world.panels = {}
    if name then
        world.panels[name] = true
    end
end

--- Deliver a client event to every frame registered for it.
function M.FireEvent(event, ...)
    for _, frame in ipairs(allFrames) do
        if frame.events[event] and frame.scripts.OnEvent then
            frame.scripts.OnEvent(frame, event, ...)
        end
    end
end

local function MakeFrame(name)
    local frame = { name = name, events = {}, scripts = {}, hooks = {} }
    function frame:RegisterEvent(event) self.events[event] = true end
    function frame:UnregisterEvent(event) self.events[event] = nil end
    function frame:UnregisterAllEvents() self.events = {} end
    function frame:SetScript(script, fn) self.scripts[script] = fn end
    function frame:HookScript(script, fn)
        self.hooks[script] = self.hooks[script] or {}
        table.insert(self.hooks[script], fn)
    end
    function frame:IsVisible() return world.panels[self.name] and true or false end
    function frame:IsShown() return self:IsVisible() end
    function frame:Show()
        world.panels[self.name] = true
        for _, fn in ipairs(self.hooks.OnShow or {}) do fn(self) end
    end
    function frame:Hide() world.panels[self.name] = nil end
    for _, noop in ipairs({ "SetSize", "SetPoint", "SetWidth", "SetHeight", "SetScale", "SetFrameStrata",
        "SetMovable", "EnableMouse", "RegisterForDrag", "SetClampedToScreen", "SetAlpha", "ClearAllPoints",
        "SetParent", "SetUnit", "SetCamera", "SetModelScale", "SetPosition", "SetFacing", "RefreshUnit" }) do
        frame[noop] = function() end
    end
    table.insert(allFrames, frame)
    return frame
end

local frames = {}
local function Frame(name)
    frames[name] = frames[name] or MakeFrame(name)
    return frames[name]
end
M.Frame = Frame

local _G = _G

-- A current Blizzard client, which is where the 10 Hz watcher runs at all.
function _G.GetBuildInfo() return "2.5.6", "60000", "Jan 1 2026", 20506 end
_G.WOW_PROJECT_ID = 5
_G.WOW_PROJECT_CLASSIC = 2
_G.WOW_PROJECT_BURNING_CRUSADE_CLASSIC = 5
_G.WOW_PROJECT_WRATH_CLASSIC = 11
_G.WOW_PROJECT_MAINLINE = 1

function _G.GetTime() return world.time end
function _G.GetQuestID() return world.questID end
function _G.GetTitleText() return world.title end
function _G.GetQuestText() return world.questText end
function _G.GetProgressText() return world.progressText end
function _G.GetRewardText() return world.rewardText end
function _G.UnitName(unit) return unit == "player" and "Tester" or world.npcName end
function _G.UnitGUID() return world.npcGUID end
function _G.UnitExists() return true end
function _G.UnitIsPlayer() return false end
function _G.UnitSex() return 2 end
function _G.GetCVar() return "1" end
function _G.SetCVar() end
function _G.PlaySoundFile(path)
    table.insert(world.played, path)
    return true, #world.played
end
function _G.StopSound() end
function _G.CreateFrame(_, name) return name and Frame(name) or MakeFrame("anonymous") end
function _G.hooksecurefunc() return true end
function _G.IsLoggedIn() return true end
function _G.GetLocale() return "enUS" end
M.print = print
function _G.print() end
function _G.strsplit(sep, str)
    local out = {}
    for piece in string.gmatch(str or "", "([^" .. sep .. "]*)" .. sep .. "?") do
        table.insert(out, piece)
    end
    if out[#out] == "" then table.remove(out) end
    return unpack(out)
end
_G.format = string.format
_G.strlower = string.lower
_G.strupper = string.upper
_G.strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
_G.gsub = string.gsub
_G.strfind = string.find
_G.getn = function(t) return #t end
_G.NORMAL_FONT_COLOR_CODE = "|cffffffff"
_G.GRAY_FONT_COLOR_CODE = "|cff808080"
_G.OKAY = "Okay"
_G.StaticPopupDialogs = {}
function _G.StaticPopup_Show() end
_G.SlashCmdList = {}

for _, name in ipairs({ "QuestFrameRewardPanel", "QuestFrameProgressPanel", "QuestFrameDetailPanel",
    "QuestFrameGreetingPanel", "QuestLogDetailFrame", "GossipFrame", "QuestFrame" }) do
    _G[name] = Frame(name)
end

-- One sound pack, present and already loaded.
local PACK = "TestPack"
function _G.GetNumAddOns() return 1 end
function _G.GetAddOnInfo(i)
    if i == 1 or i == PACK then return PACK, PACK, "", true, "LOADED" end
end
function _G.GetAddOnMetadata(_, key)
    if key == "X-VoiceOver-DataModule-Version" then return "1" end
    if key == "Version" then return "1.2.1" end
    if key == "Title" then return PACK end
    return ""   -- The client's tonumber tolerates nil, LuaJIT's does not.
end
function _G.IsAddOnLoadOnDemand() return false end
function _G.GetAddOnEnableState() return 2 end
function _G.DisableAddOn() end
function _G.LoadAddOn() return true end

local libs = {}
_G.LibStub = setmetatable({
    NewLibrary = function() end,
    GetLibrary = function(_, name) return libs[name] end,
}, { __call = function(_, name) return libs[name] end })

libs["AceAddon-3.0"] = {
    GetAddon = function() return nil end,
    NewAddon = function(_, name)
        local addon = { name = name }
        function addon:RegisterEvent() end
        function addon:UnregisterEvent() end
        function addon:ScheduleTimer(fn, delay)
            local timer = { at = world.time + delay, fn = fn }
            table.insert(timers, timer)
            return timer
        end
        function addon:ScheduleRepeatingTimer(fn, interval)
            local timer = { at = world.time + interval, fn = fn, interval = interval }
            table.insert(timers, timer)
            return timer
        end
        function addon:CancelTimer(timer)
            if timer then timer.at = nil end
        end
        return addon
    end,
}

local function DeepCopy(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do copy[key] = DeepCopy(item) end
    return copy
end

libs["AceDB-3.0"] = {
    New = function(_, _, defaults)
        local db = { profile = DeepCopy(defaults.profile), char = DeepCopy(defaults.char) }
        db.RegisterCallback = function() end
        return db
    end,
}

--- Load the player against this stub and return its private environment.
function M.LoadPlayer(addonDirectory)
    dofile(addonDirectory .. "Environment.lua")
    local VO = _G.VoiceOver

    -- The player calls into these while dispatching quests, but none of them decide which
    -- line is read, so a stub that answers every call keeps the test about dispatch.
    for _, module in ipairs({ "SoundQueueUI", "QuestOverlayUI", "ReportButton", "Options" }) do
        VO[module] = setmetatable({}, { __index = function() return function() end end })
    end

    for _, file in ipairs({ "Version", "Enums", "Utils", "Debug", "FuzzySearch", "SoundQueue", "EasterEggs",
        "DataModules", "VoiceOver" }) do
        dofile(addonDirectory .. file .. ".lua")
    end
    VO.Utils.CreateNPCModelFrame = function() end
    return VO
end

return M
