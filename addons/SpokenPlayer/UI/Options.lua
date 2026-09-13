setfenv(1, SpokenEnv)

-- The player's settings: player-wide things only. Each feature addon keeps its own panel
-- and, where the Settings API exists, nests it under this one.
--
-- Settings.RegisterCanvasLayoutCategory is the modern path and exists on every current
-- client. The three private-server clients have no Settings API at all; there the same
-- panel is a movable window opened with /spoken options. One builder, two hosts.
Options = {}

local INDENT, ROW_GAP = 20, -28
local panel
local pendingLinks = {}

local function Heading(parent, text, x, y, template)
    local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontNormalLarge")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

-- `read`/`write` are the setting's accessors; `apply` runs afterwards for redraws.
local function Checkbox(parent, label, tooltip, x, y, read, write, apply)
    local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    box:SetPoint("TOPLEFT", x, y)
    box.text = box:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    box.text:SetPoint("LEFT", box, "RIGHT", 2, 0)
    box.text:SetText(label)
    box:SetScript("OnShow", function(self) self:SetChecked(read() and true or false) end)
    box:SetScript("OnClick", function(self)
        write(self:GetChecked() and true or false)
        if apply then apply() end
    end)
    if tooltip then
        box:SetScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(label)
            GameTooltip:AddLine(tooltip, 1, 1, 1, true)
            GameTooltip:Show()
        end)
        box:SetScript("OnLeave", function() GameTooltip_Hide() end)
    end
    return box
end

--- `show` renders a value for the label; the default reads it as a percentage.
local function Percent(value) return format("%d%%", value * 100) end
local function Seconds(value) return format("%.1fs", value) end

local function Slider(parent, label, minValue, maxValue, step, x, y, read, write, apply, show)
    show = show or Percent
    local template = Version.IsAnyLegacy and "OptionsSliderTemplate" or "UISliderTemplate"
    local slider = CreateFrame("Slider", nil, parent, template)
    slider:SetPoint("TOPLEFT", x + 4, y - 8)
    slider:SetWidth(180)
    -- Both load-bearing: a slider given neither draws nothing at all, leaving a gap on
    -- the panel where a setting should be. The zones addon's sliders set both.
    slider:SetHeight(16)
    slider:SetOrientation("HORIZONTAL")
    slider:SetMinMaxValues(minValue, maxValue)
    slider:SetValueStep(step)
    slider.label = slider:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    slider.label:SetPoint("BOTTOMLEFT", slider, "TOPLEFT", 0, 4)
    -- Labelled now as well as on show: a slider on a panel that is never opened still
    -- reads as what it is, and the label is what a test can see.
    slider.label:SetText(format("%s: %s", label, show(read())))
    slider:SetScript("OnShow", function(self)
        self:SetValue(read())
        self.label:SetText(format("%s: %s", label, show(read())))
    end)
    slider:SetScript("OnValueChanged", function(self, value)
        value = math.floor(value / step + 0.5) * step
        self.label:SetText(format("%s: %s", label, show(value)))
        if math.abs(value - read()) >= step / 2 then
            write(value)
            if apply then apply() end
        end
    end)
    return slider
end

-- A cycle button rather than a dropdown, the trade the zones addon's own panel already
-- made: UIDropDownMenuTemplate exists on the current clients but none of its Initialize
-- plumbing can be checked without launching the game, and five values do not justify it.
local function Cycle(parent, label, tooltip, values, x, y, read, write, apply)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetPoint("TOPLEFT", x, y)
    button:SetSize(240, 22)
    local function Sync()
        button:SetText(format(label, read()))
    end
    button:SetScript("OnClick", function()
        local index = 1
        for i = 1, getn(values) do
            if values[i] == read() then
                index = i
                break
            end
        end
        write(values[math.mod(index, getn(values)) + 1])
        if apply then apply() end
        Sync()
    end)
    button:SetScript("OnShow", Sync)
    if tooltip then
        button:SetScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(tooltip, nil, nil, nil, nil, true)
            GameTooltip:Show()
        end)
        button:SetScript("OnLeave", function() GameTooltip:Hide() end)
    end
    Sync()
    return button
end

local CHANNELS = { "Master", "SFX", "Music", "Ambience", "Dialog" }

local function Build()
    panel = CreateFrame("Frame", "SpokenOptionsPanel", UIParent)
    panel.name = "Spoken Player"
    local cfg = function() return Addon.db.profile.Frame end
    local mm = function() return Addon.db.profile.Minimap.LibDBIcon end
    local refresh = function() PlayerFrame:RefreshConfig() end

    Heading(panel, "Spoken Player", INDENT, -16)
    local y = -52
    Heading(panel, L.OPT_WINDOW_TITLE, INDENT, y, "GameFontNormal")
    y = y + ROW_GAP
    Checkbox(panel, L.OPT_LOCK_FRAME, L.OPT_LOCK_FRAME_TIP, INDENT, y,
        function() return cfg().LockFrame end, function(v) cfg().LockFrame = v end, refresh)
    y = y + ROW_GAP
    Checkbox(panel, L.OPT_HIDE_PORTRAIT, L.OPT_HIDE_PORTRAIT_TIP, INDENT, y,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end, refresh)
    y = y + ROW_GAP
    Checkbox(panel, L.OPT_HIDE_FRAME, L.OPT_HIDE_FRAME_TIP, INDENT, y,
        function() return cfg().HideFrame end, function(v) cfg().HideFrame = v end, refresh)
    y = y + ROW_GAP - 12
    Slider(panel, L.OPT_SCALE, 0.5, 2, 0.05, INDENT, y,
        function() return cfg().FrameScale end, function(v) cfg().FrameScale = v end, refresh)
    y = y + ROW_GAP - 16
    local reset = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    reset:SetSize(120, 22)
    reset:SetPoint("TOPLEFT", INDENT, y)
    reset:SetText(L.OPT_RESET)
    reset:SetScript("OnClick", function() PlayerFrame:Reset() end)

    -- Audio. Everything about how a line is played lives here, whichever addon queued
    -- it: the two feature addons each used to carry their own channel control, and a
    -- player with both installed had two settings for one thing.
    local audio = function() return Addon.db.profile.Audio end
    y = y + ROW_GAP - 8
    Heading(panel, L.OPT_AUDIO_TITLE, INDENT, y, "GameFontNormal")
    y = y + ROW_GAP
    Cycle(panel, L.OPT_CHANNEL, L.OPT_CHANNEL_TIP, CHANNELS, INDENT, y,
        function() return audio().SoundChannel end,
        function(v) audio().SoundChannel = v end,
        -- The handle belongs to the old channel, so a line already speaking cannot move.
        function() SoundQueue:RemoveAllSoundsFromQueue() end)
    y = y + ROW_GAP - 4
    if audio().AutoToggleDialog ~= nil then
        Checkbox(panel, L.OPT_MUTE_DIALOGUE,
            Version.IsLegacyVanilla and L.OPT_MUTE_DIALOGUE_TIP_VANILLA or L.OPT_MUTE_DIALOGUE_TIP,
            INDENT, y,
            function() return audio().AutoToggleDialog end,
            function(v)
                audio().AutoToggleDialog = v
                -- Turning it off while it holds the channel down would leave it muted.
                if not v then
                    SoundUtils:MuteChannel("Dialog", false)
                end
            end)
        y = y + ROW_GAP
    end

    -- 2.4.3 and 3.3.5 only, and absent from the saved variables anywhere else. These had
    -- no rows at all until now: the settings existed and could only be reached by editing
    -- the saved variables by hand.
    local music = audio().LegacyMusicChannel
    if music then
        Checkbox(panel, L.OPT_MUSIC_CHANNEL, L.OPT_MUSIC_CHANNEL_TIP, INDENT, y,
            function() return music.Enabled end,
            function(v) music.Enabled = v end)
        y = y + ROW_GAP - 12
        Slider(panel, L.OPT_MUSIC_VOLUME, 0, 1, 0.05, INDENT, y,
            function() return music.Volume end,
            function(v) music.Volume = v end)
        y = y + ROW_GAP - 16
        Slider(panel, L.OPT_MUSIC_FADE, 0, 2, 0.1, INDENT, y,
            function() return music.FadeOutMusic end,
            function(v) music.FadeOutMusic = v end, nil, Seconds)
        y = y + ROW_GAP - 16
    end
    if audio().LegacyHDModels ~= nil then
        Checkbox(panel, L.OPT_HD_MODELS, L.OPT_HD_MODELS_TIP, INDENT, y,
            function() return audio().LegacyHDModels end,
            function(v) audio().LegacyHDModels = v end)
        y = y + ROW_GAP
    end

    y = y + ROW_GAP - 8
    Heading(panel, "Minimap", INDENT, y, "GameFontNormal")
    y = y + ROW_GAP
    Checkbox(panel, L.OPT_MINIMAP_SHOW, nil, INDENT, y,
        function() return not mm().hide end,
        function(v) mm().hide = not v end, function() Minimap:Refresh() end)
    y = y + ROW_GAP
    Checkbox(panel, L.OPT_MINIMAP_LOCK, nil, INDENT, y,
        function() return mm().lock end,
        function(v) mm().lock = v end, function() Minimap:Refresh() end)

    -- Feature addons register a button here to reach their own settings.
    panel.links = {}
    panel.linkY = y + ROW_GAP - 8
    for _, link in ipairs(pendingLinks) do
        Options:AddLink(link.text, link.onClick)
    end
    pendingLinks = {}
    return panel
end

function Options:Setup()
    if panel then return end
    Build()
    if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
        self.category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Player")
        Settings.RegisterAddOnCategory(self.category)
    else
        -- No Settings API: a window of our own, opened by /spoken options.
        panel:SetSize(420, 360)
        panel:SetPoint("CENTER")
        panel:SetMovable(true)
        panel:EnableMouse(true)
        panel:SetFrameStrata("DIALOG")
        panel:Hide()
        local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
        close:SetPoint("TOPRIGHT", -4, -4)
        close:SetScript("OnClick", function() panel:Hide() end)
    end
end

--- A button on the player's panel that opens a feature addon's own settings. The
--- quests addon uses this because AceConfigDialog owns its frame lifecycle and nesting
--- it as a canvas subcategory is fragile across six clients.
function Options:AddLink(text, onClick)
    -- Feature addons call this from ADDON_LOADED; the panel is built at PLAYER_LOGIN.
    if not panel then
        table.insert(pendingLinks, { text = text, onClick = onClick })
        return
    end
    local button = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    button:SetSize(200, 22)
    button:SetPoint("TOPLEFT", INDENT, panel.linkY)
    button:SetText(text)
    button:SetScript("OnClick", onClick)
    table.insert(panel.links, button)
    panel.linkY = panel.linkY - 26
end

function Options:Open()
    if self.category and Settings and Settings.OpenToCategory then
        -- OpenToCategory takes an ID in some builds and the category in others.
        local id = self.category.GetID and self.category:GetID() or nil
        if not (id and pcall(Settings.OpenToCategory, id)) then
            pcall(Settings.OpenToCategory, self.category)
        end
    elseif panel then
        panel:SetShown(not panel:IsShown())
    else
        print("Spoken Player: " .. L.OPT_NO_SETTINGS_API)
    end
end
