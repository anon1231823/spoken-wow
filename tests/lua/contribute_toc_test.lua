-- Contributing is off on the private-server clients (1.12, 2.4.3, 3.3.5): their .toc files
-- must not list Contribute.xml, and every Blizzard-client .toc must. The 1.12 client's Lua 5.0
-- cannot even parse the contribute files, so this is load-bearing, not cosmetic, and nothing
-- else runs a 5.0 parser to catch it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local ADDONS = here .. "/../../addons/"

local function Lists(path, file)
    local toc = assert(io.open(path)):read("*a")
    return toc:find("\n" .. file:gsub("%.", "%%.") .. "%s*\n") ~= nil or toc:find("\n" .. file:gsub("%.", "%%.") .. "%s*$") ~= nil
end

for _, addon in ipairs({ "SpokenPlayer", "SpokenQuests" }) do
    for _, legacy in ipairs({ "1.12", "2.4.3", "3.3.5" }) do
        local toc = ADDONS .. addon .. "/" .. addon .. "_" .. legacy .. ".toc"
        Expect(addon .. "_" .. legacy .. ".toc does not load contributing", Lists(toc, "Contribute.xml"), false)
        Expect("...but still loads the addon", Lists(toc, "addon.xml"), true)
    end
    for _, flavor in ipairs({ "", "_Mainline", "_Vanilla", "_TBC", "_Wrath" }) do
        local toc = ADDONS .. addon .. "/" .. addon .. flavor .. ".toc"
        Expect(addon .. flavor .. ".toc loads contributing", Lists(toc, "Contribute.xml"), true)
    end
    local shared = assert(io.open(ADDONS .. addon .. "/addon.xml")):read("*a")
    Expect(addon .. "/addon.xml, which every client loads, carries no contribute file",
        shared:find("Contribute") == nil, true)
end

os.exit(Failures() == 0 and 0 or 1)
