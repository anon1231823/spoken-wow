-- The client's book frame, wired to the playlist.
--
-- Three events, the same three on all three targets:
--
--   ITEM_TEXT_BEGIN    the frame is opening; the text is not there yet
--   ITEM_TEXT_READY    a page's words are available, on open AND on every page turn
--   ITEM_TEXT_CLOSED   the frame is gone
--
-- READY is the only one that can identify a page, because it is the only one at which
-- ItemTextGetText() answers. It fires again for every turn, which is what makes a page turn
-- and an opening indistinguishable here -- and they should be: both mean "this is the page
-- now", and SyncTo decides whether that changes anything.

local ADDON_NAME, SpokenBooks = ...

local frame = CreateFrame("Frame")
SpokenBooks.eventFrame = frame

frame:RegisterEvent("ITEM_TEXT_BEGIN")
frame:RegisterEvent("ITEM_TEXT_READY")
frame:RegisterEvent("ITEM_TEXT_CLOSED")

--- A page became available. The addon's whole in-game entry point.
function SpokenBooks:OnTextReady()
	if not self.source then
		return 0
	end

	local pageId = self:PageOnScreen()
	if not pageId then
		-- Mail, or a page this corpus does not carry. Neither is worth saying anything
		-- about: one is deliberate and the other is a gap the reader cannot act on.
		return 0
	end

	self.lastPage = pageId

	if not SpokenBooksDB or SpokenBooksDB.autoplay == false then
		-- The reader turned autoplay off, so nothing starts by itself -- but the page is
		-- remembered, which is what lets `/spb read` play the one in front of them.
		return 0
	end

	return self:SyncTo(pageId)
end

function SpokenBooks:OnTextClosed()
	self.lastPage = nil
	self:StopReading()
end

frame:SetScript("OnEvent", function(_, event)
	-- 1.12's frames call OnEvent with the event in the global `event` rather than as an
	-- argument. Reading through whichever exists is what the other two addons do.
	local name = event or _G.event
	if name == "ITEM_TEXT_READY" then
		SpokenBooks:OnTextReady()
	elseif name == "ITEM_TEXT_CLOSED" then
		SpokenBooks:OnTextClosed()
	end
end)

--- Read the page in front of the reader now, whatever autoplay says. What the player's own
--- play control and `/spb read` reach.
function SpokenBooks:ReadCurrent()
	local pageId = self:PageOnScreen() or self.lastPage
	if not pageId then
		return 0
	end
	return self:SyncTo(pageId)
end
