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

	-- Everything below is laid out in `content`, not in `panel`. The settings canvas
	-- is a fixed size and neither scrolls nor clips what overflows it, so a panel
	-- with more rows than fit draws them over the game world. See UI/Scroller.lua.
	local scroller = ZoneLore:CreateScroller(panel)
	local content = scroller.child

	MakeHeading(content, "ZoneLore", INDENT, -16)
	MakeNote(
		content,
		"Lore for zones and subzones on the world map and minimap. Text from "
			.. "warcraft.wiki.gg, CC BY-SA 4.0.",
		INDENT,
		-42
	)

	local y = -80
	MakeHeading(content, "World map", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(content, "showMapPanel", "Show the lore panel beside the map",
		"The panel is hidden while the map is maximised, since it would sit off-screen.",
		INDENT, y, RedrawPanel)

	y = y + ROW_GAP
	MakeCheckbox(content, "showHoverPreview", "Show a lore tooltip on hover",
		"Hover a zone on a continent map, or a subzone on a zone map. Suppressed while "
			.. "the cursor is over a map pin.",
		INDENT, y, nil)

	y = y + ROW_GAP - 8
	-- Stored as a string ("LEFT"/"RIGHT") rather than a boolean, so this checkbox
	-- cannot use MakeCheckbox's Get/Set path directly.
	local sideBox = CreateFrame("CheckButton", nil, content, "UICheckButtonTemplate")
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
	MakeSlider(content, "panelWidth", "Panel width", 220, 520, 10, INDENT + 4, y, RedrawPanel)

	y = y + ROW_GAP - 24
	MakeSlider(content, "fontSize", "Font size", 9, 20, 1, INDENT + 4, y, RedrawEverything)

	y = y + ROW_GAP - 28
	MakeHeading(content, "Minimap", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(content, "showMinimapButton", "Show the minimap button",
		"Left-click opens the lore window, right-click opens these settings.",
		INDENT, y, function()
			-- The checkbox has already written the option, so sync rather than
			-- toggle; ApplyMinimapButton also keeps `hide` in step for LibDBIcon.
			if ZoneLore.ApplyMinimapButton then
				ZoneLore:ApplyMinimapButton()
			end
		end)

	y = y + ROW_GAP - 28
	MakeHeading(content, "Narration", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(content, "voiceEnabled", "Show the Play button on lore descriptions",
		"Reads the lore aloud. Needs the ZoneLoreAudio companion addon; without it "
			.. "the button does not appear.",
		INDENT, y, function()
			ZoneLore:StopLore()
			ZoneLore:NotifyAudioChanged()
		end)

	y = y + ROW_GAP
	MakeCheckbox(content, "autoplay", "Narrate a zone when you discover it",
		"Triggered by the game's own discovery -- the moment it prints "
			.. "\"Discovered Durotar\". Fires once per character, because that is "
			.. "when the game fires it.",
		INDENT, y, function()
			if not ZoneLore:Get("autoplay") then
				ZoneLore:StopLore()
			end
		end)

	y = y + ROW_GAP
	MakeCheckbox(content, "autoplaySubzones", "Also narrate subzones you discover",
		"Most discoveries are subzones -- a walk across Elwynn sets off several. "
			.. "They queue rather than interrupt, so untick this only if the "
			.. "narration feels constant.",
		INDENT + INDENT, y, nil)

	y = y + ROW_GAP
	MakeCheckbox(content, "autoplayExplored", "Also narrate areas you explored before installing",
		"The game announces a discovery once per character, ever -- so a character "
			.. "who already explored Azeroth is never narrated anything. Tick this "
			.. "and ZoneLore keeps its own record instead, still one clip per area "
			.. "per character. /zl forget clears it.",
		INDENT + INDENT, y, nil)

	y = y + ROW_GAP
	MakeCheckbox(content, "showPlaybackBar", "Show playback controls while narrating",
		"A small movable Pause/Stop widget below the minimap, so narration can be "
			.. "stopped without reopening the map. It appears only while a clip is "
			.. "playing. Drag it to move it; /zl bar puts it back.",
		INDENT, y, function()
			if ZoneLore.RefreshPlaybackBar then
				ZoneLore:RefreshPlaybackBar()
			end
		end)

	y = y + ROW_GAP
	MakeCheckbox(content, "stopAudioOnRead", "Stop narrating when you open the text",
		"The Read button on those controls opens the lore window on whatever is "
			.. "playing. Ticked, it stops the narration too -- and discards anything "
			.. "queued behind it -- so the button reads \"Read instead\". Unticked, "
			.. "you read along.",
		INDENT + INDENT, y, function()
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
	local channelButton = CreateFrame("Button", nil, content, "UIPanelButtonTemplate")
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
	MakeNote(content, "Dialog follows the Dialog volume slider in the game's sound options.",
		INDENT + 4, y)

	y = y + ROW_GAP - 4
	-- Same cycle-button trade as the channel above. The list it cycles through is
	-- whatever is installed, so it is built on click rather than captured here:
	-- packs cannot be installed mid-session, but a player who disables one in the
	-- AddOns list and reloads should not find this button offering it.
	local packButton = CreateFrame("Button", nil, content, "UIPanelButtonTemplate")
	packButton:SetPoint("TOPLEFT", INDENT + 4, y)
	packButton:SetSize(220, 22)

	local packNote = MakeNote(content, "", INDENT + 4, y - 26)

	local function SyncPack()
		local packs = ZoneLore:GetAudioPacks()
		local active = ZoneLore:GetActiveAudioPack()

		if #packs == 0 then
			packButton:SetText("No sound pack installed")
			packButton:Disable()
			packNote:SetText("Nothing is narrated. Install ZoneLoreAudio or "
				.. "ZoneLoreAudio64 to hear the lore read aloud.")
			return
		end

		packButton:SetText("Sound pack: " .. ZoneLore:GetAudioPackLabel(active))
		if #packs > 1 then
			packButton:Enable()
			packNote:SetText(("%s. Click to switch between the %d installed packs.")
				:format(active.addon, #packs))
		else
			-- Nothing to cycle to. Disabled rather than hidden: the pack in use is
			-- worth reporting even when there is no choice to make.
			packButton:Disable()
			packNote:SetText(active.addon .. ". Install another pack to switch quality.")
		end
	end

	packButton:SetScript("OnClick", function()
		local packs = ZoneLore:GetAudioPacks()
		if #packs < 2 then
			return
		end
		local active = ZoneLore:GetActiveAudioPack()
		local index = 1
		for i = 1, #packs do
			if packs[i] == active then
				index = i
				break
			end
		end
		ZoneLore:SetActiveAudioPack(packs[(index % #packs) + 1].addon)
		SyncPack()
	end)
	packButton:SetScript("OnShow", SyncPack)
	SyncPack()

	-- Clears the button and the two-line note beneath it.
	y = y + ROW_GAP - 46
	MakeHeading(content, "Language", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	-- Only finished languages are offered. A player choosing from a list has no way
	-- to know that half a translation is missing, and would report the English that
	-- shows through as a bug; /zl lang <code> force is how an unfinished one gets
	-- looked at.
	local langButton = CreateFrame("Button", nil, content, "UIPanelButtonTemplate")
	langButton:SetPoint("TOPLEFT", INDENT + 4, y)
	langButton:SetSize(220, 22)

	local langNote = MakeNote(content, "", INDENT + 4, y - 26)

	local function SyncLanguage()
		local available = ZoneLore:GetSelectableLanguages()
		-- The chosen language, which is not always the one on screen: a switch only
		-- takes effect on the next load, and a button that snapped back to the old
		-- name would read as the click having been ignored.
		local chosen = ZoneLore:GetLanguagePreference() or ZoneLore:GetLanguage()
		local info = ZoneLore:GetLocaleInfo(chosen)

		langButton:SetText("Language: " .. (info and info.name or chosen))
		if #available > 1 then
			langButton:Enable()
			if chosen ~= ZoneLore:GetLanguage() then
				langNote:SetText("Reload to start reading it: type /reload.")
			else
				langNote:SetText(("%d languages available. Switching takes effect after /reload.")
					:format(#available))
			end
		else
			-- Disabled rather than hidden, for the same reason as the sound pack
			-- above: what is being read is worth reporting even with no choice.
			langButton:Disable()
			langNote:SetText("The lore is only written in English so far.")
		end
	end

	langButton:SetScript("OnClick", function()
		local available = ZoneLore:GetSelectableLanguages()
		if #available < 2 then
			return
		end
		local current = ZoneLore:GetLanguagePreference() or ZoneLore:GetLanguage()
		local index = 1
		for i = 1, #available do
			if available[i].code == current then
				index = i
				break
			end
		end
		local chosen = available[(index % #available) + 1]
		if ZoneLore:SetLanguage(chosen.code) then
			-- Said before the reload rather than after: the failure to avoid is a
			-- player switching, seeing English, and concluding it did not work.
			ZoneLore:Print("language set to %s -- |cffffcc00/reload to apply|r", chosen.name)
		end
		SyncLanguage()
	end)
	langButton:SetScript("OnShow", SyncLanguage)
	SyncLanguage()

	-- Clears the button and its note.
	y = y + ROW_GAP - 46
	MakeHeading(content, "Troubleshooting", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	MakeCheckbox(content, "debug", "Report area names when clicking the map",
		"Prints the raw area name the client reports, the key it normalises to, and "
			.. "whether lore was found. Use this to spot a subzone needing an alias.",
		INDENT, y, nil)

	-- Its own section rather than part of Troubleshooting, and not only because the
	-- checkbox above already uses the word "report": the per-line Report buttons
	-- cover a bad line, and this covers everything that belongs to no line at all --
	-- the addon erroring, the voice being wrong throughout, the site itself.
	y = y + ROW_GAP - 8
	MakeHeading(content, "Feedback", INDENT, y, "GameFontNormal")

	y = y + ROW_GAP
	local feedbackButton = CreateFrame("Button", nil, content, "UIPanelButtonTemplate")
	feedbackButton:SetPoint("TOPLEFT", INDENT + 4, y)
	feedbackButton:SetSize(220, 22)
	feedbackButton:SetText("Report a problem")
	feedbackButton:SetScript("OnClick", function()
		ZoneLore:ShowCopyLink(ZoneLore.SITE_URL,
			"Copy this address and open it in your browser to send feedback about ZoneLore.")
	end)

	MakeNote(content, "There is a Report button on each lore entry for problems with that "
		.. "entry. This one is for everything else. The game cannot open a link, so both "
		.. "give you an address to copy.", INDENT + 4, y - 26)

	-- `y` is the top of the last control, measured down from the canvas top, so the
	-- content reaches -y plus that control and the note under it. Derived rather
	-- than written as a number: a hardcoded height is a number nobody updates when a
	-- row is added, and the failure it produces is the one this scroller exists to
	-- fix -- a section you cannot reach.
	scroller:SetContentHeight(-y + 80)

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
