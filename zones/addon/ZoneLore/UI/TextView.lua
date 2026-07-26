-- ZoneLore -- a scrolling block of wrapped text.
--
-- Shared by the world map panel and the standalone lore window so both scroll
-- and wrap identically. A plain ScrollFrame is used rather than
-- UIPanelScrollFrameTemplate, whose presence on 11509 is unconfirmed; a
-- ScrollFrame clips its scroll child by itself, so the wheel is all that is
-- needed. The trade-off is no visible scrollbar.

local ADDON_NAME, ZoneLore = ...

local SCROLL_STEP = 28

local TextView = {}
TextView.__index = TextView

-- Anchor the returned view's `frame` yourself. Width is taken from the frame at
-- SetText time, so it copes with the frame being resized after creation.
function ZoneLore:CreateTextView(parent)
	local view = setmetatable({}, TextView)

	local scroll = CreateFrame("ScrollFrame", nil, parent)
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

function TextView:ApplyFont()
	local fontPath = GameFontHighlight:GetFont()
	if fontPath then
		self.text:SetFont(fontPath, ZoneLore:Get("fontSize"), "")
	end
end

function TextView:SetText(str)
	self.lastText = str or ""

	-- The scroll child does not inherit the ScrollFrame's width, so both it and
	-- the FontString have to be told, or the text will not wrap.
	local width = self.frame:GetWidth()
	if width and width > 0 then
		self.child:SetWidth(width)
		self.text:SetWidth(width)
		self.wrappedAt = width
	end

	self.text:SetText(self.lastText)
	self:ApplyFont()
	self.child:SetHeight((self.text:GetStringHeight() or 0) + 8)
	self.frame:SetVerticalScroll(0)
end

function TextView:Show()
	self.frame:Show()
end

function TextView:Hide()
	self.frame:Hide()
end
