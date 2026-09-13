setfenv(1, VoiceOver)
Options = { }

local AceGUI = LibStub("AceGUI-3.0")
local AceConfigDialog = LibStub("AceConfigDialog-3.0")
local AceDBOptions = LibStub("AceDBOptions-3.0")

------------------------------------------------------------
-- Construction of the options table for AceConfigDialog --

local function SortAceConfigOptions(a, b)
    return (a.order or 100) < (b.order or 100)
end

-- Needed to preserve order (modern AceGUI has support for custom sorting of dropdown items, but old versions don't)
local FRAME_STRATAS =
{
    "BACKGROUND",
    "LOW",
    "MEDIUM",
    "HIGH",
    "DIALOG",
}

-- General Tab
---@type AceConfigOptionsTable
local GeneralTab =
{
    name = "General",
    type = "group",
    order = 10,
    args = {
        Audio = {
            type = "group",
            order = 4,
            inline = true,
            name = "Audio",
            args = {
                GossipFrequency = {
                    type = "select",
                    width = 1.1,
                    order = 3,
                    name = "NPC Greeting Playback Frequency",
                    desc = "Controls how often Spoken Quests will play NPC greeting dialog. The Once options are remembered for this character across NPC revisits and logins.",
                    values = {
                        [Enums.GossipFrequency.Always] = "Always",
                        [Enums.GossipFrequency.OncePerQuestNPC] = "Once per Quest NPC (per character)",
                        [Enums.GossipFrequency.OncePerNPC] = "Once per NPC (per character)",
                        [Enums.GossipFrequency.Never] = "Never",
                    },
                    get = function(info) return Addon.db.profile.Audio.GossipFrequency end,
                    set = function(info, value)
                        Addon.db.profile.Audio.GossipFrequency = value
                        Player:RefreshConfig()
                    end,
                },
                LineBreak2 = { type = "description", name = "", order = 5 },
                ToggleSyncToWindowState = {
                    type = "toggle",
                    order = 6,
                    width = 2,
                    name = "Sync Dialog to Window State",
                    desc = "Narration will automatically stop when the gossip/quest window is closed.",
                    get = function(info) return Addon.db.profile.Audio.StopAudioOnDisengage end,
                    set = function(info, value)
                        Addon.db.profile.Audio.StopAudioOnDisengage = value
                    end,
                },
                LineBreak3 = { type = "description", name = "", order = 7 },
                OGThrall = {
                    type = "toggle",
                    order = 8,
                    width = 2,
                    name = "OG Thrall",
                    desc = "Plays the original AI VoiceOver recording of Thrall's \"All members of the Horde are equal in my eyes\" speech instead of this addon's.",
                    get = function(info) return Addon.db.profile.Audio.OGThrall end,
                    set = function(info, value)
                        Addon.db.profile.Audio.OGThrall = value
                    end,
                },
            }
        },
        Debug = {
            type = "group",
            order = 5,
            inline = true,
            name = "Debugging Tools",
            args = {
                DebugEnabled = {
                    type = "toggle",
                    order = 1,
                    width = 1.25,
                    name = "Enable Debug Messages",
                    desc = "Enables printing of some \"useful\" debug messages to the chat window.",
                    get = function(info) return Addon.db.profile.DebugEnabled end,
                    set = function(info, value) Addon.db.profile.DebugEnabled = value end,
                },
            }
        }
    }
}

-- The 2.4.3/3.3.5 music-channel and HD-model settings are the Spoken player's now.
local LegacyWrathTab = nil

---@type AceConfigOptionsTable
local DataModulesTab =
{
    name = function() return format("Data Modules%s", next(Options.table.args.DataModules.args.Available.args) and "|cFF00CCFF (NEW)|r" or "") end,
    type = "group",
    childGroups = "tree",
    order = 20,
    args = {
        Available = {
            type = "group",
            name = "|cFF00CCFFAvailable|r",
            order = 100000,
            hidden = function(info) return not next(Options.table.args.DataModules.args.Available.args) end,
            args = {}
        }
    }
}

---@type AceConfigOptionsTable
local SlashCommands = {
    type = "group",
    name = "Commands",
    order = 110,
    inline = true,
    dialogHidden = true,
    args = {
        PlayPause = {
            type = "execute",
            order = 1,
            name = "Play/Pause Audio",
            desc = "Play/Pause voiceovers",
            hidden = true,
            func = function(info)
                if Spoken then Spoken:TogglePause() end
            end
        },
        Play = {
            type = "execute",
            order = 2,
            name = "Play Audio",
            desc = "Resume the playback of voiceovers",
            func = function(info)
                if Spoken then Spoken:Resume() end
            end
        },
        Pause = {
            type = "execute",
            order = 3,
            name = "Pause Audio",
            desc = "Pause the playback of voiceovers",
            func = function(info)
                if Spoken then Spoken:Pause() end
            end
        },
        Skip = {
            type = "execute",
            order = 4,
            name = "Skip Line",
            desc = "Skip the currently played voiceover",
            func = function(info)
                if Spoken then Spoken:Skip() end
            end
        },
        Clear = {
            type = "execute",
            order = 5,
            name = "Clear Queue",
            desc = "Stop the playback and clears the voiceovers queue",
            func = function(info)
                if Spoken then Spoken:StopAll() end
            end
        },
        Read = {
            type = "execute",
            order = 70,
            name = "Read Visible Quest",
            desc = "Narrate the quest panel that is currently visible",
            dropdownHidden = true,
            func = function(info)
                if not Addon:ReadVisibleQuest("/vo read") then
                    print("|cFFFF4040Spoken Quests: no visible quest detail, progress, reward, or greeting panel was found.|r")
                end
            end
        },
        Test = {
            type = "execute",
            order = 80,
            name = "Test Audio",
            desc = "Play a short known file from the Vanilla Data module",
            dropdownHidden = true,
            func = function(info)
                local soundData = {
                    event = Enums.SoundEvent.QuestAccept,
                    questID = 3441,
                    name = "Spoken Quests self-test",
                    title = "Spoken Quests self-test",
                }
                if not DataModules:PrepareSound(soundData) then
                    Debug:Record("self-test-data-failed", "The Vanilla Data module did not provide the known 3441-accept test sound")
                    print("|cFFFF4040Spoken Quests test failed: the known Vanilla test sound was not found in the loaded sound packs.|r")
                    return
                end

                -- Through the player, the route every real line takes: on 2.4.3 and 3.3.5
                -- that means the music channel, and a self-test that went another way would
                -- answer a question nobody asked.
                local channel = Player.source and Player.source:GetChannel() or "unknown"
                if Player:Enqueue(soundData) then
                    Debug:Record("self-test-playing", format("Self-test queued on %s: %s", channel, soundData.filePath))
                    print(format("|cFF40FF40Spoken Quests test started on %s.|r You should hear a short voice line.", channel))
                else
                    local stage, message = Debug:GetRuntimeStatus()
                    print(format("|cFFFF4040Spoken Quests test failed: %s (%s).|r", message or "refused", stage or "unknown"))
                end
            end
        },
        Diagnostics = {
            type = "execute",
            order = 90,
            name = "Diagnostics",
            desc = "Print client, API, and sound-pack loading status",
            dropdownHidden = true,
            func = function(info)
                print(format("|cFF00CCFFSpoken Quests %s|r - client %s, interface %d",
                    AddonVersion, Version.Client or "unknown", Version.Interface or 0))
                print("AddOn API: " .. (C_AddOns and "C_AddOns compatibility layer" or "legacy globals"))

                local channel = Player.source and Player.source:GetChannel() or "unknown"
                print(format("Playback: channel=%s, paused=%s, queue=%d, player=%s", channel,
                    tostring(Spoken and Spoken:IsPaused()), Spoken and Spoken:GetQueueSize() or 0,
                    Spoken and Spoken.ADDON_VERSION or "missing"))
                print("NPC greetings: " ..
                    (Enums.GossipFrequency:GetName(Addon.db.profile.Audio.GossipFrequency) or "unknown"))
                print(format("Sound CVars: all=%s, master=%s, SFX=%s/%s, dialog=%s/%s",
                    tostring(GetCVar("Sound_EnableAllSound")), tostring(GetCVar("Sound_MasterVolume")),
                    tostring(GetCVar("Sound_EnableSFX")), tostring(GetCVar("Sound_SFXVolume")),
                    tostring(GetCVar("Sound_EnableDialog")), tostring(GetCVar("Sound_DialogVolume"))))

                local presentCount, registeredCount = 0, 0
                for _, module in DataModules:GetPresentModules() do
                    presentCount = presentCount + 1
                    local registered = DataModules:GetModule(module.AddonName) ~= nil
                    if registered then
                        registeredCount = registeredCount + 1
                    end
                    local status = registered and "loaded" or (DataModules:GetModuleLoadError(module.AddonName) or "not loaded")
                    print(format("Data: %s (%s) - %s", module.AddonName,
                        module.ContentVersion or "unknown version", status))
                end
                if presentCount == 0 then
                    print("Data: no sound packs were detected")
                else
                    print(format("Data modules: %d detected, %d loaded", presentCount, registeredCount))
                end
                local stage, message = Debug:GetRuntimeStatus()
                print(format("Last runtime stage: %s - %s", stage or "none", message or "no details"))
                if Addon.eventBridgeErrors then
                    for _, warning in ipairs(Addon.eventBridgeErrors) do
                        print("Bridge warning: " .. warning)
                    end
                end
                if Addon.optionsInitializationError then
                    print("Options startup warning: " .. Addon.optionsInitializationError)
                end
                if Addon.dataModulesPending then
                    print("Data startup: loading is deferred until one second after entering the world")
                elseif Addon.dataModulesDeferredError then
                    print("Data startup warning: " .. Addon.dataModulesDeferredError)
                end
                if Options.initializationErrors then
                    for _, warning in ipairs(Options.initializationErrors) do
                        print("Options warning: " .. warning)
                    end
                end
            end
        },
        Options = {
            type = "execute",
            order = 100,
            name = "Open Options",
            desc = "Open the options panel",
            func = function(info)
                Options:OpenConfigWindow()
            end
        },
    }
}

---@type AceConfigOptionsTable
Options.table = {
    name = "Spoken Quests",
    type = "group",
    childGroups = "tab",
    args = {
        General = GeneralTab,
        LegacyWrath = LegacyWrathTab,
        DataModules = DataModulesTab,
        Profiles = nil, -- Filled in Options:OnInitialize, order is implicitly 100

        SlashCommands = SlashCommands,
    }
}
------------------------------------------------------------

---@param module DataModuleMetadata
---@param order number
function Options:AddDataModule(module, order)
    local descriptionOrder = 0
    local function GetNextOrder()
        descriptionOrder = descriptionOrder + 1
        return descriptionOrder
    end
    local function MakeDescription(header, text)
        return { type = "description", order = GetNextOrder(), name = function() return format("%s%s: |r%s", NORMAL_FONT_COLOR_CODE, header, type(text) == "function" and text() or text) end }
    end

    local name, title, notes, loadable, reason = DataModules:GetModuleAddOnInfo(module)
    if reason == "DEMAND_LOADED" or reason == "INTERFACE_VERSION" then
        reason = nil
    end
    DataModulesTab.args[module.AddonName] = {
        name = function()
            local isLoaded = DataModules:GetModule(module.AddonName)
            return format("%d. %s%s%s|r",
                order,
                reason and RED_FONT_COLOR_CODE or isLoaded and HIGHLIGHT_FONT_COLOR_CODE or GRAY_FONT_COLOR_CODE,
                string.gsub(module.Title, "VoiceOver Data %- ", ""),
                isLoaded and "" or " (not loaded)")
        end,
        type = "group",
        order = order,
        args = {
            AddonName = MakeDescription("Addon Name", module.AddonName),
            Title = MakeDescription("Title", module.Title),
            ModuleVersion = MakeDescription("Module Data Format Version", module.ModuleVersion),
            ModulePriority = MakeDescription("Module Priority", module.ModulePriority),
            ContentVersion = MakeDescription("Content Version", module.ContentVersion),
            LoadOnDemand = MakeDescription("Load on Demand", module.LoadOnDemand and "Yes" or "No"),
            Loaded = MakeDescription("Is Loaded", function() return DataModules:GetModule(module.AddonName) and "Yes" or "No" end),
            NotLoadableReason = {
                type = "description",
                order = GetNextOrder(),
                name = format("%sReason: |r%s%s|r", NORMAL_FONT_COLOR_CODE, RED_FONT_COLOR_CODE, reason and _G["ADDON_"..reason] or ""),
                hidden = not reason,
            },
            Load = {
                type = "execute",
                order = GetNextOrder(),
                name = "Load",
                hidden = function() return reason or not module.LoadOnDemand or DataModules:GetModule(module.AddonName) end,
                func = function()
                    local loaded, reason = DataModules:LoadModule(module)
                    if not loaded then
                        StaticPopup_Show("VOICEOVER_ERROR", format([[Failed to load data module "%s". Reason: %s]], module.AddonName, reason and _G["ADDON_" .. reason] or "Unknown"))
                    end
                end,
            },
        }
    }
end

---@param module AvailableDataModule
---@param order number
---@param update boolean Data module has update
function Options:AddAvailableDataModule(module, order, update)
    local descriptionOrder = 0
    local function GetNextOrder()
        descriptionOrder = descriptionOrder + 1
        return descriptionOrder
    end
    local function MakeDescription(header, text)
        return { type = "description", order = GetNextOrder(), name = function() return format("%s%s: |r%s", NORMAL_FONT_COLOR_CODE, header, type(text) == "function" and text() or text) end }
    end

    DataModulesTab.args.Available.args[module.AddonName] = {
        name = Utils:ColorizeText(format(update and "%s (Update)" or "%s", string.gsub(module.Title, "VoiceOver Data %- ", "")), "|cFF00CCFF"),
        type = "group",
        order = order,
        args = {
            AddonName = MakeDescription("Addon Name", module.AddonName),
            Title = MakeDescription("Title", module.Title),
            ContentVersion = MakeDescription("Content Version", format(update and "%2$s -> |cFF00CCFF%1$s|r" or "%s", module.ContentVersion, update and DataModules:GetPresentModule(module.AddonName).ContentVersion)),
            URL = {
                type = "input",
                order = GetNextOrder(),
                width = "full",
                name = "Download URL",
                get = function(info) return module.URL end,
                set = function(info) end,
            },
        }
    }
end

---Initialization of opens panel
function Options:Initialize()
    self.initializationErrors = {}
    local function RunOptionalStep(name, callback)
        local succeeded, result = pcall(callback)
        if succeeded then
            return result
        end
        local message = name .. ": " .. tostring(result)
        table.insert(self.initializationErrors, message)
    end

    RunOptionalStep("profile options", function()
        self.table.args.Profiles = AceDBOptions:GetOptionsTable(Addon.db)
    end)

    -- Create options table
    Debug:Print("Registering options table...", "Options")
    local AceConfig = LibStub("AceConfig-3.0")
    if Addon.RegisterOptionsTable then
        -- Embedded version for 1.12
        AceConfig = Addon
    end
    RunOptionalStep("AceConfig slash registration", function()
        AceConfig:RegisterOptionsTable("SpokenQuests", self.table, "vo")
    end)
    RunOptionalStep("Blizzard settings categories", function()
        AceConfigDialog:AddToBlizOptions("SpokenQuests", "Spoken Quests")
        for key, tab in Utils:Ordered(Options.table.args, SortAceConfigOptions) do
            if not tab.hidden and not tab.dialogHidden then
                AceConfigDialog:AddToBlizOptions("SpokenQuests",
                    type(tab.name) == "function" and tab.name() or tab.name,
                    "SpokenQuests", key)
            end
        end
    end)
    Debug:Print("Done!", "Options")

    -- Create the option frame
    ---@type AceGUIFrame|AceGUIWidget
    RunOptionalStep("AceGUI options frame", function()
        self.frame = AceGUI:Create("Frame")
        --AceConfigDialog:SetDefaultSize("VoiceOver", 640, 780) -- Let it be auto-sized
        AceConfigDialog:Open("SpokenQuests", self.frame)
        self.frame:SetLayout("Fill")
        self.frame:Hide()

        -- Enable the frame to be closed with Escape key
        _G["VoiceOverOptions"] = self.frame.frame
        tinsert(UISpecialFrames, "VoiceOverOptions")
    end)
end

function Options:OpenConfigWindow()
    if not self.frame then
        print("|cFFFF4040Spoken Quests: the legacy options window is unavailable on this client. " ..
            "Quest narration and slash commands remain active.|r")
        return
    end
    if self.frame:IsShown() then
        PlaySound(SOUNDKIT.IG_MAINMENU_CLOSE)
        self.frame:Hide()
    else
        PlaySound(SOUNDKIT.IG_MAINMENU_OPEN)
        self.frame:Show()
        AceConfigDialog:Open("SpokenQuests", self.frame)
    end
end
