-- ZoneLore -- narrated lore playback.
--
-- All playback state lives here; UI/AudioButton.lua is the only thing that draws
-- it. One clip plays at a time, addon-wide, so starting a new one always stops
-- whatever was running.
--
-- Audio ships in separate sound-pack addons, all of them optional: without one
-- there is nothing to play, so the Play button does not appear and autoplay stays
-- quiet.
--
-- More than one pack can be installed at a time -- they differ in bitrate, and
-- now in language. Each registers itself into ZoneLoreAudioPacks under its own
-- folder name; this file picks which one to play from.
--
-- Every pack has the same structure and the same keys, so any installed pack is
-- playable regardless of the language being read: a player reading German with
-- only the English pack installed hears English narration rather than nothing.
-- When several packs are installed the player picks one; unpicked,
-- the language being read wins, then the client's own locale.

local ADDON_NAME, ZoneLore = ...

-- THERE IS NO STAND-IN CLIP. A line with no audio in the installed pack plays
-- nothing and says why.
--
-- There used to be one: Sounds/placeholder.mp3, a quest line borrowed from
-- ../wow-voiceover so the playback controls could be exercised before any real
-- narration existed. It was returned for every entry the pack did not cover, which
-- on a client with no pack installed is every entry there is -- so players heard a
-- stranger's quest audio about the League of Arathor over Elwynn Forest, Dun Morogh,
-- Felwood and Red Cloud Mesa, and reported it as the lore being wrong. They were
-- right: substituting unrelated audio is worse than silence, because silence is
-- honest about what is missing and this was not.

-- The pack table shape this version knows how to read. A pack declaring anything
-- else is ignored with a warning: refusing to read it is recoverable, guessing at
-- an unknown layout plays silence and reports nothing.
local PACK_FORMAT = 1

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

-- What was paused, or nil: { mapID, areaKey }.
--
-- The client can start and stop a sound file and nothing in between -- there is no
-- seek, and no way to ask how far into a clip playback has reached. So "pause" is
-- stop, and "resume" replays from the beginning. AI_VoiceOver's pause button works
-- exactly this way (SoundQueue:PauseQueue calls Utils:StopSound, ResumeQueue calls
-- PlaySound) for the same reason. The tooltip says so rather than letting the
-- player discover it.
local paused = nil

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
-- Sound packs
--------------------------------------------------------------------------------

-- Warned-about folder names, so an unreadable pack says so once per session
-- rather than on every lookup.
local warnedFormat = {}

-- Every installed pack this version can read, best match first. Packs are
-- registered by the data addons themselves at load time, so this is cheap enough
-- to walk on demand and always reflects what is loaded.
--
-- Every pack is listed whatever it narrates -- packs are interchangeable, and an
-- English pack under German text beats silence. Pass `lang` only to
-- narrow the answer to one language.
function ZoneLore:GetAudioPacks(lang)
	local packs = {}
	local registry = _G.ZoneLoreAudioPacks

	if type(registry) == "table" then
		for name, pack in pairs(registry) do
			if type(pack) == "table" and pack.version == PACK_FORMAT then
				-- A pack published before languages existed carries no language and
				-- is English, which is the same default Sounds.lua applies.
				if lang == nil or (pack.language or "enUS") == lang then
					table.insert(packs, pack)
				end
			elseif type(pack) == "table" and not warnedFormat[name] then
				warnedFormat[name] = true
				self:Print(
					"|cffffcc00%s is built for a different version of ZoneLore|r "
						.. "(pack format %s, this build reads %d) -- update both to the same major version",
					name, tostring(pack.version), PACK_FORMAT
				)
			end
		end
	elseif type(_G.ZoneLoreAudioData) == "table" and _G.ZoneLoreAudioData.version == PACK_FORMAT then
		-- A pack predating the registry. It only knew the one folder name.
		local legacy = _G.ZoneLoreAudioData
		legacy.addon = legacy.addon or "ZoneLoreAudio"
		legacy.quality = legacy.quality or "standard"
		legacy.bitrate = legacy.bitrate or 0
		legacy.language = legacy.language or "enUS"
		if lang == nil or legacy.language == lang then
			table.insert(packs, legacy)
		end
	end

	-- Best default first: the language being read, then the client's own locale,
	-- then bitrate descending, then folder name so the order is stable when two
	-- packs report the same bitrate (or none at all).
	local reading = self:GetLanguage()
	local client = self.clientLocale
	local function rank(pack)
		local language = pack.language or "enUS"
		if language == reading then
			return 0
		elseif language == client then
			return 1
		end
		return 2
	end
	table.sort(packs, function(a, b)
		local ra, rb = rank(a), rank(b)
		if ra ~= rb then
			return ra < rb
		end
		if (a.bitrate or 0) ~= (b.bitrate or 0) then
			return (a.bitrate or 0) > (b.bitrate or 0)
		end
		return tostring(a.addon) < tostring(b.addon)
	end)

	return packs
end

-- The pack narration plays from, or nil when no pack is installed at all.
--
-- The stored preference is a folder name rather than an index: a player who
-- uninstalls the high-quality pack should fall back to whatever is left instead
-- of pointing at whichever pack happens to occupy that slot afterwards. It is
-- kept per content language, so picking the English pack while reading German
-- does not overrule the German pack once one is installed and German is no
-- longer what is being read.
function ZoneLore:GetActiveAudioPack()
	local packs = self:GetAudioPacks()
	if #packs == 0 then
		return nil
	end

	local stored = self:Get("audioPack")
	local preferred = type(stored) == "table" and stored[self:GetLanguage()] or nil
	if type(preferred) == "string" then
		for i = 1, #packs do
			if packs[i].addon == preferred then
				return packs[i]
			end
		end
	end

	-- No preference, or the preferred pack is gone: best available wins -- the
	-- sort in GetAudioPacks already put the language being read first, then the
	-- client's locale.
	return packs[1]
end

-- Switches packs. Returns false when the name is not an installed pack, so the
-- caller can say so rather than storing a preference that resolves to nothing.
function ZoneLore:SetActiveAudioPack(name)
	local packs = self:GetAudioPacks()
	for i = 1, #packs do
		if packs[i].addon == name then
			local stored = self:Get("audioPack")
			if type(stored) ~= "table" then
				stored = {}
			end
			stored[self:GetLanguage()] = name
			self:Set("audioPack", stored)
			self:StopLore()
			self:NotifyAudioChanged()
			return true
		end
	end
	return false
end

-- "high (128 kbps)" -- for the options dropdown and /zl audio. The language is
-- named only when it is not the one being read, which is the case worth pointing
-- at: a pack that is installed but will never play.
function ZoneLore:GetAudioPackLabel(pack)
	if not pack then
		return "none"
	end
	local quality = pack.quality or "standard"
	local label = quality
	if pack.bitrate and pack.bitrate > 0 then
		label = ("%s (%d kbps)"):format(quality, pack.bitrate)
	end
	local language = pack.language or "enUS"
	if language ~= self:GetLanguage() then
		label = ("%s, %s"):format(label, language)
	end
	return label
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

	local pack = self:GetActiveAudioPack()
	if pack then
		local clip
		if areaKey then
			local zoneClips = pack.subzones and pack.subzones[mapID]
			clip = zoneClips and zoneClips[areaKey]
		else
			clip = pack.zones and pack.zones[mapID]
		end
		if clip and clip.file then
			return "Interface\\AddOns\\" .. pack.addon .. "\\Sounds\\" .. clip.file .. ".mp3", clip.len
		end
	end

	return nil, nil
end

function ZoneLore:HasAudio(mapID, areaKey)
	return self:GetAudioClip(mapID, areaKey) ~= nil
end

-- Why there is no clip, phrased for the player. Distinguishes "you have no sound
-- pack" from "your pack does not cover this line": the first is a download, the
-- second is nothing they can do, and telling them apart is the whole point of
-- saying anything at all.
function ZoneLore:DescribeMissingAudio()
	if #self:GetAudioPacks() == 0 then
		return "no sound pack installed -- get ZoneLore Audio to hear the lore read aloud"
	end
	return "no narration for this entry in the installed sound pack yet"
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

function ZoneLore:IsPaused()
	return paused ~= nil
end

-- What the floating controls are controlling: mapID, areaKey, isPaused. Nil when
-- nothing is playing or paused, which is also what hides the controls.
function ZoneLore:GetNowPlaying()
	if current then
		return current.mapID, current.areaKey, false
	end
	if paused then
		return paused.mapID, paused.areaKey, true
	end
	return nil, nil, false
end

-- A readable name for an entry, for the controls to label what is playing.
function ZoneLore:GetAudioLabel(mapID, areaKey)
	if not mapID then
		return ""
	end
	if areaKey then
		local zoneTable = self.Subzones[mapID]
		local entry = zoneTable and zoneTable[areaKey]
		return (entry and entry.name) or areaKey
	end
	return self:GetMapName(mapID) or tostring(mapID)
end

local function ClearPlayback()
	if current and current.handle then
		StopSound(current.handle)
	end
	current = nil
	token = token + 1
end

-- The player asking for silence, as opposed to playback being reset on the way to
-- starting something else. The distinction matters once autoplay has a queue: Stop
-- has to mean stop, not skip to the next queued area.
function ZoneLore:StopLore()
	if self.ClearAutoplayQueue then
		self:ClearAutoplayQueue()
	end

	if not current and not paused then
		return
	end
	ClearPlayback()
	paused = nil
	ZoneLore:NotifyAudioChanged()
end

-- Ends the current clip while leaving the queue alone, so whatever is waiting
-- starts. Distinct from StopLore, which is the player asking for silence.
function ZoneLore:SkipLore()
	if not current and not paused then
		return false
	end
	ClearPlayback()
	paused = nil
	-- Autoplay drains on this notification, so the next entry starts itself.
	ZoneLore:NotifyAudioChanged()
	return true
end

-- Stops the sound and remembers the entry. Resuming replays it from the start;
-- see the note on `paused` above for why nothing better is possible.
function ZoneLore:PauseLore()
	if not current then
		return false
	end
	paused = { mapID = current.mapID, areaKey = current.areaKey }
	ClearPlayback()
	ZoneLore:NotifyAudioChanged()
	return true
end

function ZoneLore:ResumeLore()
	if not paused then
		return false
	end
	-- PlayLore clears `paused` via StopLore, so read it into the call first.
	return self:PlayLore(paused.mapID, paused.areaKey)
end

function ZoneLore:TogglePauseLore()
	if paused then
		return self:ResumeLore()
	end
	return self:PauseLore()
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
	-- Not StopLore: starting a clip supersedes the previous one, but must not
	-- discard the autoplay queue the way an explicit Stop does.
	ClearPlayback()
	paused = nil

	if not self:IsVoiceEnabled() then
		ZoneLore:NotifyAudioChanged()
		return false
	end

	-- Every failure below still has to notify: playback was cleared above, so the
	-- buttons and the floating controls would otherwise keep showing the old clip.
	local path, duration = self:GetAudioClip(mapID, areaKey)
	if not path then
		-- Said out loud, because this is the case players used to experience as
		-- "the narration is about the wrong zone". Autoplay never reaches here --
		-- it refuses to queue an entry with no clip -- so this only speaks when
		-- somebody asked for this line by clicking Play or typing /zl play.
		self:Print("|cffffcc00%s|r", self:DescribeMissingAudio())
		ZoneLore:NotifyAudioChanged()
		return false
	end

	local channel = self:GetVoiceChannel()
	local audible, why = IsChannelAudible(channel)
	if not audible then
		self:Print("|cffffcc00cannot play lore: %s|r", why)
		ZoneLore:NotifyAudioChanged()
		return false
	end

	local willPlay, handle = PlaySoundFile(path, channel)
	if not willPlay then
		self:Print("|cffffcc00no audio for this entry|r (missing %s)", path)
		ZoneLore:NotifyAudioChanged()
		return false
	end

	token = token + 1
	current = { handle = handle, mapID = mapID, areaKey = areaKey, token = token }

	-- Recorded here rather than where autoplay queues things, so that every route
	-- to a clip counts -- a discovery, a zone change, or the player clicking Play.
	-- Only the autoplayExplored option reads it; see Autoplay.lua.
	if self.MarkHeard then
		self:MarkHeard(mapID, areaKey)
	end

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
