-- Two players of this lineage handle the same events and queue the same line, so SpokenQuests
-- stops any older one it finds and disables its folder for the next login. What it must not
-- touch is the TOC-only tombstone it ships itself under the old folder name: that folder holds
-- no code, it arrives in this addon's own zip, and disabling an addon is something current
-- clients refuse - they answer with their own "blocked from an action only available to the
-- Blizzard UI" dialog. A fresh install used to open with both dialogs, about an addon nobody
-- had installed. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/SpokenQuests/"
local Expect, Failures = H.Expecter(print)

local PACK = { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1" } }
-- The folder the release ships under the old name, and the folder an upgrade may still hold:
-- the client cannot tell them apart, and neither entry says whether any code came with it.
local TOMBSTONE = { folder = "VoiceOverRedux", title = "|cff888888VoiceOver Redux|r (now Spoken Quests)" }
local UPSTREAM = { folder = "AI_VoiceOver", title = "VoiceOver" }

--- A login with the addon list and the old players the scenario describes. The saved
--- variables are dropped unless the scenario is a second login of the same character.
local function Login(addons, loadedPlayers, keepSaved)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetAddOns(addons)
    stub.SetLoadedPlayers(loadedPlayers)
    if not keepSaved then
        _G.SpokenQuestsDB, _G.VoiceOverDB = nil, nil
    end
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
    local VO = stub.LoadQuestsAlone(QUESTS)
    VO.Addon:OnInitialize()
    return VO
end

local function Shown()
    for _, popup in ipairs(stub.popups) do
        if popup.key == "VOICEOVER_REDUX_DUPLICATE_ADDON" then
            return popup.dialog
        end
    end
end

---------------------------------------------------------------- a fresh install
Login({ PACK, TOMBSTONE }, {})
Expect("the tombstone raises no dialog", Shown(), nil)
Expect("...and nothing is disabled for it", #stub.disabledAddOns, 0)

---------------------------------------------------------------- the old player is really there
Login({ PACK, TOMBSTONE }, { "VoiceOverRedux" })
Expect("a registered old player is stopped for the session",
    stub.aceAddons["VoiceOverRedux"] and stub.aceAddons["VoiceOverRedux"].stopped, true)
Expect("...its folder disabled for the next login", stub.disabledAddOns[1], "VoiceOverRedux")
Expect("...and the dialog names it", Shown() and Shown().text:find('"VoiceOverRedux"', 1, true) ~= nil, true)

---------------------------------------------------------------- upstream, under its own name
-- The AceAddon name a player registers under is not the folder it installs into, and the
-- dialog has to say the folder: that is what the player deletes or leaves switched off.
Login({ PACK, UPSTREAM }, { "VoiceOver" })
Expect("upstream's folder is disabled, not its AceAddon name", stub.disabledAddOns[1], "AI_VoiceOver")
Expect("...and the dialog names the folder", Shown() and Shown().text:find('"AI_VoiceOver"', 1, true) ~= nil, true)

---------------------------------------------------------------- installed, already switched off
-- Nothing registered, so nothing is duplicating anything. The dialog used to say it "was also
-- enabled" about a folder the player had disabled themselves.
Login({ PACK, UPSTREAM }, {})
Expect("an old player switched off raises no dialog", Shown(), nil)
Expect("...and is not disabled again", #stub.disabledAddOns, 0)

---------------------------------------------------------------- said once
Login({ PACK, TOMBSTONE }, { "VoiceOverRedux" })
Shown().OnAccept()
Login({ PACK, TOMBSTONE }, { "VoiceOverRedux" }, true)
Expect("the dialog is not repeated at the next login", Shown(), nil)
Expect("...though the duplicate is still disabled", stub.disabledAddOns[1], "VoiceOverRedux")

stub.ResetAddOns()
stub.SetLoadedPlayers({})
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll duplicate-player tests passed")
