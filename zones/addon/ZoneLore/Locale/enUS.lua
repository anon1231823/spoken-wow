-- English, and the key set every other language is measured against.
--
-- tools/locale/check-strings.mjs reads this file to decide what a translation has
-- to cover, so a key added here immediately makes every language incomplete --
-- which is the point: a new string nobody has translated should stop a language
-- being offered as finished.
--
-- FORMAT ARGUMENTS ARE POSITIONAL (%1$s, %2$d), even where there is only one and
-- the position is obvious. Word order is the thing a translator most often has to
-- change and least often can, and retrofitting positions across hundreds of
-- strings later is a second sweep of every file.
--
-- Only the files listed below draw their text from here so far. The rest still
-- hold English literals; converting one is mechanical, and UI/SoundQueueUI.lua is
-- the worked example.
--
--   UI/SoundQueueUI.lua  every label and tooltip
--   UI/MapPanel.lua      the two sentences that were built by concatenation
--   Core.lua             the /zl command list

local _, ZoneLore = ...

local L = {}

--------------------------------------------------------------------------------
-- Playback controls
--------------------------------------------------------------------------------

L.PLAY = "Play"
L.PAUSE = "Pause"
L.READ = "Read"
L.READ_INSTEAD = "Read instead"

L.PLAY_TOOLTIP = "Starts this lore again from the beginning."
L.PAUSE_TOOLTIP =
	"The game cannot resume a sound part-way through, so playing again starts from the beginning."
L.READ_TOOLTIP = "Opens this lore in the window and keeps playing."
L.READ_INSTEAD_TOOLTIP =
	"Opens this lore in the window and stops the narration, discarding anything queued behind it."
L.READ_SETTING_HINT = "Which one this does is a ZoneLore setting."

--------------------------------------------------------------------------------
-- Queue
--------------------------------------------------------------------------------

L.QUEUE_TITLE = "Up next"
L.QUEUE_COUNT = "%1$d waiting"
L.QUEUE_REMOVE_TOOLTIP = "Click to take this out of the queue."
L.QUEUE_DRAG_HINT = "Drag this list to move it."

-- Why a discovery is queued but silent. Without these, narration waiting out a
-- pull looks exactly like narration that failed.
L.QUEUE_HELD_COMBAT = "Waiting for combat to end."
L.QUEUE_HELD_CINEMATIC = "Waiting for the cinematic to end."
L.QUEUE_HELD_OFF = "Narration is turned off."

--------------------------------------------------------------------------------
-- Map panel
--
-- Both of these were built with `..` around a zone name, which fixes English word
-- order into every language. They are the reason the rule above exists.
--------------------------------------------------------------------------------

L.BACK_TO_ZONE = "< Back to %1$s"
L.NO_LORE_FOR = "No lore recorded for %1$s yet."

--------------------------------------------------------------------------------
-- Slash commands
--------------------------------------------------------------------------------

L.CMD_HEADING = "commands:"
L.CMD_STATUS = "  /zl            -- status for the current zone and subzone"
L.CMD_OPTIONS = "  /zl options    -- open the settings panel"
L.CMD_WINDOW = "  /zl window     -- open the browsable lore window"
L.CMD_PANEL = "  /zl panel      -- toggle the world map panel"
L.CMD_HOVER = "  /zl hover      -- toggle the hover preview tooltip"
L.CMD_PLAY = "  /zl play       -- read the current lore aloud"
L.CMD_STOP = "  /zl stop       -- stop the narration"
L.CMD_VOICE = "  /zl voice      -- toggle narration on or off"
L.CMD_AUTOPLAY = "  /zl autoplay   -- toggle narrating areas as you discover them"
L.CMD_AUDIO = "  /zl audio      -- list sound packs, or switch with /zl audio <name>"
L.CMD_LANG = "  /zl lang       -- list languages, or switch with /zl lang <code>"
L.CMD_DISCOVER = "  /zl discover   -- pretend to discover an area (dev)"
L.CMD_FORGET = "  /zl forget     -- forget what this character has been narrated"
L.CMD_BAR = "  /zl bar        -- move the player back to the middle of the screen"
L.CMD_MINIMAP = "  /zl minimap    -- show or hide the minimap button"
L.CMD_DEBUG = "  /zl debug      -- report area names on map click"
L.CMD_VERIFY = "  /zl verify     -- check data against this client"
L.CMD_DUMP = "  /zl dump       -- enumerate the map tree (dev)"

ZoneLore:RegisterStrings("enUS", L)
