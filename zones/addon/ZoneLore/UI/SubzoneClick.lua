-- ZoneLore -- detect clicks on a subzone of the displayed world map.
--
-- Subzones have no uiMapID, so C_Map.GetMapInfoAtPosition cannot see them; it
-- only reports child *maps*. MapUtil.FindBestAreaNameAtMouse is the API that
-- resolves a cursor position to an area name, and it is present on 11509
-- (Leatrix_Maps calls it on this client).

local ADDON_NAME, ZoneLore = ...

-- Normalised-coordinate slop allowed between mouse-down and mouse-up before the
-- gesture counts as a map drag rather than a click. IsPanning() is unreliable by
-- the time OnMouseUp fires, so compare positions instead.
local DRAG_TOLERANCE = 0.01

local downX, downY

local function IsZoneMap(mapID)
	local info = mapID and C_Map.GetMapInfo(mapID)
	if not info then
		return false
	end
	local zoneType = (Enum and Enum.UIMapType and Enum.UIMapType.Zone) or 3
	return info.mapType == zoneType
end

local function AreaNameAt(mapID, x, y)
	if not MapUtil or not MapUtil.FindBestAreaNameAtMouse then
		return nil
	end
	local ok, name = pcall(MapUtil.FindBestAreaNameAtMouse, mapID, x, y)
	if ok then
		return name
	end
	return nil
end

local function HandleClick(x, y)
	local mapID = WorldMapFrame.mapID
	if not mapID then
		return
	end

	-- On a continent or world map a click is navigation to a child zone; leave
	-- that to Blizzard's own handlers rather than hijacking it.
	if not IsZoneMap(mapID) then
		return
	end

	local areaName = AreaNameAt(mapID, x, y)
	local debug = ZoneLore:Get("debug")

	if not areaName then
		if debug then
			ZoneLore:Print("no area under cursor on map %d", mapID)
		end
		return
	end

	local entry, key = ZoneLore:GetSubzoneLore(mapID, areaName)

	if debug then
		ZoneLore:Print(
			'area "%s" -> key "%s" -> %s',
			areaName,
			tostring(key),
			entry and "found" or "|cffffcc00no lore|r"
		)
	end

	if entry then
		ZoneLore:SelectSubzone(mapID, areaName, entry)
	end
end

function ZoneLore:SetupSubzoneClicks()
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if not container then
		ZoneLore:Print("|cffffcc00WorldMapFrame.ScrollContainer missing; subzone clicks disabled|r")
		return
	end

	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		ZoneLore:Print("|cffffcc00MapUtil.FindBestAreaNameAtMouse missing; subzone clicks disabled|r")
		return
	end

	container:HookScript("OnMouseDown", function(self, button)
		if button == "LeftButton" then
			downX, downY = self:GetNormalizedCursorPosition()
		end
	end)

	container:HookScript("OnMouseUp", function(self, button)
		if button ~= "LeftButton" then
			return
		end

		local startX, startY = downX, downY
		downX, downY = nil, nil
		if not startX then
			return
		end

		local x, y = self:GetNormalizedCursorPosition()
		if not x then
			return
		end

		if math.abs(x - startX) + math.abs(y - startY) > DRAG_TOLERANCE then
			return -- the player was panning the map
		end

		HandleClick(x, y)
	end)
end
