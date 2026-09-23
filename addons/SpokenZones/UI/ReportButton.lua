-- SpokenZones -- the "Report" button shown beside a lore description.
--
-- A factory in the same shape as SpokenZones:CreateAudioButton: anchor the returned
-- button yourself, then call SetTarget whenever the panel's content changes.
-- Text rather than an icon, for the reason UI/AudioButton.lua gives.
--
-- Unlike the play button it does not care whether the line has audio. Play hides
-- with no clip because there is nothing to play; lore text can be wrong whether
-- or not anyone has read it aloud, and a report on a line with no voiceover is
-- one of the more useful kinds.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 20
local CONTRIBUTE_WIDTH = 100

local ReportButton = {}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

-- nil areaKey means the zone itself. Passing a nil mapID parks the button: there
-- is nothing to report against, so it hides.
function ReportButton:SetTarget(mapID, areaKey)
	self.mapID = mapID
	self.areaKey = areaKey
	self:Refresh()
end

function ReportButton:Refresh()
	if self.mapID then
		self:Show()
	else
		self:Hide()
	end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

function SpokenZones:CreateReportButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	button:SetText(L.REPORT_BUTTON)
	button:Hide()

	button.SetTarget = ReportButton.SetTarget
	button.Refresh = ReportButton.Refresh

	button:SetScript("OnClick", function(self)
		local url = SpokenZones:ReportURL(self.mapID, self.areaKey)
		if not url then
			return
		end
		SpokenZones:ShowCopyLink(url, L.OPT_REPORT_LINE_ADDRESS)
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		GameTooltip:SetText(L.OPT_REPORT_PROBLEM)
		GameTooltip:AddLine(L.OPT_REPORT_LINE_TIP, 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	return button
end

--------------------------------------------------------------------------------
-- The "no lore here" button
--------------------------------------------------------------------------------

-- The Contribute button, in the panel's body under "nobody has written its lore yet" rather
-- than on the footer: every place is already known, and what is missing is the lore itself,
-- so the offer belongs beside the words that say so. Pointed at a place with SetTarget; hidden
-- with no target, or where this client cannot contribute (SpokenZones:CanContribute).
function SpokenZones:CreateContributeButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetSize(CONTRIBUTE_WIDTH, BUTTON_HEIGHT + 2)
	button:SetText(L.CONTRIBUTE_BUTTON)
	button:Hide()

	button:SetScript("OnClick", function(self)
		SpokenZones:ShowContribution(self.mapID, self.subzone)
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(L.CONTRIBUTE_BUTTON_TIP_TITLE)
		GameTooltip:AddLine(L.CONTRIBUTE_BUTTON_TIP, 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	function button:SetTarget(mapID, subzone)
		self.mapID, self.subzone = mapID, subzone
		if mapID and SpokenZones:CanContribute() then
			self:Show()
		else
			self:Hide()
		end
	end

	return button
end
