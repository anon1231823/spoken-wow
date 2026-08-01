-- ZoneLore -- narrate a zone or subzone the first time the player explores it.
--
-- Firing on both zones and subzones means up to 1353 triggers over a character's
-- life, and riding through Elwynn crosses a dozen subzones in a minute. Two rules
-- keep that from turning into noise:
--
--   * A new area never interrupts. It queues behind whatever is playing.
--   * The queue is capped. Past the cap the oldest entry is dropped, because
--     narration that has fallen two minutes behind is describing somewhere the
--     player has already left.
--
-- An area is marked heard when it is *queued*, not when it plays. Marking on play
-- would re-queue everywhere the cap dropped, which is exactly the backlog the cap
-- exists to prevent.

local ADDON_NAME, ZoneLore = ...

-- Roughly 90 seconds of subzone audio at the corpus average. Deep enough that
-- normal walking never loses an entry, shallow enough that flying does.
local QUEUE_LIMIT = 3

-- The client reports the new area before GetSubZoneText catches up, so sampling
-- immediately after the event yields the area just left.
local SETTLE_DELAY = 0.75

-- Logging in should not start a monologue. Suppressed rather than marked heard, so
-- the zone still narrates the next time the player actually walks into it.
local LOGIN_GRACE = 6

local pending = {}
local ticker = nil
local suppressUntil = 0

--------------------------------------------------------------------------------
-- Per-character memory
--------------------------------------------------------------------------------

-- Account-wide would mean a fresh alt gets silence in its own starting zone.
-- Exploring for the first time is a property of the character, not the account.
local function CharDB()
	if type(ZoneLoreCharDB) ~= "table" then
		ZoneLoreCharDB = {}
	end
	if type(ZoneLoreCharDB.heardZones) ~= "table" then
		ZoneLoreCharDB.heardZones = {}
	end
	if type(ZoneLoreCharDB.heardSubzones) ~= "table" then
		ZoneLoreCharDB.heardSubzones = {}
	end
	return ZoneLoreCharDB
end

local function HasHeard(mapID, areaKey)
	local db = CharDB()
	if areaKey then
		local zoneTable = db.heardSubzones[mapID]
		return zoneTable ~= nil and zoneTable[areaKey] == true
	end
	return db.heardZones[mapID] == true
end

local function MarkHeard(mapID, areaKey)
	local db = CharDB()
	if areaKey then
		db.heardSubzones[mapID] = db.heardSubzones[mapID] or {}
		db.heardSubzones[mapID][areaKey] = true
	else
		db.heardZones[mapID] = true
	end
end

function ZoneLore:ForgetHeardAreas()
	ZoneLoreCharDB = nil
	wipe(pending)
	CharDB()
end

function ZoneLore:CountHeardAreas()
	local db = CharDB()
	local zones, subzones = 0, 0
	for _ in pairs(db.heardZones) do
		zones = zones + 1
	end
	for _, zoneTable in pairs(db.heardSubzones) do
		for _ in pairs(zoneTable) do
			subzones = subzones + 1
		end
	end
	return zones, subzones
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

-- Combat is the one state worth waiting out rather than skipping: a clip that
-- starts mid-pull competes with everything the player needs to hear.
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

-- The audio callback covers a clip ending; the ticker covers everything with no
-- event of its own -- leaving combat, or the queue filling while paused.
local function StartTicker()
	if ticker then
		return
	end
	ticker = C_Timer.NewTicker(1, Drain)
end

-- Called by ZoneLore:StopLore. Stop means silence, not "skip to the next area the
-- player wandered through" -- so the backlog goes with it. The areas stay marked
-- heard, which is the point: they were offered and declined.
function ZoneLore:ClearAutoplayQueue()
	wipe(pending)
	StopTicker()
end

local function Enqueue(mapID, areaKey)
	MarkHeard(mapID, areaKey)

	table.insert(pending, { mapID = mapID, areaKey = areaKey })
	while #pending > QUEUE_LIMIT do
		table.remove(pending, 1)
	end

	StartTicker()
	Drain()
end

--------------------------------------------------------------------------------
-- Detection
--------------------------------------------------------------------------------

local function Consider()
	if not ZoneLore:Get("autoplay") or not ZoneLore:IsVoiceEnabled() then
		return
	end
	if GetTime() < suppressUntil then
		return
	end

	-- GetBestMapForUnit can return an inn or a dungeon, which is not itself a key
	-- in Zones; the same walk up the hierarchy the rest of the addon uses.
	local zoneEntry, mapID = ZoneLore:GetLoreWithFallback(ZoneLore:GetPlayerMapID())
	if not mapID then
		return
	end

	if zoneEntry and not HasHeard(mapID, nil) then
		Enqueue(mapID, nil)
	end

	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" then
		local subEntry, key = ZoneLore:GetSubzoneLore(mapID, subZone)
		if subEntry and key and not HasHeard(mapID, key) then
			Enqueue(mapID, key)
		end
	end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function ZoneLore:SetupAutoplay()
	suppressUntil = GetTime() + LOGIN_GRACE

	-- Core fires this for ZONE_CHANGED, ZONE_CHANGED_INDOORS and
	-- ZONE_CHANGED_NEW_AREA, which between them cover both halves of a move.
	self:OnZoneChanged(function()
		C_Timer.After(SETTLE_DELAY, Consider)
	end)

	self:OnAudioChanged(Drain)
end
