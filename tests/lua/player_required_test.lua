-- The player is an optional dependency, so a feature addon loads without it and says so.
-- The one case worth a dialog rather than a line of chat is the player being installed and
-- switched off: that is one click to fix, and the addon manager that installed the player
-- cannot notice. Both feature addons carry their own copy of this, because the code they
-- would share lives in the addon that is missing. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/SpokenQuests/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

local DISABLED = { folder = "SpokenPlayer", title = "Spoken Player", loadable = false, reason = "DISABLED" }
local PACK = { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1" } }

--- A login with no player loaded, and the addon list the scenario describes.
local function Login(addons)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetAddOns(addons)
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
end

local function Shown()
    for _, popup in ipairs(stub.popups) do
        if popup.key == "SPOKEN_PLAYER_REQUIRED" then
            return popup.dialog
        end
    end
end

---------------------------------------------------------------- one addon, player switched off
Login({ PACK, DISABLED })
local VO = stub.LoadQuestsAlone(QUESTS)
VO.Addon:OnInitialize()
VO.Addon:PromptForPlayer()
local dialog = Shown()
Expect("the dialog is raised", dialog ~= nil, true)
Expect("...naming the addon that needs the player", dialog and dialog.text,
    "|cffffd200Spoken Player|r is required to use Spoken Quests.")
Expect("...offering to enable it", dialog and dialog.button1, "Enable")
Expect("...and to decline", dialog and dialog.button2, "Cancel")
Expect("nothing is enabled until the button is clicked", #stub.enabledAddOns, 0)
dialog.OnAccept()
Expect("accepting enables the player", stub.enabledAddOns[1], "SpokenPlayer")
Expect("...and reloads, since an addon only loads at login", stub.reloads, 1)

---------------------------------------------------------------- said once, however many addons ask
Login({ PACK, DISABLED })
VO = stub.LoadQuestsAlone(QUESTS)
VO.Addon:OnInitialize()
local Z = stub.LoadZones(ZONES, H.NewZoneLore())
Z:SetupAudio()
VO.Addon:PromptForPlayer()
Z:PromptForPlayer()
local seen = 0
for _, popup in ipairs(stub.popups) do
    if popup.key == "SPOKEN_PLAYER_REQUIRED" then seen = seen + 1 end
end
Expect("two addons raise one dialog", seen, 1)
Expect("...naming both", Shown() and Shown().text,
    "|cffffd200Spoken Player|r is required to use Spoken Quests and Spoken Zones.")

---------------------------------------------------------------- the zones addon alone
Login({ PACK, DISABLED })
Z = stub.LoadZones(ZONES, H.NewZoneLore())
Z:SetupAudio()
Z:PromptForPlayer()
Expect("the zones addon raises it too", Shown() ~= nil, true)
Expect("...naming itself", Shown() and Shown().text,
    "|cffffd200Spoken Player|r is required to use Spoken Zones.")

---------------------------------------------------------------- not installed at all
-- Nothing to enable, so nothing to click. The addon's own line in chat already says it.
Login({ PACK })
VO = stub.LoadQuestsAlone(QUESTS)
VO.Addon:OnInitialize()
VO.Addon:PromptForPlayer()
Expect("an absent player raises no dialog", Shown(), nil)

---------------------------------------------------------------- present and enabled
Login({ PACK, { folder = "SpokenPlayer", title = "Spoken Player" } })
VO = stub.LoadQuestsAlone(QUESTS)
VO.Addon:OnInitialize()
VO.Addon:PromptForPlayer()
Expect("an enabled player raises no dialog", Shown(), nil)

---------------------------------------------------------------- the player actually loaded
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
stub.ResetAddOns()
_G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
VO = stub.LoadQuests(QUESTS, here .. "/../../addons/SpokenPlayer/")
VO.Addon:OnInitialize()
VO.Addon:PromptForPlayer()
Expect("a loaded player raises no dialog", Shown(), nil)

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player-required tests passed")
