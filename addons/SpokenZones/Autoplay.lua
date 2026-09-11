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
-- The game fires a discovery once and never again, which is precisely the
-- semantics this feature wanted.
--
-- The cost of leaning on it is that a character who explored Azeroth before
-- installing ZoneLore already spent every discovery it will ever get, and so is
-- narrated nothing at all. The `autoplayExplored` option answers that by keeping
-- the record here instead -- see "Per-character record" below -- and narrating on
-- zone change rather than on discovery. It is off by default, and on a fresh
-- character it changes nothing observable: the discovery message still arrives
-- first and marks the area heard, leaving the override with nothing to say.

local ADDON_NAME, ZoneLore = ...

-- The queue itself is the Spoken player's, shared with every other route to a clip
-- and with every other Spoken addon. This file decides what deserves narrating and
-- hands it over; the depth cap, the dedup and the retry after combat are the
-- player's business, configured on this addon's source in Audio.lua.

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

-- How many of the two message forms this client actually defines. Reported by /zl,
-- so "the feature cannot work here" is distinguishable from "nothing has been
-- discovered yet" without another character.
local formCount = 0

-- Two patterns per message form. The anchored one is exact; the loose one matches
-- the same text sitting inside a longer line, which is what happens if the client
-- ever prefixes or colours the message. Anchoring alone would reject that
-- silently, and every test of this feature costs a fresh character to run.
local function BuildPatterns(globalString)
	if type(globalString) ~= "string" or globalString == "" then
		return nil, nil
	end
	-- Escape the Lua pattern magic characters first, so the literal parts of the
	-- message match themselves, then reopen the format specifiers as captures.
	local escaped = globalString:gsub("([%^%$%(%)%%%.%[%]%*%+%-%?])", "%%%1")
	escaped = escaped:gsub("%%%%d", "%%d+")

	-- Greedy inside anchors, since the whole line is the message. Non-greedy when
	-- loose, so a trailing sentence is not swallowed into the area name.
	local anchored = "^" .. escaped:gsub("%%%%s", "(.+)") .. "$"
	local loose = escaped:gsub("%%%%s", "(.-)")
	return anchored, loose
end

local function DiscoveryPatterns()
	if patterns then
		return patterns
	end
	patterns = {}

	-- Every anchored form before any loose one: an exact match on the plain message
	-- is better evidence than a loose match on the experience one.
	local anchoredSet, looseSet = {}, {}
	-- The XP form first within each set: it is the more specific of the two, and at
	-- max level the client falls back to the plain form.
	for _, name in ipairs({ "ERR_ZONE_EXPLORED_XP", "ERR_ZONE_EXPLORED" }) do
		local anchored, loose = BuildPatterns(_G[name])
		if anchored then
			table.insert(anchoredSet, anchored)
			table.insert(looseSet, loose)
		end
	end
	formCount = #anchoredSet

	for _, pattern in ipairs(anchoredSet) do
		table.insert(patterns, pattern)
	end
	for _, pattern in ipairs(looseSet) do
		table.insert(patterns, pattern)
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

-- Why a queued clip may not start yet. Registered onto the queue at setup, and
-- consulted every time it tries to advance.
--
-- Combat is worth waiting out rather than skipping: a clip starting mid-pull
-- competes with everything the player actually needs to hear. The queue holds
-- rather than drops, and retries once the pull or the movie ends.
--
-- The item is inspected, not just the moment, because none of this applies to a
-- player who pressed Play: clicking Play mid-pull means now. Only what this file
-- queued waits.
local function HoldReason(item)
	if not item.autoplay then
		return nil
	end
	if not ZoneLore:Get("autoplay") or not ZoneLore:IsVoiceEnabled() then
		return ZoneLore.L.QUEUE_HELD_OFF
	end
	if UnitAffectingCombat("player") then
		return ZoneLore.L.QUEUE_HELD_COMBAT
	end
	-- A starting-zone cinematic is the one moment a new character is guaranteed to
	-- be discovering things, so narrating over it is the likeliest collision there
	-- is.
	if (CinematicFrame and CinematicFrame:IsShown())
		or (MovieFrame and MovieFrame:IsShown()) then
		return ZoneLore.L.QUEUE_HELD_CINEMATIC
	end
	return nil
end

-- A continent is never autoplayed.
--
-- "Eastern Kingdoms" and "Kalimdor" are lore in their own right and the map panel and
-- /zl play will read them on request, but they are not somewhere a character arrives:
-- every player who ever logs in is standing on one, so autoplaying them means every new
-- character is greeted with the history of a landmass rather than with the valley it
-- woke up in. They reach the queue by accident anyway -- GetLoreWithFallback climbs the
-- parent chain, so any map without lore of its own eventually resolves to its continent,
-- and a player's map resolves to exactly that for the first moments after login.
--
-- Guarded here rather than at each caller because all three autoplay routes -- the login
-- greeting, a discovery, and the already-explored sweep -- share this queue and all three
-- resolve their map the same way.
local CONTINENT_MAP_TYPE = (Enum and Enum.UIMapType and Enum.UIMapType.Continent) or 2

local function IsAutoplayableMap(mapID)
	if not mapID then
		return false
	end
	local info = C_Map.GetMapInfo(mapID)
	-- An unknown map type is allowed through: this is a filter against three specific
	-- maps, and refusing everything it cannot classify would silence the feature on a
	-- client whose map table this addon has not seen.
	if not info or not info.mapType then
		return true
	end
	return info.mapType > CONTINENT_MAP_TYPE
end

-- Returns whether the entry was queued, which the login greeting needs: a greeting that
-- resolved nothing must not count as having greeted.
local function Enqueue(mapID, areaKey)
	-- A subzone of a continent is not a thing, so the guard applies to the zone-level
	-- entries only -- but those are the ones that carry the continent lore.
	if not areaKey and not IsAutoplayableMap(mapID) then
		if ZoneLore:Get("debug") then
			ZoneLore:Print("autoplay: %s is a continent -- not queued", tostring(ZoneLore:GetMapName(mapID)))
		end
		return false
	end

	-- An entry the installed pack cannot narrate never enters the queue. PlayLore
	-- would refuse it anyway, but silently queueing it would spend one of three slots
	-- on nothing and make the Next button count clips that will not play.
	if not ZoneLore:HasAudio(mapID, areaKey) then
		if ZoneLore:Get("debug") then
			ZoneLore:Print("autoplay: no clip for %s/%s -- not queued", tostring(mapID), tostring(areaKey))
		end
		return false
	end

	local item = ZoneLore:NewLoreSound(mapID, areaKey)
	if not item then
		return false
	end

	-- Marks this as something the player did not ask for, which is what the hold
	-- above keys on and what keeps a background failure from printing.
	item.autoplay = true

	-- The queue refuses a duplicate of its own accord: the login greeting and a
	-- real discovery message can name the same area, and an area on a zone border
	-- can be announced twice. Narrating it twice in a row is worse than missing it.
	return ZoneLore:EnqueueLore(item)
end

--------------------------------------------------------------------------------
-- Per-character record
--------------------------------------------------------------------------------
--
-- What this character has already been narrated. Only `autoplayExplored` reads it;
-- everything writes it, because an area heard from the map panel is still an area
-- the player has heard.
--
-- Marking happens when playback starts rather than when an area is queued. The
-- queue holds three, so riding across an explored Stranglethorn drops most of what
-- it queues; marking on entry would spend those areas on silence and the player
-- would never get them back. Marking on playback leaves them eligible, at the price
-- of a place passed through weeks ago narrating late.

local function CharDB()
	if type(ZoneLoreCharDB) ~= "table" then
		ZoneLoreCharDB = {}
	end
	return ZoneLoreCharDB
end

-- String keys throughout, including for zones, so the two kinds cannot collide and
-- the saved variable reads the same way for both.
local function HeardKey(mapID, areaKey)
	if areaKey then
		return mapID .. "/" .. areaKey
	end
	return tostring(mapID)
end

local function HeardSet()
	local db = CharDB()
	if type(db.heard) ~= "table" then
		db.heard = {}
	end
	return db.heard
end

function ZoneLore:HasHeard(mapID, areaKey)
	if not mapID then
		return false
	end
	return HeardSet()[HeardKey(mapID, areaKey)] == true
end

-- Called by ZoneLore:PlayLore once a clip is confirmed started, whatever asked for
-- it. That is what keeps a discovery and a zone change landing together from
-- narrating the same area twice.
function ZoneLore:MarkHeard(mapID, areaKey)
	if not mapID then
		return
	end
	HeardSet()[HeardKey(mapID, areaKey)] = true
end

function ZoneLore:HeardCount()
	local count = 0
	for _ in pairs(HeardSet()) do
		count = count + 1
	end
	return count
end

--------------------------------------------------------------------------------
-- Narrating what the client already considers explored
--------------------------------------------------------------------------------
--
-- Zone changes, not discoveries. Core dispatches these from ZONE_CHANGED,
-- ZONE_CHANGED_INDOORS and ZONE_CHANGED_NEW_AREA, which between them cover subzone
-- transitions as well as zone ones -- and unlike a discovery they fire every time,
-- which is exactly why the record above has to exist.

local function NarrateUnheard()
	if not ZoneLore:Get("autoplayExplored") then
		return
	end
	if not ZoneLore:Get("autoplay") or not ZoneLore:IsVoiceEnabled() then
		return
	end

	local _, mapID = ZoneLore:GetLoreWithFallback(ZoneLore:GetPlayerMapID())
	if not mapID then
		return
	end

	-- The zone first: entering a new zone at one of its subzones leaves both
	-- unheard, and the wider piece is the one that sets up the other.
	if not ZoneLore:HasHeard(mapID, nil) and ZoneLore:GetLore(mapID) then
		Enqueue(mapID, nil)
	end

	if not ZoneLore:Get("autoplaySubzones") then
		return
	end

	local subZone = GetSubZoneText()
	if not subZone or subZone == "" then
		return
	end

	local entry, key = ZoneLore:GetSubzoneLore(mapID, subZone)
	if entry and key and not ZoneLore:HasHeard(mapID, key) then
		Enqueue(mapID, key)
	end
end

--------------------------------------------------------------------------------
-- The one discovery the client never announces
--------------------------------------------------------------------------------
--
-- Where a character spawns is either already explored when it is created, or is
-- announced while the intro cinematic is up and before this addon has registered
-- anything. Either way a new orc stands in Valley of Trials in silence -- and that
-- is the first thing this feature should ever have to say.
--
-- So the spawn area is seeded once, guarded by a single per-character boolean.
-- This is a greeting, not a rule: it must not fire on every login, and it is the
-- only place left that guesses at a first visit rather than being told about one.

local LOGIN_SEED_DELAY = 2

-- A brand-new character is the worst case for asking the client where it is: the world
-- is still loading, the intro cinematic is up, and GetBestMapForUnit answers with the
-- continent -- which is how a dwarf who should hear Coldridge Valley was greeted with
-- the history of the Eastern Kingdoms instead. So the greeting retries rather than
-- spending its one turn on whatever the first answer happened to be.
local LOGIN_SEED_ATTEMPTS = 8

-- Whether the greeting is settled: it queued something, or there is nothing it will ever
-- queue. False means "ask again shortly".
local function SeedLoginArea(attempt)
	local db = CharDB()
	local debugOn = ZoneLore:Get("debug")

	if db.greeted then
		return true
	end
	if not ZoneLore:Get("autoplay") or not ZoneLore:IsVoiceEnabled() then
		-- Deliberately without setting the flag, so turning autoplay on later still
		-- greets on the next login rather than having silently used up its turn.
		if debugOn then
			ZoneLore:Print("greeting: autoplay %s, voice %s -- nothing to do",
				ZoneLore:Get("autoplay") and "on" or "off",
				ZoneLore:IsVoiceEnabled() and "on" or "off")
		end
		return true
	end

	-- Every step of the resolution, because a greeting that says nothing is
	-- indistinguishable from a greeting that never ran -- and reproducing either costs a
	-- fresh character.
	local playerMap = ZoneLore:GetPlayerMapID()
	local _, mapID = ZoneLore:GetLoreWithFallback(playerMap)
	if debugOn then
		ZoneLore:Print("greeting %d: player map %s (%s), resolved %s (%s), subzone \"%s\"",
			attempt or 0, tostring(playerMap), tostring(ZoneLore:GetMapName(playerMap)),
			tostring(mapID), tostring(mapID and ZoneLore:GetMapName(mapID)),
			tostring(GetSubZoneText()))
	end
	if not mapID then
		return false
	end

	-- The subzone is the more specific answer, the same preference /zl play and the
	-- lore window both apply.
	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" and ZoneLore:Get("autoplaySubzones") then
		local entry, key = ZoneLore:GetSubzoneLore(mapID, subZone)
		if entry and key and Enqueue(mapID, key) then
			db.greeted = true
			return true
		end
	end

	if ZoneLore:GetLore(mapID) and Enqueue(mapID, nil) then
		db.greeted = true
		return true
	end

	-- Nothing queued: either the map has not settled yet, or it settled on a continent.
	-- Both are worth another look, and the flag stays unset so a later login still
	-- greets if this one never resolves.
	if debugOn then
		ZoneLore:Print("greeting %d: nothing queued for map %s -- retrying", attempt or 0, tostring(mapID))
	end
	return false
end

-- Everything this character is remembered for: the greeting it has had, and the
-- areas it has been narrated. Lets both be tested without rolling another
-- character, and lets a player hear the lot again.
function ZoneLore:ForgetAutoplayHistory()
	local db = CharDB()
	db.greeted = nil
	db.heard = nil
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

-- Four events, because the message's route is not something to bet on. Its text
-- lives in a global named ERR_*, and ERR_ strings normally arrive on
-- UI_INFO_MESSAGE / UI_ERROR_MESSAGE; but exploration also awards experience,
-- which is CHAT_MSG_COMBAT_XP_GAIN territory, and plain system text is
-- CHAT_MSG_SYSTEM. Registering all four costs nothing -- anything that is not a
-- discovery fails the patterns -- and betting on one costs a play session.
local DISCOVERY_EVENTS = {
	"CHAT_MSG_SYSTEM",
	"CHAT_MSG_COMBAT_XP_GAIN",
	"UI_INFO_MESSAGE",
	"UI_ERROR_MESSAGE",
}

-- The payload is not in the same position across those events: CHAT_MSG_* put the
-- text first, while UI_*_MESSAGE put a numeric messageType first and the text
-- second. Rather than encode that per event, take whichever argument is a string.
local function TextFrom(...)
	for i = 1, select("#", ...) do
		local value = select(i, ...)
		if type(value) == "string" then
			return value
		end
	end
	return nil
end

function ZoneLore:SetupAutoplay()
	local frame = CreateFrame("Frame")
	for _, event in ipairs(DISCOVERY_EVENTS) do
		frame:RegisterEvent(event)
	end

	frame:SetScript("OnEvent", function(_, event, ...)
		local message = TextFrom(...)
		local area = AreaFromMessage(message)
		if area then
			ZoneLore:OnAreaDiscovered(area)
		elseif message and ZoneLore:Get("debug") then
			-- Under debug only, and for every watched event rather than one of
			-- them. If a discovery ever stops being recognised, this is the line
			-- that shows which event carried it and what it actually said.
			ZoneLore:Print("|cff888888%s: %s|r", event, message)
		end
	end)

	-- The hold applies to this addon's clips only; the player asks the gate per clip.
	if self.source then
		self.source:AddGate(HoldReason)
	end
	self:OnZoneChanged(NarrateUnheard)
	self.autoplayFrame = frame

	-- Delayed because GetSubZoneText is not reliably populated the instant the
	-- world finishes loading, and repeated because on a new character the map is not
	-- either. The cinematic needs no handling of its own: the greeting queues as soon
	-- as it can and the hold above keeps it there until the intro ends.
	local attempts = 0
	local seed
	seed = function()
		attempts = attempts + 1
		local settled = SeedLoginArea(attempts)
		-- Logging in is not a zone change, so without this a player who logs out
		-- and back in somewhere unheard stands there in silence until they walk
		-- into the next subzone. The greeting runs first and Enqueue refuses a
		-- duplicate, so the spawn area cannot end up queued by both.
		NarrateUnheard()
		if not settled and attempts < LOGIN_SEED_ATTEMPTS then
			C_Timer.After(LOGIN_SEED_DELAY, seed)
		end
	end
	C_Timer.After(LOGIN_SEED_DELAY, seed)
end

-- Reports whether the client defined the strings this feature is built on, so a
-- silent failure can be told apart from "nothing has been discovered yet".
function ZoneLore:DescribeAutoplay()
	DiscoveryPatterns()
	local found = formCount
	if found == 0 then
		self:Print("|cffff5555autoplay cannot work|r: this client defines neither "
			.. "ERR_ZONE_EXPLORED nor ERR_ZONE_EXPLORED_XP")
		return
	end
	self:Print("autoplay %s, matching %d discovery message form(s); subzones %s",
		self:Get("autoplay") and "on" or "off", found,
		self:Get("autoplaySubzones") and "included" or "excluded")

	-- The count distinguishes "the option is doing nothing yet" from "everything
	-- around here is already marked", which otherwise sound identical: silence.
	if self:Get("autoplayExplored") then
		self:Print("already-explored areas included -- %d narrated on this character so far",
			self:HeardCount())
	end
end
