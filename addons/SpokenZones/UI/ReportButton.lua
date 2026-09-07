-- ZoneLore -- the "Report" button shown beside a lore description.
--
-- A factory in the same shape as ZoneLore:CreateAudioButton: anchor the returned
-- button yourself, then call SetTarget whenever the panel's content changes.
-- Text rather than an icon, for the reason UI/AudioButton.lua gives.
--
-- Unlike the play button it does not care whether the line has audio. Play hides
-- with no clip because there is nothing to play; lore text can be wrong whether
-- or not anyone has read it aloud, and a report on a line with no voiceover is
-- one of the more useful kinds.

local ADDON_NAME, ZoneLore = ...

local BUTTON_WIDTH = 58
local BUTTON_HEIGHT = 20

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

function ZoneLore:CreateReportButton(parent)
	local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
	button:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
	button:SetText("Report")
	button:Hide()

	button.SetTarget = ReportButton.SetTarget
	button.Refresh = ReportButton.Refresh

	button:SetScript("OnClick", function(self)
		local url = ZoneLore:ReportURL(self.mapID, self.areaKey)
		if not url then
			return
		end
		ZoneLore:ShowCopyLink(url, "Copy this address and open it in your browser to report a problem with this entry.")
	end)

	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		GameTooltip:SetText("Report a problem")
		GameTooltip:AddLine("Wrong lore, a bad reading, a mispronounced name -- this gives you a link to say so.", 1, 0.8, 0.2, true)
		GameTooltip:Show()
	end)

	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)

	return button
end
