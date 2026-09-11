-- Sources: how a feature addon registers with the player, and the per-source hooks the
-- domain-specific rules live behind. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests, zones = H.Fresh(stub, SPOKEN)
local rec = H.Recorder(env)

---------------------------------------------------------------- registration
Expect("a registered source is retrievable", env.Sources:Get("quests"), quests)
Expect("an unknown key is nil", env.Sources:Get("books"), nil)
local ok = pcall(function() env.Sources:Register("quests", { title = "Again" }) end)
Expect("registering a key twice is an error", ok, false)
local order = {}
for key in env.Sources:Iterate() do table.insert(order, key) end
Expect("Iterate follows `order`", table.concat(order, ","), "quests,zones")

---------------------------------------------------------------- admit
local vetoed = nil
local books = env.Sources:Register("books", { title = "Books", addon = "SpokenBooks", order = 3,
    admit = function(clip, queue) if vetoed then return false, vetoed end return true end })
vetoed = "no page open"
local bc = H.Clip()
local res, why = books:Enqueue(bc)
Expect("admit can veto", res, nil)
Expect("...with its own reason", why, "no page open")
Expect("...reported as dropped", rec:Has("CLIP_DROPPED " .. bc.key .. " no page open"), true)
vetoed = nil
Expect("...and lets clips through otherwise", books:Enqueue(H.Clip()) ~= nil, true)
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- enter / empty hooks
local enters, empties = 0, 0
local hooked = env.Sources:Register("hooked", { title = "Hooked", addon = "X", order = 4,
    onQueueEnter = function() enters = enters + 1 end,
    onQueueEmpty = function() empties = empties + 1 end })
local h1, h2 = H.Clip(), H.Clip()
hooked:Enqueue(h1); hooked:Enqueue(h2)
Expect("onQueueEnter fires once for the first clip", enters, 1)
Expect("...not again for the second", enters, 1)
Expect("onQueueEmpty has not fired yet", empties, 0)
stub.Advance(1.55)
Expect("...nor when one clip remains", empties, 0)
stub.Advance(1.55)
Expect("onQueueEmpty fires once the last leaves", empties, 1)
Expect("...exactly once", empties, 1)

---------------------------------------------------------------- testBeforeQueue
local probing = env.Sources:Register("probing", { title = "P", addon = "X", order = 5, testBeforeQueue = true })
world.missing["absent.ogg"] = true
res, why = probing:Enqueue(H.Clip({ path = "absent.ogg" }))
Expect("testBeforeQueue refuses a missing file at the door", res, nil)
Expect("...as missing", why, "missing")
Expect("...without queueing it", env.SoundQueue:GetQueueSize(), 0)

---------------------------------------------------------------- channel
stub.ResetSound()
quests:Enqueue(H.Clip())
Expect("no source channel: the player's setting", world.playedChannels[1], "Master")
env.SoundQueue:RemoveAllSoundsFromQueue()
zones:Enqueue(H.Clip())
Expect("a source channel overrides it", world.playedChannels[2], "Dialog")
env.SoundQueue:RemoveAllSoundsFromQueue()

world.cvars.Sound_EnableDialog = "0"
res, why = zones:Enqueue(H.Clip())
Expect("an inaudible channel refuses at the door", res, nil)
Expect("...with the audibility reason", why, "the Dialog sound channel is disabled")
Expect("CanPlay says the same", select(2, zones:CanPlay()), "the Dialog sound channel is disabled")
stub.ResetSound()

---------------------------------------------------------------- SOURCE_REGISTERED
local seen
env.Callbacks:Register("SOURCE_REGISTERED", function(source) seen = source end)
local late = env.Sources:Register("late", { title = "Late", addon = "X", order = 9 })
Expect("SOURCE_REGISTERED carries the source", seen, late)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll sources tests passed")
