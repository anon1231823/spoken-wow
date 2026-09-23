-- The books addon's settings panel: three switches, the language choices and the button that
-- undoes the third, laid out by the same UI/Layout.lua every Spoken addon carries. The panel is
-- this addon's own canvas rather than a section of the player's, because its settings are about
-- books and must be reachable with the player absent. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenBooksDB = nil
_G.SpokenBooksCharDB = nil

local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Layout", "UI/Options", "Events", "Commands" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("SpokenBooks", B)
end
B:InitDB()
B:SetupOptions()

---------------------------------------------------------------- registration
Expect("the panel is registered as a settings category", stub.settingsCategories[1] ~= nil, true)
Expect("...under its own name", stub.settingsCategories[1] and stub.settingsCategories[1].name,
    "Spoken Books")

---------------------------------------------------------------- what is on it
-- The rows live in the scroller's content frame, not on the panel: the settings canvas
-- neither scrolls nor clips, so a panel with more rows than fit draws over the world.
local content = B.optionsPanel.content
local headings, checkboxes, buttons = {}, {}, {}
for _, child in ipairs(content.children) do
    if child.layoutHeading then
        table.insert(headings, child.text)
    elseif type(child.text) == "table" then
        -- A checkbox carries its label as a fontstring beside it; a button carries its own.
        table.insert(checkboxes, child)
    elseif type(child.text) == "string" and child.scripts and child.scripts.OnClick then
        -- Clickable, which is what separates a button from the explanatory note above the
        -- first section: both are rows carrying a string.
        table.insert(buttons, child)
    end
end

Expect("every section is there", table.concat(headings, "|"),
    "Reading|Language|What this character has read")
Expect("every switch has a row", table.getn(checkboxes), 3)
Expect("...and the record has its button", table.getn(buttons), 1)

local function Labelled(text)
    for _, box in ipairs(checkboxes) do
        if box.text and box.text.text == text then return box end
    end
end

---------------------------------------------------------------- the switches write through
local once = Labelled("Read each book only once")
Expect("the read-once switch is on the panel", once ~= nil, true)
Expect("...reading the default off", once.checked, false)

-- What the client does on a click: flip the box, then run the handler.
once:SetChecked(true)
once.scripts.OnClick(once)
Expect("ticking it turns the setting on", SpokenBooksDB.readOnce, true)

once:SetChecked(false)
once.scripts.OnClick(once)
Expect("...and clearing it turns the setting off", SpokenBooksDB.readOnce, false)

local autoplay = Labelled("Read a book when it is opened")
Expect("autoplay is on the panel too, defaulting on", autoplay and autoplay.checked, true)
autoplay:SetChecked(false)
autoplay.scripts.OnClick(autoplay)
Expect("...and unticking it is the same as /spb autoplay", SpokenBooksDB.autoplay, false)
SpokenBooksDB.autoplay = true

---------------------------------------------------------------- forgetting what was read
SpokenBooksCharDB.read = { ["Hillsbrad Town Registry"] = true, ["Jitters' Journal"] = true }
Expect("the button says what it does", buttons[1].text, "Forget what has been read")
buttons[1].scripts.OnClick(buttons[1])

local left = 0
for _ in pairs(SpokenBooksCharDB.read) do left = left + 1 end
Expect("pressing it clears this character's record", left, 0)

-- Derived from the layout rather than written down, so adding a row cannot leave a section
-- below the reach of the scrollbar.
Expect("the scroller is told how tall the content grew", content.height > 0, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll books options tests passed")
