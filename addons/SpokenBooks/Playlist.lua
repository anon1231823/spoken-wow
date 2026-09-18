-- A book read straight through, and kept in step with the page on screen.
--
-- Opening a book queues it from the page being read to its last, so a twenty-page journal
-- narrates on while the reader turns pages. Turning a page does not restart anything: if
-- the page turned to is already queued, the clip for it is coming and nothing happens. If
-- it is not -- the reader jumped, or opened a different book -- the queue is dropped and
-- rebuilt from there.
--
-- Queuing the WHOLE book rather than the page on screen is the difference between reading
-- along and pressing play twenty times. It is also why the source's queueLimit is 1: the
-- player admits the next page only as the current one finishes, so a reader who closes the
-- book has one clip to stop rather than nineteen.

local ADDON_NAME, SpokenBooks = ...

--- The pages of a book from `pageId` onwards, in reading order.
function SpokenBooks:PagesFrom(pageId)
	local book = self:BookOf(pageId)
	if not book then
		return {}
	end

	local rest, found = {}, false
	for _, id in ipairs(book.pages) do
		if id == pageId then
			found = true
		end
		if found then
			table.insert(rest, id)
		end
	end
	return rest
end

--- Whether a page is already queued or speaking.
function SpokenBooks:IsQueued(pageId)
	if not self.source or not _G.Spoken or not Spoken.GetQueue then
		return false
	end

	local key = "b:" .. pageId
	-- GetQueue is a shallow copy of the whole queue, both sources included; the key
	-- namespace is this addon's, so a match can only be one of ours.
	for _, clip in ipairs(Spoken:GetQueue()) do
		if clip.key == key then
			return true
		end
	end
	return false
end

--- Queue this page and the rest of its book. Returns how many clips were admitted.
---
--- A page the installed pack has no clip for is skipped rather than queued silent: the
--- player would otherwise hold a clip with no sound for its whole length, which reads as
--- the addon having stopped working.
function SpokenBooks:PlayFrom(pageId)
	local source = self.source
	if not source then
		return 0
	end

	local queued = 0
	for _, id in ipairs(self:PagesFrom(pageId)) do
		if SpokenBooksDB and SpokenBooksDB.readWholeBook == false and id ~= pageId then
			break
		end
		local clip = self:ClipFor(id)
		if clip and source:Enqueue(clip) then
			queued = queued + 1
		end
	end
	return queued
end

--- The page on screen changed. Keep the queue pointed at it.
function SpokenBooks:SyncTo(pageId)
	if not pageId then
		return 0
	end

	-- Already coming: the reader turned to a page this book had queued for them, which is
	-- the normal case and the one that must not restart narration.
	if self:IsQueued(pageId) then
		return 0
	end

	-- Somewhere else entirely. Drop what this source holds -- never the whole queue, which
	-- may be carrying a quest line -- and rebuild from here.
	if self.source then
		self.source:StopAll()
	end
	return self:PlayFrom(pageId)
end

--- The book was closed. Narration goes with it: a book is read while it is open, and a
--- voice carrying on over a closed frame is describing something nobody is looking at.
function SpokenBooks:StopReading()
	if self.source then
		self.source:StopAll()
	end
end
