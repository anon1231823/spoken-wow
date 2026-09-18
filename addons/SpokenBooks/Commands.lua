-- /spokenbooks and /spb, matching /spoken and /sp on the player, /spokenquests and /spq,
-- and /spokenzones and /spz.

local ADDON_NAME, SpokenBooks = ...

local function Print(message, ...)
	local text = select("#", ...) > 0 and format(message, ...) or message
	DEFAULT_CHAT_FRAME:AddMessage("|cff80c0ffSpoken Books|r: " .. text)
end

SpokenBooks.Print = function(self, message, ...) Print(message, ...) end

local function Toggle(key, label)
	SpokenBooksDB[key] = not SpokenBooksDB[key]
	Print("%s %s", label, SpokenBooksDB[key] and "enabled" or "disabled")
end

--- Read the page in front of the reader, or say why nothing happened.
---
--- Deliberate, so it works with autoplay off: that is the whole point of the setting, and a
--- command that respected it would leave no way to start narration.
---
--- Shared with the player's menu entry rather than inlined in the slash command, because a
--- reason only one of the two printed would make the other look broken.
function SpokenBooks:ReadOrExplain()
	if self:ReadCurrent() > 0 then
		return
	end
	Print(self:HasAudio(self.lastPage or -1)
		and "nothing to read -- open a book first"
		or self:DescribeMissingAudio())
end

local function Status()
	local data = SpokenBooks:Data()
	local books, pages = 0, 0
	for _ in pairs(data and data.books or {}) do books = books + 1 end
	for _ in pairs(data and data.pages or {}) do pages = pages + 1 end

	local packs = SpokenBooks:GetAudioPacks()
	local clips = 0
	for _, pack in ipairs(packs) do
		for _ in pairs(pack.pages) do clips = clips + 1 end
	end

	Print("%d books, %d pages known; %d narrated by %d pack%s", books, pages, clips,
		#packs, #packs == 1 and "" or "s")
	local read = 0
	for _ in pairs(SpokenBooksCharDB and SpokenBooksCharDB.read or {}) do read = read + 1 end

	Print("autoplay %s, whole book %s, read once %s",
		SpokenBooksDB.autoplay and "on" or "off",
		SpokenBooksDB.readWholeBook and "on" or "off",
		SpokenBooksDB.readOnce and "on" or "off")
	-- Said whether or not read-once is on, because the count is what makes `/spb forget`
	-- make sense, and because a reader turning the setting on wants to know what it will
	-- already consider read.
	Print("%d book%s read on this character", read, read == 1 and "" or "s")
	if #packs == 0 then
		Print(SpokenBooks:DescribeMissingAudio())
	end
end

_G.SLASH_SPOKENBOOKS1 = "/spokenbooks"
_G.SLASH_SPOKENBOOKS2 = "/spb"
SlashCmdList["SPOKENBOOKS"] = function(msg)
	local cmd = string.lower(msg or "")
	cmd = string.match(cmd, "^%s*(%S*)") or ""

	if cmd == "autoplay" then
		Toggle("autoplay", "autoplay")
	elseif cmd == "whole" or cmd == "book" then
		Toggle("readWholeBook", "reading the whole book")
	elseif cmd == "once" then
		Toggle("readOnce", "reading each book only once")
	elseif cmd == "forget" then
		local count = SpokenBooks:ForgetRead()
		Print("forgot %d book%s; they will be read again", count, count == 1 and "" or "s")
	elseif cmd == "settings" or cmd == "options" then
		-- Guarded because UI/Options.lua is the one file here that a client can do without:
		-- everything it offers is also a command on this list.
		if SpokenBooks.OpenOptions then
			SpokenBooks:OpenOptions()
		else
			Print("no settings panel on this client -- every switch is on this list")
		end
	elseif cmd == "read" or cmd == "play" then
		SpokenBooks:ReadOrExplain()
	elseif cmd == "stop" then
		SpokenBooks:StopReading()
		Print("stopped")
	elseif cmd == "status" then
		Status()
	else
		Print("/spb read | stop | autoplay | whole | once | forget | settings | status")
	end
end
