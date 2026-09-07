setfenv(1, ZoneLoreQueue)

-- ZoneLore -- the player: what is being narrated, what is waiting, and the
-- controls for both.
--
-- Ported from VoiceOverRedux's SoundQueueUI.lua, which is public domain, and kept
-- close to it: this is the same widget players already know from quest voiceover,
-- and the two addons are meant to end up sharing one player outright. Layout,
-- proportions, textures and the atlas coordinates are Redux's.
--
-- What differs, and why:
--
--  * The portrait is always the book. Redux draws a 3D model of the NPC speaking
--    and falls back to Book.blp when there is no model to draw; a zone has no
--    speaker, so the fallback is the only case. Everything the model brought with
--    it -- DressUpModel, SetCreature, the animation timer, the retry-until-cached
--    OnUpdate -- is gone with it.
--  * The two text lines are the zone and the area. Redux shows the NPC's name
--    over the quest title; here it is the zone over the subzone being narrated.
--  * No gossip. The Stop-Gossip control and the bullet-per-quest-event colouring
--    have no lore equivalent.
--  * No minimap button. ZoneLore registers its own in UI/MinimapButton.lua, and
--    Redux's version reaches into an AceConfig options table this addon lacks.
--  * Read and Report are ZoneLore's, and live in an actions row under the queue.
--    Report is here for the reason it was on the old playback bar: the complaint
--    people actually have is about the line they are hearing right now.
--  * Refreshed through ZoneLore's OnAudioChanged fanout rather than by the queue
--    calling this file directly, which is what keeps SoundQueue.lua free of any
--    dependency on it.

local ZoneLore = ZoneLore
local L = ZoneLore.L

SoundQueueUI = {}
ZoneLore.SoundQueueUI = SoundQueueUI

local PORTRAIT_SIZE = 120
local PORTRAIT_ATLAS_SIZE = 512
local PORTRAIT_ATLAS_BORDER_SIZE = 416
local PORTRAIT_ATLAS_VIEWPORT_SIZE = 348
local PORTRAIT_BORDER_SCALE = PORTRAIT_SIZE / PORTRAIT_ATLAS_VIEWPORT_SIZE
local PORTRAIT_BORDER_SIZE = PORTRAIT_ATLAS_BORDER_SIZE * PORTRAIT_BORDER_SCALE
local PORTRAIT_BORDER_OUTSET = 34 * PORTRAIT_BORDER_SCALE
local FRAME_WIDTH_WITHOUT_PORTRAIT = 300
local MAX_ROWS = 4
local ACTION_WIDTH = 70
local ACTION_HEIGHT = 18
-- The strip along the bottom that Read and Report own. The queue is centred in
-- what is left rather than in the whole frame, so a fourth row cannot land on top
-- of them.
local ACTION_STRIP = ACTION_HEIGHT + 6

local TEXTURES = [[Interface\AddOns\ZoneLore\Textures\]]

do
	local font = CreateFont("ZoneLoreQueueNameFont")
	font:SetFont(GameFontNormal:GetFont(), 19, "")
	font:SetShadowColor(0, 0, 0)
	font:SetShadowOffset(1, -1)
	font:SetJustifyH("LEFT")
	font:SetJustifyV("TOP")
end
do
	local font = CreateFont("ZoneLoreQueueRowFont")
	font:SetFont(GameFontNormal:GetFont(), 16, "")
	font:SetShadowColor(0, 0, 0)
	font:SetShadowOffset(1, -1)
	font:SetJustifyH("LEFT")
	font:SetJustifyV("MIDDLE")
end

function SoundQueueUI:Initialize()
	self:InitDisplay()
	self:InitPortrait()
	self:InitMover()
	self:InitActions()

	self:RefreshConfig()
end

function SoundQueueUI:InitDisplay()
	self.frame = CreateFrame("Frame", "ZoneLoreQueueFrame", UIParent, "BackdropTemplate")
	function self.frame:Reset()
		self:SetWidth(PORTRAIT_SIZE + FRAME_WIDTH_WITHOUT_PORTRAIT)
		self:SetHeight(PORTRAIT_SIZE)
		self:ClearAllPoints()
		self:SetPoint("BOTTOM", 0, 200)
	end
	self.frame:Reset()
	self.frame:SetMovable(true)
	self.frame:SetResizable(true)
	self.frame:SetClampedToScreen(true)
	self.frame:SetUserPlaced(true)
	self.frame:SetFrameStrata(Addon.db.profile.SoundQueueUI.FrameStrata)

	self.frame.background = self.frame:CreateTexture(nil, "BACKGROUND")
	self.frame.background:SetPoint("RIGHT")
	self.frame.background:SetTexture(TEXTURES .. "BackgroundGradient")

	self.frame.resizer = CreateFrame("Button", nil, self.frame)
	self.frame.resizer:SetPoint("BOTTOMRIGHT")
	self.frame.resizer:SetSize(16, 16)
	self.frame.resizer:SetNormalTexture(TEXTURES .. "SizeGrabber-Up")
	self.frame.resizer:SetPushedTexture(TEXTURES .. "SizeGrabber-Down")
	self.frame.resizer:SetHighlightTexture(TEXTURES .. "SizeGrabber-Highlight")
	self.frame.resizer:HookScript("OnEnter", function() SetCursor([[Interface\Cursor\UI-Cursor-SizeRight]]) end)
	self.frame.resizer:HookScript("OnLeave", function() SetCursor(nil) end)
	self.frame.resizer:HookScript("OnMouseDown", function()
		self.frame.resizer:GetHighlightTexture():Hide()
		self.frame:StartSizing("BOTTOMRIGHT")
	end)
	self.frame.resizer:HookScript("OnMouseUp", function()
		self.frame.resizer:GetHighlightTexture():Show()
		self.frame:StopMovingOrSizing()
	end)

	self.frame.container = CreateFrame("Frame", nil, self.frame)
	self.frame.container:SetPoint("RIGHT", self.frame, "RIGHT", 0, ACTION_STRIP / 2)
	self.frame.container.buttons = {}
	function self.frame.container.buttons:Update()
		for _, button in ipairs(self) do
			button:Update()
		end
	end

	-- The zone. Redux puts the NPC's name here.
	self.frame.container.name = self.frame.container:CreateFontString(nil, "ARTWORK", "ZoneLoreQueueNameFont")
	self.frame.container.name:SetPoint("TOPLEFT")
	self.frame.container.name:SetWordWrap(false)
	self.frame.container.name:SetTextColor(214 / 255, 214 / 255, 214 / 255)
	function self.frame.container.name:Update()
		local containerWidth = self:GetParent():GetWidth()
		self:SetWidth(0)
		self:SetText(self:GetText())
		self:SetWidth(math.min(containerWidth, self:GetStringWidth() + 1))
	end

	self.frame:SetScript("OnSizeChanged", function()
		self.frame.container.name:Update()
		self.frame.container.buttons:Update()
	end)
end

function SoundQueueUI:InitPortrait()
	self.frame.portrait = CreateFrame("Frame", nil, self.frame)
	self.frame.portrait:SetPoint("TOPLEFT")
	self.frame.portrait:SetSize(PORTRAIT_SIZE, PORTRAIT_SIZE)

	self.frame.portrait.background = self.frame.portrait:CreateTexture(nil, "BACKGROUND")
	self.frame.portrait.background:SetAllPoints()
	self.frame.portrait.background:SetTexture(TEXTURES .. "PortraitFrameBackground")

	-- Redux shows this only when a creature model is missing or still loading. For
	-- lore it is the whole answer: a book being read aloud.
	self.frame.portrait.book = self.frame.portrait:CreateTexture(nil, "ARTWORK")
	self.frame.portrait.book:SetAllPoints()
	self.frame.portrait.book:SetTexture(TEXTURES .. "Book")
	self.frame.portrait.book:SetTexCoord(8 / 256, 248 / 256, 8 / 256, 248 / 256)

	-- The pause control covers the whole portrait, with a semi-transparent wash
	-- that only appears while paused.
	self.frame.portrait.pause = CreateFrame("Button", nil, self.frame.portrait)
	self.frame.portrait.pause:SetFrameLevel(self.frame.portrait:GetFrameLevel() + 1)
	self.frame.portrait.pause:SetAllPoints()
	self.frame.portrait.pause.background = self.frame.portrait.pause:CreateTexture(nil, "BACKGROUND")
	self.frame.portrait.pause.background:SetAllPoints()
	self.frame.portrait.pause.background:SetTexture(TEXTURES .. "PortraitFrameBackground")
	self.frame.portrait.pause.background:SetAlpha(0.75)
	self.frame.portrait.pause:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
	self.frame.portrait.pause:GetNormalTexture():ClearAllPoints()
	self.frame.portrait.pause:GetNormalTexture():SetPoint("CENTER")
	self.frame.portrait.pause:GetNormalTexture():SetSize(32, 32)
	self.frame.portrait.pause:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
	self.frame.portrait.pause:GetPushedTexture():ClearAllPoints()
	self.frame.portrait.pause:GetPushedTexture():SetPoint("CENTER")
	self.frame.portrait.pause:GetPushedTexture():SetSize(28, 28)
	function self.frame.portrait.pause:Update()
		local paused = SoundQueue:IsPaused()
		local left = paused and 0 or 93
		if paused and not SoundQueue:IsPlaying() then
			self.background:Show()
		else
			self.background:Hide()
		end
		self:GetNormalTexture():SetTexCoord(left / PORTRAIT_ATLAS_SIZE, (left + 93) / PORTRAIT_ATLAS_SIZE,
			419 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
		self:GetPushedTexture():SetTexCoord(left / PORTRAIT_ATLAS_SIZE, (left + 93) / PORTRAIT_ATLAS_SIZE,
			419 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
		self:GetNormalTexture():SetAlpha(MouseIsOver(self) and 1 or (paused and 0.75 or 0))
	end
	self.frame.portrait.pause:Update()
	self.frame.portrait.pause:HookScript("OnEnter", function(button)
		button:GetNormalTexture():SetAlpha(1)
		GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
		GameTooltip:SetText(SoundQueue:IsPaused() and L.PLAY or L.PAUSE)
		GameTooltip:AddLine(L.PAUSE_TOOLTIP, 1, 1, 1, true)
		GameTooltip:Show()
	end)
	self.frame.portrait.pause:HookScript("OnLeave", function(button)
		button:GetNormalTexture():SetAlpha(SoundQueue:IsPaused() and 0.75 or 0)
		GameTooltip_Hide()
	end)
	self.frame.portrait.pause:HookScript("OnClick", function()
		SoundQueue:TogglePauseQueue()
	end)

	-- A separate frame so the border and anything sitting on it (the mover) draw
	-- above everything in the portrait.
	self.frame.portrait.border = CreateFrame("Frame", nil, self.frame.portrait)
	self.frame.portrait.border:SetFrameLevel(self.frame.portrait.pause:GetFrameLevel() + 1)
	self.frame.portrait.border:SetAllPoints()
	self.frame.portrait.border.texture = self.frame.portrait.border:CreateTexture(nil, "BORDER")
	self.frame.portrait.border.texture:SetSize(PORTRAIT_BORDER_SIZE, PORTRAIT_BORDER_SIZE)
	self.frame.portrait.border.texture:SetPoint("TOPLEFT", -PORTRAIT_BORDER_OUTSET, PORTRAIT_BORDER_OUTSET)
	self.frame.portrait.border.texture:SetPoint("BOTTOMRIGHT", PORTRAIT_BORDER_OUTSET, -PORTRAIT_BORDER_OUTSET)
	self.frame.portrait.border.texture:SetTexture(TEXTURES .. "PortraitFrameAtlas")
	self.frame.portrait.border.texture:SetTexCoord(0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE,
		0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE)
end

function SoundQueueUI:InitMover()
	self.frame.mover = CreateFrame("Button", nil, self.frame.portrait.border)
	self.frame.mover:SetSize(26, 26)
	self.frame.mover:SetPoint("CENTER", self.frame.portrait.border, "BOTTOMLEFT", 5, 6)
	self.frame.mover:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
	self.frame.mover:GetNormalTexture():SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE,
		462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
	self.frame.mover:GetNormalTexture():ClearAllPoints()
	self.frame.mover:GetNormalTexture():SetPoint("CENTER")
	self.frame.mover:GetNormalTexture():SetSize(16, 16)
	self.frame.mover:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
	self.frame.mover:GetPushedTexture():SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE,
		462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
	self.frame.mover:GetPushedTexture():ClearAllPoints()
	self.frame.mover:GetPushedTexture():SetPoint("CENTER")
	self.frame.mover:GetPushedTexture():SetSize(14, 14)
	self.frame.mover.background = self.frame.mover:CreateTexture(nil, "BACKGROUND")
	self.frame.mover.background:SetTexture(TEXTURES .. "SettingsButton")
	self.frame.mover.background:SetPoint("CENTER")
	self.frame.mover.background:SetSize(32, 32)
	self.frame.mover:HookScript("OnEnter", function(button)
		if Addon.db.profile.SoundQueueUI.LockFrame then return end
		SetCursor([[Interface\Cursor\UI-Cursor-Move]])
		GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
		GameTooltip:SetText(L.QUEUE_TITLE)
		GameTooltip:AddLine(L.QUEUE_DRAG_HINT, 1, 1, 1, true)
		GameTooltip:Show()
	end)
	self.frame.mover:HookScript("OnLeave", function()
		SetCursor(nil)
		GameTooltip_Hide()
	end)
	self.frame.mover:HookScript("OnMouseDown", function()
		if Addon.db.profile.SoundQueueUI.LockFrame then return end
		self.frame:StartMoving()
	end)
	self.frame.mover:HookScript("OnMouseUp", function()
		if Addon.db.profile.SoundQueueUI.LockFrame then return end
		self.frame:StopMovingOrSizing()
	end)
end

-- Read and Report. Neither exists in Redux: a quest voiceover has no text to open
-- and no line to complain about that the website does not already know.
function SoundQueueUI:InitActions()
	-- Anchored to the frame rather than to the container: the container's height is
	-- recomputed every refresh to hug its text, so anything hung off its bottom edge
	-- sits on the last queue row.
	local read = CreateFrame("Button", nil, self.frame, "UIPanelButtonTemplate")
	read:SetSize(ACTION_WIDTH, ACTION_HEIGHT)
	read:SetPoint("BOTTOMLEFT", self.frame.portrait, "BOTTOMRIGHT", 15, 4)
	read:SetScript("OnClick", function()
		local mapID, areaKey = ZoneLore:GetNowPlaying()
		if not mapID then
			return
		end
		-- Opened before stopping: StopLore hides this frame, and reading the state
		-- after that would be reading it from under our own feet.
		ZoneLore:ShowLoreFor(mapID, areaKey)
		if ZoneLore:Get("stopAudioOnRead") then
			ZoneLore:StopLore()
		end
	end)
	read:SetScript("OnEnter", function(button)
		GameTooltip:SetOwner(button, "ANCHOR_LEFT")
		if ZoneLore:Get("stopAudioOnRead") then
			GameTooltip:SetText(L.READ_INSTEAD)
			GameTooltip:AddLine(L.READ_INSTEAD_TOOLTIP, 1, 1, 1, true)
		else
			GameTooltip:SetText(L.READ)
			GameTooltip:AddLine(L.READ_TOOLTIP, 1, 1, 1, true)
		end
		GameTooltip:AddLine(L.READ_SETTING_HINT, 0.7, 0.7, 0.7, true)
		GameTooltip:Show()
	end)
	read:SetScript("OnLeave", GameTooltip_Hide)
	function read:Update()
		self:SetText(ZoneLore:Get("stopAudioOnRead") and L.READ_INSTEAD or L.READ)
	end
	read:Update()
	self.frame.read = read

	local report = ZoneLore:CreateReportButton(self.frame)
	report:SetSize(ACTION_WIDTH, ACTION_HEIGHT)
	report:SetPoint("BOTTOMLEFT", read, "BOTTOMRIGHT", 4, 0)
	self.frame.report = report
end

function SoundQueueUI:RefreshConfig()
	-- SetResizeBounds replaced SetMinResize/SetMaxResize. Both exist in the wild
	-- across the clients this addon targets, so ask rather than assume.
	if self.frame.SetResizeBounds then
		self.frame:SetResizeBounds(PORTRAIT_SIZE + 100, PORTRAIT_SIZE, 10000, PORTRAIT_SIZE)
	elseif self.frame.SetMinResize then
		self.frame:SetMinResize(PORTRAIT_SIZE + 100, PORTRAIT_SIZE)
		self.frame:SetMaxResize(10000, PORTRAIT_SIZE)
	end

	self.frame.container:SetPoint("LEFT", self.frame.portrait, "RIGHT", 15, ACTION_STRIP / 2)
	self.frame.background:SetPoint("TOPLEFT", self.frame.portrait, "TOPRIGHT")
	self.frame.background:SetPoint("BOTTOMLEFT", self.frame.portrait, "BOTTOMRIGHT")

	self.frame.mover:SetShown(not Addon.db.profile.SoundQueueUI.LockFrame)
	self.frame.resizer:SetShown(not Addon.db.profile.SoundQueueUI.LockFrame)
	self.frame:SetScale(Addon.db.profile.SoundQueueUI.FrameScale)

	self:UpdateSoundQueueDisplay()
end

function SoundQueueUI:CreateButton(i)
	local button = CreateFrame("Button", nil, self.frame.container)
	self.frame.container.buttons[i] = button

	button:SetID(i)
	button:SetHeight(20)

	button.textWidget = button:CreateFontString(nil, "OVERLAY", "ZoneLoreQueueRowFont")
	button.textWidget:SetWordWrap(false)

	button.iconWidget = button:CreateTexture(nil, "ARTWORK")
	button.iconWidget:SetSize(16, 16)
	button.iconWidget:SetPoint("CENTER", button, "LEFT", 16 / 2, 0)

	function button:Configure(soundData)
		self.soundData = soundData
		self:Update()
	end
	function button:Update(pushed, hovered)
		if pushed == nil then pushed = self.pushed else self.pushed = pushed end
		if hovered == nil then hovered = self.hovered else self.hovered = hovered end
		local soundData = self.soundData
		if not soundData then
			self:Hide()
			return
		end
		self:Show()
		local isHead = soundData == SoundQueue:GetCurrentSound()
		local buttonIndex = self:GetID()

		if isHead then
			self:SetAlpha(1)
			self.textWidget:SetShadowColor(0, 0, 0, 1)
			self:SetPoint("TOPLEFT", SoundQueueUI.frame.container.name, "BOTTOMLEFT", 0, -2)
			self:EnableMouse(SoundQueue:CanBePaused())
		else
			local queuePosition = buttonIndex - 1
			local alpha = math.max(0.1, math.min(1, 1 - (queuePosition - 1) / 3))
			self:SetAlpha(alpha)
			self.textWidget:SetShadowColor(0, 0, 0, 0.5 + 0.5 * alpha)
			self:SetPoint("TOPLEFT",
				SoundQueueUI.frame.container.buttons[buttonIndex - 1] or SoundQueueUI.frame.container.name,
				"BOTTOMLEFT", 0, queuePosition == 1 and -8 or -2)
			self:EnableMouse(true)
		end

		-- A held clip says why. Without it, narration waiting out a pull looks
		-- exactly like narration that failed.
		local text = soundData.label
		local held = SoundQueue:GetHeldReason(soundData)
		if held then
			text = ("%s |cff888888(%s)|r"):format(text, held)
		end

		self.textWidget:ClearAllPoints()
		self.textWidget:SetPoint("LEFT", 16 + 5, 0)
		self.textWidget:SetText(text)
		self:SetWidth(math.min(self:GetParent():GetWidth(), 16 + 5 + self.textWidget:GetWidth() + 1))
		self.textWidget:SetPoint("RIGHT")

		if hovered then
			local r, g, b = 225 / 255, 20 / 255, 8 / 255
			if pushed then
				r, g, b = r * 0.75, g * 0.75, b * 0.75
			end
			self:SetAlpha(1)
			self.textWidget:SetTextColor(r, g, b)
			self.textWidget:SetShadowColor(0, 0, 0, 1)
			self.iconWidget:SetTexture(TEXTURES .. "SoundQueueBulletDelete")
			self.iconWidget:SetSize(14, 14)
		elseif isHead then
			self.textWidget:SetTextColor(245 / 255, 204 / 255, 24 / 255)
			self.iconWidget:SetTexture(TEXTURES .. "SoundQueueBulletQueue")
			self.iconWidget:SetSize(22, 22)
		else
			self.textWidget:SetTextColor(123 / 255, 147 / 255, 167 / 255)
			self.iconWidget:SetTexture(TEXTURES .. "SoundQueueBulletQueue")
			self.iconWidget:SetSize(22, 22)
		end
	end

	button:HookScript("OnClick", function(self) SoundQueue:RemoveSoundFromQueue(self.soundData) end)
	button:HookScript("OnMouseDown", function(self) self:Update(true) end)
	button:HookScript("OnMouseUp", function(self) self:Update(false) end)
	button:HookScript("OnEnter", function(self)
		self:Update(nil, true)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(L.QUEUE_REMOVE_TOOLTIP)
		GameTooltip:Show()
	end)
	button:HookScript("OnLeave", function(self)
		self:Update(nil, false)
		GameTooltip_Hide()
	end)
	button:Update()

	return button
end

function SoundQueueUI:UpdateSoundQueueDisplay()
	self.frame:SetShown(ZoneLore:Get("showQueueUI")
		and not Addon.db.profile.SoundQueueUI.HideFrame
		and not SoundQueue:IsEmpty())
	if not self.frame:IsShown() then
		return
	end

	self:UpdatePauseDisplay()

	self.frame.container:SetHeight(self.frame:GetHeight())
	local lastButtonIndex = 0
	local lastContent = self.frame.container.name
	for i, soundData in ipairs(SoundQueue.sounds) do
		if i == 1 then
			-- The zone above, the area being narrated below -- which for zone-level
			-- lore is the same name twice, and for a subzone is the pair a player
			-- needs to place it.
			self.frame.container.name:SetText(ZoneLore:GetMapName(soundData.mapID) or soundData.label)
		end
		lastButtonIndex = lastButtonIndex + 1
		local button = self.frame.container.buttons[lastButtonIndex] or self:CreateButton(lastButtonIndex)
		button:Configure(soundData)
		lastContent = button
		if lastButtonIndex == MAX_ROWS then
			break
		end
	end
	for i = lastButtonIndex + 1, getn(self.frame.container.buttons) do
		self.frame.container.buttons[i]:Configure(nil)
	end

	self.frame.container.name:Update()
	self.frame.read:Update()
	local mapID, areaKey = ZoneLore:GetNowPlaying()
	self.frame.report:SetTarget(mapID, areaKey)
	self.frame.read:SetShown(mapID ~= nil)

	-- Align the container vertically to the middle.
	local contentTop = self.frame.container.name:GetTop() or 0
	local contentBottom = lastContent:GetBottom() or 0
	self.frame.container:SetHeight(contentTop - contentBottom)

	-- Again once the layout has settled: truncation and hover state both depend on
	-- where the rows ended up.
	Addon:ScheduleTimer(function()
		self.frame.container.buttons:Update()
		self.frame.container.name:Update()
	end, 0)
end

function SoundQueueUI:UpdatePauseDisplay()
	self.frame.portrait.pause:Update()
end

function ZoneLore:SetupSoundQueueUI()
	SoundQueueUI:Initialize()
	self:OnAudioChanged(function()
		SoundQueueUI:UpdateSoundQueueDisplay()
	end)
end

-- The player is placed by the client (SetUserPlaced), so recovering one dragged
-- off-screen means asking the frame to lay itself out again rather than clearing a
-- saved coordinate.
function ZoneLore:ResetPlayerPosition()
	SoundQueueUI.frame:Reset()
end

function ZoneLore:RefreshSoundQueueUI()
	SoundQueueUI:RefreshConfig()
end
