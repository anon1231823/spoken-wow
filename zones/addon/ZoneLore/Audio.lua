-- ZoneLore -- narrated lore playback.
--
-- All playback state lives here; UI/AudioButton.lua is the only thing that draws
-- it. One clip plays at a time, addon-wide, so starting a new one always stops
-- whatever was running.
--
-- Audio ships in a separate ZoneLoreAudio addon, which is optional: without it
-- every lookup falls back to the bundled placeholder, so the button is testable
-- before any audio exists and merely sounds wrong rather than erroring.

local ADDON_NAME, ZoneLore = ...

local AUDIO_ADDON = "ZoneLoreAudio"
local SOUND_ROOT = "Interface\\AddOns\\" .. AUDIO_ADDON .. "\\Sounds\\"
local PLACEHOLDER = "Interface\\AddOns\\" .. ADDON_NAME .. "\\Sounds\\placeholder.mp3"

-- Measured from the file. Hardcoded because the client cannot report a sound's
-- length, and without a duration the "clip finished" path -- the button resetting
-- itself, the floating controls disappearing -- cannot be exercised at all until
-- real audio exists. Update this if the placeholder is ever swapped.
local PLACEHOLDER_DURATION = 40.124

-- PlaySoundFile only accepts these. An unknown name makes the call fail outright,
-- so a saved variable carrying a stale channel falls back rather than going silent.
local CHANNELS = {
	Master = true,
	SFX = true,
	Music = true,
	Ambience = true,
	Dialog = true,
}
local DEFAULT_CHANNEL = "Dialog"

-- What is playing right now, or nil: { handle, mapID, areaKey, token }.
local current = nil

-- Bumped on every play and stop. A timer that fires with a stale token belongs to
-- a clip that has already been superseded, and must not stop the current one.
local token = 0

-- Callbacks fired whenever playback starts or stops, so every button showing the
-- same entry agrees on its glyph without polling.
ZoneLore.audioChangedCallbacks = {}

function ZoneLore:OnAudioChanged(fn)
	table.insert(self.audioChangedCallbacks, fn)
end

-- Public because toggling the feature off has to refresh every button too, not
-- just the transitions that start and stop a clip.
function ZoneLore:NotifyAudioChanged()
	local list = self.audioChangedCallbacks
	for i = 1, #list do
		local ok, err = pcall(list[i])
		if not ok then
			ZoneLore:Print("|cffff5555error|r: %s", tostring(err))
		end
	end
end

--------------------------------------------------------------------------------
-- Lookup
--------------------------------------------------------------------------------

function ZoneLore:GetVoiceChannel()
	local channel = self:Get("voiceChannel")
	if type(channel) == "string" and CHANNELS[channel] then
		return channel
	end
	return DEFAULT_CHANNEL
end

function ZoneLore:IsVoiceEnabled()
	return self:Get("voiceEnabled") and true or false
end

-- Path and duration for a lore entry. `areaKey` is a canonical subzone key (see
-- ZoneLore:NormaliseAreaKey), or nil for the zone itself.
--
-- Duration comes from the generated lookup because there is no way to ask the
-- client how long a sound file is; without one the button could never reset itself.
function ZoneLore:GetAudioClip(mapID, areaKey)
	if not mapID then
		return nil, nil
	end

	local data = _G.ZoneLoreAudioData
	if data then
		local clip
		if areaKey then
			local zoneClips = data.subzones and data.subzones[mapID]
			clip = zoneClips and zoneClips[areaKey]
		else
			clip = data.zones and data.zones[mapID]
		end
		if clip and clip.file then
			return SOUND_ROOT .. clip.file .. ".mp3", clip.len
		end
	end

	return PLACEHOLDER, PLACEHOLDER_DURATION
end

function ZoneLore:HasAudio(mapID, areaKey)
	local path = self:GetAudioClip(mapID, areaKey)
	return path ~= nil
end

-- True when the audio addon is installed and carries a real clip for this entry,
-- as opposed to the placeholder. Reported by /zl play so a silent-looking result
-- can be told apart from a missing soundpack.
function ZoneLore:HasRealAudio(mapID, areaKey)
	local path = self:GetAudioClip(mapID, areaKey)
	return path ~= nil and path ~= PLACEHOLDER
end

--------------------------------------------------------------------------------
-- Playback
--------------------------------------------------------------------------------

function ZoneLore:IsPlayingLore(mapID, areaKey)
	if not current then
		return false
	end
	if mapID == nil then
		return true
	end
	return current.mapID == mapID and current.areaKey == areaKey
end

function ZoneLore:StopLore()
	if not current then
		return
	end
	if current.handle then
		StopSound(current.handle)
	end
	current = nil
	token = token + 1
	ZoneLore:NotifyAudioChanged()
end

-- A disabled sound channel makes PlaySoundFile return false with no other clue,
-- which otherwise looks exactly like a missing file. Master has no CVar of its own.
local function IsChannelAudible(channel)
	if GetCVar("Sound_EnableAllSound") == "0" then
		return false, "all sound is disabled"
	end
	if channel ~= "Master" and GetCVar("Sound_Enable" .. channel) == "0" then
		return false, ("the %s sound channel is disabled"):format(channel)
	end
	return true, nil
end

function ZoneLore:PlayLore(mapID, areaKey)
	self:StopLore()

	if not self:IsVoiceEnabled() then
		return false
	end

	local path, duration = self:GetAudioClip(mapID, areaKey)
	if not path then
		return false
	end

	local channel = self:GetVoiceChannel()
	local audible, why = IsChannelAudible(channel)
	if not audible then
		self:Print("|cffffcc00cannot play lore: %s|r", why)
		return false
	end

	local willPlay, handle = PlaySoundFile(path, channel)
	if not willPlay then
		self:Print("|cffffcc00no audio for this entry|r (missing %s)", path)
		return false
	end

	token = token + 1
	current = { handle = handle, mapID = mapID, areaKey = areaKey, token = token }

	-- Reset the button when the clip runs out. The client fires no event for this,
	-- so a recorded duration is the only signal; a clip of unknown length would stay
	-- in Stop state until the player clicks it or something else interrupts.
	if duration and duration > 0 then
		local mine = token
		C_Timer.After(duration + 0.25, function()
			if current and current.token == mine then
				current = nil
				ZoneLore:NotifyAudioChanged()
			end
		end)
	end

	ZoneLore:NotifyAudioChanged()
	return true
end

-- Play if this entry is not already playing, stop if it is. What the button does.
function ZoneLore:ToggleLore(mapID, areaKey)
	if self:IsPlayingLore(mapID, areaKey) then
		self:StopLore()
		return false
	end
	return self:PlayLore(mapID, areaKey)
end

--------------------------------------------------------------------------------
-- Why nothing here stops playback on its own
--------------------------------------------------------------------------------
--
-- Narration only stops when the player stops it, or when another clip starts.
-- Closing the map, navigating it, walking into another zone and hiding the lore
-- window all leave it running.
--
-- The alternative -- stopping when the entry scrolls out of view -- reads well as
-- a rule and is wrong in practice: the intended use is to start a zone's lore and
-- then close the map and walk, which that rule would cut off immediately. The
-- button always shows the state of the entry in front of it, so stopping is never
-- more than one click away.
