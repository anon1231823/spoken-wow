setfenv(1, SpokenEnv)

-- The player's settings: player-wide things only. Each feature addon keeps its own panel
-- and, where the Settings API exists, nests it under this one.
--
-- Settings.RegisterCanvasLayoutCategory is the modern path and exists on every current
-- client. The three private-server clients have no Settings API at all; there the same
-- panel is a movable window opened with /spoken options. One builder, two hosts.
Options = {}

local INDENT = 20
local panel
local pendingLinks = {}

-- Rows, headings and the spacing between them come from UI/Layout.lua, the file every
-- Spoken addon carries a copy of, so the three panels read alike.
local Layout = SpokenLayout

local function Heading(parent, text, x, y, template)
    local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontNormalLarge")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

local CHANNELS = { "Master", "SFX", "Music", "Ambience", "Dialog" }

local function Build()
    panel = CreateFrame("Frame", "SpokenOptionsPanel", UIParent)
    panel.name = "Spoken Player"
    local cfg = function() return Addon.db.profile.Frame end
    local audio = function() return Addon.db.profile.Audio end
    local mm = function() return Addon.db.profile.Minimap.LibDBIcon end
    local refresh = function() PlayerFrame:RefreshConfig() end

    Heading(panel, "Spoken Player", INDENT, -16)
    local layout = Layout.New(panel, INDENT, -52)
    panel.layout = layout

    layout:Section(L.OPT_WINDOW_TITLE)
    layout:Checkbox(L.OPT_LOCK_FRAME, L.OPT_LOCK_FRAME_TIP,
        function() return cfg().LockFrame end, function(v) cfg().LockFrame = v end, refresh)
    layout:Checkbox(L.OPT_HIDE_PORTRAIT, L.OPT_HIDE_PORTRAIT_TIP,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end, refresh)
    layout:Checkbox(L.OPT_HIDE_FRAME, L.OPT_HIDE_FRAME_TIP,
        function() return cfg().HideFrame end, function(v) cfg().HideFrame = v end, refresh)
    layout:Checkbox(L.OPT_HIDE_ACTIONS, L.OPT_HIDE_ACTIONS_TIP,
        function() return cfg().HideActions end, function(v) cfg().HideActions = v end, refresh)
    layout:Slider(L.OPT_SCALE, 0.5, 2, 0.05,
        function() return cfg().FrameScale end, function(v) cfg().FrameScale = v end, refresh)
    layout:Button(L.OPT_RESET, 120, function() PlayerFrame:Reset() end)

    -- Everything about how a line is played, whichever addon queued it: the two feature
    -- addons each used to carry their own channel control, and a player with both
    -- installed had two settings for one thing.
    layout:Section(L.OPT_AUDIO_TITLE)
    layout:Dropdown(L.OPT_CHANNEL, L.OPT_CHANNEL_TIP, CHANNELS,
        function() return audio().SoundChannel end,
        function(v) audio().SoundChannel = v end,
        -- The handle belongs to the old channel, so a line already speaking cannot move.
        function() SoundQueue:RemoveAllSoundsFromQueue() end)
    if audio().AutoToggleDialog ~= nil then
        layout:Checkbox(L.OPT_MUTE_DIALOGUE,
            Version.IsLegacyVanilla and L.OPT_MUTE_DIALOGUE_TIP_VANILLA or L.OPT_MUTE_DIALOGUE_TIP,
            function() return audio().AutoToggleDialog end,
            function(v)
                audio().AutoToggleDialog = v
                -- Turning it off while it holds the channel down would leave it muted.
                if not v then
                    SoundUtils:MuteChannel("Dialog", false)
                end
            end)
    end

    -- 2.4.3 and 3.3.5 only, and absent from the saved variables anywhere else. These had
    -- no rows at all until recently: the settings existed and could only be reached by
    -- editing the saved variables by hand.
    local music = audio().LegacyMusicChannel
    if music then
        layout:Checkbox(L.OPT_MUSIC_CHANNEL, L.OPT_MUSIC_CHANNEL_TIP,
            function() return music.Enabled end,
            function(v) music.Enabled = v end)
        layout:Slider(L.OPT_MUSIC_VOLUME, 0, 1, 0.05,
            function() return music.Volume end,
            function(v) music.Volume = v end)
        layout:Slider(L.OPT_MUSIC_FADE, 0, 2, 0.1,
            function() return music.FadeOutMusic end,
            function(v) music.FadeOutMusic = v end, nil, Layout.Seconds)
    end
    if audio().LegacyHDModels ~= nil then
        layout:Checkbox(L.OPT_HD_MODELS, L.OPT_HD_MODELS_TIP,
            function() return audio().LegacyHDModels end,
            function(v) audio().LegacyHDModels = v end)
    end

    layout:Section(L.OPT_MINIMAP_TITLE)
    layout:Checkbox(L.OPT_MINIMAP_SHOW, nil,
        function() return not mm().hide end,
        function(v) mm().hide = not v end, function() Minimap:Refresh() end)
    layout:Checkbox(L.OPT_MINIMAP_LOCK, nil,
        function() return mm().lock end,
        function(v) mm().lock = v end, function() Minimap:Refresh() end)

    -- Feature addons register a button here to reach their own settings. The section is
    -- created with the first of them: with no feature addon installed there is nothing
    -- to head.
    panel.links = {}
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
    if not panel.linksSection then
        panel.linksSection = true
        panel.layout:Section(L.OPT_ADDONS_TITLE)
    end
    table.insert(panel.links, panel.layout:Button(text, 200, onClick))
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
