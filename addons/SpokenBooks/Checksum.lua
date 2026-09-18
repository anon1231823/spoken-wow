-- The Lua half of pipelines/books/tools/lib/naming.mjs.
--
-- THE TWO MUST AGREE EXACTLY. The exporter keys Data/Books.lua on this number, so a page
-- whose checksum differs by one is a page this addon can never find -- and it fails
-- silently, as a book that simply does not narrate.
--
-- Multiply, add, modulo, and nothing else: the clients this ships to run Lua 5.1, which has
-- no bitwise operators, and string.byte walks UTF-8 bytes, which is why the exporter hashes
-- bytes rather than characters. The modulus is the largest signed 32-bit prime, so every
-- intermediate value stays exact in the doubles Lua stores numbers as.

local ADDON_NAME, SpokenBooks = ...

local MODULUS = 2147483647
local FACTOR = 31

local byte, len = string.byte, string.len
-- The client provides these as globals and the test stub mirrors it; `or string.*` is what
-- keeps this file loadable in a plain Lua that does neither.
local gsub = gsub or string.gsub
local strfind = strfind or string.find

---@param text string the page as the client is showing it
---@return number
function SpokenBooks:ChecksumOf(text)
	if type(text) ~= "string" then
		return 0
	end

	-- The exporter normalises before hashing: CRLF and WoW's $B become newlines, trailing
	-- spaces go, runs of blank lines collapse, and the ends are trimmed. The client hands
	-- us text that has already been through the first of those, but not the rest.
	text = self:Normalise(text)

	local sum = len(text) % MODULUS
	for i = 1, len(text) do
		sum = (sum * FACTOR + byte(text, i)) % MODULUS
	end
	return sum
end

--- The storage form the exporter hashes. Mirrors normaliseText in tools/lib/text.mjs.
function SpokenBooks:Normalise(text)
	text = gsub(text, "\r\n", "\n")
	text = gsub(text, "\r", "\n")
	text = gsub(text, "%$[Bb]", "\n")
	-- Trailing whitespace per line, then runs of blank lines, then the ends. Done in that
	-- order because trimming first would leave a "   \n" in the middle looking blank.
	text = gsub(text, "[ \t]+\n", "\n")
	text = gsub(text, "[ \t]+$", "")
	while strfind(text, "\n\n\n") do
		text = gsub(text, "\n\n\n", "\n\n")
	end
	text = gsub(text, "^%s+", "")
	text = gsub(text, "%s+$", "")
	return text
end
