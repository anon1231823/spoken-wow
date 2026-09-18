-- The Play/Stop button on the client's book frame.
--
-- What a reader reaches for when autoplay is off, or when read-once has already counted this
-- book: the addon's two settings both mean "do not start by yourself", and neither should
-- mean "give me no way to start it".
--
-- A TEXT button, not an icon, for the reason UI/AudioButton.lua gives on the zones side: an
-- icon path cannot be verified without launching the client, and a texture that does not
-- exist on 11509 draws nothing at all -- an invisible button is a worse failure than a plain
-- one. SpokenPlayer carries QuestLogPlayButton.blp, but it is that addon's file and this one
-- must work with the player absent.
--
-- ANCHORED OUTSIDE THE FRAME, off its top-right corner. The inside of ItemTextFrame is
-- Blizzard's: the page buttons sit along the bottom, the close button in the corner, and the
-- material -- Parchment, Stone, Bronze, Marble, Silver -- changes the art behind all of it.
-- Which interior spot is free cannot be settled without opening one book of every material
-- in three clients, while just outside the edge cannot collide with any of them.

local ADDON_NAME, SpokenBooks = ...

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 22

--- Show, hide and re-label the button for whatever is on screen now.
---
--- Hidden rather than disabled when there is nothing to play. A greyed-out button on every
--- letter and every page this corpus does not carry is a permanent invitation to wonder what
--- is broken; an absent one says the addon has nothing to offer here.
function SpokenBooks:RefreshPlayButton()
	local button = self.playButton
	if not button then
		return
	end

	local pageId = self:PageOnScreen()
	if not pageId or not self:HasAudio(pageId) then
		button:Hide()
		return
	end

	button:Show()

	local book = self:PlaceOf(pageId)
	if self:IsNarrating(book) then
		button:SetText("Stop")
	else
		button:SetText("Play")
	end
end

--- Build the button, once, as soon as the client has a book frame to hang it on.
---
--- Called on every page as well as at login: ItemTextFrame is FrameXML on all three targets
--- and should exist by then, but a client that builds it later still gets its button rather
--- than going without for the session.
function SpokenBooks:SetupPlayButton()
	if self.playButton then
		return self.playButton
	end

	local frame = _G.ItemTextFrame
	if not frame or not CreateFrame then
		return nil
	end

	local button = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
	button:SetWidth(BUTTON_WIDTH)
	button:SetHeight(BUTTON_HEIGHT)
	button:SetPoint("TOPLEFT", frame, "TOPRIGHT", -2, -28)
	button:SetText("Play")
	button:Hide()

	button:SetScript("OnClick", function()
		local pageId = SpokenBooks:PageOnScreen()
		if pageId and SpokenBooks:IsNarrating(SpokenBooks:PlaceOf(pageId)) then
			SpokenBooks:StopReading()
		else
			-- The same call `/spb read` makes, so a page with no clip explains itself here
			-- exactly as it does in the chat frame.
			SpokenBooks:ReadOrExplain()
		end
		SpokenBooks:RefreshPlayButton()
	end)

	button:SetScript("OnEnter", function(self)
		if not GameTooltip then
			return
		end
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		if self:GetText() == "Stop" then
			GameTooltip:SetText("Stop reading this book")
		else
			GameTooltip:SetText("Read this book aloud")
		end
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		if GameTooltip then
			GameTooltip:Hide()
		end
	end)

	self.playButton = button
	return button
end
