setfenv(1, SpokenEnv)

-- The object the ported queue code reaches timers and settings through, under the name
-- upstream gave it. A plain table with AceTimer embedded, not an AceAddon: the player has
-- no options table to register, no console commands of its own, and every client from
-- 1.12 up can embed AceTimer into anything. Reproducing the name is what keeps the
-- ported bodies diffable against upstream.
Addon = LibStub("AceTimer-3.0"):Embed({})

-- What feature addons register through API.lua and the UI reads back.
Bullets = {}
Renderers = {}

-- Player-wide settings only. Anything a single domain cares about -- gossip frequency,
-- autoplay, which pack to prefer -- stays in that feature addon's own saved variables.
Defaults = {
    profile = {
        Frame = {
            LockFrame = false,
            FrameScale = 0.7,
            FrameStrata = "HIGH",
            HidePortrait = false,
            HideFrame = false,
        },
        Audio = {
            -- A string, because that is what PlaySoundFile takes. The quests addon keeps
            -- its enum internally and converts at the boundary.
            SoundChannel = "Master",
            -- 2.4.3 and 3.3.5 only. Those clients cannot stop a sound once started, so the
            -- player routes speech through the music channel, which can be stopped. This
            -- moved here from the quests addon because it is how the *player* plays on those
            -- clients, whichever addon queued the line.
            LegacyMusicChannel = (Version.IsLegacyWrath or Version.IsLegacyBurningCrusade or nil) and {
                Enabled = true,
                Volume = 1,
                FadeOutMusic = 0.5,
            },
            -- 2.4.3 and 3.3.5 with HD model patches: which set the portrait's animation
            -- durations are looked up in.
            LegacyHDModels = (Version.IsLegacyWrath or Version.IsLegacyBurningCrusade or nil) and false,
        },
        Minimap = {
            LibDBIcon = {}, -- LibDBIcon's own: minimapPos, lock, hide
            -- What each mouse button does. "Menu" opens the list; any other value is a
            -- menu entry id, the player's or a source's.
            Commands = {
                LeftButton = "Menu",
                MiddleButton = "PlayPause",
                RightButton = "Settings",
            },
        },
    },
    char = {
        IsPaused = false,
    },
}

--- Idempotent, so the test harness and ADDON_LOADED can both call it.
function Addon:InitDB()
    if self.db then
        return
    end
    self.db = LibStub("AceDB-3.0"):New("SpokenDB", Defaults)
end

--- Everything that needs the world: the frame, the button, the settings, the slash
--- command. Idempotent, so the harness and PLAYER_LOGIN can both call it.
function Addon:Enable()
    if self.enabled then return end
    self:InitDB()
    self.enabled = true
    PlayerFrame:Initialize()
    Minimap:Setup()
    Options:Setup()

    SLASH_SPOKEN1 = "/spoken"
    SlashCmdList.SPOKEN = function(input)
        local command = strlower(strtrim(input or ""))
        if command == "play" or command == "pause" or command == "" then
            SoundQueue:TogglePauseQueue()
        elseif command == "stop" then
            SoundQueue:RemoveAllSoundsFromQueue()
        elseif command == "skip" then
            SoundQueue:Skip()
        elseif command == "options" or command == "settings" then
            Options:Open()
        elseif command == "reset" then
            PlayerFrame:Reset()
        elseif command == "diagnostics" then
            print(format("Spoken %s, API %d, %d queued, %s", AddonVersion, Spoken.API_VERSION,
                SoundQueue:GetQueueSize(), SoundQueue:IsPaused() and "paused" or "playing"))
            for key, source in Sources:Iterate() do
                print(format("  source %s (%s)", key, source.addon or "?"))
            end
            for _, err in ipairs(Callbacks.errors) do print("  callback error: " .. err) end
        else
            print("Spoken: /spoken play | stop | skip | options | reset | diagnostics")
        end
    end
end

-- AceDB needs the saved variable to exist, which is only true once the client has loaded
-- this addon's file. 1.12 hands an OnEvent handler nothing and sets the globals `event`
-- and `arg1` instead, hence the fallback.
local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", function(_, ev, name)
    ev = ev or event
    if ev == "ADDON_LOADED" and (name or arg1) == AddonFolder then
        Addon:InitDB()
    elseif ev == "PLAYER_LOGIN" then
        Addon:Enable()
    end
end)
