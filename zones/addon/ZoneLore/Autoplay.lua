-- ZoneLore -- narrate an area when the player discovers it.
--
-- The trigger is the game's own discovery, the moment it prints "Discovered
-- Durotar". Nothing else comes close:
--
--   * Zone-change events do not fire for it. A new orc stands in Valley of Trials,
--     which is a subzone of Durotar, so GetBestMapForUnit already answers "Durotar"
--     from the first second. Walking out into open Durotar changes no map ID.
--   * Tracking first visits ourselves means deciding when a visit starts, and any
--     answer to that is a guess. The client already knows, exactly, and remembers
--     per character across sessions for free.
--
-- So there is no per-character bookkeeping here. The game fires a discovery once
-- and never again, which is precisely the semantics this feature wanted.

local ADDON_NAME, ZoneLore = ...

-- Two discoveries can land together when a subzone sits on a zone border. Deep
-- enough to hold those, shallow enough that nothing narrates far behind the player.
local QUEUE_LIMIT = 3

local pending = {}
local ticker = nil

--------------------------------------------------------------------------------
-- Reading the client's own discovery messages
--------------------------------------------------------------------------------
--
-- ERR_ZONE_EXPLORED_XP is "Discovered %s: %d experience gained." and
-- ERR_ZONE_EXPLORED is "Discovered %s." -- but only in English. Building the
-- patterns from the globals the running client defines makes this work in every
-- locale without shipping a translation table, and makes a Blizzard rewording a
-- non-event.

local patterns = nil

local function BuildPattern(globalString)
	if type(globalString) ~= "string" or globalString == "" then
		return nil
	end
	-- Escape the Lua pattern magic characters first, so the literal parts of the
	-- message match themselves, then reopen the format specifiers as captures.
	local pattern = globalString:gsub("([%^%$%(%)%%%.%[%]%*%+%-%?])", "%%%1")
	pattern = pattern:gsub("%%%%d", "%%d+")
	pattern = pattern:gsub("%%%%s", "(.+)")
	return "^" .. pattern .. "$"
end

local function DiscoveryPatterns()
	if patterns then
		return patterns
	end
	patterns = {}
	-- The XP form first: it is the more specific of the two, and at max level (or
	-- in a rested-XP-less state) the client falls back to the plain form.
	for _, name in ipairs({ "ERR_ZONE_EXPLORED_XP", "ERR_ZONE_EXPLORED" }) do
		local pattern = BuildPattern(_G[name])
		if pattern then
			table.insert(patterns, pattern)
		end
	end
	return patterns
end

local function AreaFromMessage(message)
	if type(message) ~= "string" then
		return nil
	end
	for _, pattern in ipairs(DiscoveryPatterns()) do
		local area = message:match(pattern)
		if area then
			return area
		end
	end
	return nil
end

--------------------------------------------------------------------------------
-- Queue
--------------------------------------------------------------------------------

local function StopTicker()
	if ticker then
		ticker:Cancel()
		ticker = nil
	end
end

-- Combat is worth waiting out rather than skipping: a clip starting mid-pull
-- competes with everything the player actually needs to hear.
local function CanPlayNow()
	if #pending == 0 then
		return false
	end
	if not ZoneLore:Get("autoplay") or not ZoneLore:IsVoiceEnabled() then
		return false
	end
	if ZoneLore:IsPlayingLore() or ZoneLore:IsPaused() then
		return false
	end
	if UnitAffectingCombat("player") then
		return false
	end
	-- A starting-zone cinematic is the one moment a new character is guaranteed to
	-- be discovering things, so narrating over it is the likeliest collision there
	-- is. The queue holds rather than drops: the ticker retries once it ends.
	if (CinematicFrame and CinematicFrame:IsShown())
		or (MovieFrame and MovieFrame:IsShown()) then
		return false
	end
	return true
end

local function Drain()
	if not CanPlayNow() then
		if #pending == 0 then
			StopTicker()
		end
		return
	end

	local entry = table.remove(pending, 1)
	if #pending == 0 then
		StopTicker()
	end
	ZoneLore:PlayLore(entry.mapID, entry.areaKey)
end

-- The audio callback covers a clip ending; the ticker covers what has no event of
-- its own, which is leaving combat.
local function StartTicker()
	if ticker then
		return
	end
	ticker = C_Timer.NewTicker(1, Drain)
end

-- Called by ZoneLore:StopLore. Stop means silence, not "skip to the next thing I
-- discovered on the way here".
function ZoneLore:ClearAutoplayQueue()
	wipe(pending)
	StopTicker()
end

local function Enqueue(mapID, areaKey)
	table.insert(pending, { mapID = mapID, areaKey = areaKey })
	while #pending > QUEUE_LIMIT do
		table.remove(pending, 1)
	end
	StartTicker()
	Drain()
end

--------------------------------------------------------------------------------
-- Discovery handling
--------------------------------------------------------------------------------

-- Discovering the area that shares the zone's name -- stepping out of Valley of
-- Trials into open Durotar -- is what "discovered a zone" means. Everything else
-- the client announces is a subzone.
local function IsZoneDiscovery(areaName, mapID)
	local zoneName = ZoneLore:GetMapName(mapID)
	if not zoneName then
		return false
	end
	return ZoneLore:NormaliseAreaKey(areaName) == ZoneLore:NormaliseAreaKey(zoneName)
end

function ZoneLore:OnAreaDiscovered(areaName)
	if not areaName or areaName == "" then
		return
	end

	local debugOn = self:Get("debug")

	if not self:Get("autoplay") or not self:IsVoiceEnabled() then
		if debugOn then
			self:Print('discovered "%s" -- autoplay off, ignoring', areaName)
		end
		return
	end

	local _, mapID = self:GetLoreWithFallback(self:GetPlayerMapID())
	if not mapID then
		return
	end

	if IsZoneDiscovery(areaName, mapID) then
		if self:GetLore(mapID) then
			if debugOn then
				self:Print('discovered zone "%s" -- queued', areaName)
			end
			Enqueue(mapID, nil)
		end
		return
	end

	if not self:Get("autoplaySubzones") then
		if debugOn then
			self:Print('discovered subzone "%s" -- subzone autoplay is off', areaName)
		end
		return
	end

	local entry, key = self:GetSubzoneLore(mapID, areaName)
	if entry and key then
		if debugOn then
			self:Print('discovered subzone "%s" -> key "%s" -- queued', areaName, key)
		end
		Enqueue(mapID, key)
	elseif debugOn then
		self:Print('discovered subzone "%s" -> key "%s" -- no lore', areaName, tostring(key))
	end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

-- Which event carries the message depends on whether the discovery awarded
-- experience, so listen to both rather than betting on one. A message that is not
-- a discovery simply does not match the patterns.
local DISCOVERY_EVENTS = {
	"CHAT_MSG_SYSTEM",
	"CHAT_MSG_COMBAT_XP_GAIN",
}

function ZoneLore:SetupAutoplay()
	local frame = CreateFrame("Frame")
	for _, event in ipairs(DISCOVERY_EVENTS) do
		frame:RegisterEvent(event)
	end

	frame:SetScript("OnEvent", function(_, event, message)
		local area = AreaFromMessage(message)
		if area then
			ZoneLore:OnAreaDiscovered(area)
		elseif ZoneLore:Get("debug") and event == "CHAT_MSG_SYSTEM" then
			-- Printed under debug only. If discovery messages ever stop matching,
			-- this is what shows the text that should have.
			ZoneLore:Print("|cff888888system: %s|r", tostring(message))
		end
	end)

	self:OnAudioChanged(Drain)
	self.autoplayFrame = frame
end

-- Reports whether the client defined the strings this feature is built on, so a
-- silent failure can be told apart from "nothing has been discovered yet".
function ZoneLore:DescribeAutoplay()
	local found = #DiscoveryPatterns()
	if found == 0 then
		self:Print("|cffff5555autoplay cannot work|r: this client defines neither "
			.. "ERR_ZONE_EXPLORED nor ERR_ZONE_EXPLORED_XP")
		return
	end
	self:Print("autoplay %s, matching %d discovery message form(s); subzones %s",
		self:Get("autoplay") and "on" or "off", found,
		self:Get("autoplaySubzones") and "included" or "excluded")
end
