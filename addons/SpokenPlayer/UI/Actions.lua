setfenv(1, SpokenEnv)

-- The strip of buttons under the queue, built from the speaking clip's presentation.
-- Zones bring Read and Report; quests bring Report, and Stop Gossip anchored to the
-- header. The player lays them out and knows nothing about what they do.
--
--   action = { id, text = "Read" | fun():string, tooltip = fun(GameTooltip),
--              label = "Report a problem"?, -- an icon action's name, where a menu lists it
--              visible = fun():boolean, onClick = fun(clip), anchor = "header"?,
--              create = fun(parent):Button?, onClipChanged = fun(clip, button)? }
--
-- `create` opts a button out of the default template -- the report button builds its
-- own -- and such a button keeps its own OnClick; the player only tells it which clip
-- it now stands beside.
Actions = {}

local ACTION_WIDTH = 70
local ACTION_HEIGHT = 18
-- Big enough to aim at and to read as a bug rather than a smudge.
local ICON_SIZE = 24
local named = 0

--- Whether an action's icon can be drawn. The art these use lives in folders that postdate
--- the three private-server clients, where the texture is simply missing and the button
--- would be a blank square; an action carrying a `text` says what to put there instead.
local function CanDrawIcon()
    return not Version.IsAnyLegacy
end
Actions.STRIP_HEIGHT = ACTION_HEIGHT + 6

-- Actions an addon has declared optional, in the order declared: { id, label }. The player
-- offers a setting for each, named by the addon, and never learns what the action does.
Actions.optional = {}

--- Declare that an action may be switched off, and what to call it in the settings.
function Actions:RegisterOptional(id, label)
    for _, entry in ipairs(self.optional) do
        if entry.id == id then
            entry.label = label or entry.label
            return entry
        end
    end
    local entry = { id = id, label = label or id }
    table.insert(self.optional, entry)
    return entry
end

function Actions:Build(frame)
    frame.actions = { buttons = {}, byId = {}, shown = 0 }
end

local function NewButton(frame, action)
    local button
    if action.create then
        button = action.create(frame)
    elseif action.icon then
        if CanDrawIcon() then
            -- No template: a button that is only a texture wants none of
            -- UIPanelButtonTemplate's furniture.
            button = CreateFrame("Button", nil, frame)
            button:SetSize(ICON_SIZE, ICON_SIZE)
            button:SetNormalTexture(action.icon)
            button:SetHighlightTexture(action.icon)
            local highlight = button:GetHighlightTexture()
            if highlight and highlight.SetBlendMode then
                highlight:SetBlendMode("ADD")
            end
            button.showsIcon = true
        else
            -- Named, because 1.12's UIPanelButtonTemplate names its label "$parentText"
            -- and an unnamed button leaves that substitution with nothing to resolve.
            named = named + 1
            button = CreateFrame("Button", "SpokenActionButton" .. named, frame,
                "UIPanelButtonTemplate")
            button:SetSize(ICON_SIZE + 8, ICON_SIZE + 4)
            button:SetText(action.text or "?")
        end
        button:SetScript("OnClick", function(self)
            if self.action and self.action.onClick then
                self.action.onClick(frame.actions.clip)
            end
        end)
        button:SetScript("OnEnter", function(self)
            if self.action and self.action.tooltip then
                GameTooltip:SetOwner(self, "ANCHOR_LEFT")
                self.action.tooltip(GameTooltip)
                GameTooltip:Show()
            end
        end)
        button:SetScript("OnLeave", function() GameTooltip_Hide() end)
    else
        button = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
        button:SetScript("OnClick", function(self)
            if self.action and self.action.onClick then
                self.action.onClick(frame.actions.clip)
            end
        end)
        button:SetScript("OnEnter", function(self)
            if self.action and self.action.tooltip then
                GameTooltip:SetOwner(self, "ANCHOR_LEFT")
                self.action.tooltip(GameTooltip)
                GameTooltip:Show()
            end
        end)
        button:SetScript("OnLeave", function() GameTooltip_Hide() end)
    end
    if not action.create and not action.icon then
        button:SetSize(ACTION_WIDTH, ACTION_HEIGHT)
    end
    return button
end

--- Lay out the actions for `clip` (the head), hiding whatever the last clip left.
---@return number shown
function Actions:Configure(frame, clip)
    -- One setting covers the lot. Every action either of the shipped addons offers is a
    -- convenience beside the line, so "hide them" is a player-wide answer rather than one
    -- checkbox per addon per button.
    local list = clip and clip.present and clip.present.actions or {}
    frame.actions.clip = clip
    local previous, shown, placed = nil, 0, 0
    local inUse = {}
    -- Keyed by source as well as id: both shipped addons call their action "report", and
    -- one button between them means the addon that built it first answers for the other.
    -- A button an addon built keeps its own click handler, so that is not a label problem.
    local owner = clip and clip.source and clip.source.key or "?"

    local hidden = (Addon.db.profile.Frame or Defaults.profile.Frame).HiddenActions or {}
    for _, action in ipairs(list) do
        if not hidden[action.id] and (not action.visible or action.visible()) then
            local id = owner .. ":" .. action.id
            local button = frame.actions.byId[id]
            if not button then
                button = NewButton(frame, action)
                frame.actions.byId[id] = button
            end
            button.action = action
            inUse[id] = true

            local text = action.text
            if type(text) == "function" then text = text() end
            -- An icon button has no label to set; its `text` is the fallback for a client
            -- that cannot draw the icon, and that was read when it was built.
            if text and not button.showsIcon then button:SetText(text) end
            if action.onClipChanged then action.onClipChanged(clip, button) end

            button:ClearAllPoints()
            if action.anchor == "topright" then
                -- Out of the way of the line being read, and it makes no room for itself:
                -- the strip below the queue is what pushes the rows up.
                button:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
            elseif action.anchor == "header" then
                button:SetPoint("BOTTOMLEFT", frame.container.name, "RIGHT", -6, 0)
            elseif previous then
                button:SetPoint("BOTTOMLEFT", previous, "BOTTOMRIGHT", 4, 0)
                previous = button
            else
                button:SetPoint("BOTTOMLEFT", frame.portrait, "BOTTOMRIGHT", 15, 4)
                previous = button
            end
            button:Show()
            placed = placed + 1
            frame.actions.buttons[placed] = button
            if action.anchor ~= "topright" then
                shown = shown + 1
            end
        end
    end
    for id, button in pairs(frame.actions.byId) do
        if not inUse[id] then button:Hide() end
    end
    for i = placed + 1, getn(frame.actions.buttons) do
        frame.actions.buttons[i] = nil
    end
    frame.actions.shown = shown
    return shown
end
