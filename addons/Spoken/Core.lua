setfenv(1, SpokenEnv)

-- The object the ported queue code reaches timers and settings through, under the name
-- upstream gave it. A plain table with AceTimer embedded, not an AceAddon: the player has
-- no options table to register, no console commands of its own, and every client from
-- 1.12 up can embed AceTimer into anything. Reproducing the name is what keeps the
-- ported bodies diffable against upstream.
Addon = LibStub("AceTimer-3.0"):Embed({})

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
        },
        Minimap = {
            LibDBIcon = {}, -- LibDBIcon's own: minimapPos, lock, hide
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

-- AceDB needs the saved variable to exist, which is only true once the client has loaded
-- this addon's file. 1.12 hands an OnEvent handler nothing and sets the globals `event`
-- and `arg1` instead, hence the fallback.
local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:SetScript("OnEvent", function(_, _, name)
    if (name or arg1) == AddonFolder then
        Addon:InitDB()
    end
end)
