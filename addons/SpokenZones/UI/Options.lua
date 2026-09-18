-- SpokenZones -- options panel in the interface settings.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, which exists on 11509
-- (Leatrix_Maps, Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use
-- it). InterfaceOptions_AddCategory is the legacy-only path and is not used.
--
-- Widget templates are picked from what addons already running on this client
-- use: UICheckButtonTemplate (Syndicator/Options) and UISliderTemplate
-- (Syndicator/Options, Leatrix_Maps, Leatrix_Plus).

local ADDON_NAME, SpokenZones = ...

local INDENT = 20

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

--------------------------------------------------------------------------------
-- Apply helpers
--------------------------------------------------------------------------------

local function RedrawPanel()
	if SpokenZones.ApplyPanelOptions then
		SpokenZones:ApplyPanelOptions()
	end
end

local function RedrawEverything()
	RedrawPanel()
	if SpokenZones.RefreshLoreWindow then
		SpokenZones:RefreshLoreWindow()
	end
end

--------------------------------------------------------------------------------
-- Panel
--------------------------------------------------------------------------------

function SpokenZones:SetupOptions()
	if panel then
		return
	end

	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		SpokenZones:Print("|cffffcc00Settings API missing; options panel unavailable (use /zl help)|r")
		return
	end

	-- Parentless, with `.name` set, is the shape the Settings API expects here.
	panel = CreateFrame("Frame")
	panel.name = "Spoken Zones"

	-- Everything below is laid out in `content`, not in `panel`. The settings canvas
	-- is a fixed size and neither scrolls nor clips what overflows it, so a panel
	-- with more rows than fit draws them over the game world. See UI/Scroller.lua.
	local scroller = SpokenLayout.Scroll(panel)
	local content = scroller.child
	panel.content = content

	MakeHeading(content, "Spoken Zones", INDENT, -16)
	local layout = SpokenLayout.New(content, INDENT, -42)
	layout:Note("Lore for zones and subzones on the world map and minimap. Text from "
		.. "warcraft.wiki.gg, CC BY-SA 4.0.")

	-- Every row's position, and the spacing between them, comes from UI/Layout.lua -- the
	-- file every Spoken addon carries a copy of, so the three panels read alike.
	local function Get(key) return function() return SpokenZones:Get(key) end end
	local function Set(key) return function(value) SpokenZones:Set(key, value) end end

	layout:Section("World map")
	layout:Checkbox("Show the lore panel beside the map",
		"The panel is hidden while the map is maximised, since it would sit off-screen.",
		Get("showMapPanel"), Set("showMapPanel"), RedrawPanel)
	layout:Checkbox("Show a lore tooltip on hover",
		"Hover a zone on a continent map, or a subzone on a zone map. Suppressed while "
			.. "the cursor is over a map pin.",
		Get("showHoverPreview"), Set("showHoverPreview"))
	-- Stored as a string ("LEFT"/"RIGHT") rather than a boolean, so it reads and writes
	-- its own way rather than through Get/Set above.
	layout:Checkbox("Put the panel on the left of the map", nil,
		function() return SpokenZones:Get("panelSide") == "LEFT" end,
		function(value) SpokenZones:Set("panelSide", value and "LEFT" or "RIGHT") end,
		RedrawPanel)
	layout:Slider("Panel width", 220, 520, 10,
		Get("panelWidth"), Set("panelWidth"), RedrawPanel, SpokenLayout.Number)
	layout:Slider("Font size", 9, 20, 1,
		Get("fontSize"), Set("fontSize"), RedrawEverything, SpokenLayout.Number)

	layout:Section("Minimap")
	layout:Checkbox("Show the minimap button",
		"Left-click opens the lore window, right-click opens these settings.",
		Get("showMinimapButton"), Set("showMinimapButton"), function()
			-- The checkbox has already written the option, so sync rather than
			-- toggle; ApplyMinimapButton also keeps `hide` in step for LibDBIcon.
			if SpokenZones.ApplyMinimapButton then
				SpokenZones:ApplyMinimapButton()
			end
		end)

	layout:Section("Narration")
	layout:Checkbox("Show the Play button on lore descriptions",
		"Reads the lore aloud. Needs a Spoken Zones Audio companion addon; without one "
			.. "the button does not appear.",
		Get("voiceEnabled"), Set("voiceEnabled"), function()
			SpokenZones:StopLore()
			SpokenZones:NotifyAudioChanged()
		end)
	layout:Checkbox("Narrate a zone when you discover it",
		"Triggered by the game's own discovery -- the moment it prints "
			.. "\"Discovered Durotar\". Fires once per character, because that is "
			.. "when the game fires it.",
		Get("autoplay"), Set("autoplay"), function()
			if not SpokenZones:Get("autoplay") then
				SpokenZones:StopLore()
			end
		end)
	layout:Indent()
	layout:Checkbox("Also narrate subzones you discover",
		"Most discoveries are subzones -- a walk across Elwynn sets off several. "
			.. "They queue rather than interrupt, so untick this only if the "
			.. "narration feels constant.",
		Get("autoplaySubzones"), Set("autoplaySubzones"))
	layout:Checkbox("Also narrate areas you explored before installing",
		"The game announces a discovery once per character, ever -- so a character "
			.. "who already explored Azeroth is never narrated anything. Tick this "
			.. "and Spoken Zones keeps its own record instead, still one clip per area "
			.. "per character. /zl forget clears it.",
		Get("autoplayExplored"), Set("autoplayExplored"))
	layout:Outdent()
	-- The list is read when the menu opens rather than captured here: packs cannot be
	-- installed mid-session, but a player who disables one in the AddOns list and reloads
	-- should not find this offering it.
	local packNote
	local function PackLabel(pack)
		return pack and SpokenZones:GetAudioPackLabel(pack) or "none installed"
	end
	local function DescribePacks()
		local packs = SpokenZones:GetAudioPacks()
		local active = SpokenZones:GetActiveAudioPack()
		if #packs == 0 then
			packNote:SetText("Nothing is narrated. Install Spoken Zones Audio to hear the "
				.. "lore read aloud.")
		elseif #packs > 1 then
			packNote:SetText(string.format("%s. %d installed; the higher quality one is "
				.. "used unless you choose otherwise.", active.addon, #packs))
		else
			packNote:SetText(active.addon .. ". Install another pack to switch quality.")
		end
	end
	layout:Dropdown("Sound pack", "Which installed pack narrates the lore.",
		function() return SpokenZones:GetAudioPacks() end,
		function() return SpokenZones:GetActiveAudioPack() end,
		function(pack) SpokenZones:SetActiveAudioPack(pack.addon) end,
		function() DescribePacks() end,
		PackLabel)
	packNote = layout:Note("", 460, 32)
	DescribePacks()

	layout:Section("Language")
	-- Only finished languages are offered. A player choosing from a list has no way to
	-- know that half a translation is missing, and would report the English that shows
	-- through as a bug; /zl lang <code> force is how an unfinished one gets looked at.
	local langNote
	local function DescribeLanguage()
		local available = SpokenZones:GetSelectableLanguages()
		-- The chosen language, which is not always the one on screen: a switch only takes
		-- effect on the next load.
		local chosen = SpokenZones:GetLanguagePreference() or SpokenZones:GetLanguage()
		if #available < 2 then
			langNote:SetText("The lore is only written in English so far.")
		elseif chosen ~= SpokenZones:GetLanguage() then
			langNote:SetText("Reload to start reading it: type /reload.")
		else
			langNote:SetText(string.format(
				"%d languages available. Switching takes effect after /reload.", #available))
		end
	end
	layout:Dropdown("Language", "Which language the lore is read and shown in.",
		function() return SpokenZones:GetSelectableLanguages() end,
		function()
			local chosen = SpokenZones:GetLanguagePreference() or SpokenZones:GetLanguage()
			for _, locale in ipairs(SpokenZones:GetSelectableLanguages()) do
				if locale.code == chosen then
					return locale
				end
			end
		end,
		function(locale)
			if SpokenZones:SetLanguage(locale.code) then
				-- Said before the reload rather than after: the failure to avoid is a
				-- player switching, seeing English, and concluding it did not work.
				SpokenZones:Print("language set to %s -- |cffffcc00/reload to apply|r", locale.name)
			end
		end,
		function() DescribeLanguage() end,
		function(locale) return locale and locale.name or "English" end)
	langNote = layout:Note("", 460, 32)
	DescribeLanguage()

	layout:Section("Troubleshooting")
	layout:Checkbox("Report area names when clicking the map",
		"Prints the raw area name the client reports, the key it normalises to, and "
			.. "whether lore was found. Use this to spot a subzone needing an alias.",
		Get("debug"), Set("debug"))

	-- Its own section rather than part of Troubleshooting, and not only because the
	-- checkbox above already uses the word "report": the per-line Report buttons
	-- cover a bad line, and this covers everything that belongs to no line at all --
	-- the addon erroring, the voice being wrong throughout, the site itself.
	layout:Section("Feedback")
	layout:Button("Report a problem", 220, function()
		SpokenZones:ShowCopyLink(SpokenZones.SITE_URL,
			"Copy this address and open it in your browser to send feedback about Spoken Zones.")
	end)
	layout:Note("There is a Report button on each lore entry for problems with that "
		.. "entry. This one is for everything else. The game cannot open a link, so both "
		.. "give you an address to copy.", 460, 40)

	-- Derived rather than written as a number: a hardcoded height is a number nobody
	-- updates when a row is added, and the failure it produces is the one this scroller
	-- exists to fix -- a section you cannot reach.
	scroller:SetContentHeight(layout:Height() + 40)

	category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Zones")
	Settings.RegisterAddOnCategory(category)

	SpokenZones.optionsPanel = panel
	SpokenZones.optionsCategory = category
end

function SpokenZones:OpenOptions()
	if not category or not (Settings and Settings.OpenToCategory) then
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
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
		SpokenZones:Print("open Game Menu -> Options -> AddOns -> Spoken Zones")
	end
end
