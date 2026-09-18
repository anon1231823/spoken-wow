-- SpokenBooks -- books, letters and notes read aloud.
--
-- Client targets: Classic Era 1.15.9 (11509), Anniversary 2.5.6 (20506) and
-- Forever 1.60 (16001). Nothing here branches on the client: the book UI is the same API
-- on all three -- ITEM_TEXT_BEGIN/READY/CLOSED and the ItemTextGet* family -- which was
-- checked against all three branches of the client UI source before any of this was built.
--
-- This addon is one *source* on the Spoken player: its clips wait their turn behind
-- whatever another Spoken addon queued, and stopping here stops narration of a book rather
-- than a quest line that happens to be speaking.

local ADDON_NAME, SpokenBooks = ...

-- C_AddOns is the modern home of GetAddOnMetadata; the global is the older one. Reading
-- through whichever exists removes a class of load-time failure on a client this has not
-- been run on.
local GetAddOnMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata

SpokenBooks.name = ADDON_NAME
SpokenBooks.version = GetAddOnMeta and GetAddOnMeta(ADDON_NAME, "Version") or "dev"

-- The API version this addon was written against. A player bundled into a legacy-client zip
-- can lag the one an addon manager installs, and this is what lets the two disagree safely.
local REQUIRED_API = 1

local defaults = {
	-- On, unlike the zones addon's area autoplay: opening a book is already a deliberate
	-- act, so a player who opened one has asked to read it. The switch is for whoever
	-- would rather press play themselves.
	autoplay = true,
	-- Whole book rather than the page on screen. A twenty-page journal read one button
	-- press at a time is a worse experience than one that reads on while you turn pages.
	readWholeBook = true,
}

function SpokenBooks:InitDB()
	SpokenBooksDB = SpokenBooksDB or {}
	for key, value in pairs(defaults) do
		if SpokenBooksDB[key] == nil then
			SpokenBooksDB[key] = value
		end
	end
	return SpokenBooksDB
end

--- Whether the player addon is present and speaks a version this addon understands.
function SpokenBooks:PlayerAvailable()
	return _G.Spoken ~= nil and Spoken.IsCompatible ~= nil and Spoken:IsCompatible(REQUIRED_API)
end

--- Registers this addon with the player. Returns the source, or nil when there is no
--- player to register with -- which is not an error: the addon loads, and says so.
function SpokenBooks:SetupSource()
	if not self:PlayerAvailable() then
		self.compatible = false
		return nil
	end
	self.compatible = true

	self.source = Spoken:RegisterSource("books", {
		title = "Spoken Books",
		addon = ADDON_NAME,
		order = 3,
		-- NO LIMIT, unlike the zones source, and the difference is what the limit is for.
		-- Zone lore arrives in bursts nobody asked for -- crossing a cluster of small
		-- subzones queues narration about places the player has already left -- so it caps
		-- the backlog and drops the oldest. A book is the opposite: a bounded sequence
		-- somebody deliberately opened, whose pages are only meaningful in order. Capped at
		-- one, queueing a four-page book keeps the first page and the last and silently
		-- discards the middle, which is how this was found.
		--
		-- Nothing accumulates regardless: closing the book stops this source, and turning to
		-- a page that is not queued rebuilds from there.
		queueLimit = nil,
		-- Durations come from a generated lookup and are exact, so the gap only has to
		-- separate two pages of prose rather than absorb a bad measurement.
		interClipGap = 0.35,
	})

	-- Switchable from the player's settings, named there by this addon. The other two
	-- declare the same id, so one setting covers whichever is speaking.
	if Spoken.RegisterOptionalAction then
		Spoken:RegisterOptionalAction("report", "Report")
	end

	return self.source
end

--- The corpus, as Data/Books.lua left it. Nil only when that file failed to load, which is
--- worth answering for rather than indexing into nil from four call sites.
function SpokenBooks:Data()
	return _G.SpokenBooksData
end
