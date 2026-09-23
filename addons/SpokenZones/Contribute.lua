-- A place this addon has no lore for, as something a player can describe.
--
-- No text, unlike the quests and books envelopes: zone lore is wiki-sourced rather than
-- client-sourced, so the client has nothing to hand over. What this sends names the place --
-- the map, the zone, the subzone -- and the contribute page asks the player for the part that
-- is actually missing: a description of it.
--
-- It travels the same format for one reason: one triage queue for three addons.

local ADDON_NAME, SpokenZones = ...

-- The merged domain, not SpokenZones.SITE_URL ("https://lore.rusty.one", ReportButton.lua's
-- own report domain): the contribute page is new and exists only on the site all three
-- sections share. Kept as a local of its own for the reason SpokenQuests/Contribute.lua gives
-- for the same split -- a report link that moved would be a report link that breaks for
-- everyone still running the shipped addon.
local SITE_URL = "https://spoken.rusty.one"

--- Whether this client can offer Contribute at all: a player that carries contributing (an
--- older bundled one does not), and the buttons not hidden in its settings.
function SpokenZones:CanContribute()
    if not (_G.Spoken and Spoken.Contribute and Spoken.ShowContribution) then
        return false
    end
    if Spoken.AreContributeButtonsHidden and Spoken:AreContributeButtonsHidden() then
        return false
    end
    return true
end

--- The envelope for a place the panel is showing with no lore, or nil with no map to name.
---
--- The place the player is looking at, not where they stand: every zone and subzone is already
--- known, what is missing is what to say about it, and a player reading the map of a zone they
--- have been to can describe it from anywhere. The description itself is written on the
--- contribute page, which asks for it -- the client has nothing to hand over.
function SpokenZones:CaptureContribution(mapID, subzone)
    if not mapID then
        return nil
    end

    local fields =
    {
        -- SpokenZones.VERSION does not exist -- Core.lua computes the real .toc version into
        -- the lowercase SpokenZones.version; "dev" is what a source checkout with no .toc
        -- metadata at all reads back as.
        { "addon", format("SpokenZones/%s", self.version or "dev") },
        { "build", format("%s/%s", (GetBuildInfo and select(1, GetBuildInfo())) or "?",
                                   (GetBuildInfo and select(2, GetBuildInfo())) or "?") },
        { "locale", (GetLocale and GetLocale()) or "enUS" },
        -- The language narration plays in, said outright so triage can see what the player
        -- was hearing beside what their client shows.
        { "pack", self:GetPackLanguage() },
        { "map", mapID },
    }
    local zone = self:GetMapName(mapID)
    if zone and zone ~= "" then
        fields[#fields + 1] = { "zone", zone }
    end
    -- Omitted rather than sent empty for the zone itself: the site keys a contribution on the
    -- map, or the map and the subzone, and an empty subzone is a key it would have to decide
    -- about.
    if subzone and subzone ~= "" then
        fields[#fields + 1] = { "subzone", subzone }
    end

    return Spoken.Contribute:Envelope("zones", fields, nil)
end

-- Compression belongs here, not in CaptureContribution: this runs once, on the click.
function SpokenZones:ShowContribution(mapID, subzone)
    local envelope = self:CaptureContribution(mapID, subzone)
    if not envelope then
        return
    end
    local address = format("%s/contribute", SITE_URL)
    -- Encode is absent on an older SpokenPlayer a legacy-client zip can still bundle; Link
    -- returns nil for that or for an oversized result, and the two-copy fallback still works.
    local link = Spoken.Contribute.Encode and Spoken.Contribute:Link(address, envelope)
    if link then
        Spoken:ShowContribution(link, address, true)
    else
        Spoken:ShowContribution(envelope, address)
    end
end
