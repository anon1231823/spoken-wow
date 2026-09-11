-- ZoneLore -- a scrolling viewport for a frame full of widgets.
--
-- Settings.RegisterCanvasLayoutCategory hands the addon a fixed-size canvas and
-- does nothing else: a canvas taller than the settings window does not scroll,
-- and does not even clip, so the overflow draws over the game world. Anything
-- registered there that can outgrow one screen has to bring its own viewport.
--
-- The scrollbar is hand-rolled for UI/TextView.lua's reason -- ScrollFrameTemplate
-- needs XML KeyValues naming a scrollBarTemplate, none of which can be verified
-- without launching the client, while a track and a thumb are deterministic. It
-- looks the same as TextView's on purpose.
--
-- Not shared with TextView, which predates it: TextView's bar is entangled with
-- text wrapping (SetText subtracts the bar's width to decide where to wrap), so
-- lifting it out would mean reworking the widget the map panel and the lore
-- window both depend on. This one only has to move a frame of controls.

local ADDON_NAME, ZoneLore = ...

local SCROLL_STEP = 32
local BAR_WIDTH = 6
local MIN_THUMB = 20

local Scroller = {}
Scroller.__index = Scroller

local function Clamp(value, low, high)
	if value < low then
		return low
	elseif value > high then
		return high
	end
	return value
end

--------------------------------------------------------------------------------
-- Scrollbar
--------------------------------------------------------------------------------

-- Measures and redraws the bar, and NOTHING ELSE. In particular it must never
-- scroll: OnVerticalScroll calls it, so a SetVerticalScroll in here is an infinite
-- recursion and a dead settings panel. Moving the scroll position is ScrollTo's
-- job, and Recalculate below is what calls it when the range changes.
function Scroller:UpdateScrollBar()
	local viewHeight = self.frame:GetHeight() or 0
	local contentHeight = self.contentHeight or 0
	local range = contentHeight - viewHeight

	-- Nothing to scroll: keep the bar out of the way entirely.
	if range <= 1 or viewHeight <= 0 then
		self.range = 0
		self.bar:Hide()
		return
	end

	self.range = range
	self.bar:Show()

	local barHeight = self.bar:GetHeight() or 0
	local thumbHeight = Clamp((viewHeight / contentHeight) * barHeight, MIN_THUMB, barHeight)
	self.thumb:SetHeight(thumbHeight)

	local travel = barHeight - thumbHeight
	local fraction = range > 0 and (self.frame:GetVerticalScroll() / range) or 0
	self.thumb:ClearAllPoints()
	self.thumb:SetPoint("TOP", self.bar, "TOP", 0, -Clamp(fraction * travel, 0, travel))
end

function Scroller:ScrollTo(value)
	self.frame:SetVerticalScroll(Clamp(value, 0, self.range or 0))
end

-- Re-measure, then pull the scroll position back inside whatever range is left.
-- Without the second half, shrinking the viewport's content leaves the view parked
-- past the end of it, showing empty space under the last control.
function Scroller:Recalculate()
	self:UpdateScrollBar()
	self:ScrollTo(self.frame:GetVerticalScroll())
end

-- How tall the content actually is. The caller knows, because it laid the widgets
-- out; nothing here can measure a frame whose children are absolutely positioned.
function Scroller:SetContentHeight(height)
	self.contentHeight = height
	self.child:SetHeight(height)
	self:Recalculate()
end

local function BuildScrollBar(view, parent)
	local bar = CreateFrame("Frame", nil, parent)
	bar:SetWidth(BAR_WIDTH)
	bar:SetPoint("TOPRIGHT", view.frame, "TOPRIGHT", 0, 0)
	bar:SetPoint("BOTTOMRIGHT", view.frame, "BOTTOMRIGHT", 0, 0)
	bar:Hide()

	local track = bar:CreateTexture(nil, "BACKGROUND")
	track:SetAllPoints()
	track:SetColorTexture(1, 1, 1, 0.06)

	local thumb = CreateFrame("Button", nil, bar)
	thumb:SetWidth(BAR_WIDTH)
	thumb:SetHeight(MIN_THUMB)
	thumb:SetPoint("TOP", bar, "TOP", 0, 0)

	local thumbTex = thumb:CreateTexture(nil, "ARTWORK")
	thumbTex:SetAllPoints()
	thumbTex:SetColorTexture(1, 0.82, 0, 0.45)

	thumb:SetScript("OnEnter", function()
		thumbTex:SetColorTexture(1, 0.82, 0, 0.75)
	end)
	thumb:SetScript("OnLeave", function()
		if not view.dragging then
			thumbTex:SetColorTexture(1, 0.82, 0, 0.45)
		end
	end)

	thumb:RegisterForDrag("LeftButton")
	thumb:SetScript("OnDragStart", function()
		view.dragging = true
	end)
	thumb:SetScript("OnDragStop", function()
		view.dragging = false
		thumbTex:SetColorTexture(1, 0.82, 0, 0.45)
	end)

	-- Map the cursor's Y position onto the scroll range while dragging.
	bar:SetScript("OnUpdate", function()
		if not view.dragging then
			return
		end

		local barHeight = bar:GetHeight() or 0
		local thumbHeight = thumb:GetHeight() or 0
		local travel = barHeight - thumbHeight
		if travel <= 0 then
			return
		end

		local _, cursorY = GetCursorPosition()
		cursorY = cursorY / UIParent:GetEffectiveScale()

		local offset = (bar:GetTop() or 0) - cursorY - (thumbHeight / 2)
		view:ScrollTo((Clamp(offset, 0, travel) / travel) * (view.range or 0))
	end)

	view.bar = bar
	view.thumb = thumb
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- Fills `parent`. Anchor widgets inside the returned `child`, then call
-- SetContentHeight with how far down they reach.
function ZoneLore:CreateScroller(parent)
	local view = setmetatable({}, Scroller)
	view.range = 0
	view.contentHeight = 0

	local scroll = CreateFrame("ScrollFrame", nil, parent)
	scroll:SetAllPoints(parent)
	if scroll.SetClipsChildren then
		scroll:SetClipsChildren(true)
	end
	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", function(_, delta)
		view:ScrollTo(scroll:GetVerticalScroll() - (delta * SCROLL_STEP))
	end)
	scroll:SetScript("OnVerticalScroll", function()
		view:UpdateScrollBar()
	end)

	local child = CreateFrame("Frame", nil, scroll)
	child:SetSize(1, 1)
	scroll:SetScrollChild(child)

	view.frame = scroll
	view.child = child

	BuildScrollBar(view, parent)

	-- A canvas has no resolved size until the settings window lays it out, so the
	-- viewport height -- and with it whether there is anything to scroll at all --
	-- is not known at construction time. Setting the child's width does not resize
	-- the ScrollFrame, so this cannot recurse.
	-- Belt and braces: the settings window can size its canvas before this is ever
	-- shown, in which case OnSizeChanged has already fired and there is nothing to
	-- recompute -- but a bar left hidden because the height was still 0 at that
	-- moment is invisible until something else resizes.
	scroll:SetScript("OnShow", function()
		view:Recalculate()
	end)

	scroll:SetScript("OnSizeChanged", function(self)
		local width = self:GetWidth() or 0
		if width > 0 then
			child:SetWidth(width - BAR_WIDTH - 2)
		end
		view:Recalculate()
	end)

	return view
end
