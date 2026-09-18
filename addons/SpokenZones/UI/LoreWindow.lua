-- SpokenZones -- standalone, browsable lore window.
--
-- Opened from the minimap button or /zl window. Independent of WorldMapFrame, so
-- it works with the map closed.
--
-- The left column is an accordion: all zones, with the selected zone's subzones
-- nested under it. Only one zone expands at a time, which caps the row count at
-- about 108 (49 zones + Ashenvale's 59 subzones) -- small enough that every row
-- can be a real button and no view virtualisation is needed. Expanding all zones
-- at once would be 1353 rows, which is why the accordion is not optional.

local ADDON_NAME, SpokenZones = ...

local WINDOW_WIDTH = 720
local WINDOW_HEIGHT = 460
local LIST_WIDTH = 210
local ROW_HEIGHT = 16
local PADDING = 14
local SCROLL_STEP = ROW_HEIGHT * 3

-- Horizontal room kept clear at the right of the credit line for the report
-- button, the same trade UI/MapPanel.lua makes: the credit is short and the
-- button is a rare click, so they share the footer row.
local REPORT_RESERVE = 64

local window, listScroll, listChild, header, subheader, body, footer, audioButton, reportButton
local rows = {}
local expandedZone = nil
local selection = nil -- { mapID = , key = nil|string }
local sortedZoneIDs = nil

--------------------------------------------------------------------------------
-- Data ordering
--------------------------------------------------------------------------------

local function ZoneIDs()
	if sortedZoneIDs then
		return sortedZoneIDs
	end
	sortedZoneIDs = {}
	for mapID in pairs(SpokenZones.Zones) do
		table.insert(sortedZoneIDs, mapID)
	end
	-- Alphabetical by display name: uiMapID order is meaningless to a reader.
	table.sort(sortedZoneIDs, function(a, b)
		local na = SpokenZones:GetMapName(a) or SpokenZones.Zones[a].name or ""
		local nb = SpokenZones:GetMapName(b) or SpokenZones.Zones[b].name or ""
		if na == nb then
			return a < b
		end
		return na < nb
	end)
	return sortedZoneIDs
end

local function SubzoneKeys(mapID)
	local tbl = SpokenZones.Subzones[mapID]
	if not tbl then
		return nil
	end
	local keys = {}
	for key in pairs(tbl) do
		table.insert(keys, key)
	end
	table.sort(keys, function(a, b)
		return (tbl[a].name or a) < (tbl[b].name or b)
	end)
	return keys
end

-- Flatten the tree into display rows honouring the current expansion.
local function BuildRowList()
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		local subKeys = SubzoneKeys(mapID)
		table.insert(list, {
			kind = "zone",
			mapID = mapID,
			label = SpokenZones:GetMapName(mapID) or SpokenZones.Zones[mapID].name or tostring(mapID),
			count = subKeys and #subKeys or 0,
		})
		if expandedZone == mapID and subKeys then
			for _, key in ipairs(subKeys) do
				table.insert(list, {
					kind = "subzone",
					mapID = mapID,
					key = key,
					label = SpokenZones.Subzones[mapID][key].name or key,
				})
			end
		end
	end
	return list
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

local function ShowEntry()
	if not selection then
		header:SetText("Spoken Zones")
		subheader:SetText("")
		body:SetText("|cff888888Pick a zone on the left. Zones with subzones show a count; click one to expand it.|r")
		audioButton:SetTarget(nil, nil)
		reportButton:SetTarget(nil, nil)
		return
	end

	local mapID, key = selection.mapID, selection.key

	if key then
		local entry = SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		if entry then
			header:SetText(entry.name or key)
			subheader:SetText("in " .. (SpokenZones:GetMapName(mapID) or ""))
			body:SetText(entry.full or entry.short or "")
			-- Rows are already keyed by the canonical form, so this needs no
			-- normalising -- unlike the map panel, which starts from a client name.
			audioButton:SetTarget(mapID, key)
			reportButton:SetTarget(mapID, key)
			return
		end
	end

	local entry = SpokenZones:GetLore(mapID)
	header:SetText(SpokenZones:GetMapName(mapID) or (entry and entry.name) or tostring(mapID))
	local subKeys = SubzoneKeys(mapID)
	subheader:SetText(subKeys and (#subKeys .. " subzones") or "")
	body:SetText(entry and (entry.full or entry.short) or "|cff888888No lore recorded.|r")
	audioButton:SetTarget(entry and mapID or nil, nil)
	reportButton:SetTarget(entry and mapID or nil, nil)
end

--------------------------------------------------------------------------------
-- List rendering
--------------------------------------------------------------------------------

local function IsSelected(row)
	if not selection then
		return false
	end
	if row.kind == "zone" then
		return selection.mapID == row.mapID and selection.key == nil
	end
	return selection.mapID == row.mapID and selection.key == row.key
end

local function OnRowClick(self)
	local row = self.row
	if not row then
		return
	end

	if row.kind == "zone" then
		-- Clicking a zone both selects it and toggles its subzones.
		expandedZone = (expandedZone == row.mapID) and nil or row.mapID
		selection = { mapID = row.mapID, key = nil }
	else
		selection = { mapID = row.mapID, key = row.key }
	end

	SpokenZones:RefreshLoreWindow()
end

local function AcquireRow(index)
	local row = rows[index]
	if row then
		return row
	end

	row = CreateFrame("Button", nil, listChild)
	row:SetHeight(ROW_HEIGHT)
	row:SetPoint("LEFT", listChild, "LEFT", 0, 0)
	row:SetPoint("RIGHT", listChild, "RIGHT", 0, 0)

	row.label = row:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	row.label:SetPoint("LEFT", row, "LEFT", 0, 0)
	row.label:SetPoint("RIGHT", row, "RIGHT", -2, 0)
	row.label:SetJustifyH("LEFT")

	row.highlight = row:CreateTexture(nil, "BACKGROUND")
	row.highlight:SetAllPoints()
	row.highlight:SetColorTexture(1, 1, 1, 0.12)
	row.highlight:Hide()

	row:SetScript("OnClick", OnRowClick)
	row:SetScript("OnEnter", function(self)
		if not self.selected then
			self.highlight:Show()
		end
	end)
	row:SetScript("OnLeave", function(self)
		if not self.selected then
			self.highlight:Hide()
		end
	end)

	rows[index] = row
	return row
end

local function RenderList()
	local list = BuildRowList()

	for i, item in ipairs(list) do
		local row = AcquireRow(i)
		row.row = item
		row:ClearAllPoints()
		row:SetPoint("TOPLEFT", listChild, "TOPLEFT", 0, -((i - 1) * ROW_HEIGHT))
		row:SetPoint("TOPRIGHT", listChild, "TOPRIGHT", 0, -((i - 1) * ROW_HEIGHT))

		if item.kind == "zone" then
			local marker = item.count > 0 and (expandedZone == item.mapID and "- " or "+ ") or "  "
			local suffix = item.count > 0 and ("  |cff777777" .. item.count .. "|r") or ""
			row.label:SetText(marker .. item.label .. suffix)
			row.label:SetTextColor(1, 0.82, 0)
			row.label:SetPoint("LEFT", row, "LEFT", 0, 0)
		else
			row.label:SetText(item.label)
			row.label:SetTextColor(0.8, 0.8, 0.8)
			row.label:SetPoint("LEFT", row, "LEFT", 16, 0)
		end

		row.selected = IsSelected(item)
		if row.selected then
			row.highlight:Show()
		else
			row.highlight:Hide()
		end
		row:Show()
	end

	for i = #list + 1, #rows do
		rows[i]:Hide()
		rows[i].row = nil
	end

	listChild:SetHeight(math.max(#list * ROW_HEIGHT, 1))
	return list
end

-- Bring the selected row into view. Only used when opening the window: doing it
-- on every refresh would yank the list out from under a click.
local function ScrollToSelection(list)
	if not selection then
		return
	end
	for i, item in ipairs(list) do
		if IsSelected(item) then
			local viewHeight = listScroll:GetHeight() or 0
			-- GetVerticalScrollRange is stale until the next layout pass, right
			-- after listChild:SetHeight, so derive the range instead.
			local range = math.max(0, (#list * ROW_HEIGHT) - viewHeight)
			local target = ((i - 1) * ROW_HEIGHT) - (viewHeight / 2) + (ROW_HEIGHT / 2)
			if target < 0 then
				target = 0
			elseif target > range then
				target = range
			end
			listScroll:SetVerticalScroll(target)
			return
		end
	end
end

function SpokenZones:RefreshLoreWindow(scrollToSelection)
	if not window then
		return
	end
	local list = RenderList()
	if scrollToSelection then
		ScrollToSelection(list)
	end
	ShowEntry()
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

local function BuildWindow()
	window = CreateFrame("Frame", "SpokenZonesWindow", UIParent, "BackdropTemplate")
	window:SetSize(WINDOW_WIDTH, WINDOW_HEIGHT)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:SetToplevel(true)
	window:EnableMouse(true)
	window:SetMovable(true)
	window:RegisterForDrag("LeftButton")
	window:SetScript("OnDragStart", window.StartMoving)
	window:SetScript("OnDragStop", window.StopMovingOrSizing)
	window:SetClampedToScreen(true)
	window:SetBackdrop({
		bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
		edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
		tile = true,
		tileSize = 32,
		edgeSize = 32,
		insets = { left = 11, right = 12, top = 12, bottom = 11 },
	})
	window:Hide()

	local title = window:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	title:SetPoint("TOP", window, "TOP", 0, -PADDING)
	title:SetText("Spoken Zones")

	local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", window, "TOPRIGHT", -8, -8)
	close:SetScript("OnClick", function()
		window:Hide()
	end)

	-- On the title row beside the close button rather than on the header row.
	-- UIPanelCloseButton is 32x32 and reaches down to -40, which is exactly where
	-- the header row starts, so anything anchored top-right there overlaps it.
	audioButton = SpokenZones:CreateAudioButton(window)
	audioButton:SetPoint("TOPRIGHT", close, "TOPLEFT", -2, -5)

	-- Left: the zone/subzone list.
	listScroll = CreateFrame("ScrollFrame", nil, window)
	listScroll:SetPoint("TOPLEFT", window, "TOPLEFT", PADDING, -(PADDING + 20))
	listScroll:SetPoint("BOTTOMLEFT", window, "BOTTOMLEFT", PADDING, PADDING + 4)
	listScroll:SetWidth(LIST_WIDTH)
	if listScroll.SetClipsChildren then
		listScroll:SetClipsChildren(true)
	end
	listScroll:EnableMouseWheel(true)
	listScroll:SetScript("OnMouseWheel", function(self, delta)
		local range = self:GetVerticalScrollRange() or 0
		local target = self:GetVerticalScroll() - (delta * SCROLL_STEP)
		if target < 0 then
			target = 0
		elseif target > range then
			target = range
		end
		self:SetVerticalScroll(target)
	end)

	listChild = CreateFrame("Frame", nil, listScroll)
	listChild:SetSize(LIST_WIDTH, 1)
	listScroll:SetScrollChild(listChild)

	-- Right: the selected entry.
	header = window:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	header:SetPoint("TOPLEFT", listScroll, "TOPRIGHT", PADDING, 0)
	header:SetPoint("RIGHT", window, "RIGHT", -PADDING, 0)
	header:SetJustifyH("LEFT")
	header:SetWordWrap(true)

	subheader = window:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subheader:SetPoint("TOPLEFT", header, "BOTTOMLEFT", 0, -2)
	subheader:SetPoint("RIGHT", window, "RIGHT", -PADDING, 0)
	subheader:SetJustifyH("LEFT")

	footer = window:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	footer:SetPoint("BOTTOMLEFT", listScroll, "BOTTOMRIGHT", PADDING, 0)
	footer:SetPoint("RIGHT", window, "RIGHT", -(PADDING + REPORT_RESERVE), 0)
	footer:SetJustifyH("LEFT")
	footer:SetText("Lore: warcraft.wiki.gg (CC BY-SA 4.0)")

	reportButton = SpokenZones:CreateReportButton(window)
	reportButton:SetPoint("LEFT", footer, "RIGHT", 6, -4)

	body = SpokenZones:CreateTextView(window)
	body.frame:SetPoint("TOPLEFT", subheader, "BOTTOMLEFT", 0, -8)
	-- Cleared against the button rather than the credit line: the button is the
	-- taller of the two, so it is the one that decides where the text has to stop.
	body.frame:SetPoint("BOTTOMRIGHT", reportButton, "TOPRIGHT", 0, 6)

	SpokenZones.window = window
end

--------------------------------------------------------------------------------
-- Public
--------------------------------------------------------------------------------

-- The zone the player is standing in, resolved to something we actually have
-- lore for. C_Map.GetBestMapForUnit can return an indoor or micro map (an inn,
-- a dungeon) that is not itself a key in Zones, so walk up to its parent.
local function CurrentZoneID()
	local playerMap = SpokenZones:GetPlayerMapID()
	if not playerMap then
		return nil
	end
	local _, resolved = SpokenZones:GetLoreWithFallback(playerMap)
	return resolved
end

function SpokenZones:ToggleLoreWindow()
	if not window then
		return
	end
	if window:IsShown() then
		window:Hide()
		return
	end

	-- Re-sync to where the player is standing on *every* open, not just the
	-- first. Opening from the minimap should always land on the current zone;
	-- keeping the previous selection made it show wherever you last browsed.
	local current = CurrentZoneID()
	if current then
		-- Standing in a subzone we have lore for is more specific than the zone,
		-- so prefer it. Either way the parent zone is expanded.
		local subZone = GetSubZoneText()
		local subEntry, subKey
		if subZone and subZone ~= "" then
			subEntry, subKey = SpokenZones:GetSubzoneLore(current, subZone)
		end

		expandedZone = current
		if subEntry then
			selection = { mapID = current, key = subKey }
		else
			selection = { mapID = current, key = nil }
		end
	end

	window:Show()
	SpokenZones:RefreshLoreWindow(true)
end

-- Open on a named entry rather than on the player's location. Deliberately not
-- routed through ToggleLoreWindow: that re-syncs to where the player is standing
-- on every open, which is right for the minimap button and wrong for anything
-- naming an entry -- narration outlives the zone you started it in.
function SpokenZones:ShowLoreFor(mapID, areaKey)
	if not window or not mapID then
		return
	end

	expandedZone = mapID
	selection = { mapID = mapID, key = areaKey }

	window:Show()
	SpokenZones:RefreshLoreWindow(true)
end

function SpokenZones:SetupLoreWindow()
	if window then
		return
	end
	BuildWindow()
	tinsert(UISpecialFrames, "SpokenZonesWindow") -- close on Escape
end
