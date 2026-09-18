-- The books addon speaking through the player. Checksum.lua and Core.lua are loaded for
-- real against a hand-built SpokenBooks table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local BOOKS = here .. "/../../addons/SpokenBooks/"
local Expect, Failures = H.Expecter(print)

local function LoadBooks()
    local SpokenBooks = {}
    for _, file in ipairs({ "Checksum", "Core" }) do
        local chunk = assert(loadfile(BOOKS .. file .. ".lua"))
        chunk("SpokenBooks", SpokenBooks)
    end
    return SpokenBooks
end

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    _G.SpokenBooksDB = nil
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    local B = LoadBooks()
    B:InitDB()
    B:SetupSource()
    return env, B
end

local env, B = Boot()
local Spoken = _G.Spoken

---------------------------------------------------------------- registration
Expect("the books addon registers a source with the player", Spoken:GetSource("books"), B.source)
Expect("...as one page behind the one speaking", B.source.queueLimit, 1)
Expect("...with its own gap", B.source.interClipGap, 0.35)
Expect("...and reports itself compatible", B.compatible, true)

---------------------------------------------------------------- saved variables
Expect("autoplay is on by default, because opening a book is already deliberate",
    SpokenBooksDB.autoplay, true)
Expect("a whole book is read by default", SpokenBooksDB.readWholeBook, true)

SpokenBooksDB.autoplay = false
B:InitDB()
Expect("InitDB does not overwrite a choice already made", SpokenBooksDB.autoplay, false)

---------------------------------------------------------------- the checksum
-- The numbers below come from pipelines/books/tools/lib/naming.mjs, which keys the
-- generated lookup on them. If these two disagree, every page lookup misses and the addon
-- narrates nothing at all -- silently, which is why they are asserted rather than trusted.
Expect("the checksum matches the exporter on ASCII", B:ChecksumOf("The rains have come."), 1482999072)
Expect("the checksum matches the exporter on UTF-8", B:ChecksumOf("Voil\195\160, l'\195\169p\195\169e."), 1603451486)
Expect("the checksum normalises CRLF the way the exporter does",
    B:ChecksumOf("One.\r\n\r\nTwo."), B:ChecksumOf("One.\n\nTwo."))
Expect("...and WoW's $B newline token", B:ChecksumOf("One.$B$BTwo."), B:ChecksumOf("One.\n\nTwo."))
Expect("...and trailing whitespace", B:ChecksumOf("One.   \nTwo."), B:ChecksumOf("One.\nTwo."))
Expect("a non-string is not an error", B:ChecksumOf(nil), 0)

---------------------------------------------------------------- the generated data
dofile(BOOKS .. "Data/Books.lua")
local data = B:Data()
Expect("the lookup loaded", type(data), "table")
Expect("...at the version this addon reads", data.version, 1)
local twilight = data.index["Decoded Twilight Text"]
local variants = 0
for _ in pairs(twilight[1]) do variants = variants + 1 end
Expect("seven books share a title and are told apart by checksum", variants, 7)

---------------------------------------------------------------- a player that is too old
local oldSpoken = _G.Spoken
_G.Spoken = { IsCompatible = function() return false end }
local B2 = LoadBooks()
Expect("an incompatible player leaves the addon loaded but quiet", B2:SetupSource(), nil)
Expect("...and says so", B2.compatible, false)
_G.Spoken = oldSpoken

print(Failures() == 0 and "All books source tests passed" or (Failures() .. " failed"))
os.exit(Failures() == 0 and 0 or 1)
