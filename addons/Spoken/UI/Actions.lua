setfenv(1, SpokenEnv)

-- The strip of buttons under the queue, built from the speaking clip's presentation.
-- Zones bring Read and Report; quests bring Report, and Stop Gossip anchored to the
-- header. The player lays them out and knows nothing about what they do.
--
--   action = { id, text = "Read" | fun():string, tooltip = fun(GameTooltip),
--              visible = fun():boolean, onClick = fun(clip), anchor = "header"?,
--              create = fun(parent):Button?, onClipChanged = fun(clip, button)? }
--
-- `create` opts a button out of the default template -- the report button builds its
-- own -- and such a button keeps its own OnClick; the player only tells it which clip
-- it now stands beside.
Actions = {}

local ACTION_WIDTH = 70
local ACTION_HEIGHT = 18
Actions.STRIP_HEIGHT = ACTION_HEIGHT + 6

function Actions:Build(frame)
    frame.actions = { buttons = {}, byId = {}, shown = 0 }
end

local function NewButton(frame, action)
    local button
    if action.create then
        button = action.create(frame)
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
    button:SetSize(ACTION_WIDTH, ACTION_HEIGHT)
    return button
end

--- Lay out the actions for `clip` (the head), hiding whatever the last clip left.
---@return number shown
function Actions:Configure(frame, clip)
    local list = clip and clip.present and clip.present.actions or {}
    frame.actions.clip = clip
    local previous, shown = nil, 0
    local inUse = {}

    for _, action in ipairs(list) do
        if not action.visible or action.visible() then
            local button = frame.actions.byId[action.id]
            if not button then
                button = NewButton(frame, action)
                frame.actions.byId[action.id] = button
            end
            button.action = action
            inUse[action.id] = true

            local text = action.text
            if type(text) == "function" then text = text() end
            if text then button:SetText(text) end
            if action.onClipChanged then action.onClipChanged(clip, button) end

            button:ClearAllPoints()
            if action.anchor == "header" then
                button:SetPoint("BOTTOMLEFT", frame.container.name, "RIGHT", -6, 0)
            elseif previous then
                button:SetPoint("BOTTOMLEFT", previous, "BOTTOMRIGHT", 4, 0)
                previous = button
            else
                button:SetPoint("BOTTOMLEFT", frame.portrait, "BOTTOMRIGHT", 15, 4)
                previous = button
            end
            button:Show()
            shown = shown + 1
            frame.actions.buttons[shown] = button
        end
    end
    for id, button in pairs(frame.actions.byId) do
        if not inUse[id] then button:Hide() end
    end
    for i = shown + 1, getn(frame.actions.buttons) do
        frame.actions.buttons[i] = nil
    end
    frame.actions.shown = shown
    return shown
end
