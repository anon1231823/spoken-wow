setfenv(1, SpokenEnv)

-- The one minimap button. Feature addons contribute menu entries rather than buttons of
-- their own, so a player with two Spoken addons installed gets one icon, not two.
--
-- Left-click opens a menu: the player's entries, then each source's, grouped in source
-- order. Right-click opens settings. Middle-click runs the configured command. All
-- three are rebindable, which is what keeps VoiceOverRedux's three-configurable-clicks
-- behaviour for the players who use it.
Minimap = { entries = {} }

local ICON = [[Interface\AddOns\Spoken\Textures\MinimapButton]]
local ldbObject, menuFrame

-- The player's own entries.
local PLAYER_ENTRIES = {
    { id = "PlayPause", text = L.PLAY_PAUSE, order = 1, onClick = function() SoundQueue:TogglePauseQueue() end },
    { id = "Stop",      text = L.STOP,       order = 2, onClick = function() SoundQueue:RemoveAllSoundsFromQueue() end },
    { id = "Settings",  text = L.SETTINGS,   order = 3, onClick = function() Options:Open() end },
}

--- entry = { id, text, icon, order, onClick(button), tooltip(GameTooltip), visible() }
function Minimap:AddEntry(sourceKey, entry)
    self.entries[sourceKey] = self.entries[sourceKey] or {}
    self:RemoveEntry(sourceKey, entry.id)
    table.insert(self.entries[sourceKey], entry)
    table.sort(self.entries[sourceKey], function(a, b) return (a.order or 100) < (b.order or 100) end)
end

function Minimap:RemoveEntry(sourceKey, id)
    local list = self.entries[sourceKey]
    if not list then return end
    for i = getn(list), 1, -1 do
        if list[i].id == id then table.remove(list, i) end
    end
end

--- The menu as a flat list, in the order it is shown.
function Minimap:BuildMenu()
    local menu = {}
    for _, entry in ipairs(PLAYER_ENTRIES) do
        if not entry.visible or entry.visible() then table.insert(menu, entry) end
    end
    for key, source in Sources:Iterate() do
        for _, entry in ipairs(self.entries[key] or {}) do
            if not entry.visible or entry.visible() then
                entry.sourceTitle = source.title
                table.insert(menu, entry)
            end
        end
    end
    return menu
end

--- An entry by id, across the player and every source.
function Minimap:FindEntry(id)
    for _, entry in ipairs(self:BuildMenu()) do
        if entry.id == id then return entry end
    end
end

-- A plain list of buttons rather than UIDropDownMenu: that API has three incompatible
-- shapes across the six clients this runs on, and a menu of a handful of rows does not
-- need it.
local function ShowMenu(anchor)
    if not menuFrame then
        menuFrame = CreateFrame("Frame", "SpokenMinimapMenu", UIParent, "BackdropTemplate")
        menuFrame:SetFrameStrata("DIALOG")
        menuFrame:SetClampedToScreen(true)
        menuFrame.rows = {}
        menuFrame:HookScript("OnLeave", function(self) self.leaveAt = GetTime() end)
    end
    local menu = Minimap:BuildMenu()
    local y, width = -6, 140
    local lastGroup
    for i, entry in ipairs(menu) do
        local row = menuFrame.rows[i]
        if not row then
            row = CreateFrame("Button", nil, menuFrame)
            row:SetHeight(18)
            row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
            row.text:SetPoint("LEFT", 8, 0)
            row:SetScript("OnClick", function(self)
                menuFrame:Hide()
                if self.entry.onClick then self.entry.onClick(self) end
            end)
            menuFrame.rows[i] = row
        end
        if entry.sourceTitle and entry.sourceTitle ~= lastGroup then
            y = y - 4
            lastGroup = entry.sourceTitle
        end
        row.entry = entry
        row.text:SetText(entry.text)
        row:SetPoint("TOPLEFT", 4, y)
        row:SetWidth(width - 8)
        row:Show()
        y = y - 18
    end
    for i = getn(menu) + 1, getn(menuFrame.rows) do menuFrame.rows[i]:Hide() end
    menuFrame:SetSize(width, -y + 6)
    menuFrame:ClearAllPoints()
    menuFrame:SetPoint("TOPRIGHT", anchor, "BOTTOMLEFT")
    menuFrame:Show()
end

function Minimap:Setup()
    if ldbObject then return end
    local LibDataBroker = LibStub("LibDataBroker-1.1", true)
    local LibDBIcon = LibStub("LibDBIcon-1.0", true)
    if not LibDataBroker or not LibDBIcon then return end

    local db = Addon.db.profile.Minimap.LibDBIcon
    -- Seeded once, so the button does not start at angle 0 under other addons' buttons.
    if db.minimapPos == nil then db.minimapPos = 204 end

    ldbObject = LibDataBroker:NewDataObject("Spoken", {
        type = "launcher",
        text = "Spoken",
        icon = ICON,
        OnClick = function(button, mouseButton)
            local command = Addon.db.profile.Minimap.Commands[mouseButton]
            if command == "Menu" then
                ShowMenu(button)
            elseif command and command ~= "" then
                local entry = Minimap:FindEntry(command)
                if entry and entry.onClick then
                    PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
                    entry.onClick(button)
                end
            end
        end,
        OnTooltipShow = function(tooltip)
            tooltip:SetText("Spoken")
            local head = SoundQueue:GetCurrentSound()
            if head and head.present then
                tooltip:AddLine(head.present.header or "", 1, 0.82, 0)
                tooltip:AddLine(head.present.label or "", 0.8, 0.8, 0.8)
            end
            tooltip:AddLine(" ")
            tooltip:AddLine(L.MENU_LEFT, 0.7, 0.7, 0.7)
            tooltip:AddLine(L.MENU_MIDDLE, 0.7, 0.7, 0.7)
            tooltip:AddLine(L.MENU_RIGHT, 0.7, 0.7, 0.7)
        end,
    })
    LibDBIcon:Register("Spoken", ldbObject, db)
end

function Minimap:Refresh()
    local LibDBIcon = LibStub("LibDBIcon-1.0", true)
    if LibDBIcon and ldbObject then
        LibDBIcon:Refresh("Spoken", Addon.db.profile.Minimap.LibDBIcon)
    end
end
