local _, SpokenBooks = ...

-- Simplified Chinese interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "zhCN" then
	return
end
L.OPT_NOTE = "通过 Spoken 播放器大声朗读书籍、信件和笔记。旁白需要 Spoken Books Audio 包。"
L.OPT_SECTION_READING = "阅读"
L.OPT_AUTOPLAY = "打开书籍时朗读"
L.OPT_AUTOPLAY_TIP = "关闭后不会自动开始，只有点击播放或输入 /spb read 才会朗读书籍。"
L.OPT_WHOLE_BOOK = "朗读整本书，而不仅是当前页"
L.OPT_WHOLE_BOOK_TIP = "打开第一页会将其余排入队列，因此翻阅日志时旁白不会中断。"
L.OPT_READ_ONCE = "每本书只朗读一次"
L.OPT_READ_ONCE_TIP = "此角色已听过的书再次打开时不再朗读。播放仍然有效，已读记录按角色记住。"
L.OPT_SECTION_READ = "此角色已读内容"
L.OPT_FORGET = "忘记已读记录"
L.OPT_FORGET_DONE_FMT = "已忘记 %1$d 本书；将重新朗读。"
L.OPT_FORGET_TIP = "清除此角色的记录，使每本书都如初见。仅在“每本书只朗读一次”开启时有意义。"
L.PLAY = "播放"
L.STOP = "停止"
L.PLAY_TIP = "大声朗读这本书"
L.STOP_TIP = "停止朗读这本书"
L.CONTRIBUTE = "贡献"
L.REPORT = "报告"
L.NO_LINE = "本页没有台词"
L.NO_LINE_TIP = "发送你客户端的文本以便添加。"
L.MENU_READ_BOOK = "朗读这本书"
L.MENU_BOOK_SETTINGS = "Spoken Books 设置"
