setfenv(1, SpokenEnv)
Version = {}

local CLIENT_VERSION, BUILD, _, INTERFACE_VERSION = GetBuildInfo()

Version.Client                  = CLIENT_VERSION
Version.Build                   = BUILD
Version.Interface               = INTERFACE_VERSION or 0
Version.IsAnyLegacy             = WOW_PROJECT_ID == nil or nil
Version.IsLegacyVanilla         = Version.IsAnyLegacy and Version.Interface ==     0 or nil
Version.IsLegacyBurningCrusade  = Version.IsAnyLegacy and Version.Interface == 20400 or nil
Version.IsLegacyWrath           = Version.IsAnyLegacy and Version.Interface == 30300 or nil
Version.IsAnyRetail             = not Version.IsAnyLegacy or nil
Version.IsRetailVanilla         = Version.IsAnyRetail and WOW_PROJECT_ID == WOW_PROJECT_CLASSIC or nil
Version.IsRetailBurningCrusade  = Version.IsAnyRetail and WOW_PROJECT_ID == WOW_PROJECT_BURNING_CRUSADE_CLASSIC or nil
Version.IsRetailWrath           = Version.IsAnyRetail and WOW_PROJECT_ID == WOW_PROJECT_WRATH_CLASSIC or nil
Version.IsRetailMainline        = Version.IsAnyRetail and WOW_PROJECT_ID == WOW_PROJECT_MAINLINE or nil
-- The "WoW Forever" beta client: vanilla content on the modern engine, answering
-- WOW_PROJECT_MAINLINE with an interface number of its own (16001) two orders of
-- magnitude below the live one, so the comparison holds for its later builds too.
Version.IsCamelot               = Version.IsRetailMainline and Version.Interface < 100000 or nil

function Version:IsBelowLegacyVersion(version)
    return self.IsAnyLegacy and self.Interface < version or nil
end
function Version:IsRetailOrAboveLegacyVersion(version)
    return self.IsAnyRetail or self.Interface >= version or nil
end
