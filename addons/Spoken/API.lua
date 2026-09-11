setfenv(1, SpokenEnv)

-- The public surface. Everything a feature addon may rely on is defined in this file
-- or documented here; nothing else on `Spoken` is a contract.
--
-- API_VERSION moves only on a breaking change. A feature addon's entire hard
-- requirement is `_G.Spoken and Spoken:IsCompatible(1)`, and a copy bundled into a
-- legacy-client zip may lag the one an addon manager installs, so this is what lets
-- the two disagree safely.
Spoken.API_VERSION = 1
Spoken.ADDON_VERSION = AddonVersion

---@param required number The API_VERSION the caller was written against.
---@return boolean
function Spoken:IsCompatible(required)
    return type(required) == "number" and required <= self.API_VERSION
end
