-- ZoneLore -- the play/stop button shown next to a lore description.
--
-- A factory in the same shape as ZoneLore:CreateTextView: anchor the returned
-- button yourself, then call SetTarget whenever the panel's content changes.
--
-- Deliberately a text button rather than an icon. Icon paths cannot be verified
-- without launching the client, and a texture that does not exist on 11509 draws
-- nothing at all -- an invisible button is a worse failure than a plain one. This
-- is the same trade the hand-rolled scrollbar in UI/TextView.lua makes.

local ADDON_NAME, ZoneLore = ...

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 20

local AudioButton = {}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

-- nil areaKey means the zone itself. Passing a nil mapID parks the button: it
-- has nothing to play, so it hides.
function AudioButton:SetTarget(mapID, areaKey)
	self.mapID = mapID
	self.areaKey = areaKey
	self:Refresh()
end

function AudioButton:Refresh()
	if not ZoneLore:IsVoiceEnabled() or not self.mapID then
		self:Hide()
		return
	end

	if not ZoneLore:HasAudio(self.mapID, self.areaKey) then
		self:Hide()
		return
	end

	self:Show()

	if ZoneLore:IsPlayingLore(self.mapID, self.areaKey) then
		self:SetText("Stop")
	else
		self:SetText("Play")
	end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

function ZoneLore:CreateAudioButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	button:SetText("Play")
	button:Hide()

	button.SetTarget = AudioButton.SetTarget
	button.Refresh = AudioButton.Refresh

	button:SetScript("OnClick", function(self)
		if not self.mapID then
			return
		end
		ZoneLore:ToggleLore(self.mapID, self.areaKey)
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		if ZoneLore:IsPlayingLore(self.mapID, self.areaKey) then
			GameTooltip:SetText("Stop the narration")
		else
			GameTooltip:SetText("Read this lore aloud")
		end
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	-- Both panels can show the same entry at once, and either can start playback,
	-- so every button re-reads the shared state rather than tracking its own.
	ZoneLore:OnAudioChanged(function()
		button:Refresh()
	end)

	return button
end
