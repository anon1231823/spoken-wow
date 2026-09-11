setfenv(1, SpokenEnv)

-- Per-client overrides. Loaded last, so everything it replaces already exists. Each block
-- writes into the environment, never into _G, which is the whole point of the environment.
--
-- Only the playback half of VoiceOverRedux's Compatibility.lua lives here so far: what the
-- frame and model overrides need arrives with the player's UI. The quest-side policy that
-- used to sit inside these functions -- toggling the NPC's own greeting off on 1.12 when
-- AutoToggleDialog is set -- does not: that is the quests addon's, and it hooks the queue.

--------------------------------------------------------------------------------- 1.12
if Version.IsLegacyVanilla then

    -- One sound system, one CVar, no channels and no way to stop a single sound. What it
    -- can do is stop *every* sound by toggling effects off and on again.
    function SoundUtils:WhyInaudible(channel)
        if tonumber(GetCVar("MasterSoundEffects")) ~= 1 then
            return "sound effects are disabled"
        end
        return nil
    end

    -- PlaySoundFile reports success for any filename here, so a probe learns nothing;
    -- the lookup table is the only word on whether a file exists.
    function SoundUtils:TestSound(clip)
        return true
    end

    function SoundUtils:PlaySound(clip, channel)
        PlaySoundFile(clip.path)
        clip.handle = 1 -- anything non-nil: marks the clip as one StopSound can act on
        return true, clip.handle
    end

    function SoundUtils:StopSound(clip)
        SetCVar("MasterSoundEffects", 0)
        SetCVar("MasterSoundEffects", 1)
        clip.handle = nil
    end

end

--------------------------------------------------------------------------- 2.4.3 / 3.3.5
if Version.IsLegacyBurningCrusade or Version.IsLegacyWrath then

    function SoundUtils:WhyInaudible(channel)
        if tonumber(GetCVar("Sound_EnableAllSound")) ~= 1 then
            return "all sound is disabled"
        end
        if Addon.db.profile.Audio.LegacyMusicChannel.Enabled then
            return nil
        end
        if tonumber(GetCVar("Sound_EnableSFX")) ~= 1 then
            return "the SFX sound channel is disabled"
        end
        return nil
    end

    function SoundUtils:TestSound(clip)
        return true
    end

    --[[
        Here begins the code the plays the VO over music channel in order to support the ability to pause/stop the VO.
        2.4.3's and 3.3.5's PlaySound/PlaySoundFile cannot be stopped by any means short of restarting the whole sound system (freezes the client for a couple of seconds).
        But PlayMusic can be stopped with StopMusic. This, however, causes the currently played script music to fade out instead of cutting,
            which is a problem, because by letting this happen we'll hear the VO looping until it fully fades out. This can be worked around
            by PlayMusic'ing another file (even one that doesn't exist), as that causes the script music to be instantly interrupted.
        Toggling Sound_EnableMusic cvar off-and-on additionally allows us to interrupt the current in-game background music.
        The whole process looks as follows:
        1. Sound queue requests to start playing the VO by calling SoundUtils:PlaySound
        2. Music volume is smoothly lowered to 0 over the config.FadeOutMusic duration
        3. In-game background music is instantly stopped by toggling Sound_EnableMusic cvar off-and-on
        4. Music volume is instantly changed to config.Volume level
        5. VO sound file is played on the music channel
        6. Once the VO's duration has ran out (soundData.stopSoundTimer) - silence.wav is played as music to instantly stop the VO and prevent it from looping
        7. Sound queue requests to stop playing the VO by calling SoundUtils:StopSound (either due to pause or soundData being removed from the queue) - silence.wav is played again to interrupt the VO in case it hasn't finished playing naturally
        8. Music volume is instantly changed to 0
        9. Music volume is smoothly raised to back to the pre-VO level over the config.FadeOutMusic duration
        10. In-game background music is removed by calling StopMusic()

        On 2.4.3 steps 2 and 3 are swapped, because 3.3.5's trick to instantly stop music by toggling cvars causes it to instead
            fade out over a short time on 2.4.3 (around 0.4-0.5 secs). So we lock config.FadeOutMusic to 0.5 secs let the client
            fade music out naturally during these 0.5 seconds, after which we bump the volume up and proceed as normal.
    ]]
    local function GetCurrentVolume()
        return tonumber(GetCVar("Sound_MusicVolume")) or 1
    end
    local function PlaySilence()
        PlayMusic([[Interface\AddOns\Spoken\Sounds\silence.wav]])
    end

    -- Functions that deal with temporarily changing player's sound settings to utilize the music channel for VO playback
    local prev_Sound_EnableMusic
    local prev_Sound_MusicVolume
    local function ReplaceCVars()
        if prev_Sound_EnableMusic == nil then
            prev_Sound_EnableMusic = GetCVar("Sound_EnableMusic")
            prev_Sound_MusicVolume = GetCVar("Sound_MusicVolume")
            SetCVar("Sound_EnableMusic", 1)
        end
    end
    local function RestoreCVars()
        if prev_Sound_EnableMusic ~= nil then
            SetCVar("Sound_EnableMusic", prev_Sound_EnableMusic)
            SetCVar("Sound_MusicVolume", prev_Sound_MusicVolume)
            prev_Sound_EnableMusic = nil
            prev_Sound_MusicVolume = nil
        end
    end

    -- Functions that deal with smoothly changing the music channel's volume to avoid abrupt changes
    local slideVolumeTarget
    local slideVolumeRate
    local slideVolumeCallback
    local EPS_VOLUME = 0.01
    local function GetMusicFadeOutDuration()
        if tonumber(prev_Sound_EnableMusic) == 0 or tonumber(prev_Sound_MusicVolume) == 0 then
            return 0
        end
        return Addon.db.profile.Audio.LegacyMusicChannel.FadeOutMusic or 0
    end
    local function StopSlideVolume()
        slideVolumeTarget = nil
        slideVolumeRate = nil
        slideVolumeCallback = nil
    end
    local function SlideVolume(target, callback)
        local duration = GetMusicFadeOutDuration()
        if duration <= 0 then
            -- Instantly change the volume if the player had reduced the duration all the way to 0
            return false
        end
        local current = GetCurrentVolume()
        if math.abs(target - current) <= EPS_VOLUME then
            -- Instantly "change" the volume if it's already fuzzy-equal to the target volume, and cancel the ongoing slide volume ("remove currently played sound from queue" case)
            StopSlideVolume()
            return false
        end
        -- Interpolate towards the target volume over the configured duration
        slideVolumeTarget = target
        slideVolumeRate = (target - current) / duration
        slideVolumeCallback = callback
        return true
    end
    local volumeFrame = CreateFrame("Frame", "SpokenSlideVolumeFrame", UIParent)
    volumeFrame:RegisterEvent("PLAYER_LOGOUT")
    volumeFrame:SetScript("OnEvent", function(self, event)
        if event == "PLAYER_LOGOUT" then
            StopSlideVolume()
            RestoreCVars()
        end
    end)
    volumeFrame:SetScript("OnUpdate", function(self, elapsed)
        if slideVolumeRate then
            local current = GetCurrentVolume()
            local target = slideVolumeTarget
            local next = current + slideVolumeRate * elapsed
            local finished = false
            if math.abs(target - current) <= EPS_VOLUME or current < target and next >= target or current > target and next <= target then
                next = target
                finished = true
            end
            SetCVar("Sound_MusicVolume", next)
            if finished then
                if slideVolumeCallback then
                    slideVolumeCallback()
                end
                StopSlideVolume()
            end
        end
    end)

    function SoundUtils:PlaySound(soundData)
        soundData.delay = nil
        if not Addon.db.profile.Audio.LegacyMusicChannel.Enabled then
            -- Play VO as a sound, but have no ability to stop it
            _G.PlaySoundFile(soundData.path)
            return
        end

        soundData.handle = 1 -- Just put something here to flag the sound as stoppable

        ReplaceCVars()
        local function Play()
            -- Hack to instantly interrupt the music
            SetCVar("Sound_EnableMusic", 0)
            SetCVar("Sound_EnableMusic", 1)

            SetCVar("Sound_MusicVolume", Addon.db.profile.Audio.LegacyMusicChannel.Volume)
            PlayMusic(soundData.path)

            soundData.stopSoundTimer = Addon:ScheduleTimer(function()
                PlaySilence() -- Instantly interrupt the VO sound
            end, soundData.length)
        end
        if SlideVolume(0, Play) then
            soundData.delay = GetMusicFadeOutDuration()

            if Version.IsLegacyBurningCrusade then
                -- On 2.4.3 we ask the client to interrupt the music here and give it time to fade out naturally
                SetCVar("Sound_EnableMusic", 0)
                SetCVar("Sound_EnableMusic", 1)
                PlaySilence()
            end
        else
            Play()
        end
    end

    function SoundUtils:StopSound(soundData)
        if not soundData.handle then
            -- VO was played as a sound - we cannot stop it
            return
        end

        Addon:CancelTimer(soundData.stopSoundTimer, true)
        soundData.stopSoundTimer = nil
        -- Upstream left the handle set here, so a stopped clip still looked stoppable.
        soundData.handle = nil

        PlaySilence() -- Instantly interrupt the VO sound
        SetCVar("Sound_MusicVolume", 0)

        local function ResumeMusic()
            StopMusic()
            RestoreCVars()
        end
        if not SlideVolume(tonumber(prev_Sound_MusicVolume) or 1, ResumeMusic) then
            ResumeMusic()
        end
    end


end
