-- ZoneLore -- the private environment the ported sound queue runs in.
--
-- SoundQueue.lua and UI/SoundQueueUI.lua are ports of AI_VoiceOver's files of the
-- same names (that project is public domain). They are kept close to line-for-line
-- with upstream so its fixes can be re-applied by diff, which means keeping the
-- `setfenv(1, ...)` idiom they are written in: every bare global in those two
-- files resolves against the table below rather than against `_G`.
--
-- The rest of the addon uses the ordinary `local ADDON_NAME, ZoneLore = ...`
-- idiom and should stay that way. The seam between the two is this file: it
-- publishes `ZoneLore` into the private environment on the way in, and each
-- ported file publishes its own table back onto `ZoneLore` on the way out.
-- Nothing else should reach across.

local ADDON_NAME, ZoneLore = ...

-- `__index = _G` is what lets the ported files call WoW API functions normally.
-- `_G` is also stored as a field so they can write real globals deliberately,
-- which upstream does in a couple of places.
local _G = getfenv(0)
ZoneLoreQueue = setmetatable({ _G = _G }, { __index = _G })
ZoneLoreQueue.ZoneLore = ZoneLore
ZoneLore.QueueEnv = ZoneLoreQueue

-- Upstream reaches config and timers through a single AceAddon object called
-- `Addon`. Reproducing that name is what keeps the ported bodies unedited.
-- AceAddon itself is not needed: AceTimer:Embed copies its five methods onto any
-- plain table.
--
-- The saved variable is deliberately not ZoneLoreDB. AceDB takes ownership of the
-- table it is given, and Core.lua's InitConfig already owns that one -- including
-- an in-place audioPack migration that is only safe because nothing else writes
-- there. ZoneLore:Get/Set stays authoritative for every player-facing setting;
-- this table holds only what the ported code reads for itself.
local defaults = {
	profile = {
		SoundQueueUI = {
			LockFrame = false,
			FrameScale = 0.7,
			FrameStrata = "MEDIUM",
			HideFrame = false,
		},
	},
	char = {
		IsPaused = false,
	},
}

local Addon = LibStub("AceTimer-3.0"):Embed({})
ZoneLoreQueue.Addon = Addon

-- AceDB needs the saved variable to exist, which is only true once the client has
-- loaded it. Core.lua already waits on ADDON_LOADED for the same reason.
function ZoneLore:InitQueueDB()
	if Addon.db then
		return
	end
	Addon.db = LibStub("AceDB-3.0"):New("ZoneLoreQueueDB", defaults)
end
