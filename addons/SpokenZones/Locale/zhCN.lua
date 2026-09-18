-- zhCN. Empty: nothing has been translated yet.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, SpokenZones = ...

if not SpokenZones:ShouldLoadLanguage("zhCN") then
	return
end

local L = {}

SpokenZones:RegisterStrings("zhCN", L)
