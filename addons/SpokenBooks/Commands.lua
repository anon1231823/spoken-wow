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
	Print("autoplay %s, whole book %s",
		SpokenBooksDB.autoplay and "on" or "off",
		SpokenBooksDB.readWholeBook and "on" or "off")
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
	elseif cmd == "read" or cmd == "play" then
		-- Deliberate, so it works with autoplay off: that is the whole point of the
		-- setting, and a command that respected it would leave no way to start narration.
		if SpokenBooks:ReadCurrent() == 0 then
			Print(SpokenBooks:HasAudio(SpokenBooks.lastPage or -1)
				and "nothing to read -- open a book first"
				or SpokenBooks:DescribeMissingAudio())
		end
	elseif cmd == "stop" then
		SpokenBooks:StopReading()
		Print("stopped")
	elseif cmd == "status" then
		Status()
	else
		Print("/spb read | stop | autoplay | whole | status")
	end
end
