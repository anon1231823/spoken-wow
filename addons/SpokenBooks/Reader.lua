-- Which page the client is showing, if any.
--
-- ItemTextFrame is the whole of the book UI on all three targets, and it serves MAIL as
-- well: the same frame, the same events, the same getters. So the first question here is
-- never "which page is this" but "is this a book at all" -- a reader who opens a letter
-- from another player and hears it read aloud has been given somebody else's post by a
-- narrator, which is worse than hearing nothing.
--
-- Identification order, and each step earns its place:
--
--   1. title + page number + checksum   -- the normal path
--   2. checksum alone                   -- for a client whose object name differs from the
--                                          corpus's; only for checksums no other page shares
--   3. nothing                          -- silently, because the alternative is reading the
--                                          wrong page's words aloud

local ADDON_NAME, SpokenBooks = ...

--- Whether the frame is showing mail rather than something the world wrote.
---
--- Two tests, because they catch different things. A creator is a player's name, and only
--- mail has one. And MailFrame being open is what catches a piece of mail with no creator
--- at all -- a returned letter, or one the server sent.
function SpokenBooks:IsMail()
	if ItemTextGetCreator and ItemTextGetCreator() then
		return true
	end

	local mail = _G.MailFrame
	if mail and mail.IsShown and mail:IsShown() then
		return true
	end

	return false
end

--- A page id from one language's index, or nil.
local function Find(index, title, number, checksum)
	local byTitle = title and index.index and index.index[title]
	local byNumber = byTitle and byTitle[number]
	local found = byNumber and byNumber[checksum]
	if found then
		return found
	end

	-- The fallback. `loose` holds only checksums no other page shares, so a hit here is
	-- the page, not a guess between candidates.
	return index.loose and index.loose[checksum]
end

--- The page id the client is showing, or nil.
function SpokenBooks:PageOnScreen()
	local data = self:Data()
	if not data or self:IsMail() then
		return nil
	end

	local text = ItemTextGetText and ItemTextGetText()
	if type(text) ~= "string" or text == "" then
		return nil
	end

	local checksum = self:ChecksumOf(text)
	local title = ItemTextGetItem and ItemTextGetItem()
	local number = (ItemTextGetPage and ItemTextGetPage()) or 1

	-- The client's own locale first: the title and the words are what this client shows, and
	-- a German client's are German. `locales` holds an index per language in the shape of the
	-- English one; a build without it leaves every client on the English index, as before.
	local localized = data.locales and data.locales[self:GetClientLanguage()]
	return (localized and Find(localized, title, number, checksum))
		or Find(data, title, number, checksum)
end

--- Where a page sits: its book and its number. Nil for a page the lookup does not carry.
function SpokenBooks:PlaceOf(pageId)
	local data = self:Data()
	local place = data and data.pages[pageId]
	if not place then
		return nil, nil
	end
	return place.book, place.number
end

--- The book a page belongs to: its title and its pages in reading order.
function SpokenBooks:BookOf(pageId)
	local data = self:Data()
	local book = self:PlaceOf(pageId)
	return book and data.books[book] or nil
end
