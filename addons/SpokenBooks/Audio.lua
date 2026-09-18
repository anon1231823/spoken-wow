-- What a page sounds like: which pack narrates it, where the file is, how long it runs.
--
-- Narration ships in a separate sound-pack addon because it is a large download, and it is
-- optional: without one there is nothing to play, so the addon stays quiet and says why.
--
-- THERE IS NO STAND-IN CLIP, for the reason addons/SpokenZones/Audio.lua gives at length:
-- substituting unrelated audio is worse than silence, because silence is honest about what
-- is missing and a borrowed clip is not.

local ADDON_NAME, SpokenBooks = ...

-- The pack table shape this version knows how to read. A pack declaring anything else is
-- ignored with a warning: refusing to read it is recoverable, guessing at an unknown layout
-- plays silence and reports nothing.
local PACK_FORMAT = 1

-- The player's own book art. Pointed at rather than copied: SpokenPlayer is installed
-- alongside this addon by definition -- it is what the clips are queued through -- and a
-- second copy of the same texture is a second thing to keep in step.
local BOOK_TEXTURE = [[Interface\AddOns\SpokenPlayer\Textures\Book]]

--- Every installed pack this version can read, newest format first.
function SpokenBooks:GetAudioPacks()
	local packs = {}
	for name, pack in pairs(_G.SpokenBooksAudioPacks or {}) do
		if type(pack) == "table" and pack.version == PACK_FORMAT and type(pack.pages) == "table" then
			pack.addon = pack.addon or name
			table.insert(packs, pack)
		end
	end
	table.sort(packs, function(a, b) return (a.addon or "") < (b.addon or "") end)
	return packs
end

--- The clip for a page, as the player's queue wants it, or nil when no pack carries it.
function SpokenBooks:ClipFor(pageId)
	local place = self:Data() and self:Data().pages[pageId]
	if not place then
		return nil
	end

	for _, pack in ipairs(self:GetAudioPacks()) do
		local entry = pack.pages[pageId]
		if entry then
			local book = self:Data().books[place.book]
			return {
				key = "b:" .. pageId,
				path = [[Interface\AddOns\]] .. pack.addon .. [[\Sounds\]] .. entry.file .. ".mp3",
				-- 0 means the pack recorded no duration -- an imported take rather than one
				-- this project cut. The player falls back to its own timer; a wrong number
				-- here would reset the Play button mid-sentence.
				length = (entry.len and entry.len > 0) and entry.len or nil,
				pageId = pageId,
				present = {
					header = book and book.title or "",
					-- Only where there is more than one page: "page 1 of 1" is noise on a
					-- letter, which is most of this corpus.
					label = (book and #book.pages > 1)
						and format("Page %d of %d", place.number, #book.pages)
						or nil,
					bullet = "book",
					portrait = { kind = "texture", texture = BOOK_TEXTURE },
				},
			}
		end
	end

	return nil
end

--- Why there is no clip, phrased for the player. Distinguishes "you have no sound pack"
--- from "your pack does not cover this page": the first is a download and the second is
--- nothing they can do, and telling them apart is the point of saying anything at all.
function SpokenBooks:DescribeMissingAudio()
	if #self:GetAudioPacks() == 0 then
		return "No Spoken Books sound pack is installed."
	end
	return "The installed sound pack has no narration for this page yet."
end

function SpokenBooks:HasAudio(pageId)
	return self:ClipFor(pageId) ~= nil
end
