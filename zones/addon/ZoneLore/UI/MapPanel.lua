-- ZoneLore -- the lore panel docked to the side of the world map.
--
-- Shows lore for the zone the map is displaying, or for a subzone the player
-- clicked (see UI/SubzoneClick.lua), with a link back to the zone.

local ADDON_NAME, ZoneLore = ...

local PADDING = 16
local INFO_LINE_HEIGHT = 16

local panel, header, infoLine, body, footer

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

local function BuildPanel()
	local width = ZoneLore:Get("panelWidth")

	panel = CreateFrame("Frame", "ZoneLorePanel", WorldMapFrame, "BackdropTemplate")
	panel:SetWidth(width)
	panel:SetFrameStrata(WorldMapFrame:GetFrameStrata())
	panel:SetFrameLevel(WorldMapFrame:GetFrameLevel() + 10)
	panel:SetBackdrop({
		bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
		edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
		tile = true,
		tileSize = 32,
		edgeSize = 32,
		insets = { left = 11, right = 12, top = 12, bottom = 11 },
	})

	header = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	header:SetPoint("TOPLEFT", panel, "TOPLEFT", PADDING, -PADDING)
	header:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -PADDING, -PADDING)
	header:SetJustifyH("LEFT")
	header:SetWordWrap(true)

	-- One fixed-height slot under the header, used either as a caption or as the
	-- "back to zone" link. Keeping it always present means the scroll frame below
	-- never has to be re-anchored as the content type changes.
	infoLine = CreateFrame("Button", nil, panel)
	infoLine:SetHeight(INFO_LINE_HEIGHT)
	infoLine:SetPoint("TOPLEFT", header, "BOTTOMLEFT", 0, -2)
	infoLine:SetPoint("TOPRIGHT", header, "BOTTOMRIGHT", 0, -2)
	infoLine.text = infoLine:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	infoLine.text:SetAllPoints()
	infoLine.text:SetJustifyH("LEFT")
	infoLine:SetScript("OnClick", function()
		ZoneLore:ClearSubzone()
	end)
	infoLine:SetScript("OnEnter", function(self)
		if self:IsEnabled() then
			self.text:SetTextColor(1, 1, 1)
		end
	end)
	infoLine:SetScript("OnLeave", function(self)
		if self:IsEnabled() then
			self.text:SetTextColor(0.4, 0.73, 1)
		end
	end)

	footer = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	footer:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", PADDING, PADDING - 4)
	footer:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -PADDING, PADDING - 4)
	footer:SetJustifyH("LEFT")
	footer:SetText("Lore: warcraft.wiki.gg (CC BY-SA 4.0)")

	body = ZoneLore:CreateTextView(panel)
	body.frame:SetPoint("TOPLEFT", infoLine, "BOTTOMLEFT", 0, -6)
	body.frame:SetPoint("BOTTOMRIGHT", footer, "TOPRIGHT", 0, 6)

	ZoneLore.panel = panel
end

--------------------------------------------------------------------------------
-- Layout
--------------------------------------------------------------------------------

local function ApplyAnchors()
	panel:ClearAllPoints()
	if ZoneLore:Get("panelSide") == "LEFT" then
		panel:SetPoint("TOPRIGHT", WorldMapFrame, "TOPLEFT", -2, 0)
		panel:SetPoint("BOTTOMRIGHT", WorldMapFrame, "BOTTOMLEFT", -2, 0)
	else
		panel:SetPoint("TOPLEFT", WorldMapFrame, "TOPRIGHT", 2, 0)
		panel:SetPoint("BOTTOMLEFT", WorldMapFrame, "BOTTOMRIGHT", 2, 0)
	end
end

local function SetBody(text)
	body:SetText(text)
end

-- Maximised, the map fills the screen and a side panel would sit off-screen, so
-- the panel only shows in windowed mode.
local function ShouldShow()
	if not ZoneLore:Get("showMapPanel") then
		return false
	end
	if WorldMapFrame.IsMaximized and WorldMapFrame:IsMaximized() then
		return false
	end
	return true
end

local function SetCaption(text)
	infoLine:Disable()
	infoLine.text:SetTextColor(0.5, 0.5, 0.5)
	infoLine.text:SetText(text or "")
end

local function SetBackLink(zoneName)
	infoLine:Enable()
	infoLine.text:SetTextColor(0.4, 0.73, 1)
	infoLine.text:SetText("< Back to " .. zoneName)
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

local function Refresh(mapID)
	if not panel then
		return
	end

	if not ShouldShow() then
		panel:Hide()
		return
	end

	mapID = mapID or ZoneLore:GetDisplayedMapID()
	if not mapID then
		panel:Hide()
		return
	end

	panel:Show()

	local zoneName = ZoneLore:GetMapName(mapID) or ("uiMapID " .. tostring(mapID))

	-- A selection only applies to the map it was made on; navigating elsewhere
	-- drops it. Checking here rather than on the map-changed callback keeps this
	-- independent of the order modules register their callbacks.
	local selected = ZoneLore.selected
	if selected and selected.mapID ~= mapID then
		ZoneLore.selected = nil
		selected = nil
	end

	if selected then
		-- Prefer the name the client reported, which is what the player sees on
		-- the map ("The Bulwark"), over the wiki page title ("Bulwark").
		header:SetText(selected.areaName or selected.entry.name or "")
		SetBackLink(zoneName)
		SetBody(selected.entry.full or selected.entry.short or "")
		return
	end

	header:SetText(zoneName)

	local entry, foundOn = ZoneLore:GetLoreWithFallback(mapID)
	if entry then
		-- Fallback hit an ancestor (a dungeon or micro-map inheriting its zone's
		-- lore); say so rather than silently mislabelling the text.
		if foundOn ~= mapID then
			SetCaption("lore for " .. (ZoneLore:GetMapName(foundOn) or "parent zone"))
		else
			local subzones = ZoneLore.Subzones[mapID]
			if subzones and next(subzones) then
				SetCaption("click a subzone on the map for more")
			else
				SetCaption("")
			end
		end
		SetBody(entry.full or entry.short or "")
	else
		SetCaption("")
		SetBody("|cff888888No lore recorded for " .. zoneName .. " yet.|r")
	end
end

function ZoneLore:RefreshPanel()
	Refresh(ZoneLore:GetDisplayedMapID())
end

-- Re-apply width, side and font after an options change. TextView re-wraps itself
-- when the width actually changes, via its OnSizeChanged.
function ZoneLore:ApplyPanelOptions()
	if not panel then
		return
	end
	panel:SetWidth(ZoneLore:Get("panelWidth"))
	ApplyAnchors()
	Refresh(ZoneLore:GetDisplayedMapID())
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function ZoneLore:SetupMapPanel()
	if panel then
		return
	end

	BuildPanel()
	ApplyAnchors()

	-- Re-evaluate visibility whenever the map changes shape. Leatrix_Maps hooks
	-- this same set; these are the paths that resize or re-dock the map frame.
	local function Relayout()
		if not panel then
			return
		end
		ApplyAnchors()
		Refresh(ZoneLore:GetDisplayedMapID())
	end

	hooksecurefunc(WorldMapFrame, "Maximize", Relayout)
	hooksecurefunc(WorldMapFrame, "Minimize", Relayout)
	hooksecurefunc(WorldMapFrame, "SynchronizeDisplayState", Relayout)
	if WorldMapFrame.OnFrameSizeChanged then
		hooksecurefunc(WorldMapFrame, "OnFrameSizeChanged", Relayout)
	end

	ZoneLore:OnMapChanged(function(mapID)
		Refresh(mapID)
	end)

	Refresh(ZoneLore:GetDisplayedMapID())
end
