-- ZoneLore -- the lore panel docked to the side of the world map.

local ADDON_NAME, ZoneLore = ...

local PADDING = 16
local SCROLL_STEP = 28

local panel, header, subheader, scroll, scrollChild, body, footer

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

	subheader = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subheader:SetPoint("TOPLEFT", header, "BOTTOMLEFT", 0, -2)
	subheader:SetPoint("TOPRIGHT", header, "BOTTOMRIGHT", 0, -2)
	subheader:SetJustifyH("LEFT")

	footer = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	footer:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", PADDING, PADDING - 4)
	footer:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -PADDING, PADDING - 4)
	footer:SetJustifyH("LEFT")
	footer:SetText("Lore: warcraft.wiki.gg (CC BY-SA 4.0)")

	-- A plain ScrollFrame rather than UIPanelScrollFrameTemplate: no dependency
	-- on a template whose presence on 11509 is unverified, and the lore entries
	-- are short enough that a wheel is sufficient navigation.
	scroll = CreateFrame("ScrollFrame", nil, panel)
	scroll:SetPoint("TOPLEFT", subheader, "BOTTOMLEFT", 0, -8)
	scroll:SetPoint("BOTTOMRIGHT", footer, "TOPRIGHT", 0, 6)
	-- A ScrollFrame already clips its scroll child; this is belt-and-braces and
	-- guarded because it is not confirmed present on 11509.
	if scroll.SetClipsChildren then
		scroll:SetClipsChildren(true)
	end
	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", function(self, delta)
		local range = self:GetVerticalScrollRange() or 0
		local target = self:GetVerticalScroll() - (delta * SCROLL_STEP)
		if target < 0 then
			target = 0
		elseif target > range then
			target = range
		end
		self:SetVerticalScroll(target)
	end)

	scrollChild = CreateFrame("Frame", nil, scroll)
	scrollChild:SetWidth(width - PADDING * 2)
	scrollChild:SetHeight(1)
	scroll:SetScrollChild(scrollChild)

	body = scrollChild:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	body:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 0, 0)
	body:SetWidth(width - PADDING * 2)
	body:SetJustifyH("LEFT")
	body:SetJustifyV("TOP")
	body:SetWordWrap(true)
	body:SetSpacing(2)

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

local function ApplyFont()
	local size = ZoneLore:Get("fontSize")
	local fontPath = GameFontHighlight:GetFont()
	if fontPath then
		body:SetFont(fontPath, size, "")
	end
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
	local entry, foundOn = ZoneLore:GetLoreWithFallback(mapID)

	header:SetText(zoneName)

	if entry then
		-- Fallback hit an ancestor (a dungeon or micro-map inheriting its zone's
		-- lore); say so rather than silently mislabelling the text.
		if foundOn ~= mapID then
			subheader:SetText("lore for " .. (ZoneLore:GetMapName(foundOn) or "parent zone"))
		else
			subheader:SetText("")
		end
		body:SetText(entry.full or entry.short or "")
	else
		subheader:SetText("")
		body:SetText("|cff888888No lore recorded for " .. zoneName .. " yet.|r")
	end

	ApplyFont()
	scrollChild:SetHeight((body:GetStringHeight() or 0) + 8)
	scroll:SetVerticalScroll(0)
end

ZoneLore.RefreshMapPanel = function(_, mapID)
	Refresh(mapID)
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
	ApplyFont()

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
