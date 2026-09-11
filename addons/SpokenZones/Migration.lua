-- The addon was ZoneLore, and the client names a SavedVariables file after the folder:
-- ZoneLoreDB and ZoneLoreCharDB live in ZoneLore.lua, which only still loads because a
-- tombstone folder of that name declares them. This copies them once into this addon's own
-- variables.
--
-- First in the load order, at file scope, on purpose: Language.lua reads the saved language
-- choice while the Data/ files are still loading, long before ADDON_LOADED, and it has to
-- find it in the new table by then. LoadSavedVariablesFirst in the .toc is what makes the
-- old tables exist this early.
local function DeepCopy(value)
	if type(value) ~= "table" then
		return value
	end
	local copy = {}
	for key, item in pairs(value) do
		copy[key] = DeepCopy(item)
	end
	return copy
end

if type(ZoneLoreDB) == "table" and not (type(SpokenZonesDB) == "table" and SpokenZonesDB.migratedFrom) then
	SpokenZonesDB = DeepCopy(ZoneLoreDB)
	SpokenZonesDB.migratedFrom = "ZoneLore"
	if type(ZoneLoreCharDB) == "table" then
		SpokenZonesCharDB = DeepCopy(ZoneLoreCharDB)
	end
end
