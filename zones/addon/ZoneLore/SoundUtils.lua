-- ZoneLore -- the bottom of the playback stack: starting and stopping one file.
--
-- Ported from AI_VoiceOver's Utils.lua (public domain), which is where the sound
-- queue in SoundQueue.lua calls down to. Kept as its own file rather than folded
-- into Audio.lua because these two are what a shared player addon would take,
-- while Audio.lua is entirely ZoneLore's -- packs, languages, map areas.
--
-- Written in the ordinary addon idiom rather than upstream's private environment:
-- nothing here is close enough to upstream to be worth diffing, because ZoneLore
-- stores its sound channel as a plain string and upstream stores an enum.

local ADDON_NAME, ZoneLore = ...

local SoundUtils = {}
ZoneLore.SoundUtils = SoundUtils
ZoneLore.QueueEnv.Utils = SoundUtils

-- Why sound cannot be heard right now, phrased for the player, or nil when it
-- can. PlaySoundFile returns false both for a missing file and for a muted
-- channel, so without asking first those two are indistinguishable -- and they
-- want opposite responses from whoever is reading the message.
--
-- Master has no CVar of its own, so it is only covered by the global check.
--
-- Upstream additionally refuses when Sound_EnableSFX is off, on the grounds that
-- the SFX channel gates every other channel. That is not reproduced here: it
-- would be a new reason for ZoneLore to refuse to play, it cannot be confirmed
-- without a client, and being wrong about it means silence where there is now
-- sound. Worth testing on 11509 before adopting.
function SoundUtils:WhyInaudible(channel)
	if GetCVar("Sound_EnableAllSound") == "0" then
		return "all sound is disabled"
	end
	if channel ~= "Master" and GetCVar("Sound_Enable" .. channel) == "0" then
		return ("the %s sound channel is disabled"):format(channel)
	end
	return nil
end

function SoundUtils:IsSoundEnabled(channel)
	return self:WhyInaudible(channel) == nil
end

-- Starts the clip and records the handle on the item, which is the only way to
-- stop it again. Returns whether the client accepted the file, so a caller can
-- tell a missing file from a silent one.
function SoundUtils:PlaySound(soundData, channel)
	local willPlay, handle = PlaySoundFile(soundData.filePath, channel)
	soundData.handle = handle
	return willPlay
end

function SoundUtils:StopSound(soundData)
	if soundData.handle then
		StopSound(soundData.handle)
	end
	soundData.handle = nil
end
