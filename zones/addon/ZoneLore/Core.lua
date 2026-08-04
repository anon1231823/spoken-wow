-- ZoneLore -- Core: namespace, saved variables, events, zone resolution.
-- Client target: WoW Classic Era 1.15.9 (Interface 11509).

local ADDON_NAME, ZoneLore = ...

ZoneLore.name = ADDON_NAME
ZoneLore.version = C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version") or "dev"

-- Populated by Data/Zones.lua and Data/Subzones.lua (both generated). Declared
-- here so every other file can rely on the tables existing even when a data file
-- is empty or failed to load.
ZoneLore.Zones = ZoneLore.Zones or {}
ZoneLore.Subzones = ZoneLore.Subzones or {}

-- The subzone the player clicked on the world map, or nil to show zone lore:
-- { mapID = <parent uiMapID>, areaName = <client name>, entry = <lore> }
ZoneLore.selected = nil

-- Callbacks fired when the lore shown to the player should change. UI modules
-- register into this rather than each hooking WorldMapFrame independently.
ZoneLore.mapChangedCallbacks = {}
ZoneLore.zoneChangedCallbacks = {}

local defaults = {
	showMapPanel = true,
	panelSide = "RIGHT",
	panelWidth = 300,
	fontSize = 12,
	showHoverPreview = true,
	showMinimapButton = true,
	voiceEnabled = true,
	-- Dialog so narration rides the player's dialog volume slider rather than
	-- competing with it. See Audio.lua for the channels PlaySoundFile accepts.
	voiceChannel = "Dialog",
	showPlaybackBar = true,
	autoplay = true,
	autoplaySubzones = true,
	-- Off, so Read means "read along". Stopping discards the queue as well, which
	-- is not something to do to a player who only wanted to see the words.
	stopAudioOnRead = false,
	-- `playbackBarPos` is deliberately absent: nil means "below the minimap", which
	-- is an anchor rather than a coordinate and so cannot be expressed here.
	-- `audioPack` likewise: nil means "the best pack installed", which is a rule
	-- rather than a folder name, and naming a default here would pin the player to
	-- a pack they may never install. See Audio.lua.
	debug = false,
	-- `hide` and `minimapPos` are intentionally absent: LibDBIcon owns those keys
	-- inside ZoneLoreDB and writes them itself. See UI/MinimapButton.lua.
}

--------------------------------------------------------------------------------
-- Output
--------------------------------------------------------------------------------

local PREFIX = "|cff66bbffZoneLore|r: "

function ZoneLore:Print(fmt, ...)
	local msg = select("#", ...) > 0 and fmt:format(...) or fmt
	DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. msg)
end

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

-- Merge defaults into the saved table without clobbering stored values, so new
-- options added in later versions appear for existing users. Runtime reads and
-- writes go straight to ZoneLoreDB.
local function InitConfig()
	if type(ZoneLoreDB) ~= "table" then
		ZoneLoreDB = {}
	end
	for key, value in pairs(defaults) do
		if ZoneLoreDB[key] == nil then
			ZoneLoreDB[key] = value
		end
	end
	ZoneLore.db = ZoneLoreDB
end

-- Safe before ADDON_LOADED has run.
function ZoneLore:Get(key)
	if ZoneLoreDB == nil then
		return defaults[key]
	end
	local value = ZoneLoreDB[key]
	if value == nil then
		return defaults[key]
	end
	return value
end

function ZoneLore:Set(key, value)
	ZoneLoreDB[key] = value
end

--------------------------------------------------------------------------------
-- Zone resolution
--------------------------------------------------------------------------------

-- The uiMapID the world map is currently displaying (nil if the map is not up).
function ZoneLore:GetDisplayedMapID()
	return WorldMapFrame and WorldMapFrame.mapID
end

-- The uiMapID the player is physically standing in.
function ZoneLore:GetPlayerMapID()
	return C_Map.GetBestMapForUnit("player")
end

-- Prefer the client's own zone name over the name baked into the generated data,
-- so Era-specific naming (e.g. "The Barrens" rather than retail's "Northern
-- Barrens") is always correct regardless of what the wiki page was titled.
function ZoneLore:GetMapName(mapID)
	if not mapID then
		return nil
	end
	local info = C_Map.GetMapInfo(mapID)
	if info and info.name and info.name ~= "" then
		return info.name
	end
	local entry = self.Zones[mapID]
	return entry and entry.name or nil
end

function ZoneLore:GetLore(mapID)
	if not mapID then
		return nil
	end
	return self.Zones[mapID]
end

-- Walks up the map hierarchy looking for an ancestor that does have lore, so a
-- dungeon or micro-map falls back to its parent zone instead of showing nothing.
-- Returns the entry and the mapID it was found on.
function ZoneLore:GetLoreWithFallback(mapID)
	local id, hops = mapID, 0
	while id and hops < 6 do
		local entry = self.Zones[id]
		if entry then
			return entry, id
		end
		local info = C_Map.GetMapInfo(id)
		id = info and info.parentMapID
		if id == 0 then
			id = nil
		end
		hops = hops + 1
	end
	return nil, nil
end

--------------------------------------------------------------------------------
-- Subzones
--
-- Subzones are areas, not uiMapIDs, and MapUtil.FindBestAreaNameAtMouse returns
-- a name rather than an ID -- so lore is keyed by name, scoped to the parent
-- zone. Client and wiki disagree on cosmetic details ("The Bulwark" versus a
-- page titled "Bulwark"), so both sides are reduced to the same canonical key.
--
-- This must stay in step with normaliseKey in tools/lib/wiki.mjs.
--------------------------------------------------------------------------------

function ZoneLore:NormaliseAreaKey(name)
	if type(name) ~= "string" then
		return nil
	end
	local key = name:lower()
	key = key:gsub("'", "")
	key = key:gsub("^the%s+", "")
	key = key:gsub("[^a-z0-9]+", " ")
	key = key:gsub("^%s+", "")
	key = key:gsub("%s+$", "")
	if key == "" then
		return nil
	end
	return key
end

--------------------------------------------------------------------------------
-- Report links
--
-- The game cannot open a URL or send anything anywhere, so the only way a player
-- can report a bad line is to copy an address and open it themselves. The site
-- resolves /r/{mapID}/{slug} back to a line by matching that path against the
-- audio file paths it already assigns, which is why the slug is built the same
-- way here as slugFor does in tools/voice/naming.mjs -- and why "zone", the file
-- name a zone's own line gets, doubles as the slug for it.
--
-- tools/validate.mjs fails the build if these two ever drift, or if two subzones
-- in one zone come to share a slug: the JS side has a hash fallback for that
-- collision, and nothing here can reproduce it.
--------------------------------------------------------------------------------

ZoneLore.SITE_URL = "https://lore.rusty.one"

function ZoneLore:ReportURL(mapID, areaKey)
	if not mapID then
		return nil
	end
	local slug = "zone"
	if areaKey then
		slug = areaKey:gsub("%s+", "-")
		slug = slug:gsub("[^a-z0-9%-]", "")
		if slug == "" then
			slug = "zone"
		end
	end
	return ("%s/r/%d/%s"):format(self.SITE_URL, mapID, slug)
end

-- Returns the lore entry and the key that was looked up. The key is returned
-- even on a miss so /zl debug can report what failed to match.
function ZoneLore:GetSubzoneLore(parentMapID, areaName)
	local key = self:NormaliseAreaKey(areaName)
	if not key then
		return nil, nil
	end
	local zoneTable = self.Subzones[parentMapID]
	if not zoneTable then
		return nil, key
	end
	return zoneTable[key], key
end

function ZoneLore:IsZoneMap(mapID)
	local info = mapID and C_Map.GetMapInfo(mapID)
	if not info then
		return false
	end
	local zoneType = (Enum and Enum.UIMapType and Enum.UIMapType.Zone) or 3
	return info.mapType == zoneType
end

-- Subzone name under a normalised canvas position, or nil.
function ZoneLore:GetAreaNameAt(mapID, x, y)
	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		return nil
	end
	local ok, name = pcall(MapUtil.FindBestAreaNameAtMouse, mapID, x, y)
	if ok then
		return name
	end
	return nil
end

-- What the cursor is over, at a normalised canvas position on the map `mapID`.
-- Shared by the click handler and the hover preview so both agree.
--
-- Returns kind ("zone"|"subzone"), display name, lore entry, and the resolved
-- uiMapID for the "zone" case. Returns nil when nothing is resolvable.
function ZoneLore:ResolveAt(mapID, x, y)
	if not mapID or not x or not y then
		return nil
	end

	-- A child *map* under the cursor: a zone on a continent map, or a dungeon
	-- entrance on a zone map. Prefer this when we actually have lore for it.
	local childInfo = C_Map.GetMapInfoAtPosition(mapID, x, y)
	if childInfo and childInfo.mapID and childInfo.mapID ~= mapID then
		local entry = self:GetLore(childInfo.mapID)
		if entry then
			return "zone", childInfo.name or entry.name, entry, childInfo.mapID
		end
	end

	-- Otherwise fall back to the area (subzone) name, which has no uiMapID.
	local areaName = self:GetAreaNameAt(mapID, x, y)
	if areaName then
		local entry = self:GetSubzoneLore(mapID, areaName)
		if entry then
			return "subzone", areaName, entry, nil
		end
		-- Name but no lore: still useful to the caller for debug reporting.
		return "subzone", areaName, nil, nil
	end

	return nil
end

function ZoneLore:SelectSubzone(mapID, areaName, entry)
	self.selected = { mapID = mapID, areaName = areaName, entry = entry }
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end

function ZoneLore:ClearSubzone()
	if not self.selected then
		return
	end
	self.selected = nil
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end

--------------------------------------------------------------------------------
-- Callback dispatch
--------------------------------------------------------------------------------

function ZoneLore:OnMapChanged(fn)
	table.insert(self.mapChangedCallbacks, fn)
end

function ZoneLore:OnZoneChanged(fn)
	table.insert(self.zoneChangedCallbacks, fn)
end

local function Dispatch(list, ...)
	for i = 1, #list do
		local ok, err = pcall(list[i], ...)
		if not ok then
			ZoneLore:Print("|cffff5555error|r: %s", tostring(err))
		end
	end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

local initialised = false

local function SetupHooks()
	if initialised then
		return
	end
	initialised = true

	-- Map is showing a different zone. Covers both player-driven navigation and
	-- programmatic SetMapID calls; OnMapChanged is the single funnel for both.
	hooksecurefunc(WorldMapFrame, "OnMapChanged", function()
		Dispatch(ZoneLore.mapChangedCallbacks, WorldMapFrame.mapID)
	end)

	WorldMapFrame:HookScript("OnShow", function()
		Dispatch(ZoneLore.mapChangedCallbacks, WorldMapFrame.mapID)
	end)

	if ZoneLore.SetupMapPanel then
		ZoneLore:SetupMapPanel()
	end
	if ZoneLore.SetupSubzoneClicks then
		ZoneLore:SetupSubzoneClicks()
	end
	if ZoneLore.SetupHoverPreview then
		ZoneLore:SetupHoverPreview()
	end
	if ZoneLore.SetupLoreWindow then
		ZoneLore:SetupLoreWindow()
	end
	if ZoneLore.SetupMinimapButton then
		ZoneLore:SetupMinimapButton()
	end
	if ZoneLore.SetupPlaybackBar then
		ZoneLore:SetupPlaybackBar()
	end
	if ZoneLore.SetupAutoplay then
		ZoneLore:SetupAutoplay()
	end
	if ZoneLore.SetupOptions then
		ZoneLore:SetupOptions()
	end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ZONE_CHANGED")
events:RegisterEvent("ZONE_CHANGED_INDOORS")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:SetScript("OnEvent", function(self, event, arg1)
	if event == "ADDON_LOADED" then
		if arg1 == ADDON_NAME then
			InitConfig()
			self:UnregisterEvent("ADDON_LOADED")
		end
	elseif event == "PLAYER_ENTERING_WORLD" then
		SetupHooks()
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
	else
		Dispatch(ZoneLore.zoneChangedCallbacks, ZoneLore:GetPlayerMapID())
	end
end)

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

-- Recursively enumerate the map tree so tools/seed/zones.json can be built from
-- the client itself rather than transcribed by hand. Results land in
-- ZoneLoreDB.dump, which is only written to disk on logout or /reload.
local MAP_TYPE_NAMES = { [0] = "Cosmic", [1] = "World", [2] = "Continent", [3] = "Zone", [4] = "Dungeon", [5] = "Micro", [6] = "Orphan" }

local function DumpMapTree(rootID, out, seen, depth)
	if not rootID or seen[rootID] or depth > 8 then
		return
	end
	seen[rootID] = true

	local info = C_Map.GetMapInfo(rootID)
	if info then
		table.insert(out, {
			mapID = rootID,
			name = info.name,
			mapType = info.mapType,
			mapTypeName = MAP_TYPE_NAMES[info.mapType] or tostring(info.mapType),
			parentMapID = info.parentMapID,
			hasArt = C_Map.MapHasArt(rootID) or false,
		})
	end

	local children = C_Map.GetMapChildrenInfo(rootID)
	if children then
		for i = 1, #children do
			DumpMapTree(children[i].mapID, out, seen, depth + 1)
		end
	end
end

local function CmdDump()
	local out, seen = {}, {}
	DumpMapTree(947, out, seen, 0)   -- Azeroth (world)
	DumpMapTree(1414, out, seen, 0)  -- Kalimdor
	DumpMapTree(1415, out, seen, 0)  -- Eastern Kingdoms
	ZoneLoreDB.dump = out
	ZoneLore:Print("dumped %d maps to ZoneLoreDB.dump. Run /reload, then:", #out)
	ZoneLore:Print("  node tools/seed-from-dump.mjs")
end

-- Cross-check the generated data against the live client. Catches wrong uiMapIDs
-- and names that differ between Era and the wiki (the main data risk).
local function CmdVerify()
	local total, missing, mismatched = 0, 0, 0
	local ids = {}
	for mapID in pairs(ZoneLore.Zones) do
		table.insert(ids, mapID)
	end
	table.sort(ids)

	for i = 1, #ids do
		local mapID = ids[i]
		local entry = ZoneLore.Zones[mapID]
		total = total + 1
		local info = C_Map.GetMapInfo(mapID)
		if not info then
			missing = missing + 1
			ZoneLore:Print("|cffff5555%d|r (%s): no such map on this client", mapID, tostring(entry.name))
		elseif entry.name and info.name ~= entry.name then
			mismatched = mismatched + 1
			ZoneLore:Print("|cffffcc00%d|r: data says %q, client says %q", mapID, entry.name, info.name)
		end
	end

	ZoneLore:Print("verified %d entries: %d unknown to client, %d name mismatches", total, missing, mismatched)
	if missing == 0 and mismatched == 0 then
		ZoneLore:Print("|cff55ff55all entries resolve correctly|r")
	end
end

local function CmdStatus()
	local playerMap = ZoneLore:GetPlayerMapID()
	local shownMap = ZoneLore:GetDisplayedMapID()

	local zoneCount = 0
	for _ in pairs(ZoneLore.Zones) do
		zoneCount = zoneCount + 1
	end

	local subzoneZones, subzoneCount = 0, 0
	for _, tbl in pairs(ZoneLore.Subzones) do
		subzoneZones = subzoneZones + 1
		for _ in pairs(tbl) do
			subzoneCount = subzoneCount + 1
		end
	end

	ZoneLore:Print(
		"v%s -- %d zones, %d subzones across %d zones",
		ZoneLore.version, zoneCount, subzoneCount, subzoneZones
	)
	ZoneLore:Print("player is in: %s (uiMapID %s)", tostring(ZoneLore:GetMapName(playerMap)), tostring(playerMap))
	ZoneLore:Print("map is showing: %s (uiMapID %s)", tostring(ZoneLore:GetMapName(shownMap)), tostring(shownMap))

	local entry = ZoneLore:GetLore(playerMap)
	if entry then
		ZoneLore:Print("lore for current zone: %d characters", #(entry.full or ""))
	else
		ZoneLore:Print("|cffffcc00no lore recorded for the current zone|r")
	end

	-- Report the subzone the player is standing in. This exercises the same
	-- name-keyed lookup the map click uses, without needing the map open, so a
	-- name mismatch can be spotted just by walking around.
	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" then
		local subEntry, key = ZoneLore:GetSubzoneLore(playerMap, subZone)
		ZoneLore:Print(
			'standing in subzone "%s" -> key "%s" -> %s',
			subZone, tostring(key), subEntry and "lore found" or "|cffffcc00no lore|r"
		)
	end

	if ZoneLore.DescribeAutoplay then
		ZoneLore:DescribeAutoplay()
	end

	local pack = ZoneLore:GetActiveAudioPack()
	if pack then
		ZoneLore:Print("sound pack: %s -- %s", pack.addon, ZoneLore:GetAudioPackLabel(pack))
	else
		ZoneLore:Print("|cffffcc00no sound pack installed|r -- narration uses the placeholder clip")
	end

	if ZoneLore:Get("debug") then
		ZoneLore:Print("|cff66bbffdebug mode is on|r")
	end
end

-- What /zl play narrates: the subzone the player is standing in if it has lore,
-- otherwise the zone. The same "more specific answer wins" preference the lore
-- window applies when it opens.
local function CurrentAudioTarget()
	local _, resolved = ZoneLore:GetLoreWithFallback(ZoneLore:GetPlayerMapID())
	if not resolved then
		return nil, nil
	end

	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" then
		local entry, key = ZoneLore:GetSubzoneLore(resolved, subZone)
		if entry then
			return resolved, key
		end
	end

	return resolved, nil
end

local function CmdPlay()
	local mapID, key = CurrentAudioTarget()
	if not mapID then
		ZoneLore:Print("|cffffcc00no lore for where you are standing|r")
		return
	end

	if not ZoneLore:IsVoiceEnabled() then
		ZoneLore:Print("|cffffcc00narration is turned off|r -- /zl voice to turn it on")
		return
	end

	if not ZoneLore:PlayLore(mapID, key) then
		return
	end

	local what = key or ZoneLore:GetMapName(mapID) or tostring(mapID)
	if ZoneLore:HasRealAudio(mapID, key) then
		ZoneLore:Print("playing lore for %s", what)
	else
		ZoneLore:Print("playing |cffffcc00placeholder|r audio for %s -- no voiceover recorded yet", what)
	end
end

-- `/zl audio` lists installed sound packs; `/zl audio <folder>` switches to one.
-- Worth a command of its own because having two tiers installed at once is the
-- case where the addon's behaviour is otherwise invisible: both play, and only
-- the disk footprint differs.
local function CmdAudioPack(arg)
	local packs = ZoneLore:GetAudioPacks()
	if #packs == 0 then
		ZoneLore:Print("|cffffcc00no sound pack installed|r")
		ZoneLore:Print("  install ZoneLoreAudio (128 kbps) or ZoneLoreAudio64 (64 kbps) alongside ZoneLore")
		return
	end

	if arg and arg ~= "" then
		-- Matched case-insensitively: the player is reading the folder name off a
		-- listing and retyping it, and "zoneloreaudiohq" is the same request.
		for i = 1, #packs do
			if packs[i].addon:lower() == arg:lower() then
				ZoneLore:SetActiveAudioPack(packs[i].addon)
				ZoneLore:Print("now playing from %s -- %s", packs[i].addon, ZoneLore:GetAudioPackLabel(packs[i]))
				return
			end
		end
		ZoneLore:Print('|cffffcc00"%s" is not an installed sound pack|r', arg)
		return
	end

	local active = ZoneLore:GetActiveAudioPack()
	ZoneLore:Print("sound packs:")
	for i = 1, #packs do
		local pack = packs[i]
		ZoneLore:Print(
			"  %s %s -- %s, v%s",
			pack == active and "|cff66bbff*|r" or " ",
			pack.addon, ZoneLore:GetAudioPackLabel(pack), tostring(pack.packVersion)
		)
	end
	if #packs > 1 then
		ZoneLore:Print("  /zl audio <name> to switch")
	end
end

local function CmdHelp()
	ZoneLore:Print("commands:")
	ZoneLore:Print("  /zl            -- status for the current zone and subzone")
	ZoneLore:Print("  /zl options    -- open the settings panel")
	ZoneLore:Print("  /zl window     -- open the browsable lore window")
	ZoneLore:Print("  /zl panel      -- toggle the world map panel")
	ZoneLore:Print("  /zl hover      -- toggle the hover preview tooltip")
	ZoneLore:Print("  /zl play       -- read the current lore aloud")
	ZoneLore:Print("  /zl stop       -- stop the narration")
	ZoneLore:Print("  /zl voice      -- toggle narration on or off")
	ZoneLore:Print("  /zl autoplay   -- toggle narrating areas as you discover them")
	ZoneLore:Print("  /zl audio      -- list sound packs, or switch with /zl audio <name>")
	ZoneLore:Print("  /zl discover   -- pretend to discover an area (dev)")
	ZoneLore:Print("  /zl forget     -- replay the login greeting on next login (dev)")
	ZoneLore:Print("  /zl bar        -- move the playback controls back below the minimap")
	ZoneLore:Print("  /zl minimap    -- show or hide the minimap button")
	ZoneLore:Print("  /zl debug      -- report area names on map click")
	ZoneLore:Print("  /zl verify     -- check data against this client")
	ZoneLore:Print("  /zl dump       -- enumerate the map tree (dev)")
end

_G.SLASH_ZONELORE1 = "/zonelore"
_G.SLASH_ZONELORE2 = "/zl"
SlashCmdList["ZONELORE"] = function(msg)
	local cmd = (msg or ""):lower():match("^%s*(%S*)")
	if cmd == "dump" then
		CmdDump()
	elseif cmd == "verify" then
		CmdVerify()
	elseif cmd == "panel" then
		local enabled = not ZoneLore:Get("showMapPanel")
		ZoneLore:Set("showMapPanel", enabled)
		ZoneLore:Print("world map panel %s", enabled and "enabled" or "disabled")
		Dispatch(ZoneLore.mapChangedCallbacks, ZoneLore:GetDisplayedMapID())
	elseif cmd == "options" or cmd == "config" or cmd == "opt" then
		if ZoneLore.OpenOptions then
			ZoneLore:OpenOptions()
		end
	elseif cmd == "window" or cmd == "w" then
		if ZoneLore.ToggleLoreWindow then
			ZoneLore:ToggleLoreWindow()
		end
	elseif cmd == "minimap" then
		if ZoneLore.ToggleMinimapButton then
			local enabled = ZoneLore:ToggleMinimapButton()
			ZoneLore:Print("minimap button %s", enabled and "shown" or "hidden")
		end
	elseif cmd == "hover" then
		local enabled = not ZoneLore:Get("showHoverPreview")
		ZoneLore:Set("showHoverPreview", enabled)
		if not enabled and ZoneLore.HideHoverPreview then
			ZoneLore.HideHoverPreview()
		end
		ZoneLore:Print("hover preview %s", enabled and "enabled" or "disabled")
	elseif cmd == "play" then
		CmdPlay()
	elseif cmd == "stop" then
		ZoneLore:StopLore()
		ZoneLore:Print("narration stopped")
	elseif cmd == "voice" then
		local enabled = not ZoneLore:Get("voiceEnabled")
		ZoneLore:Set("voiceEnabled", enabled)
		if not enabled then
			ZoneLore:StopLore()
		end
		ZoneLore:NotifyAudioChanged()
		ZoneLore:Print("narration %s", enabled and "enabled" or "disabled")
	elseif cmd == "audio" then
		CmdAudioPack((msg or ""):match("^%s*%S+%s+(.-)%s*$"))
	elseif cmd == "autoplay" then
		local enabled = not ZoneLore:Get("autoplay")
		ZoneLore:Set("autoplay", enabled)
		if not enabled then
			ZoneLore:StopLore()
		end
		ZoneLore:Print("autoplay %s", enabled and "enabled" or "disabled")
	elseif cmd == "forget" then
		if ZoneLore.ForgetGreeting then
			ZoneLore:ForgetGreeting()
			ZoneLore:Print("greeting reset -- log out and back in to hear it again")
		end
	elseif cmd == "discover" then
		-- Simulates a discovery, because the real one happens once per character
		-- ever and is otherwise untestable without rolling a fresh alt.
		local areaName = (msg or ""):match("^%s*%S+%s+(.-)%s*$")
		if not areaName or areaName == "" then
			areaName = GetSubZoneText()
			if not areaName or areaName == "" then
				areaName = GetZoneText()
			end
		end
		ZoneLore:Print('simulating discovery of "%s"', tostring(areaName))
		ZoneLore:OnAreaDiscovered(areaName)
	elseif cmd == "bar" then
		if ZoneLore.ResetPlaybackBarPosition then
			ZoneLore:ResetPlaybackBarPosition()
			ZoneLore:Print("playback controls moved back below the minimap")
		end
	elseif cmd == "debug" then
		local enabled = not ZoneLore:Get("debug")
		ZoneLore:Set("debug", enabled)
		ZoneLore:Print("debug mode %s", enabled and "on -- click the map to see area names" or "off")
	elseif cmd == "help" then
		CmdHelp()
	else
		CmdStatus()
	end
end
