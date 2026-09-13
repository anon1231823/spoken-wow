-- The settings layout every Spoken addon builds its panel with.
--
-- BYTE-IDENTICAL IN EVERY SPOKEN ADDON. A copy lives in SpokenPlayer, SpokenQuests and
-- SpokenZones, and the packaging tests assert the three are the same file. The addons
-- cannot share a file at runtime -- each is installed on its own, and the player is only
-- an optional dependency of the other two -- so they share it by carrying it, the way
-- vendored libraries do. Edit one copy and copy it over the others; do not edit in place.
--
-- Deliberately idiom-free: no setfenv, no addon table, no localisation. Every label and
-- every accessor is passed in, so the same file suits an addon that runs in a private
-- environment and one that does not.
--
-- Lua 5.0 rules, because this loads on 1.12: no `#`, no literal-string method calls.

local VERSION = 1

-- LibStub's contract, for LibStub's reason: three addons load this file and the newest
-- copy must win, whichever of them the client happens to load last.
if SpokenLayout and SpokenLayout.VERSION and SpokenLayout.VERSION >= VERSION then
    return
end

local format = string.format

local function Count(list)
    local n = 0
    for _ in ipairs(list) do
        n = n + 1
    end
    return n
end

-- One rhythm, kept here rather than at the call sites. Every row used to place itself by
-- adding its own fudge to a running offset, and no two sections were spaced alike.
local ROW_GAP = 8          -- between rows inside a section
local SECTION_GAP = 32     -- above a section heading
local HEADING_GAP = 6      -- between a heading and the first row under it
local HEADING_HEIGHT = 16
local CHECKBOX_SIZE = 26
local BUTTON_HEIGHT = 22
local SLIDER_HEIGHT = 16
local SLIDER_LABEL_GAP = 18   -- the label sits above the bar, inside the row
local INDENT_STEP = 20        -- for an option that qualifies the one above it

-- A heading belongs to the section under it. The space above it is what separates two
-- sections; the space below it must stay smaller, or the heading reads as floating
-- between the two rather than introducing one.
local Layout = { VERSION = VERSION }
Layout.__index = Layout

--- Render a slider's value. Passed to Slider; the default reads it as a percentage.
function Layout.Percent(value) return format("%d%%", value * 100) end
function Layout.Seconds(value) return format("%.1fs", value) end
function Layout.Number(value) return format("%d", math.floor(value + 0.5)) end

local function Tooltip(frame, title, body)
    if not body and not title then
        return
    end
    frame:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetText(title or body)
        if title and body then
            GameTooltip:AddLine(body, 1, 1, 1, true)
        end
        GameTooltip:Show()
    end)
    frame:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

--- A panel's rows, top-anchored and running downward from `top`.
function Layout.New(parent, x, top)
    return setmetatable({ parent = parent, x = x, top = top, y = top, empty = true }, Layout)
end

--- Reserve a row `height` tall at the current offset and step past it.
function Layout:Take(height)
    local y = self.y
    self.y = self.y - height - ROW_GAP
    self.empty = false
    return y
end

--- Record the row a control was given. A control may sit inside its row -- a slider's bar
--- hangs below its own label -- but never outside it.
function Layout:Row(frame, top, height)
    frame.layoutY, frame.layoutHeight = top, height
    return frame
end

--- Step the following rows in, for options that qualify the one above them, and back out.
function Layout:Indent()
    self.x = self.x + INDENT_STEP
    return self
end

function Layout:Outdent()
    self.x = self.x - INDENT_STEP
    return self
end

--- How tall the panel has grown. For a scrolling host that must size its content.
function Layout:Height()
    return self.top - self.y
end

function Layout:Section(text)
    if not self.empty then
        self.y = self.y - SECTION_GAP + ROW_GAP   -- the section gap replaces the row gap
    end
    local fs = self.parent:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    fs:SetPoint("TOPLEFT", self.x, self.y)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    fs.layoutY, fs.layoutHeight, fs.layoutHeading = self.y, HEADING_HEIGHT, true
    self.y = self.y - HEADING_HEIGHT - HEADING_GAP
    self.empty = false
    return fs
end

--- Prose, not a setting: wraps to `width`, and occupies a row like anything else. It gets
--- no tighter gap of its own -- an exception is how a panel stops having one rhythm.
function Layout:Note(text, width, height)
    height = height or 28
    local top = self:Take(height)
    local fs = self.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    fs:SetPoint("TOPLEFT", self.x, top)
    fs:SetJustifyH("LEFT")
    fs:SetWidth(width or 460)
    fs:SetText(text)
    return self:Row(fs, top, height)
end

function Layout:Checkbox(label, tooltip, read, write, apply)
    local top = self:Take(CHECKBOX_SIZE)
    local box = CreateFrame("CheckButton", nil, self.parent, "UICheckButtonTemplate")
    box:SetSize(CHECKBOX_SIZE, CHECKBOX_SIZE)
    box:SetPoint("TOPLEFT", self.x, top)
    box.text = box:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    box.text:SetPoint("LEFT", box, "RIGHT", 2, 0)
    box.text:SetText(label)
    box:SetScript("OnShow", function(self) self:SetChecked(read() and true or false) end)
    box:SetScript("OnClick", function(self)
        write(self:GetChecked() and true or false)
        if apply then apply() end
    end)
    box:SetChecked(read() and true or false)
    Tooltip(box, label, tooltip)
    return self:Row(box, top, CHECKBOX_SIZE)
end

function Layout:Slider(label, minValue, maxValue, step, read, write, apply, show)
    show = show or Layout.Percent
    local height = SLIDER_HEIGHT + SLIDER_LABEL_GAP
    local top = self:Take(height)
    -- OptionsSliderTemplate is the private-server clients' name for it; WOW_PROJECT_ID
    -- exists on every client that calls it UISliderTemplate.
    local template = WOW_PROJECT_ID == nil and "OptionsSliderTemplate" or "UISliderTemplate"
    local slider = CreateFrame("Slider", nil, self.parent, template)
    -- Both load-bearing: a slider given neither draws nothing at all, leaving a gap on the
    -- panel where a setting should be.
    slider:SetHeight(SLIDER_HEIGHT)
    slider:SetOrientation("HORIZONTAL")
    slider:SetWidth(180)
    -- `top` is the top of the row. The label is anchored above the bar, so the bar sits a
    -- label's height down and the whole row stays inside what was reserved for it.
    slider:SetPoint("TOPLEFT", self.x + 4, top - SLIDER_LABEL_GAP)
    slider:SetMinMaxValues(minValue, maxValue)
    slider:SetValueStep(step)
    if slider.SetObeyStepOnDrag then
        slider:SetObeyStepOnDrag(true)
    end
    slider.label = slider:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    slider.label:SetPoint("BOTTOMLEFT", slider, "TOPLEFT", 0, 4)
    -- Labelled when built as well as on show: a slider on a panel nobody has opened still
    -- reads as what it is.
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
    slider:SetValue(read())
    return self:Row(slider, top, height)
end

--- A button that cycles through `values`. A dropdown would be the obvious control, but
--- UIDropDownMenu's Initialize plumbing cannot be checked without launching the game, and
--- a handful of values does not justify the risk.
function Layout:Cycle(label, tooltip, values, read, write, apply)
    local top = self:Take(BUTTON_HEIGHT)
    local button = CreateFrame("Button", nil, self.parent, "UIPanelButtonTemplate")
    button:SetSize(240, BUTTON_HEIGHT)
    button:SetPoint("TOPLEFT", self.x, top)
    local function Sync()
        button:SetText(format(label, read()))
    end
    button:SetScript("OnClick", function()
        local list = values
        if type(list) == "function" then
            list = list()
        end
        local count = Count(list)
        if count == 0 then
            return
        end
        local index = 1
        for i = 1, count do
            if list[i] == read() then
                index = i
                break
            end
        end
        -- Not math.mod: 1.12's Lua has it, LuaJIT does not, and the harness runs on
        -- LuaJIT. Plain arithmetic is the same wrap on every one of them.
        local following = index + 1
        if following > count then
            following = 1
        end
        write(list[following])
        if apply then apply() end
        Sync()
    end)
    button:SetScript("OnShow", Sync)
    Tooltip(button, nil, tooltip)
    Sync()
    return self:Row(button, top, BUTTON_HEIGHT)
end

function Layout:Button(label, width, onClick, tooltip)
    local top = self:Take(BUTTON_HEIGHT)
    local button = CreateFrame("Button", nil, self.parent, "UIPanelButtonTemplate")
    button:SetSize(width, BUTTON_HEIGHT)
    button:SetPoint("TOPLEFT", self.x, top)
    button:SetText(label)
    button:SetScript("OnClick", onClick)
    Tooltip(button, nil, tooltip)
    return self:Row(button, top, BUTTON_HEIGHT)
end

--- A control this file does not build: placed in a row of its own, at `height`.
function Layout:Custom(frame, height)
    local top = self:Take(height)
    frame:SetPoint("TOPLEFT", self.x, top)
    return self:Row(frame, top, height)
end

SpokenLayout = Layout
