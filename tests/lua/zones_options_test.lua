-- The zones addon's settings panel. It is a canvas of its own -- the addon has settings
-- that have nothing to do with the player, and must have them with the player absent --
-- but it is laid out by the same UI/Layout.lua every Spoken addon carries, so the panels
-- read alike. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
local Z = H.NewZoneLore()
for _, file in ipairs({ "UI/Layout", "UI/Options" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("SpokenZones", Z)
end
Z:SetupOptions()

Expect("the panel is registered as a settings category", stub.settingsCategories[1] ~= nil, true)
Expect("...under its own name", stub.settingsCategories[1] and stub.settingsCategories[1].name, "Spoken Zones")

-- The rows live in the scroller's content frame, not on the panel: the settings canvas
-- neither scrolls nor clips, so a panel with more rows than fit draws over the world.
local content = Z.optionsPanel.children[1]
local rows, headings = {}, {}
for _, child in ipairs(content.children) do
    if child.layoutHeading then
        table.insert(headings, { y = child.layoutY, height = child.layoutHeight, text = child.text })
    elseif child.layoutHeight then
        table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor and child.anchor.y })
    end
end

Expect("every section is there", table.getn(headings), 6)
local names = {}
for _, heading in ipairs(headings) do table.insert(names, heading.text) end
Expect("...in order", table.concat(names, "|"),
    "World map|Minimap|Narration|Language|Troubleshooting|Feedback")
Expect("and every setting", table.getn(rows) >= 13, true)

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

-- The same two invariants the player's panel holds to. An indented row is a row, so its
-- own spacing is measured the same way; only its left edge moves.
local gaps = {}
for index = 2, table.getn(rows) do
    local previous = rows[index - 1]
    local crossesHeading = false
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if not crossesHeading then
        table.insert(gaps, previous.y - rows[index].y - previous.height)
    end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)

local headingGaps = {}
for _, heading in ipairs(headings) do
    local above
    for _, row in ipairs(rows) do
        if row.y > heading.y and (not above or row.y < above.y) then above = row end
    end
    if above then table.insert(headingGaps, above.y - heading.y - above.height) end
end
Expect("every section heading the same distance below the section above", Distinct(headingGaps), 1)

local escaped = 0
for _, row in ipairs(rows) do
    if row.anchor and (row.anchor > row.y or row.anchor < row.y - row.height) then escaped = escaped + 1 end
end
Expect("no control escapes the row it was given", escaped, 0)

-- Derived from the layout rather than written down, so adding a row cannot leave a
-- section below the reach of the scrollbar.
Expect("the scroller is told how tall the content grew", Z.contentHeight > 500, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones options tests passed")
