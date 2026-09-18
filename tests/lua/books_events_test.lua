-- The client's book frame driving the addon: opening, turning pages, closing, and the
-- autoplay switch that decides whether any of it speaks. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

_G.SpokenBooksAudioPacks = {
    SpokenBooksAudio = {
        version = 1, addon = "SpokenBooksAudio", quality = "high", bitrate = 128,
        pages = {
            [261] = { file = "261", len = 30.5 },
            [262] = { file = "262", len = 41.0 },
            [265] = { file = "265", len = 12.25 },
        },
    },
}

local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."
local REGISTRY_2 = "Magistrate Rutherford Burnside\nAll debts settled.\n\nBlacksmith Avery Verringtan\nAll debts settled.\n\nClerk Horrace Whitesteed\nAll debts settled.\n\nCouncilman Gillis\nAll debts settled.\n\nCouncilman Hooks\nAll debts settled.\n\nFarmer Getz\nAll debts settled.\n\nFarmer Ray\nDebt outstanding.  Payment in agricultural goods promised at time of harvest.\n\nFarmer Lyion\nDebt outstanding.  Evicted from the land."

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Checksum", "Core", "Reader", "Audio", "Playlist", "Events", "Commands" }) do
        local chunk = assert(loadfile(BOOKS .. file .. ".lua"))
        chunk("SpokenBooks", SpokenBooks)
    end
    return SpokenBooks
end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
_G.SpokenBooksDB = nil
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
local B = LoadBooks()
B:InitDB()
B:SetupSource()
dofile(BOOKS .. "Data/Books.lua")

local function QueuedPages()
    local pages = {}
    for _, clip in ipairs(Spoken:GetQueue()) do
        if clip.pageId then table.insert(pages, clip.pageId) end
    end
    return pages
end

---------------------------------------------------------------- opening a book
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("opening a book queues it", #QueuedPages(), 3)
Expect("...starting at the page on screen", QueuedPages()[1], 261)

---------------------------------------------------------------- turning a page
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 2, text = REGISTRY_2, hasNext = true })
stub.FireEvent("ITEM_TEXT_READY")
Expect("turning to a queued page does not restart the book", #QueuedPages(), 3)
Expect("...and remembers where the reader is", B.lastPage, 262)

---------------------------------------------------------------- closing it
-- The frame goes before the event does: ItemTextGetText() answers nil from here, which is
-- what the client actually does and what makes `/spb read` afterwards a no-op.
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
Expect("closing the book does not stop narration", #QueuedPages(), 3)
Expect("...but forgets the page, because there is no page on screen", B.lastPage, nil)

---------------------------------------------------------------- mail, through the events
-- Stopped by hand, which closing the frame above no longer does: this section is about what
-- mail queues, not about the book still being read behind it.
B:StopReading()
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.FireEvent("ITEM_TEXT_READY")
Expect("mail queues nothing", #QueuedPages(), 0)
Expect("...and is not remembered as a page", B.lastPage, nil)
stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")

---------------------------------------------------------------- autoplay off
SpokenBooksDB.autoplay = false
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
stub.FireEvent("ITEM_TEXT_READY")
Expect("with autoplay off nothing speaks by itself", #QueuedPages(), 0)
Expect("...but the page is remembered, so it can be read on request", B.lastPage, 261)

B:ReadCurrent()
Expect("asking for it reads it anyway", #QueuedPages(), 3)
B:StopReading()
SpokenBooksDB.autoplay = true

---------------------------------------------------------------- the slash command
SlashCmdList["SPOKENBOOKS"]("autoplay")
Expect("/spb autoplay toggles it", SpokenBooksDB.autoplay, false)
SlashCmdList["SPOKENBOOKS"]("autoplay")
Expect("...and back", SpokenBooksDB.autoplay, true)

SlashCmdList["SPOKENBOOKS"]("whole")
Expect("/spb whole toggles whole-book reading", SpokenBooksDB.readWholeBook, false)
SlashCmdList["SPOKENBOOKS"]("whole")

stub.ClosePage()
stub.FireEvent("ITEM_TEXT_CLOSED")
SlashCmdList["SPOKENBOOKS"]("read")
Expect("/spb read with no book open queues nothing", #QueuedPages(), 0)

print(Failures() == 0 and "All books event tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
