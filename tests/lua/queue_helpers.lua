-- Shared by queue_test.lua and sources_test.lua: a fresh player with two registered
-- sources, a clip factory, and a recorder for the player's callbacks.
local M = {}

function M.Fresh(stub, spokenDir)
    stub.SetClient("11509")
    stub.ResetSound()
    stub.ResetTimers()
    local env = stub.LoadSpoken(spokenDir)
    env.Addon.db.char.IsPaused = false
    local quests = env.Sources:Register("quests", { title = "Quests", addon = "SpokenQuests", order = 1 })
    local zones = env.Sources:Register("zones", { title = "Zones", addon = "SpokenZones", order = 2,
        queueLimit = 3, interClipGap = 0.25, channel = function() return "Dialog" end })
    return env, quests, zones
end

local n = 0
--- A clip with a unique key unless one is given. `length` defaults to 1.
function M.Clip(fields)
    n = n + 1
    local clip = { key = "k" .. n, path = "clip" .. n .. ".ogg", length = 1,
        present = { header = "h", label = "l", bullet = "b", portrait = { kind = "none" } } }
    for k, v in pairs(fields or {}) do clip[k] = v end
    return clip
end

--- Records every callback the player fires as "EVENT key[ extra]".
function M.Recorder(env)
    local log = {}
    for _, event in ipairs({ "CLIP_QUEUED", "CLIP_STARTED", "CLIP_STOPPED", "CLIP_DROPPED", "QUEUE_EMPTY", "AUDIO_CHANGED" }) do
        env.Callbacks:Register(event, function(clip, extra)
            local line = event
            if type(clip) == "table" then line = line .. " " .. clip.key end
            if extra ~= nil then line = line .. " " .. tostring(extra) end
            table.insert(log, line)
        end)
    end
    local rec = { log = log }
    function rec:Has(line)
        for _, l in ipairs(log) do if l == line then return true end end
        return false
    end
    function rec:Count(prefix)
        local c = 0
        for _, l in ipairs(log) do if l:sub(1, #prefix) == prefix then c = c + 1 end end
        return c
    end
    return rec
end

function M.Expecter(print)
    local failures = 0
    local function Expect(scenario, actual, expected)
        if actual == expected then
            print(string.format("ok   %s", scenario))
        else
            failures = failures + 1
            print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
                tostring(expected), tostring(actual)))
        end
    end
    return Expect, function() return failures end
end

return M
