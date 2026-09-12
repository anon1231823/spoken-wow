-- koKR. Empty: nothing has been translated yet.
--
-- Every key in Locale/enUS.lua belongs here, with the same positional format
-- arguments (%1$s) in whatever order this language needs them. Anything missing
-- falls back to English at runtime, and the shortfall is what keeps this language
-- out of the switcher -- see tools/locale/build-languages.mjs.

local _, ZoneLore = ...

if not ZoneLore:ShouldLoadLanguage("koKR") then
	return
end

local L = {}

ZoneLore:RegisterStrings("koKR", L)
