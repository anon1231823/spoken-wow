setfenv(1, VoiceOver)

-- The addon's face in the interface settings: one canvas panel of sections, laid out by
-- UI/Layout.lua, the file every Spoken addon carries a copy of so the three panels read
-- alike.
--
-- The AceConfig table is not replaced. It still backs every `/vo` command, and it still
-- fills the window OpenConfigWindow shows -- which is where profiles and the sound-pack
-- manager live, both of them AceGUI's to draw. What changed is that the settings a player
-- actually changes are sections on one panel rather than entries in a tree.
--
-- Absent on the three private-server clients, which have no Settings API at all. There the
-- window and the slash commands are the whole interface, as they have always been.

SettingsPanel = {}

local INDENT = 20
local panel, category

-- The enum is stored as a number and read as a name. Ordered, because a cycle button
-- steps through them in the order the list is written.
local GOSSIP_ORDER = { "Always", "OncePerQuestNPC", "OncePerNPC", "Never" }
local GOSSIP_LABELS = {
    Always = "Always",
    OncePerQuestNPC = "Once per quest NPC",
    OncePerNPC = "Once per NPC",
    Never = "Never",
}

local function GossipName()
    return Enums.GossipFrequency:GetName(Addon.db.profile.Audio.GossipFrequency) or "Always"
end

function SettingsPanel:Setup()
    if panel or not (Settings and Settings.RegisterCanvasLayoutCategory) then
        return
    end
    panel = CreateFrame("Frame", "SpokenQuestsOptionsPanel", UIParent)
    panel.name = "Spoken Quests"

    -- The settings canvas is a fixed size and neither scrolls nor clips what overflows
    -- it, so a panel with more rows than fit draws them over the game world.
    local scroller = SpokenLayout.Scroll(panel)
    local content = scroller.child

    local title = content:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", INDENT, -16)
    title:SetText("Spoken Quests")

    local layout = SpokenLayout.New(content, INDENT, -42)
    panel.layout = layout
    local audio = function() return Addon.db.profile.Audio end

    layout:Note("Quest and gossip dialogue read aloud. The sound channel and the player "
        .. "window are Spoken Player's settings, since they cover every Spoken addon.", 460, 32)

    layout:Section("Dialogue")
    layout:Dropdown("NPC greetings", "How often an NPC's greeting is read. The Once "
        .. "options are remembered for this character across revisits and logins.",
        GOSSIP_ORDER,
        GossipName,
        function(name)
            Addon.db.profile.Audio.GossipFrequency = Enums.GossipFrequency[name]
        end,
        nil,
        function(name) return GOSSIP_LABELS[name] or name end)
    layout:Checkbox("Stop when the quest window closes",
        "Narration stops as soon as you close the gossip or quest window.",
        function() return audio().StopAudioOnDisengage end,
        function(value) audio().StopAudioOnDisengage = value end)
    layout:Checkbox("OG Thrall",
        "Plays the original AI VoiceOver recording of Thrall's \"All members of the Horde "
            .. "are equal in my eyes\" speech instead of this addon's.",
        function() return audio().OGThrall end,
        function(value) audio().OGThrall = value end)

    -- The packs, inline. This used to be a branch of the options tree behind a button,
    -- which is two clicks and a second window to answer "is my audio installed".
    layout:Section("Sound packs")
    local packRows = {}
    local function DescribePacks()
        local present = 0
        for _, module in DataModules:GetPresentModules() do
            present = present + 1
            local row = packRows[present]
            if row then
                local loaded = DataModules:GetModule(module.AddonName)
                row.note:SetText(format("%s  |cff888888%s%s|r",
                    (string.gsub(module.Title, "Spoken Quests Audio: ", "")),
                    module.ContentVersion or "",
                    loaded and "" or "  (not loaded)"))
                row.note:Show()
            end
        end
        for index = present + 1, table.getn(packRows) do
            packRows[index].note:Hide()
        end
        if present == 0 and packRows[1] then
            packRows[1].note:SetText("|cffff8080No sound pack installed.|r Nothing is read "
                .. "aloud without one.")
            packRows[1].note:Show()
        end
    end
    -- A row apiece, built once: the set of installed addons cannot change mid-session, and
    -- the panel is built after they have all loaded.
    local packCount = 0
    for _ in DataModules:GetPresentModules() do
        packCount = packCount + 1
    end
    for index = 1, math.max(packCount, 1) do
        packRows[index] = { note = layout:Note("", 460, 16) }
    end
    DescribePacks()
    content:SetScript("OnShow", DescribePacks)

    -- What is not installed, with the address to get it. The game cannot open a link, so
    -- the button hands over one to copy.
    local offered = 0
    for _, module in DataModules:GetAvailableModules() do
        if not DataModules.presentModules[module.AddonName] then
            offered = offered + 1
            if offered == 1 then
                layout:Note("Not installed:", 460, 16)
            end
            layout:Button((string.gsub(module.Title, "Spoken Quests Audio: ", "")), 220,
                function() ReportButton:ShowAddress(module.URL) end,
                "Hands you the address to copy: " .. module.URL)
        end
    end

    layout:Section("Troubleshooting")
    layout:Checkbox("Print debug messages",
        "Prints what the addon decided, and why, to the chat window.",
        function() return Addon.db.profile.DebugEnabled end,
        function(value) Addon.db.profile.DebugEnabled = value end)
    layout:Button("Play a test line", 200, function() Options:RunSelfTest() end,
        "Plays a known line through the player, the way a real one goes.")
    layout:Button("Print diagnostics", 200, function() Options:PrintDiagnostics() end,
        "Prints the client, the sound settings and what the addon has loaded.")

    -- Profiles, inline. AceDB owns them; this is the whole of what its own options screen
    -- offered, minus the second window to reach it.
    local db = Addon.db
    if db.GetProfiles then
        layout:Section("Profile")
        local function Others()
            local others, current = {}, db:GetCurrentProfile()
            for _, name in ipairs(db:GetProfiles()) do
                if name ~= current then
                    table.insert(others, name)
                end
            end
            return others
        end
        layout:Dropdown("Settings profile",
            "Profiles keep a separate set of these settings. Characters can share one or "
                .. "have their own.",
            function() return db:GetProfiles() end,
            function() return db:GetCurrentProfile() end,
            function(name) db:SetProfile(name) end)
        layout:Button("Reset this profile", 200, function() db:ResetProfile() end,
            "Puts every setting in this profile back to its default.")
        if db.CopyProfile then
            layout:Dropdown("Copy settings from", "Overwrites this profile with another's.",
                Others,
                function() return nil end,
                function(name) db:CopyProfile(name) end,
                nil,
                function(name) return name or "pick one" end)
        end
        if db.DeleteProfile then
            layout:Dropdown("Delete a profile", "Deletes a profile you are not using.",
                Others,
                function() return nil end,
                function(name) db:DeleteProfile(name) end,
                nil,
                function(name) return name or "pick one" end)
        end
    end

    -- Derived rather than written down: a hardcoded height is a number nobody updates
    -- when a row is added, and the failure it produces is a section you cannot reach.
    scroller:SetContentHeight(layout:Height() + 40)
    panel.content = content

    category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken Quests")
    Settings.RegisterAddOnCategory(category)
    self.panel, self.category = panel, category
end

function SettingsPanel:Open()
    if category and Settings and Settings.OpenToCategory then
        local id = category.GetID and category:GetID() or nil
        if id and pcall(Settings.OpenToCategory, id) then
            return true
        end
        if pcall(Settings.OpenToCategory, category) then
            return true
        end
    end
    return false
end
