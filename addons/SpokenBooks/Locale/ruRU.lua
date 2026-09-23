local _, SpokenBooks = ...

-- Russian interface strings for Spoken Books.
--
-- Keyed exactly as in Locale/enUS.lua; anything missing falls back to English.

local L = SpokenBooks.L

if GetLocale() ~= "ruRU" then
	return
end
L.OPT_NOTE = "Книги, письма и заметки читаются вслух через плеер Spoken. Для озвучки нужен пакет Spoken Books Audio."
L.OPT_SECTION_READING = "Чтение"
L.OPT_AUTOPLAY = "Читать книгу при открытии"
L.OPT_AUTOPLAY_TIP = "Когда выключено, ничего не начинается само, а книга читается, только если нажать «Слушать» или ввести /spb read."
L.OPT_WHOLE_BOOK = "Читать всю книгу, а не только видимую страницу"
L.OPT_WHOLE_BOOK_TIP = "Открытие первой страницы ставит в очередь остальные, и журнал читается дальше, пока вы листаете страницы."
L.OPT_READ_ONCE = "Читать каждую книгу только один раз"
L.OPT_READ_ONCE_TIP = "Книга, уже услышанная этим персонажем, при открытии больше не читается. Слушать по-прежнему работает, а прочитанное запоминается для каждого персонажа."
L.OPT_SECTION_READ = "Что прочитал этот персонаж"
L.OPT_FORGET = "Забыть прочитанное"
L.OPT_FORGET_DONE_FMT = "забыто: %1$d; всё будет прочитано снова"
L.OPT_FORGET_TIP = "Очищает запись этого персонажа, и каждая книга снова станет новой. Важно, только пока включено «Читать каждую книгу только один раз»."
L.PLAY = "Слушать"
L.STOP = "Стоп"
L.PLAY_TIP = "Прочитать эту книгу вслух"
L.STOP_TIP = "Перестать читать эту книгу"
L.CONTRIBUTE = "Помочь"
L.NO_LINE = "Нет строки для этой страницы"
L.NO_LINE_TIP = "Отправьте текст из вашего клиента, чтобы её добавить."
L.MENU_READ_BOOK = "Прочитать эту книгу"
L.MENU_BOOK_SETTINGS = "Настройки Spoken Books"
