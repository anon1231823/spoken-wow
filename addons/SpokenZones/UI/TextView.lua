-- SpokenZones -- a scrolling block of wrapped text, with a scrollbar.
--
-- Shared by the world map panel and the standalone lore window so both scroll
-- and wrap identically.
--
-- The scrollbar is hand-rolled rather than inherited from ScrollFrameTemplate.
-- That template does provide a native-looking bar on 11509 (Leatrix_Plus uses
-- it), but only via XML KeyValues naming a scrollBarTemplate, and none of that
-- plumbing can be verified without launching the game. A track and a thumb are
-- fully deterministic, and the wheel keeps working regardless.

local ADDON_NAME, SpokenZones = ...

local SCROLL_STEP = 28
local BAR_WIDTH = 6
local MIN_THUMB = 20

local TextView = {}
TextView.__index = TextView

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

function TextView:UpdateScrollBar()
	local viewHeight = self.frame:GetHeight() or 0
	local contentHeight = self.child:GetHeight() or 0
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

function TextView:ScrollTo(value)
	local target = Clamp(value, 0, self.range or 0)
	self.frame:SetVerticalScroll(target)
end

local function BuildScrollBar(view, parent)
	local bar = CreateFrame("Frame", nil, parent)
	bar:SetWidth(BAR_WIDTH)
	bar:SetPoint("TOPRIGHT", view.frame, "TOPRIGHT", 0, 0)
	bar:SetPoint("BOTTOMRIGHT", view.frame, "BOTTOMRIGHT", 0, 0)

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
	thumb.texture = thumbTex

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

-- Anchor the returned view's `frame` yourself. Width is read at SetText time, so
-- it copes with the frame being resized after creation.
function SpokenZones:CreateTextView(parent)
	local view = setmetatable({}, TextView)
	view.range = 0

	local scroll = CreateFrame("ScrollFrame", nil, parent)
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

	local text = child:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	text:SetPoint("TOPLEFT", child, "TOPLEFT", 0, 0)
	text:SetJustifyH("LEFT")
	text:SetJustifyV("TOP")
	text:SetWordWrap(true)
	text:SetSpacing(2)

	view.frame = scroll
	view.child = child
	view.text = text

	BuildScrollBar(view, parent)

	-- An anchored frame has no resolved width until it has been laid out, so the
	-- first SetText can arrive with width 0 and fail to wrap. Re-wrap whenever the
	-- width actually changes. Setting the child/FontString width does not resize
	-- the ScrollFrame, so this cannot recurse.
	scroll:SetScript("OnSizeChanged", function(self)
		local width = self:GetWidth() or 0
		if width > 0 and width ~= view.wrappedAt and view.lastText then
			view:SetText(view.lastText)
		end
	end)

	return view
end

--------------------------------------------------------------------------------
-- Content
--------------------------------------------------------------------------------

function TextView:SetText(str)
	self.lastText = str or ""

	-- The scroll child does not inherit the ScrollFrame's width, so both it and
	-- the FontString have to be told, or the text will not wrap. Leave room for
	-- the scrollbar so it never sits on top of the last few characters.
	local width = (self.frame:GetWidth() or 0) - (BAR_WIDTH + 4)
	if width > 0 then
		self.child:SetWidth(width)
		self.text:SetWidth(width)
		self.wrappedAt = self.frame:GetWidth()
	end

	self.text:SetText(self.lastText)

	local fontPath = GameFontHighlight:GetFont()
	if fontPath then
		self.text:SetFont(fontPath, SpokenZones:Get("fontSize"), "")
	end

	self.child:SetHeight((self.text:GetStringHeight() or 0) + 8)
	self.frame:SetVerticalScroll(0)
	self:UpdateScrollBar()
end

function TextView:Show()
	self.frame:Show()
	self:UpdateScrollBar()
end

function TextView:Hide()
	self.frame:Hide()
	self.bar:Hide()
end
