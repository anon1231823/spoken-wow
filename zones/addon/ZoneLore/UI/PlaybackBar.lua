-- ZoneLore -- floating playback controls, shown only while narration is running.
--
-- The Play buttons on the lore descriptions are attached to an entry, which means
-- they are only reachable while that description is on screen. Narration outlives
-- both panels on purpose (see Audio.lua), so there has to be one control that is
-- always reachable. This is it.
--
-- It exists only while something is playing or paused, and removes itself when the
-- clip ends. A control that is visible when there is nothing to control is just
-- clutter parked next to the minimap.

local ADDON_NAME, ZoneLore = ...

local BAR_WIDTH = 158
local BAR_HEIGHT = 52
local BUTTON_WIDTH = 62
local BUTTON_HEIGHT = 20
local PADDING = 8

local bar, label, pauseButton, stopButton

--------------------------------------------------------------------------------
-- Position
--------------------------------------------------------------------------------

-- Below the minimap by default, and draggable from there. Anchored to UIParent
-- rather than parented to Minimap: parenting would inherit the minimap's scale and
-- strata, and would move the controls if another addon rescales it.
local function ApplyPosition()
	local saved = ZoneLore:Get("playbackBarPos")
	bar:ClearAllPoints()

	if type(saved) == "table" and saved.point then
		bar:SetPoint(saved.point, UIParent, saved.relPoint or saved.point, saved.x or 0, saved.y or 0)
		return
	end

	-- -32 clears the minimap's own border and the ring of LibDBIcon buttons that
	-- addons (including this one) park around its edge.
	bar:SetPoint("TOP", Minimap, "BOTTOM", 0, -32)
end

local function SavePosition()
	local point, _, relPoint, x, y = bar:GetPoint()
	ZoneLore:Set("playbackBarPos", {
		point = point,
		relPoint = relPoint,
		x = math.floor(x + 0.5),
		y = math.floor(y + 0.5),
	})
end

function ZoneLore:ResetPlaybackBarPosition()
	self:Set("playbackBarPos", nil)
	if bar then
		ApplyPosition()
	end
end

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local function Refresh()
	if not bar then
		return
	end

	local mapID, areaKey, isPaused = ZoneLore:GetNowPlaying()

	if not mapID or not ZoneLore:Get("showPlaybackBar") then
		bar:Hide()
		return
	end

	label:SetText(ZoneLore:GetAudioLabel(mapID, areaKey))
	pauseButton:SetText(isPaused and "Play" or "Pause")
	bar:Show()
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

local function BuildBar()
	bar = CreateFrame("Frame", "ZoneLorePlaybackBar", UIParent, "BackdropTemplate")
	bar:SetSize(BAR_WIDTH, BAR_HEIGHT)
	bar:SetFrameStrata("MEDIUM")
	bar:SetClampedToScreen(true)
	bar:EnableMouse(true)
	bar:SetMovable(true)
	bar:RegisterForDrag("LeftButton")
	bar:SetScript("OnDragStart", bar.StartMoving)
	bar:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
		SavePosition()
	end)
	bar:SetBackdrop({
		bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
		edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
		tile = true,
		tileSize = 16,
		edgeSize = 12,
		insets = { left = 3, right = 3, top = 3, bottom = 3 },
	})
	bar:Hide()

	-- One line, clipped rather than wrapped: the widget has a fixed height, and a
	-- two-line zone name would push the buttons out of it.
	label = bar:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	label:SetPoint("TOPLEFT", bar, "TOPLEFT", PADDING, -PADDING)
	label:SetPoint("TOPRIGHT", bar, "TOPRIGHT", -PADDING, -PADDING)
	label:SetJustifyH("CENTER")
	label:SetWordWrap(false)

	pauseButton = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
	pauseButton:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	pauseButton:SetPoint("BOTTOMLEFT", bar, "BOTTOMLEFT", PADDING - 2, PADDING - 2)
	pauseButton:SetText("Pause")
	pauseButton:SetScript("OnClick", function()
		ZoneLore:TogglePauseLore()
	end)
	pauseButton:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		if ZoneLore:IsPaused() then
			GameTooltip:SetText("Play")
			GameTooltip:AddLine("Starts this lore again from the beginning.", 1, 0.8, 0.2, true)
		else
			GameTooltip:SetText("Pause")
			GameTooltip:AddLine("The game cannot resume a sound part-way through, so playing again starts from the beginning.", 1, 0.8, 0.2, true)
		end
		GameTooltip:Show()
	end)
	pauseButton:SetScript("OnLeave", GameTooltip_Hide)

	stopButton = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
	stopButton:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	stopButton:SetPoint("BOTTOMRIGHT", bar, "BOTTOMRIGHT", -(PADDING - 2), PADDING - 2)
	stopButton:SetText("Stop")
	stopButton:SetScript("OnClick", function()
		ZoneLore:StopLore()
	end)
	stopButton:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		GameTooltip:SetText("Stop")
		GameTooltip:AddLine("Drag these controls to move them. /zl bar resets their position.", 1, 1, 1, true)
		GameTooltip:Show()
	end)
	stopButton:SetScript("OnLeave", GameTooltip_Hide)

	ZoneLore.playbackBar = bar
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function ZoneLore:SetupPlaybackBar()
	if bar then
		return
	end

	BuildBar()
	ApplyPosition()

	-- Everything this widget shows is derived from the shared playback state, so
	-- one callback covers appearing, relabelling, pausing and disappearing.
	self:OnAudioChanged(Refresh)
	Refresh()
end

function ZoneLore:RefreshPlaybackBar()
	Refresh()
end
