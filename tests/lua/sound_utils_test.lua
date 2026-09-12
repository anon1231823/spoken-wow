-- The bottom of the player's playback stack: whether sound can be heard, and starting and
-- stopping one file. Run with `make test-player`.
--
-- The audibility predicate is VoiceOverRedux's (it checks volumes, and Master bypasses the
-- per-channel toggles) with ZoneLore's player-facing reasons. The per-client overrides in
-- Compat.lua are covered by reloading the same files as a 1.12 and a 3.3.5 client.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"

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

---------------------------------------------------------------- a current client
stub.SetClient("11509")
stub.ResetSound()
local env = stub.LoadSpoken(SPOKEN)
local SU = env.SoundUtils

world.cvars.Sound_EnableAllSound = "0"
Expect("all sound off is the first reason", SU:WhyInaudible("Dialog"), "all sound is disabled")
stub.ResetSound()

world.cvars.Sound_MasterVolume = "0"
Expect("master volume at zero is a reason", SU:WhyInaudible("Master"), "the master volume is 0")
stub.ResetSound()

world.cvars.Sound_EnableSFX = "0"
Expect("Master bypasses the per-channel toggles", SU:WhyInaudible("Master"), nil)
Expect("...but a channel honours its own", SU:WhyInaudible("SFX"), "the SFX sound channel is disabled")
stub.ResetSound()

world.cvars.Sound_DialogVolume = "0"
Expect("a channel at zero volume is a reason", SU:WhyInaudible("Dialog"), "the Dialog sound channel volume is 0")
stub.ResetSound()

Expect("everything on is audible", SU:WhyInaudible("Dialog"), nil)
Expect("IsSoundEnabled is the predicate form", SU:IsSoundEnabled("Dialog"), true)

local clip = { path = "a.ogg" }
Expect("PlaySound reports the client accepted the file", SU:PlaySound(clip, "Dialog"), true)
Expect("...on the channel it was given", world.playedChannels[1], "Dialog")
Expect("...and records the handle on the clip", clip.handle, 1)

SU:StopSound(clip)
Expect("StopSound stops that handle", world.stopped[1], 1)
Expect("...and clears it", clip.handle, nil)
SU:StopSound(clip)
Expect("StopSound on a clip with no handle is a no-op", #world.stopped, 1)

world.missing["gone.ogg"] = true
local gone = { path = "gone.ogg" }
Expect("a missing file is refused", SU:PlaySound(gone, "Master"), false)
Expect("...and leaves no handle", gone.handle, nil)

stub.ResetSound()
local probe = { path = "b.ogg" }
Expect("TestSound answers whether the file exists", SU:TestSound(probe), true)
Expect("...by playing it", world.played[1], "b.ogg")
Expect("...and stopping it at once", world.stopped[1], 1)
Expect("...without leaving a handle behind", probe.handle, nil)
world.missing["gone.ogg"] = true
Expect("TestSound says no for a missing file", SU:TestSound({ path = "gone.ogg" }), false)

---------------------------------------------------------------- 1.12
stub.SetClient("1.12")
stub.ResetSound()
env = stub.LoadSpoken(SPOKEN)
SU = env.SoundUtils

world.cvars.MasterSoundEffects = "0"
Expect("1.12 reads its own CVar", SU:WhyInaudible("Master"), "sound effects are disabled")
world.cvars.MasterSoundEffects = "1"
Expect("1.12 audible", SU:WhyInaudible("Master"), nil)

clip = { path = "a.mp3" }
SU:PlaySound(clip, "Master")
Expect("1.12 plays the file", world.played[1], "a.mp3")
Expect("1.12 marks the clip stoppable", clip.handle ~= nil, true)
local before = #world.cvarLog
SU:StopSound(clip)
Expect("1.12 stops by toggling sound effects off", world.cvarLog[before + 1][1] .. "=" .. world.cvarLog[before + 1][2], "MasterSoundEffects=0")
Expect("...and on again", world.cvarLog[before + 2][1] .. "=" .. world.cvarLog[before + 2][2], "MasterSoundEffects=1")
Expect("...and clears the handle", clip.handle, nil)

world.missing["gone.mp3"] = true
Expect("1.12 cannot probe, so TestSound trusts the lookup", SU:TestSound({ path = "gone.mp3" }), true)

---------------------------------------------------------------- 3.3.5
stub.SetClient("3.3.5")
stub.ResetSound()
env = stub.LoadSpoken(SPOKEN)
SU = env.SoundUtils
local music = env.Addon.db.profile.Audio.LegacyMusicChannel
Expect("3.3.5 gets the music-channel settings", music ~= nil, true)

music.Enabled = false
world.cvars.Sound_EnableSFX = "0"
Expect("3.3.5 without the music channel needs SFX on", SU:WhyInaudible("Master"), "the SFX sound channel is disabled")
music.Enabled = true
Expect("3.3.5 on the music channel does not", SU:WhyInaudible("Master"), nil)
stub.ResetSound()

music.Enabled = false
clip = { path = "a.mp3", length = 2 }
SU:PlaySound(clip, "Master")
Expect("music channel off: played as a plain sound", world.played[1], "a.mp3")
Expect("...which cannot be stopped, so no handle", clip.handle, nil)
stub.ResetSound()

Expect("...and reports that it will play, or the queue discards it", (SU:PlaySound({ path = "b.mp3", length = 2 }, "Master")), true)
stub.ResetSound()

music.Enabled = true
music.FadeOutMusic = 0
clip = { path = "a.mp3", length = 2 }
SU:PlaySound(clip, "Master")
Expect("music channel on: played as music", world.music[1], "a.mp3")
Expect("...and stoppable", clip.handle ~= nil, true)
SU:StopSound(clip)
Expect("stopping plays the player's own silence to cut it", world.music[2], [[Interface\AddOns\Spoken\Sounds\silence.wav]])
Expect("...then clears the handle", clip.handle, nil)
Expect("...reported as playing", (SU:PlaySound({ path = "c.mp3", length = 2 }, "Master")), true)

if failures > 0 then
    print(string.format("\n%d failure(s)", failures))
    os.exit(1)
end
print("\nAll sound utils tests passed")
