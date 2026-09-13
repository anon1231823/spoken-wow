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

    local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", INDENT, -16)
    title:SetText("Spoken Quests")

    local layout = SpokenLayout.New(panel, INDENT, -42)
    panel.layout = layout
    local audio = function() return Addon.db.profile.Audio end

    layout:Note("Quest and gossip dialogue read aloud. The sound channel and the player "
        .. "window are Spoken Player's settings, since they cover every Spoken addon.")

    layout:Section("Dialogue")
    layout:Cycle("NPC greetings: %s", "How often an NPC's greeting is read. The Once "
        .. "options are remembered for this character across revisits and logins.",
        GOSSIP_ORDER,
        function() return GOSSIP_LABELS[GossipName()] end,
        function(name)
            Addon.db.profile.Audio.GossipFrequency = Enums.GossipFrequency[name]
        end)
    layout:Checkbox("Stop when the quest window closes",
        "Narration stops as soon as you close the gossip or quest window.",
        function() return audio().StopAudioOnDisengage end,
        function(value) audio().StopAudioOnDisengage = value end)
    layout:Checkbox("OG Thrall",
        "Plays the original AI VoiceOver recording of Thrall's \"All members of the Horde "
            .. "are equal in my eyes\" speech instead of this addon's.",
        function() return audio().OGThrall end,
        function(value) audio().OGThrall = value end)

    layout:Section("Sound packs")
    local packNote = layout:Note("", 460, 32)
    local function DescribePacks()
        local names, count = {}, 0
        for _, module in DataModules:GetPresentModules() do
            count = count + 1
            table.insert(names, (string.gsub(module.Title, "Spoken Quests Audio: ", "")))
        end
        if count == 0 then
            packNote:SetText("No sound pack installed. Nothing is read aloud without one.")
        else
            packNote:SetText(string.format("%d installed: %s.", count, table.concat(names, ", ")))
        end
    end
    DescribePacks()
    panel:SetScript("OnShow", DescribePacks)
    layout:Button("Manage sound packs", 200, function() Options:OpenConfigWindow() end,
        "Opens the window that lists what is installed and what is available.")

    layout:Section("Troubleshooting")
    layout:Checkbox("Print debug messages",
        "Prints what the addon decided, and why, to the chat window.",
        function() return Addon.db.profile.DebugEnabled end,
        function(value) Addon.db.profile.DebugEnabled = value end)
    layout:Button("Play a test line", 200, function() Options:RunSelfTest() end,
        "Plays a known line through the player, the way a real one goes.")
    layout:Button("Print diagnostics", 200, function() Options:PrintDiagnostics() end,
        "Prints the client, the sound settings and what the addon has loaded.")

    layout:Section("All options")
    layout:Button("Profiles and everything else", 200, function() Options:OpenConfigWindow() end,
        "The full options window: profiles, sound packs and the command list.")

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
