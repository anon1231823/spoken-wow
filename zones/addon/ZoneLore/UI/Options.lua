-- ZoneLore -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, which exists on 11509
-- (Leatrix_Maps, Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use
-- it). InterfaceOptions_AddCategory is the legacy-only path and is not used.
--
-- Widget templates are picked from what addons already running on this client
-- use: UICheckButtonTemplate (Syndicator/Options) and UISliderTemplate
-- (Syndicator/Options, Leatrix_Maps, Leatrix_Plus).

local ADDON_NAME, ZoneLore = ...

local INDENT = 20
local ROW_GAP = -28

local panel, category

--------------------------------------------------------------------------------
-- Widgets
--------------------------------------------------------------------------------

local function MakeHeading(parent, text, x, y, template)
	local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontNormalLarge")
	fs:SetPoint("TOPLEFT", x, y)
	fs:SetJustifyH("LEFT")
	fs:SetText(text)
	return fs
end

local function MakeNote(parent, text, x, y, width)
	local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	fs:SetPoint("TOPLEFT", x, y)
	fs:SetWidth(width or 520)
	fs:SetJustifyH("LEFT")
	fs:SetWordWrap(true)
	fs:SetText(text)
	return fs
end

-- `apply` runs after the option is written, for anything that needs redrawing.
local function MakeCheckbox(parent, key, label, tooltip, x, y, apply)
	local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
	box:SetPoint("TOPLEFT", x, y)

	box.text = box:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	box.text:SetPoint("LEFT", box, "RIGHT", 2, 0)
	box.text:SetJustifyH("LEFT")
	box.text:SetText(label)

	box:SetScript("OnShow", function(self)
		self:SetChecked(ZoneLore:Get(key) and true or false)
	end)
	box:SetScript("OnClick", function(self)
		ZoneLore:Set(key, self:GetChecked() and true or false)
		if apply then
			apply()
		end
	end)

	if tooltip then
		box:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
			GameTooltip:SetText(label, 1, 0.82, 0)
			GameTooltip:AddLine(tooltip, 1, 1, 1, true)
			GameTooltip:Show()
		end)
		box:SetScript("OnLeave", GameTooltip_Hide)
	end

	box:SetChecked(ZoneLore:Get(key) and true or false)
	return box
end

local function MakeSlider(parent, key, label, minValue, maxValue, step, x, y, apply)
	local slider = CreateFrame("Slider", nil, parent, "UISliderTemplate")
	slider:SetPoint("TOPLEFT", x, y)
	slider:SetWidth(220)
	slider:SetHeight(16)
	slider:SetOrientation("HORIZONTAL")
	slider:SetMinMaxValues(minValue, maxValue)
	slider:SetValueStep(step)
	if slider.SetObeyStepOnDrag then
		slider:SetObeyStepOnDrag(true)
	end

	local caption = slider:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("BOTTOMLEFT", slider, "TOPLEFT", 0, 4)
	caption:SetJustifyH("LEFT")

	local function Relabel(value)
		caption:SetText(label .. ": " .. tostring(math.floor(value + 0.5)))
	end

	slider:SetScript("OnValueChanged", function(self, value)
		value = math.floor(value + 0.5)
		Relabel(value)
		if ZoneLore:Get(key) ~= value then
			ZoneLore:Set(key, value)
			if apply then
				apply()
			end
		end
	end)

	slider:SetScript("OnShow", function(self)
		local value = ZoneLore:Get(key)
		self:SetValue(value)
		Relabel(value)
	end)

	local value = ZoneLore:Get(key)
	slider:SetValue(value)
	Relabel(value)
	return slider
end

--------------------------------------------------------------------------------
-- Apply helpers
--------------------------------------------------------------------------------

local function RedrawPanel()
	if ZoneLore.ApplyPanelOptions then
		ZoneLore:ApplyPanelOptions()
	end
end

local function RedrawEverything()
	RedrawPanel()
	if ZoneLore.RefreshLoreWindow then
		ZoneLore:RefreshLoreWindow()
	end
end

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function ZoneLore:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		ZoneLore:Print("|cffffcc00Settings API missing; options panel unavailable (use /zl help)|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "ZoneLore"

	MakeHeading(panel, "ZoneLore", INDENT, -16)
	MakeNote(
		panel,
		"Lore for zones and subzones on the world map and minimap. Text from "
			.. "warcraft.wiki.gg, CC BY-SA 4.0.",
		INDENT,
		-42
	)

	local y = -80
	MakeHeading(panel, "World map", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(panel, "showMapPanel", "Show the lore panel beside the map",
		"The panel is hidden while the map is maximised, since it would sit off-screen.",
		INDENT, y, RedrawPanel)

	y = y + ROW_GAP
	MakeCheckbox(panel, "showHoverPreview", "Show a lore tooltip on hover",
		"Hover a zone on a continent map, or a subzone on a zone map. Suppressed while "
			.. "the cursor is over a map pin.",
		INDENT, y, nil)

	y = y + ROW_GAP - 8
	-- Stored as a string ("LEFT"/"RIGHT") rather than a boolean, so this checkbox
	-- cannot use MakeCheckbox's Get/Set path directly.
	local sideBox = CreateFrame("CheckButton", nil, panel, "UICheckButtonTemplate")
	sideBox:SetPoint("TOPLEFT", INDENT, y)
	sideBox.text = sideBox:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	sideBox.text:SetPoint("LEFT", sideBox, "RIGHT", 2, 0)
	sideBox.text:SetText("Put the panel on the left of the map")
	local function SyncSide(self)
		self:SetChecked(ZoneLore:Get("panelSide") == "LEFT")
	end
	sideBox:SetScript("OnShow", SyncSide)
	sideBox:SetScript("OnClick", function(self)
		ZoneLore:Set("panelSide", self:GetChecked() and "LEFT" or "RIGHT")
		RedrawPanel()
	end)
	SyncSide(sideBox)

	y = y + ROW_GAP - 24
	MakeSlider(panel, "panelWidth", "Panel width", 220, 520, 10, INDENT + 4, y, RedrawPanel)

	y = y + ROW_GAP - 24
	MakeSlider(panel, "fontSize", "Font size", 9, 20, 1, INDENT + 4, y, RedrawEverything)

	y = y + ROW_GAP - 28
	MakeHeading(panel, "Minimap", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(panel, "showMinimapButton", "Show the minimap button",
		"Left-click opens the lore window, right-click toggles the map panel.",
		INDENT, y, function()
			-- The checkbox has already written the option, so sync rather than
			-- toggle; ApplyMinimapButton also keeps `hide` in step for LibDBIcon.
			if ZoneLore.ApplyMinimapButton then
				ZoneLore:ApplyMinimapButton()
			end
		end)

	y = y + ROW_GAP - 28
	MakeHeading(panel, "Narration", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(panel, "voiceEnabled", "Show the Play button on lore descriptions",
		"Reads the lore aloud. Needs the ZoneLoreAudio companion addon; without it "
			.. "the button plays a placeholder.",
		INDENT, y, function()
			ZoneLore:StopLore()
			ZoneLore:NotifyAudioChanged()
		end)

	y = y + ROW_GAP
	MakeCheckbox(panel, "autoplay", "Narrate new areas as you explore them",
		"Plays a zone or subzone's lore the first time this character enters it. "
			.. "New areas queue behind whatever is already playing rather than "
			.. "interrupting it. /zl forget clears the list.",
		INDENT, y, function()
			if not ZoneLore:Get("autoplay") then
				ZoneLore:StopLore()
			end
		end)

	y = y + ROW_GAP
	MakeCheckbox(panel, "showPlaybackBar", "Show playback controls while narrating",
		"A small movable Pause/Stop widget below the minimap, so narration can be "
			.. "stopped without reopening the map. It appears only while a clip is "
			.. "playing. Drag it to move it; /zl bar puts it back.",
		INDENT, y, function()
			if ZoneLore.RefreshPlaybackBar then
				ZoneLore:RefreshPlaybackBar()
			end
		end)

	y = y + ROW_GAP - 6
	-- A cycle button rather than a dropdown. UIDropDownMenuTemplate works on 11509
	-- but none of its Initialize plumbing can be checked without launching the
	-- game, and five values do not justify the risk -- the same trade the
	-- hand-rolled scrollbar in UI/TextView.lua makes.
	local CHANNEL_ORDER = { "Dialog", "Master", "SFX", "Ambience", "Music" }
	local channelButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
	channelButton:SetPoint("TOPLEFT", INDENT + 4, y)
	channelButton:SetSize(220, 22)

	local function SyncChannel()
		channelButton:SetText("Sound channel: " .. ZoneLore:GetVoiceChannel())
	end

	channelButton:SetScript("OnClick", function()
		local currentChannel = ZoneLore:GetVoiceChannel()
		local index = 1
		for i = 1, #CHANNEL_ORDER do
			if CHANNEL_ORDER[i] == currentChannel then
				index = i
				break
			end
		end
		ZoneLore:Set("voiceChannel", CHANNEL_ORDER[(index % #CHANNEL_ORDER) + 1])
		-- The handle belongs to the old channel, so a running clip cannot be moved.
		ZoneLore:StopLore()
		SyncChannel()
	end)
	channelButton:SetScript("OnShow", SyncChannel)
	SyncChannel()

	y = y + ROW_GAP - 4
	MakeNote(panel, "Dialog follows the Dialog volume slider in the game's sound options.",
		INDENT + 4, y)

	y = y + ROW_GAP - 20
	MakeHeading(panel, "Troubleshooting", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(panel, "debug", "Report area names when clicking the map",
		"Prints the raw area name the client reports, the key it normalises to, and "
			.. "whether lore was found. Use this to spot a subzone needing an alias.",
		INDENT, y, nil)

	category = Settings.RegisterCanvasLayoutCategory(panel, "ZoneLore")
	Settings.RegisterAddOnCategory(category)

	ZoneLore.optionsPanel = panel
	ZoneLore.optionsCategory = category
end

function ZoneLore:OpenOptions()
	if not category or not (Settings and Settings.OpenToCategory) then
		ZoneLore:Print("open Game Menu -> Options -> AddOns -> ZoneLore")
		return
	end

	-- OpenToCategory takes an ID in some builds and the category object in others,
	-- so try the ID first and fall back rather than erroring.
	local id = category.GetID and category:GetID() or nil
	local ok = id and pcall(Settings.OpenToCategory, id)
	if not ok then
		ok = pcall(Settings.OpenToCategory, category)
	end
	if not ok then
		ZoneLore:Print("open Game Menu -> Options -> AddOns -> ZoneLore")
	end
end
