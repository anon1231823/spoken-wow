setfenv(1, SpokenEnv)

-- Local Minimal Classic skin. Playback and source-owned actions still belong to
-- the original queue/actions services. The original player remains available.
MinimalPlayer = { rows = {}, offset = 0, expanded = false }
local ART = [[Interface\AddOns\SpokenPlayer\Textures\]]
local HEIGHT, WIDTH, MAX_ROWS = 98, 380, 4
local function Clamp(n, low, high) return math.max(low, math.min(high, n)) end
local function Config() return Addon.db.profile.Frame end
local function Label(clip) return clip and (clip.present and clip.present.label or clip.key) or "" end
local function Font(parent, size, r, g, b)
    local text = parent:CreateFontString(nil, "OVERLAY")
    text:SetFont(GameFontNormal:GetFont(), size, "")
    text:SetShadowColor(0, 0, 0, 1)
    text:SetShadowOffset(1, -1)
    text:SetJustifyH("LEFT")
    text:SetWordWrap(false)
    text:SetTextColor(r, g, b)
    return text
end
local function BelongsTo(frame, root)
    while frame do
        if frame == root then return true end
        frame = frame.GetParent and frame:GetParent()
    end
    return false
end

function MinimalPlayer:IsEnabled()
    return Addon.db and Config().MinimalPlayer and not Version.IsAnyLegacy
end

function MinimalPlayer:HideTooltip()
    local owner = GameTooltip:GetOwner()
    if BelongsTo(owner, self.frame) or BelongsTo(owner, self.menu) then GameTooltip_Hide() end
end

function MinimalPlayer:HasClip()
    return self:IsEnabled() and self.wanted and SoundQueue:GetCurrentSound() ~= nil
end

function MinimalPlayer:Initialize(original)
    if self.frame then return end
    local frame = CreateFrame("Frame", "SpokenMinimalPlayerFrame", UIParent)
    self.frame = frame
    frame:SetSize(WIDTH, HEIGHT)
    local point, relative, relativePoint, x, y = original:GetPoint(1)
    frame:SetPoint(point or "BOTTOM", relative or UIParent, relativePoint or "BOTTOM", x or 0, y or 200)
    frame:SetMovable(true)
    frame:SetResizable(true)
    frame:SetClampedToScreen(true)
    frame:SetUserPlaced(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function() self:StartDrag() end)
    frame:SetScript("OnDragStop", function() frame:StopMovingOrSizing() end)
    frame:SetScript("OnMouseUp", function(_, button)
        if button == "RightButton" then self:ToggleMenu() end
    end)
    frame:Hide()

    self.panel = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    self.panel:SetBackdrop({
        bgFile = ART .. "MinimalBackground",
        edgeFile = [[Interface\DialogFrame\UI-DialogBox-Border]],
        tile = true, tileSize = 256, edgeSize = 24,
        insets = { left = 7, right = 7, top = 7, bottom = 7 },
    })

    local content = CreateFrame("Frame", nil, frame)
    self.content, frame.container = content, content
    content:SetHeight(76)
    content:SetFrameLevel(self.panel:GetFrameLevel() + 1)
    self.header = CreateFrame("Button", nil, content)
    self.header:SetPoint("TOPLEFT")
    self.header:SetPoint("TOPRIGHT")
    self.header:SetHeight(23)
    self.header:RegisterForClicks("RightButtonUp")
    self.header:RegisterForDrag("LeftButton")
    self.header:SetScript("OnClick", function() self:ToggleMenu() end)
    self.header:SetScript("OnDragStart", function() self:StartDrag() end)
    self.header:SetScript("OnDragStop", function() frame:StopMovingOrSizing() end)
    self.name = Font(self.header, 16, 1, .82, 0)
    self.name:SetAllPoints()
    content.name = self.name -- Actions' original header anchor contract.
    content.buttons = {}

    self.fold = CreateFrame("Button", nil, content)
    self.fold:SetSize(16, 16)
    self.fold:SetPoint("TOPRIGHT", 0, -26)
    self.fold.icon = self.fold:CreateTexture(nil, "ARTWORK")
    self.fold.icon:SetSize(16, 16)
    self.fold.icon:SetPoint("RIGHT")
    self.fold:SetHighlightTexture([[Interface\Buttons\UI-PlusButton-Hilight]], "ADD")
    self.fold:GetHighlightTexture():ClearAllPoints()
    self.fold:GetHighlightTexture():SetAllPoints(self.fold.icon)
    -- Folded, the count is the only sign that more lines are waiting.
    self.fold.count = Font(self.fold, 11, 1, .82, 0)
    self.fold.count:SetPoint("RIGHT", self.fold.icon, "LEFT", -2, 0)
    self.fold:SetScript("OnMouseDown", function() self.fold.pushed = true; self:LayoutQueue() end)
    self.fold:SetScript("OnMouseUp", function() self.fold.pushed = false; self:LayoutQueue() end)
    self.fold:SetScript("OnClick", function() self:ToggleQueue() end)
    self.fold:SetScript("OnEnter", function()
        GameTooltip:SetOwner(self.fold, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.QUEUE_TITLE)
        GameTooltip:AddLine(format(L.MIN_QUEUE_HINT, math.max(0, SoundQueue:GetQueueSize() - 1)), 1, .82, 0, true)
        GameTooltip:Show()
    end)
    self.fold:SetScript("OnLeave", function() self:HideTooltip() end)
    self.fold:Hide()

    -- As in the original player, clicking the playing line takes it out of the queue.
    self.title = CreateFrame("Button", nil, content)
    self.title:SetPoint("TOPLEFT", 0, -25)
    self.title:SetPoint("TOPRIGHT", self.fold, "TOPLEFT", -4, 1)
    self.title:SetHeight(19)
    self.title:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    self.title.text = Font(self.title, 12, .88, .84, .76)
    self.title.text:SetAllPoints()
    self.title:SetScript("OnClick", function(_, button)
        if button == "RightButton" then self:ToggleMenu()
        elseif self:HasClip() then SoundQueue:RemoveSoundFromQueue(self.clip) end
    end)
    self.title:SetScript("OnEnter", function()
        self.title.text:SetTextColor(225 / 255, 20 / 255, 8 / 255)
        if not self:HasClip() then return end
        GameTooltip:SetOwner(self.title, "ANCHOR_RIGHT")
        GameTooltip:SetText(Label(self.clip))
        GameTooltip:AddLine(L.QUEUE_REMOVE_TOOLTIP, 1, .82, 0, true)
        GameTooltip:AddLine(L.MIN_MENU_HINT, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    self.title:SetScript("OnLeave", function()
        self.title.text:SetTextColor(.88, .84, .76)
        self:HideTooltip()
    end)

    self.bar = CreateFrame("StatusBar", nil, content)
    self.bar:SetPoint("TOPLEFT", 2, -52)
    self.bar:SetPoint("TOPRIGHT", -2, -52)
    self.bar:SetHeight(4)
    self.bar:SetStatusBarTexture([[Interface\TargetingFrame\UI-StatusBar]])
    self.bar:SetMinMaxValues(0, 1)
    self.bar:SetValue(0)
    local track = self.bar:CreateTexture(nil, "BACKGROUND")
    track:SetAllPoints()
    track:SetColorTexture(.035, .035, .025, 1)
    local trim = self.bar:CreateTexture(nil, "OVERLAY")
    trim:SetTexture(ART .. "MinimalCastBorder")
    trim:SetPoint("TOPLEFT", -4, 4)
    trim:SetPoint("BOTTOMRIGHT", 4, -4)

    self:BuildPortrait()
    self:BuildMenu()
    Actions:Build(frame)

    self.drawer = CreateFrame("Frame", nil, frame)
    self.drawer:EnableMouseWheel(true)
    self.drawer:SetScript("OnMouseWheel", function(_, delta)
        self.offset = Clamp(self.offset - delta, 0, math.max(0, SoundQueue:GetQueueSize() - 1 - MAX_ROWS))
        self:LayoutQueue()
    end)
    self.queueNote = Font(self.drawer, 10, .62, .58, .46)
    self.drawer:Hide()

    self.resizer = CreateFrame("Button", nil, frame)
    self.resizer:SetSize(12, 12)
    self.resizer:SetPoint("BOTTOMRIGHT", -5, 12)
    self.resizer:SetNormalTexture(ART .. "SizeGrabber-Up")
    self.resizer:SetAlpha(0)
    self.resizer:SetScript("OnMouseDown", function(_, button)
        if button ~= "LeftButton" or Config().LockFrame then return end
        self.sizing = true
        frame:StartSizing("BOTTOMRIGHT")
    end)
    self.resizer:SetScript("OnMouseUp", function()
        frame:StopMovingOrSizing()
        if self.sizing then Config().MinimalWidth = frame:GetWidth() + (Config().HidePortrait and 80 or 0) end
        self.sizing = false
    end)
    frame:SetScript("OnSizeChanged", function() self:LayoutQueue() end)
    frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
    frame:SetScript("OnHide", function()
        self.menu:Hide()
        self:HideTooltip()
    end)
end

function MinimalPlayer:BuildPortrait()
    local host = CreateFrame("Frame", nil, self.frame)
    self.portrait, self.frame.portrait = host, host
    host:SetPoint("TOPLEFT", 0, -4)
    host:SetSize(90, 90)
    host:SetFrameLevel(self.content:GetFrameLevel() + 2)
    local background = host:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetTexture(ART .. "MinimalPortraitBackground")

    self.viewport = CreateFrame("Frame", nil, host)
    self.viewport:SetSize(78, 78)
    self.viewport:SetPoint("CENTER", host, "TOPLEFT", 90 * 35 / 71, -90 * 34 / 71)
    self.viewport:SetClipsChildren(true)
    local chrome = CreateFrame("Frame", nil, host)
    chrome:SetAllPoints()
    chrome:SetFrameLevel(host:GetFrameLevel() + 8)
    -- Unit-frame badge centres are backed separately from their metal ring.
    -- Without this disc the speaker's face shows through the speech-bubble badge.
    self.badgeBackground = chrome:CreateTexture(nil, "BACKGROUND")
    self.badgeBackground:SetSize(24, 24)
    self.badgeBackground:SetPoint("CENTER", host, "TOPLEFT", 90 * 56.5 / 71, -90 * 56.5 / 71)
    self.badgeBackground:SetTexture(ART .. "MinimalPortraitMask")
    self.badgeBackground:SetVertexColor(.04, .04, .035, 1)
    local ring = chrome:CreateTexture(nil, "ARTWORK")
    ring:SetAllPoints()
    ring:SetTexture(ART .. "MinimalPortraitRing")
    self.badge = chrome:CreateTexture(nil, "OVERLAY")
    self.badge:SetSize(16, 16)
    self.badge:SetPoint("CENTER", host, "TOPLEFT", 90 * 56.5 / 71, -90 * 56.5 / 71)

    -- Beneath the chrome, so the paused wash never dims the ring or the badge.
    local button = CreateFrame("Button", nil, host)
    self.pause = button
    button:SetAllPoints()
    button:SetFrameLevel(chrome:GetFrameLevel() - 1)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button.wash = button:CreateTexture(nil, "BACKGROUND")
    button.wash:SetAllPoints()
    button.wash:SetTexture(ART .. "MinimalPortraitBackground")
    button.wash:SetAlpha(.55)
    button:SetNormalTexture(ART .. "PortraitFrameAtlas")
    local icon = button:GetNormalTexture()
    icon:ClearAllPoints()
    icon:SetPoint("CENTER", self.viewport)
    icon:SetSize(20, 20)
    button:SetScript("OnClick", function(_, mouseButton)
        if mouseButton == "RightButton" then self:ToggleMenu()
        elseif self:HasClip() and SoundQueue:CanBePaused() then SoundQueue:TogglePauseQueue() end
    end)
    button:SetScript("OnEnter", function()
        self:UpdateControls()
        if not self:HasClip() or self.menu:IsShown() then return end
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.PLAY or L.PAUSE)
        GameTooltip:AddLine(L.PAUSE_TOOLTIP, 1, 1, 1, true)
        GameTooltip:AddLine(L.MIN_MENU_HINT, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function() self:UpdateControls(); self:HideTooltip() end)
end

function MinimalPlayer:BuildMenu()
    local menu = CreateFrame("Frame", "SpokenMinimalPlayerMenu", UIParent, "BackdropTemplate")
    self.menu = menu
    menu:SetSize(210, 144)
    menu:SetFrameStrata("TOOLTIP")
    menu:SetClampedToScreen(true)
    menu:EnableMouse(true)
    menu:SetBackdrop({ bgFile = [[Interface\Tooltips\UI-Tooltip-Background]],
        edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    menu:SetBackdropColor(.07, .065, .05, .98)
    menu:SetBackdropBorderColor(.6, .57, .48, 1)
    menu:Hide()
    table.insert(UISpecialFrames, "SpokenMinimalPlayerMenu")
    menu:RegisterEvent("GLOBAL_MOUSE_DOWN")
    menu:SetScript("OnEvent", function()
        if menu:IsShown() and not MouseIsOver(menu) and not MouseIsOver(self.frame) then menu:Hide(); self:HideTooltip() end
    end)
    self.menuButtons = {}
    local function Item(text, fn)
        local button = CreateFrame("Button", nil, menu)
        local index = getn(self.menuButtons) + 1
        self.menuButtons[index] = button
        button:SetPoint("TOPLEFT", 10, -8 - (index - 1) * 23)
        button:SetPoint("TOPRIGHT", -10, -8 - (index - 1) * 23)
        button:SetHeight(23)
        button.text = Font(button, 12, 1, .82, 0)
        button.text:SetPoint("LEFT", 4, 0)
        button.text:SetText(text)
        button:SetHighlightTexture([[Interface\QuestFrame\UI-QuestTitleHighlight]])
        button:GetHighlightTexture():SetAlpha(.25)
        button:SetScript("OnClick", function()
            menu:Hide()
            self:HideTooltip()
            if self:HasClip() then fn() end
        end)
        return button
    end
    self.menuPlay = Item(L.PAUSE, function() if SoundQueue:CanBePaused() then SoundQueue:TogglePauseQueue() end end)
    self.menuSkip = Item(L.MIN_SKIP, function() SoundQueue:Skip() end)
    self.menuStop = Item(L.MIN_STOP_ALL, function() SoundQueue:RemoveAllSoundsFromQueue() end)
    self.menuQueue = Item(L.QUEUE_TITLE, function() self:ToggleQueue() end)
    Item(L.SETTINGS, function() Options:Open() end)
    self.actionHost = CreateFrame("Frame", nil, menu)
    self.actionHost:SetPoint("TOPLEFT", 12, -128)
    self.actionHost:SetSize(186, 32)
end

function MinimalPlayer:ConfigureActions()
    Actions:Configure(self.frame, self.clip)
    local x, y, rowHeight, count = 0, 0, 0, 0
    for _, button in ipairs(self.frame.actions.buttons) do
        local width, height = button:GetWidth(), button:GetHeight()
        if x > 0 and x + width > 186 then x = 0; y = y + rowHeight + 5; rowHeight = 0 end
        button:SetParent(self.actionHost)
        button:SetFrameLevel(self.actionHost:GetFrameLevel() + 1)
        button:ClearAllPoints()
        button:SetPoint("TOPLEFT", x, -y)
        x = x + width + 6
        rowHeight = math.max(rowHeight, height)
        count = count + 1
    end
    self.actionHost:SetHeight(math.max(1, y + rowHeight))
    self.menu:SetHeight(count > 0 and 140 + y + rowHeight or 132)
end

function MinimalPlayer:ToggleMenu()
    if not self:HasClip() then return end
    if self.menu:IsShown() then self.menu:Hide(); self:HideTooltip(); return end
    self:ConfigureActions()
    self:UpdateControls()
    self:HideTooltip()
    self.menu:ClearAllPoints()
    self.menu:SetPoint("TOPLEFT", self.frame, "BOTTOMLEFT", Config().HidePortrait and 12 or 36, 8)
    self.menu:SetScale(self.frame:GetScale())
    self.menu:Show()
end

function MinimalPlayer:StartDrag()
    if not Config().LockFrame then self.menu:Hide(); self.frame:StartMoving() end
end

function MinimalPlayer:ConfigurePortrait()
    if Config().HidePortrait then return end
    if not StaticPortrait:Configure(self.viewport, self.clip) then Portrait:Configure(self.viewport, self.clip) end
    local viewport = self.viewport
    if viewport.active == "texture" and viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    local bullet = self.clip.present and Bullets[self.clip.present.bullet]
    if bullet then
        local texture = bullet.texture
        for _, kind in ipairs({ "Accept", "Progress", "Complete", "Gossip" }) do
            if type(texture) == "string" and string.find(texture, "SoundQueueBullet" .. kind, 1, true) then
                texture = ART .. "MinimalBullet" .. kind
                break
            end
        end
        self.badge:SetTexture(texture)
        self.badge:Show()
    else self.badge:Hide() end
end

function MinimalPlayer:UpdateControls()
    if not self.clip then return end
    local paused, playing = SoundQueue:IsPaused(), SoundQueue:IsPlaying()
    local left = paused and 0 or 93
    self.pause:GetNormalTexture():SetTexCoord(left / 512, (left + 93) / 512, 419 / 512, 1)
    self.pause:GetNormalTexture():SetAlpha((paused or MouseIsOver(self.pause)) and .9 or 0)
    self.pause.wash:SetShown(paused and not playing)
    self.bar:SetStatusBarColor(paused and .48 or .86, paused and .44 or .67, paused and .32 or .14)
    local held = not paused and not playing and SoundQueue:GetHeldReason(self.clip)
    self.title.text:SetText(held and format("%s |cffaaaa88(%s)|r", Label(self.clip), held) or Label(self.clip))
    self.menuPlay.text:SetText(paused and L.MIN_RESTART or L.PAUSE)
    self.menuQueue.text:SetText(format("%s (%d)", L.QUEUE_TITLE, math.max(0, SoundQueue:GetQueueSize() - 1)))
    for _, button in ipairs({ self.menuPlay, self.menuSkip, self.menuStop }) do
        if SoundQueue:CanBePaused() then button:Enable(); button.text:SetAlpha(1)
        else button:Disable(); button.text:SetAlpha(.35) end
    end
end

function MinimalPlayer:UpdateProgress()
    local clip = self.clip
    if not clip then return end
    local duration = tonumber(clip.length) or 0
    if clip.nextSoundTimer and duration > 0 then
        -- The queue's timer includes the source's trailing gap and any initial
        -- silence. TimeLeft therefore also handles hidden UI and replay accurately.
        local remaining = Addon:TimeLeft(clip.nextSoundTimer)
        self.seconds = Clamp(duration + (clip.source.interClipGap or 0) - remaining, 0, duration)
    elseif not SoundQueue:IsPaused() then self.seconds = 0 end
    self.bar:SetValue(duration > 0 and (self.seconds or 0) / duration or 0)
end

function MinimalPlayer:CreateQueueRow(index)
    local button = CreateFrame("Button", nil, self.drawer)
    self.rows[index] = button
    button:SetPoint("TOPLEFT", 0, -(index - 1) * 22)
    button:SetPoint("TOPRIGHT", 0, -(index - 1) * 22)
    button:SetHeight(22)
    button.text = Font(button, 11, .84, .78, .65)
    button.text:SetPoint("LEFT")
    button.text:SetPoint("RIGHT", -16, 0)
    button.remove = Font(button, 13, 1, .35, .25)
    button.remove:SetPoint("RIGHT")
    button.remove:SetText("x")
    button.remove:Hide()
    button:SetScript("OnEnter", function()
        button.remove:Show()
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(Label(button.clip))
        GameTooltip:AddLine(L.QUEUE_REMOVE_TOOLTIP, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function() button.remove:Hide(); self:HideTooltip() end)
    button:SetScript("OnClick", function()
        if self:HasClip() then SoundQueue:RemoveSoundFromQueue(button.clip) end
    end)
    return button
end

function MinimalPlayer:LayoutQueue()
    if not self.drawer then return end
    local waiting = math.max(0, SoundQueue:GetQueueSize() - 1)
    self.offset = Clamp(self.offset, 0, math.max(0, waiting - MAX_ROWS))
    local shown = self.expanded and math.min(MAX_ROWS, waiting - self.offset) or 0
    for index = 1, MAX_ROWS do
        local button = self.rows[index]
        if index <= shown then
            button = button or self:CreateQueueRow(index)
            button.clip = SoundQueue.sounds[index + self.offset + 1]
            local held = SoundQueue:GetHeldReason(button.clip)
            button.text:SetText(held and format("%s (%s)", Label(button.clip), held) or Label(button.clip))
            button.remove:Hide()
            button:Show()
        elseif button then button:Hide(); button.clip = nil end
    end
    local paged = shown > 0 and waiting > MAX_ROWS
    local height = shown * 22 + (paged and 18 or 0)
    self.drawer:ClearAllPoints()
    self.drawer:SetSize(math.max(1, self.frame:GetWidth() - (Config().HidePortrait and 34 or 114)), math.max(1, height))
    local up = shown > 0 and (self.frame:GetBottom() or 200) < height + 12
    local left = Config().HidePortrait and 16 or 96
    if up then self.drawer:SetPoint("BOTTOMLEFT", self.frame, "TOPLEFT", left, -4)
    else self.drawer:SetPoint("TOPLEFT", self.frame, "BOTTOMLEFT", left, 4) end
    self.drawer:SetShown(shown > 0)
    local glyph = (self.expanded and "Minus" or "Plus") .. (self.fold.pushed and "Button-Down" or "Button-Up")
    self.fold.icon:SetTexture([[Interface\Buttons\UI-]] .. glyph)
    self.fold.count:SetText(waiting)
    self.fold:SetWidth(18 + self.fold.count:GetStringWidth())
    self.fold:SetShown(waiting > 0)
    self.queueNote:ClearAllPoints()
    self.queueNote:SetPoint("BOTTOMLEFT")
    self.queueNote:SetText(format(L.MIN_SCROLL_QUEUE, self.offset + 1, self.offset + shown, waiting))
    self.queueNote:SetShown(paged)
    self.panel:ClearAllPoints()
    -- The panel is shorter than the circle and starts behind its centre. Its
    -- left corners sit beneath the opaque portrait rather than outside the rim.
    -- Centred on the portrait, so the text block gets even top and bottom margins.
    self.panel:SetPoint("TOPLEFT", self.frame, "TOPLEFT", Config().HidePortrait and 0 or 44, up and height + 4 or -6)
    self.panel:SetPoint("BOTTOMRIGHT", self.frame, "BOTTOMRIGHT", 0, shown > 0 and not up and -height - 4 or 10)
    if self.resizer then self.resizer:SetShown(not Config().LockFrame and shown == 0) end
end

function MinimalPlayer:ToggleQueue()
    if not self:HasClip() then return end
    self.expanded = not self.expanded
    self.offset = 0
    self:LayoutQueue()
end

function MinimalPlayer:SetVisible(visible, immediate)
    if not self.frame then return end
    if not visible then self.menu:Hide(); self:HideTooltip() end
    if immediate then
        self.wanted = false
        self.frame:Hide()
        self.frame:SetAlpha(0)
        self.fadeTime = nil
        return
    end
    if self.wanted == visible then return end
    self.wanted = visible
    self.fadeFrom = self.frame:IsShown() and self.frame:GetAlpha() or 0
    self.fadeTime = 0
    if visible then self.frame:SetAlpha(self.fadeFrom); self.frame:Show() end
end

function MinimalPlayer:Tick(elapsed)
    if self.fadeTime then
        self.fadeTime = self.fadeTime + elapsed
        local t = Clamp(self.fadeTime / (self.wanted and .18 or .24), 0, 1)
        local eased = 1 - (1 - t) * (1 - t)
        self.frame:SetAlpha(self.fadeFrom + ((self.wanted and 1 or 0) - self.fadeFrom) * eased)
        if t == 1 then
            self.fadeTime = nil
            if not self.wanted then self.frame:Hide(); return end
        end
    end
    if not self.wanted then return end
    self:UpdateProgress()
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:UpdateControls()
        self.resizer:SetAlpha(MouseIsOver(self.frame) and .65 or 0)
    end
end

function MinimalPlayer:RefreshConfig(original)
    self:Initialize(original.frame)
    local cfg, frame = Config(), self.frame
    frame:SetScale(cfg.FrameScale)
    frame:SetFrameStrata(cfg.FrameStrata)
    frame:SetResizeBounds(cfg.HidePortrait and 200 or 280, HEIGHT, 1000, HEIGHT)
    frame:SetWidth(Clamp((cfg.MinimalWidth or WIDTH) - (cfg.HidePortrait and 80 or 0), cfg.HidePortrait and 200 or 280, 1000))
    self.content:ClearAllPoints()
    self.content:SetPoint("TOPLEFT", cfg.HidePortrait and 16 or 96, -18)
    self.content:SetPoint("TOPRIGHT", -18, -18)
    self.portrait:SetShown(not cfg.HidePortrait)
    if cfg.LockFrame then frame:StopMovingOrSizing(); self.sizing = false end
    self:Update()
end

function MinimalPlayer:Update()
    if not self.frame then return end
    if not self:IsEnabled() or Config().HideFrame then self:SetVisible(false, true); return end
    local clip = SoundQueue:GetCurrentSound()
    if not clip then self:SetVisible(false); self.expanded = false; return end
    if clip ~= self.clip then
        self.menu:Hide()
        self:HideTooltip()
        self.clip, self.seconds, self.offset = clip, 0, 0
    end
    self:SetVisible(true)
    self.name:SetText(clip.present and clip.present.header or "")
    self:ConfigurePortrait()
    self:ConfigureActions()
    self:LayoutQueue()
    self:UpdateProgress()
    self:UpdateControls()
end

function MinimalPlayer:Reset()
    if not self.frame then return end
    self.frame:StopMovingOrSizing()
    Config().MinimalWidth = WIDTH
    self.frame:ClearAllPoints()
    self.frame:SetPoint("BOTTOM", UIParent, "BOTTOM", 0, 200)
    self:RefreshConfig(PlayerFrame)
end

function MinimalPlayer:Describe()
    return format("minimal=%s visible=%s portrait=%s queueExpanded=%s progress=%.1fs",
        tostring(self:IsEnabled()), tostring(self.frame and self.frame:IsShown()),
        tostring(self.viewport and self.viewport.active), tostring(self.expanded), self.seconds or 0)
end
