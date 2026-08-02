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

-- Three buttons at 54 plus the padding is 178; the bar was 158 with two at 62.
-- Widening by 20 costs less than shrinking the labels until "Report" clips.
local BAR_WIDTH = 178
local BAR_HEIGHT = 52
local BUTTON_WIDTH = 54
local BUTTON_HEIGHT = 20
local PADDING = 8

local bar, label, pauseButton, stopButton, reportButton

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

-- Autoplay.lua may not be loaded (nothing else here depends on it), so treat a
-- missing queue as an empty one rather than assuming.
local function QueueLength()
	if not ZoneLore.AutoplayQueueLength then
		return 0
	end
	return ZoneLore:AutoplayQueueLength()
end

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
	reportButton:SetTarget(mapID, areaKey)

	-- With a queue waiting, the useful action is moving on to it rather than
	-- ending everything. Stop is still there on right-click; see the tooltip.
	stopButton:SetText(QueueLength() > 0 and "Next" or "Stop")

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

	-- Centred rather than at the right edge, so the two transport controls stay
	-- adjacent and in their old order once Report joins the row.
	stopButton = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
	stopButton:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	stopButton:SetPoint("BOTTOM", bar, "BOTTOM", 0, PADDING - 2)
	stopButton:SetText("Stop")
	-- Right-click has to be asked for explicitly; a button registered for
	-- LeftButton only never sees it.
	stopButton:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	stopButton:SetScript("OnClick", function(_, button)
		if button == "RightButton" or QueueLength() == 0 then
			ZoneLore:StopLore()
		else
			ZoneLore:SkipLore()
		end
	end)
	stopButton:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		if QueueLength() > 0 then
			GameTooltip:SetText("Next")
			GameTooltip:AddLine(("%d more waiting."):format(QueueLength()), 1, 0.82, 0)
			GameTooltip:AddLine("Right-click to stop and discard the rest.", 1, 1, 1, true)
		else
			GameTooltip:SetText("Stop")
		end
		GameTooltip:AddLine("Drag these controls to move them. /zl bar resets their position.", 0.7, 0.7, 0.7, true)
		GameTooltip:Show()
	end)
	stopButton:SetScript("OnLeave", GameTooltip_Hide)

	-- The reason a report control belongs here and not only on the panels: the
	-- complaint people actually have is about the line they are hearing right now,
	-- and narration outlives both panels.
	reportButton = ZoneLore:CreateReportButton(bar)
	reportButton:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	reportButton:SetPoint("BOTTOMRIGHT", bar, "BOTTOMRIGHT", -(PADDING - 2), PADDING - 2)

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
