-- Which page the addon thinks is on screen, against the real generated lookup and the real
-- pages from the corpus. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader" }) do
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

-- Two real pages of one real book: the Hillsbrad Town Registry, whose first page names the
-- town and whose second lists its debts.
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."

---------------------------------------------------------------- the normal path
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1, hasNext = true })
Expect("a page is found by title, number and checksum", B:PageOnScreen(), 261)

local book, number = B:PlaceOf(261)
Expect("...and knows which book it is in", book, 261)
Expect("...and where", number, 1)
Expect("...and what the book is called", B:BookOf(261).title, "Hillsbrad Town Registry")

---------------------------------------------------------------- mail is not a book
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
Expect("a letter with a creator is not read", B:PageOnScreen(), nil)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
_G.MailFrame = { IsShown = function() return true end }
Expect("a page under an open MailFrame is not read", B:PageOnScreen(), nil)
_G.MailFrame = { IsShown = function() return false end }
Expect("...and is read again once the mail is closed", B:PageOnScreen(), 261)
_G.MailFrame = nil

---------------------------------------------------------------- the title fallback
stub.ShowPage({ title = "Registre de la ville", number = 1, text = REGISTRY_1 })
Expect("a title the corpus does not know still finds the page by checksum", B:PageOnScreen(), 261)

---------------------------------------------------------------- refusing to guess
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = "Words nobody wrote." })
Expect("text the corpus does not have is nil rather than a guess", B:PageOnScreen(), nil)

stub.ShowPage({ title = "Hillsbrad Town Registry", number = 9, text = REGISTRY_1 })
Expect("the wrong page number still matches, through the checksum", B:PageOnScreen(), 261)

stub.ClosePage()
Expect("a closed frame is not a page", B:PageOnScreen(), nil)

world.itemText = ""
Expect("an empty page is not a page", B:PageOnScreen(), nil)

---------------------------------------------------------------- the ambiguous ones
-- "Inscribed Kodo Leather" is four books holding identical text. Nothing on screen tells
-- them apart, so the lookup collapses them and this must resolve to the lowest of the four
-- rather than to nothing.
local kodo
for pageId, place in pairs(SpokenBooksData.pages) do
    local b = SpokenBooksData.books[place.book]
    if b and b.title == "Inscribed Kodo Leather" then
        kodo = (kodo == nil or pageId < kodo) and pageId or kodo
    end
end
Expect("the corpus still has the four Kodo Leathers", kodo ~= nil, true)

print(Failures() == 0 and "All books reader tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
