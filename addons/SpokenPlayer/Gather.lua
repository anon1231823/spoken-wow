setfenv(1, SpokenEnv)

-- Contributing in the background: every line a feature addon would have offered a Contribute
-- button for, kept in this addon's saved variables until the player uploads the file.
--
-- WHY THE SAVED VARIABLES AND NOT A LINK. A Contribute link carries one envelope, and a
-- player who meets a hundred gaps in an evening will not click a hundred times. The saved
-- variables file is the one thing an addon can write that leaves the game, and the site's
-- /contribute page reads it back: the envelopes in it are the same bytes a link would carry,
-- so the server checks them exactly as it checks a click.
--
-- Here, not in each feature addon, so there is one file to upload whichever addons gathered.
-- Loaded from Contribute.xml alone: the private-server clients, where contributing is off,
-- never have a Gather table, so nothing is gathered there either.
--
-- Keyed by what the line IS (quest, stage and speaker; page checksum), not by the envelope's
-- own checksum: an envelope captured again a second later can differ only in the NPC model a
-- slow cache has since answered, and that should replace the first rather than sit beside it.

local CAP = 2000 -- a few kilobytes each, so a full store stays a file the site will take

Gather = {}
Spoken.Gather = Gather

local function Store()
    local global = Addon.db and Addon.db.global
    if not global then
        return nil
    end
    global.Gather = global.Gather or {}
    return global.Gather
end

local function Lines()
    local store = Store()
    if not store then
        return nil
    end
    store.Lines = store.Lines or {}
    return store.Lines
end

function Gather:IsEnabled()
    local store = Store()
    return store and store.Enabled and true or false
end

function Gather:SetEnabled(enabled)
    local store = Store()
    if store then
        store.Enabled = enabled and true or false
        Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED")
    end
end

function Gather:IsIntroduced()
    local store = Store()
    return store and store.Introduced and true or false
end

function Gather:SetIntroduced()
    local store = Store()
    if store then
        store.Introduced = true
    end
end

--- Keep one envelope under `key`, replacing whatever that key held. Does nothing unless the
--- player opted in: a feature addon may call this on every panel without asking first.
---@return boolean stored
function Gather:Add(key, envelope)
    if not self:IsEnabled() then
        return false
    end
    if type(key) ~= "string" or key == "" or type(envelope) ~= "string" or envelope == "" then
        return false
    end
    local lines = Lines()
    for i = 1, #lines do
        if lines[i].key == key then
            lines[i].envelope = envelope
            return true
        end
    end
    lines[#lines + 1] = { key = key, envelope = envelope }
    -- Oldest out first. The player has almost certainly uploaded those already, or was never
    -- going to, and a file that grows forever is one the site eventually refuses whole.
    while #lines > CAP do
        table.remove(lines, 1)
    end
    return true
end

function Gather:Count()
    local lines = Lines()
    return lines and #lines or 0
end

--- Forget everything gathered. The addon cannot see the upload happen, so this is the
--- player's to press once they have sent the file.
function Gather:Clear()
    local store = Store()
    if store then
        store.Lines = {}
    end
end

Gather.CAP = CAP
