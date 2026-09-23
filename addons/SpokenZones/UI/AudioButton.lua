-- SpokenZones -- the play/stop button shown next to a lore description.
--
-- A factory in the same shape as SpokenZones:CreateTextView: anchor the returned
-- button yourself, then call SetTarget whenever the panel's content changes.
--
-- Deliberately a text button rather than an icon. Icon paths cannot be verified
-- without launching the client, and a texture that does not exist on 11509 draws
-- nothing at all -- an invisible button is a worse failure than a plain one. This
-- is the same trade the hand-rolled scrollbar in UI/TextView.lua makes.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 20

local AudioButton = {}

-- Room the button's end caps take either side of its label.
local LABEL_PADDING = 24

--- Widen a text button to fit the widest label it will ever show, never below minWidth.
--- Measured once over every label rather than on each SetText, so a button that flips
--- between Play and Stop keeps one width instead of jumping as it changes. The widths
--- above were sized to the English labels; a translated one can be twice as long.
function SpokenZones:FitButtonToLabels(button, minWidth, labels)
	local widest = 0
	for _, label in ipairs(labels) do
		button:SetText(label)
		widest = math.max(widest, button:GetTextWidth())
	end
	button:SetWidth(math.max(minWidth, widest + LABEL_PADDING))
end

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
	if not SpokenZones:IsVoiceEnabled() or not self.mapID then
		self:Hide()
		return
	end

	if not SpokenZones:HasAudio(self.mapID, self.areaKey) then
		self:Hide()
		return
	end

	self:Show()

	if SpokenZones:IsPlayingLore(self.mapID, self.areaKey) then
		self:SetText(L.STOP)
	else
		self:SetText(L.PLAY)
	end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

function SpokenZones:CreateAudioButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetHeight(BUTTON_HEIGHT)
	SpokenZones:FitButtonToLabels(button, BUTTON_WIDTH, { L.PLAY, L.STOP })
	button:SetText(L.PLAY)
	button:Hide()

	button.SetTarget = AudioButton.SetTarget
	button.Refresh = AudioButton.Refresh

	button:SetScript("OnClick", function(self)
		if not self.mapID then
			return
		end
		SpokenZones:ToggleLore(self.mapID, self.areaKey)
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		if SpokenZones:IsPlayingLore(self.mapID, self.areaKey) then
			GameTooltip:SetText(L.AUDIO_STOP_TIP)
		else
			GameTooltip:SetText(L.AUDIO_READ_TIP)
		end
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	-- Both panels can show the same entry at once, and either can start playback,
	-- so every button re-reads the shared state rather than tracking its own.
	SpokenZones:OnAudioChanged(function()
		button:Refresh()
	end)

	return button
end
