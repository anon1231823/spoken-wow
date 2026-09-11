setfenv(1, SpokenEnv)

-- Interface strings. English only for now; a locale file per language can overlay this
-- table the way the zones addon's Locale/ files do, once there is a second language.
L = {
    PLAY = "Play",
    PAUSE = "Pause",
    PAUSE_TOOLTIP = "Pause stops the clip; play starts it again from the beginning. The game cannot resume a sound part-way through.",
    STOP = "Stop",
    SETTINGS = "Settings",
    PLAY_PAUSE = "Play/Pause",
    QUEUE_TITLE = "Up next",
    QUEUE_DRAG_HINT = "Drag to move. The position can be locked in settings.",
    QUEUE_REMOVE_TOOLTIP = "Click to take this out of the queue.",
    MENU_LEFT = "|cff66bbffLeft-click|r open the menu",
    MENU_RIGHT = "|cff66bbffRight-click|r open settings",
    MENU_MIDDLE = "|cff66bbffMiddle-click|r play/pause",
    OPT_LOCK_FRAME = "Lock the player",
    OPT_LOCK_FRAME_TIP = "Prevent the player from being moved or resized.",
    OPT_HIDE_PORTRAIT = "Hide the portrait",
    OPT_HIDE_PORTRAIT_TIP = "Show the queue without the speaker's portrait. Useful alongside addons that replace the dialog window.",
    OPT_HIDE_FRAME = "Hide the player entirely",
    OPT_HIDE_FRAME_TIP = "Play everything without ever showing the window.",
    OPT_SCALE = "Player scale",
    OPT_RESET = "Reset position",
    OPT_MINIMAP_SHOW = "Show the minimap button",
    OPT_MINIMAP_LOCK = "Lock the minimap button",
    OPT_NO_SETTINGS_API = "open Game Menu -> Options -> AddOns -> Spoken, or type /spoken options",
}
