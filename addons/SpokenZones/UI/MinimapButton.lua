-- ZoneLore -- minimap button, via LibDataBroker + LibDBIcon.
--
-- LibDBIcon owns two keys inside ZoneLoreDB: `hide` and `minimapPos`. They are
-- deliberately not in Core.lua's defaults table, because the library writes them
-- itself and a default would fight it -- except for seeding minimapPos once, so
-- the button starts somewhere sensible instead of at angle 0.

local ADDON_NAME, ZoneLore = ...

local ICON = "Interface\\ICONS\\INV_Misc_Book_09"

local dataObject, icon

local function OnClick(_, button)
	if button == "RightButton" then
		ZoneLore:OpenOptions()
	else
		ZoneLore:ToggleLoreWindow()
	end
end

local function OnTooltipShow(tooltip)
	if not tooltip or not tooltip.AddLine then
		return
	end
	tooltip:AddLine("ZoneLore")

	-- Show lore for where the player is standing, which is the whole point of a
	-- minimap entry point.
	local mapID = ZoneLore:GetPlayerMapID()
	local zoneName = ZoneLore:GetMapName(mapID)
	if zoneName then
		tooltip:AddLine(zoneName, 1, 0.82, 0)
	end

	local subZone = GetSubZoneText()
	if subZone and subZone ~= "" and subZone ~= zoneName then
		local entry = ZoneLore:GetSubzoneLore(mapID, subZone)
		tooltip:AddLine(subZone .. (entry and "" or " |cff777777(no lore)|r"), 0.8, 0.8, 0.8)
		if entry and entry.short then
			tooltip:AddLine(entry.short, 1, 1, 1, true)
		end
	else
		local entry = ZoneLore:GetLore(mapID)
		if entry and entry.short then
			tooltip:AddLine(entry.short, 1, 1, 1, true)
		end
	end

	tooltip:AddLine(" ")
	tooltip:AddLine("|cff66bbffLeft-click|r open the lore window", 0.7, 0.7, 0.7)
	tooltip:AddLine("|cff66bbffRight-click|r open settings", 0.7, 0.7, 0.7)
end

function ZoneLore:SetupMinimapButton()
	-- With the Spoken player installed there is one button for every Spoken addon,
	-- and this addon's entries on it are added in Audio.lua. A button of our own
	-- would be the second icon the shared player exists to prevent.
	if _G.Spoken then
		return
	end

	local ldb = LibStub and LibStub:GetLibrary("LibDataBroker-1.1", true)
	local dbicon = LibStub and LibStub:GetLibrary("LibDBIcon-1.0", true)
	if not ldb or not dbicon then
		ZoneLore:Print("|cffffcc00LibDataBroker/LibDBIcon missing; minimap button disabled|r")
		return
	end

	-- Seed the position once so the button does not default to angle 0, where it
	-- can sit under other addons' buttons.
	if ZoneLoreDB.minimapPos == nil then
		ZoneLoreDB.minimapPos = 204
	end
	-- Mirror our own option onto the key LibDBIcon reads.
	ZoneLoreDB.hide = not ZoneLore:Get("showMinimapButton")

	dataObject = ldb:NewDataObject("ZoneLore", {
		type = "data source",
		text = "ZoneLore",
		icon = ICON,
		OnClick = OnClick,
		OnTooltipShow = OnTooltipShow,
	})

	icon = dbicon
	icon:Register("ZoneLore", dataObject, ZoneLoreDB)

	ZoneLore:ApplyMinimapButton()
end

-- Bring the button in line with the showMinimapButton option. Idempotent, so
-- callers that have already written the option (the options panel) use this
-- rather than the toggle.
function ZoneLore:ApplyMinimapButton()
	local enabled = ZoneLore:Get("showMinimapButton") and true or false
	ZoneLoreDB.hide = not enabled
	if icon then
		if enabled then
			icon:Show("ZoneLore")
		else
			icon:Hide("ZoneLore")
		end
	end
	return enabled
end

function ZoneLore:ToggleMinimapButton()
	ZoneLore:Set("showMinimapButton", not ZoneLore:Get("showMinimapButton"))
	return ZoneLore:ApplyMinimapButton()
end
