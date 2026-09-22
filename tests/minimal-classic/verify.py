from pathlib import Path
from PIL import Image
from lupa.lua51 import LuaRuntime

root=Path(__file__).parent
lua=LuaRuntime(unpack_returned_tuples=True)
addon=root.parents[1]/'addons'/'SpokenPlayer'
compile_lua=lua.eval('function(code,name) local f,e=loadstring(code,name); if not f then error(e) end;return true end')
files=list(addon.rglob('*.lua'))
for path in files: compile_lua(path.read_text(encoding='utf-8-sig'),str(path))
print('PASS: Lua 5.1 syntax for',len(files),'addon/library files')
lua.execute((root/'fixture.lua').read_text(encoding='utf-8'))
def load(name): lua.execute((addon/name).read_text(encoding='utf-8-sig'),name=name)
load('Environment.lua')
lua.execute('SpokenEnv.Version={IsAnyLegacy=false,IsLegacyVanilla=false,IsRetailVanilla=false,IsRetailOrAboveLegacyVersion=function() return true end}')
load('Core.lua')
lua.execute('''
SpokenEnv.Addon.db={profile=SpokenEnv.Defaults.profile,char={IsPaused=false}}
SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog=false
SpokenEnv.SoundUtils={
  WhyInaudible=function() end, IsMutedByPlayer=function() return false end,
  PlaySound=function(_,clip) clip.handle=clip.id;return true end,
  StopSound=function(_,clip) clip.handle=nil end, MuteChannel=function() end,
}
SpokenEnv.Options={Open=function() end}
''')
for name in ['Callbacks.lua','SoundQueue.lua','Sources.lua','Strings.lua','UI/Portrait.lua','UI/StaticPortrait.lua','UI/Actions.lua','UI/PlayerFrame.lua','UI/MinimalPlayer.lua','API.lua']: load(name)
lua.execute('''
local E=SpokenEnv
local P,Q,A=E.MinimalPlayer,E.SoundQueue,E.Addon
local function near(a,b) assert(math.abs(a-b)<.001,tostring(a).." ~= "..tostring(b)) end
local source={key="test",gates={},interClipGap=.25,GetChannel=function() return "Master" end}
local clicked=0
local actions={
 {id="report",text="Report",onClick=function(clip) assert(clip==Q:GetCurrentSound());clicked=clicked+1 end},
 {id="custom",create=function(parent)
    local b=CreateFrame("Button",nil,parent);b:SetSize(32,32)
    b:SetScript("OnClick",function(self) assert(self.seen==Q:GetCurrentSound());clicked=clicked+1 end)
    return b
  end,onClipChanged=function(clip,button) button.seen=clip end},
}
local function Clip(key,length,portrait)
 return {key=key,path="test.ogg",length=length or 20,present={header="Marshal McBride",label=key,
  actions=actions,portrait=portrait or {kind="model",creatureID=123}}}
end
E.PlayerFrame:Initialize()
assert(not P.frame:IsShown() and not E.PlayerFrame.frame:IsShown())
assert(Spoken:GetPlayerFrame()==P.frame)
local first=Clip("First")
Q:Add(first,source)
assert(P.frame:IsShown() and P.wanted and P.viewport.active=="static")
assert(P.viewport:GetWidth()==78 and not P.viewport.model)
Advance(5);near(P.bar:GetValue(),.25)
Q:PauseQueue();Advance(3);near(P.bar:GetValue(),.25)
assert(P.pause.wash:IsShown())
Q:ResumeQueue();near(P.bar:GetValue(),0)
Advance(2);near(P.bar:GetValue(),.1)
print("PASS: real queue -> UI; timer-based progress; pause freezes; restart resets")

for i=1,7 do Q:Add(Clip("Waiting "..i),source) end
P:ToggleQueue();assert(P.drawer:IsShown() and P.rows[4]:IsShown())
P.drawer.scripts.OnMouseWheel(P.drawer,-3)
assert(P.offset==3 and P.rows[1].clip.key=="Waiting 4")
local before=Q:GetQueueSize();P.rows[1]:Click();assert(Q:GetQueueSize()==before-1)
assert(Q:GetCurrentSound()==first)
P.frame.bottom=2;P:LayoutQueue()
assert(P.drawer.points[1][1]=="BOTTOMLEFT")
P.frame.bottom=200
P:ToggleMenu();assert(P.menu:IsShown())
for _,button in ipairs(P.frame.actions.buttons) do assert(button:GetParent()==P.actionHost);button:Click() end
assert(clicked==2)
Q:Skip();assert(not P.menu:IsShown())
print("PASS: paginated queue, removal, bottom-edge drop-up, original custom/source action handlers, stale-menu closure")

A.db.profile.Frame.HidePortrait=true;E.PlayerFrame:RefreshConfig()
assert(not P.portrait:IsShown());near(P.frame:GetWidth(),300)
A.db.profile.Frame.HidePortrait=false;E.PlayerFrame:RefreshConfig()
assert(P.portrait:IsShown());near(P.frame:GetWidth(),380)
A.db.profile.Frame.HideFrame=true;E.PlayerFrame:RefreshConfig()
assert(not P.frame:IsShown() and Q:IsPlaying())
Advance(4)
A.db.profile.Frame.HideFrame=false;E.PlayerFrame:RefreshConfig()
near(P.bar:GetValue(),.2)
A.db.profile.Frame.LockFrame=true;P:StartDrag();assert(not P.frame.moving)
A.db.profile.Frame.LockFrame=false;P:StartDrag();assert(P.frame.moving)
P.frame:StopMovingOrSizing()
print("PASS: hidden portrait, audio-only mode, progress catch-up, movement lock")

A.db.profile.Frame.MinimalPlayer=false;E.PlayerFrame:RefreshConfig()
assert(not P.frame:IsShown() and E.PlayerFrame.frame:IsShown())
assert(Spoken:GetPlayerFrame()==E.PlayerFrame.frame)
A.db.profile.Frame.MinimalPlayer=true;E.PlayerFrame:RefreshConfig()
assert(P.frame:IsShown() and not E.PlayerFrame.frame:IsShown())
A.db.profile.Frame.MinimalWidth=600;P:Reset();near(P.frame:GetWidth(),380)
Q:RemoveAllSoundsFromQueue();assert(not P.wanted)
Advance(.3);assert(not P.frame:IsShown())
print("PASS: original-layout fallback, public frame API, reset, fade-out to hidden")

local held=true
source.gates={function() if held then return "Combat" end end}
local gated=Clip("Held")
Q:Add(gated,source)
assert(not Q:IsPlaying() and string.find(P.title.text:GetText(),"Combat"))
near(P.bar:GetValue(),0)
held=false;Q:Advance();assert(Q:IsPlaying())
Q:RemoveAllSoundsFromQueue();source.gates={}
Q:Add(Clip("Book",20,{kind="texture",texture="Book"}),source)
assert(P.viewport.active=="texture" and getn(P.viewport.texture.masks)==1)
P:Update();assert(getn(P.viewport.texture.masks)==1)
Q:RemoveAllSoundsFromQueue()
Q:Add(Clip("Short",2),source);Advance(2.1);near(P.bar:GetValue(),1)
assert(Q:IsPlaying());Advance(.2);assert(Q:IsEmpty())
Q:Add(Clip("Zero",0),source);near(P.bar:GetValue(),0)
assert(getn(E.Callbacks.errors)==0,table.concat(E.Callbacks.errors,"\\n"))
print("PASS: combat gates, round texture fallback, gap clamping, zero-duration safety, no callback errors")
''')
lua.execute('''
local E=SpokenEnv
local P,Q,S=E.MinimalPlayer,E.SoundQueue,E.StaticPortrait
Q:RemoveAllSoundsFromQueue();Advance(.3)
local source={key="portraits",gates={},interClipGap=.25,GetChannel=function() return "Master" end}
local a="Creature-0-1-2-3-123-AAAA"
local b="Creature-0-1-2-3-456-BBBB"
local c="Creature-0-1-2-3-789-CCCC"
local function Clip(key,guid,id)
 return {key=key,path="test.ogg",length=20,unitGUID=guid,present={header=key,label=key,
   portrait={kind="model",creatureID=id,fallback={kind="texture",texture="Book"}}}}
end
MockUnits.npc=a;MockUnits.target=a
local first=Clip("NPC A",a,123);Q:Add(first,source)
local portraitA=P.viewport.activeFrame
assert(portraitA.nativeGUID==a and P.viewport.active=="static")
MockUnits.npc=b;MockUnits.target=b
local second=Clip("NPC B",b,456);Q:Add(second,source)
assert(S.cache[b] and S.cache[b].texture.nativeGUID==b)
MockUnits.npc=nil;MockUnits.target=c
S.watcher.scripts.OnEvent(S.watcher,"PLAYER_TARGET_CHANGED")
assert(P.viewport.activeFrame==portraitA and portraitA.nativeGUID==a)
Q:Skip()
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==b)
assert(not portraitA:IsShown())
Q:PauseQueue();Q:ResumeQueue()
assert(P.viewport.activeFrame.nativeGUID==b)
print("PASS: native static snapshots survive dialogue closure, target changes, queued-speaker changes and restart")

local portraitB=P.viewport.activeFrame
local calls=portraitB.nativeCalls
MockUnits.target=b
S.watcher.scripts.OnEvent(S.watcher,"UNIT_PORTRAIT_UPDATE","target")
assert(portraitB.nativeCalls==calls+1)
Q:RemoveAllSoundsFromQueue()
MockUnits.npc=nil;MockUnits.target=c
Q:Add(Clip("Unseen", "Creature-0-1-2-3-321-DDDD",321),source)
assert(P.viewport.active=="texture" and P.viewport.texture:GetTexture()=="Book")
assert(not portraitB:IsShown())
MockUnits.target="Creature-0-1-2-3-321-DDDD"
S.watcher.scripts.OnEvent(S.watcher,"PLAYER_TARGET_CHANGED")
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==MockUnits.target)
assert(getn(P.viewport.activeFrame.masks)==1)
Q:RemoveAllSoundsFromQueue()
-- Real GUIDs must never borrow another spawn's face even with the same creature ID.
MockUnits.target=b
Q:Add(Clip("Different spawn", "Creature-0-1-2-3-456-OTHER",456),source)
assert(P.viewport.active=="texture")
Q:RemoveAllSoundsFromQueue()
MockUnits.target=nil
Q:Add(Clip("Quest log", "Creature-0-0-0-0-456-000000",456),source)
assert(P.viewport.active=="static" and P.viewport.activeFrame.nativeGUID==b)
print("PASS: appearance-load refresh, honest unseen-speaker fallback, later native capture and exact-GUID matching")

Q:RemoveAllSoundsFromQueue();Advance(.3)
for i=1,48 do
 local guid="Creature-0-1-2-3-"..(1000+i).."-TEST"
 MockUnits.npc=guid
 S:Capture(Clip("Cached "..i,guid,1000+i))
end
local entries=0;for _ in pairs(S.cache) do entries=entries+1 end
assert(S.count==32 and entries==32)
assert(P.badgeBackground.color[4]==1 and P.badgeBackground:GetWidth()==24)
local bg,icon=P.badgeBackground.points[1],P.badge.points[1]
assert(bg[4]==icon[4] and bg[5]==icon[5])
P.expanded=false;P:LayoutQueue()
local top,bottom=P.panel.points[1],P.panel.points[2]
assert(top[4]==44 and top[5]==-6 and bottom[5]==10)
local cx,cy,r=90*35/71,4+90*34/71,90*30.5/71
for _,y in ipairs({6+4,98-10-4}) do
 assert((44+4-cx)^2+(y-cy)^2<r^2,"panel corner must be under the opaque portrait disc")
end
assert(getn(E.Callbacks.errors)==0,table.concat(E.Callbacks.errors,"\\n"))
print("PASS: bounded portrait cache, opaque centred badge, panel corners concealed inside portrait")
''')
for path in (addon/'Textures').glob('Minimal*.tga'):
    image=Image.open(path)
    assert all(n>0 and n&(n-1)==0 for n in image.size),(path,image.size)
    assert image.mode=='RGBA',(path,image.mode)
assert len(list((addon/'Textures').glob('Minimal*.tga'))) == 9
print('PASS: all nine power-of-two RGBA TGA assets')
