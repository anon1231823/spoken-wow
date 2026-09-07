// The few strings a player sees.
//
// The explorer is an editors' tool and its interface is English on purpose. Two
// surfaces are not: the report page the addon's Report button sends players to, and
// the feedback form on it. A German player reading German lore lands there, and the
// page around it should read as their language too. This is that -- and only that:
// no library, no extraction, no plural rules, because the set is a few dozen strings
// and it grows only when another player-facing surface appears.
//
// English is the reference and the fallback: a language missing a key shows English
// for it, so an incomplete table is a partly English page rather than a broken one.
// The other tables were written by machine and not yet reviewed by a speaker; treat
// a wrong one as a bug in this file.
//
// `{name}`-style placeholders are substituted by t(); word order around them is the
// translation's, which is why they are placeholders and not concatenation.

import type { Lang } from "./lang";

const enUS = {
  // The report page: /{lang}/r/{mapID}/{slug}
  "report.description": "Report a problem with the ZoneLore entry for {name}.",
  "report.inZone": "in {zone}",
  "report.zoneLore": "zone lore",
  "report.noNarration": "This entry has no narration yet — the addon plays a placeholder for it.",
  "report.notTranslated": "This entry has not been translated yet.",
  "report.title": "Report a problem",
  "report.blurb": "Wrong lore, a bad reading, a mispronounced name. It goes to the editors.",
  "report.browseZone": "Browse every line in {zone} →",
  "report.loreCredit": "Lore:",

  // A /r/ address that names no line
  "notFound.title": "No such entry",
  "notFound.body":
    "That address does not name a line we know. Check it against the one the addon showed you — or find the entry yourself and report it from there.",
  "notFound.browse": "Browse every line →",

  // The feedback form
  "form.category": "What is the problem?",
  "form.category.lore": "The lore text is wrong",
  "form.category.audio": "The narration sounds wrong",
  "form.category.pronunciation": "A word is mispronounced",
  "form.category.other": "Something else",
  "form.placeholder.line": "What is wrong with it? Quoting the sentence helps.",
  "form.placeholder.general": "What happened, and what did you expect instead?",
  "form.filedAs": "Filed as {email}.",
  "form.optional": "Both optional. Leave them blank to report anonymously.",
  "form.name": "Name",
  "form.email": "Email",
  "form.sendHint": "⌘↵ to send",
  "form.send": "Send",
  "form.sending": "Sending…",
  "form.failed": "That did not go through. Try again in a moment.",
  "form.empty": "Say what is wrong with it.",
  "form.thanks": "Thank you!",
  "form.sent.line": "Your report on {name} is with the editors.",
  "form.sent.general": "Your feedback is with the editors.",
  "form.noReply": "There is no reply address on this, so you will not hear back unless you left one.",
  "form.support": "Support the project",
  "form.supportReason":
    "Generating the narration costs real money per line, and the audio has to be hosted somewhere. Consider supporting the project.",
} as const;

export type MessageKey = keyof typeof enUS;
type Table = Partial<Record<MessageKey, string>>;

const deDE: Table = {
  "report.description": "Ein Problem mit dem ZoneLore-Eintrag für {name} melden.",
  "report.inZone": "in {zone}",
  "report.zoneLore": "Zonengeschichte",
  "report.noNarration": "Dieser Eintrag hat noch keine Vertonung — das Addon spielt einen Platzhalter dafür.",
  "report.notTranslated": "Dieser Eintrag ist noch nicht übersetzt.",
  "report.title": "Ein Problem melden",
  "report.blurb": "Falsche Geschichte, eine schlechte Lesung, ein falsch ausgesprochener Name. Es geht an die Redaktion.",
  "report.browseZone": "Alle Einträge in {zone} durchsehen →",
  "report.loreCredit": "Geschichte:",
  "notFound.title": "Kein solcher Eintrag",
  "notFound.body":
    "Diese Adresse nennt keinen Eintrag, den wir kennen. Vergleiche sie mit der, die das Addon dir gezeigt hat — oder suche den Eintrag selbst und melde ihn von dort.",
  "notFound.browse": "Alle Einträge durchsehen →",
  "form.category": "Was ist das Problem?",
  "form.category.lore": "Der Text ist falsch",
  "form.category.audio": "Die Vertonung klingt falsch",
  "form.category.pronunciation": "Ein Wort wird falsch ausgesprochen",
  "form.category.other": "Etwas anderes",
  "form.placeholder.line": "Was stimmt daran nicht? Den Satz zu zitieren hilft.",
  "form.placeholder.general": "Was ist passiert, und was hättest du stattdessen erwartet?",
  "form.filedAs": "Gemeldet als {email}.",
  "form.optional": "Beides optional. Leer lassen, um anonym zu melden.",
  "form.name": "Name",
  "form.email": "E-Mail",
  "form.sendHint": "⌘↵ zum Senden",
  "form.send": "Senden",
  "form.sending": "Wird gesendet…",
  "form.failed": "Das ist nicht durchgegangen. Versuche es gleich noch einmal.",
  "form.empty": "Sag, was daran nicht stimmt.",
  "form.thanks": "Danke!",
  "form.sent.line": "Deine Meldung zu {name} liegt bei der Redaktion.",
  "form.sent.general": "Dein Feedback liegt bei der Redaktion.",
  "form.noReply": "Es gibt keine Antwortadresse, du hörst also nur zurück, wenn du eine angegeben hast.",
  "form.support": "Das Projekt unterstützen",
  "form.supportReason":
    "Die Vertonung kostet pro Zeile echtes Geld, und die Audiodateien müssen irgendwo gehostet werden. Überlege, das Projekt zu unterstützen.",
};

const esES: Table = {
  "report.description": "Informar de un problema con la entrada de ZoneLore para {name}.",
  "report.inZone": "en {zone}",
  "report.zoneLore": "historia de la zona",
  "report.noNarration": "Esta entrada aún no tiene narración: el addon reproduce un marcador de posición.",
  "report.notTranslated": "Esta entrada aún no está traducida.",
  "report.title": "Informar de un problema",
  "report.blurb": "Una historia incorrecta, una mala lectura, un nombre mal pronunciado. Llega a los editores.",
  "report.browseZone": "Ver todas las entradas de {zone} →",
  "report.loreCredit": "Historia:",
  "notFound.title": "No existe esa entrada",
  "notFound.body":
    "Esa dirección no corresponde a ninguna entrada que conozcamos. Compárala con la que te mostró el addon, o busca la entrada tú mismo e infórmala desde allí.",
  "notFound.browse": "Ver todas las entradas →",
  "form.category": "¿Cuál es el problema?",
  "form.category.lore": "El texto es incorrecto",
  "form.category.audio": "La narración suena mal",
  "form.category.pronunciation": "Una palabra está mal pronunciada",
  "form.category.other": "Otra cosa",
  "form.placeholder.line": "¿Qué está mal? Citar la frase ayuda.",
  "form.placeholder.general": "¿Qué ha pasado y qué esperabas en su lugar?",
  "form.filedAs": "Enviado como {email}.",
  "form.optional": "Ambos opcionales. Déjalos en blanco para informar de forma anónima.",
  "form.name": "Nombre",
  "form.email": "Correo",
  "form.sendHint": "⌘↵ para enviar",
  "form.send": "Enviar",
  "form.sending": "Enviando…",
  "form.failed": "No se ha podido enviar. Inténtalo de nuevo en un momento.",
  "form.empty": "Di qué está mal.",
  "form.thanks": "¡Gracias!",
  "form.sent.line": "Tu informe sobre {name} está con los editores.",
  "form.sent.general": "Tu comentario está con los editores.",
  "form.noReply": "No hay dirección de respuesta, así que solo tendrás noticias si dejaste una.",
  "form.support": "Apoyar el proyecto",
  "form.supportReason":
    "Generar la narración cuesta dinero real por línea, y el audio tiene que alojarse en algún sitio. Considera apoyar el proyecto.",
};

const esMX: Table = {
  ...esES,
  "form.placeholder.general": "¿Qué pasó y qué esperabas en su lugar?",
  "form.failed": "No se pudo enviar. Inténtalo de nuevo en un momento.",
};

const frFR: Table = {
  "report.description": "Signaler un problème avec l’entrée ZoneLore pour {name}.",
  "report.inZone": "dans {zone}",
  "report.zoneLore": "histoire de la zone",
  "report.noNarration": "Cette entrée n’a pas encore de narration — l’addon joue un son de remplacement.",
  "report.notTranslated": "Cette entrée n’est pas encore traduite.",
  "report.title": "Signaler un problème",
  "report.blurb": "Une histoire fausse, une mauvaise lecture, un nom mal prononcé. Cela part aux éditeurs.",
  "report.browseZone": "Parcourir toutes les entrées de {zone} →",
  "report.loreCredit": "Histoire :",
  "notFound.title": "Aucune entrée à cette adresse",
  "notFound.body":
    "Cette adresse ne désigne aucune entrée connue. Comparez-la à celle que l’addon vous a montrée, ou trouvez l’entrée vous-même et signalez-la depuis là.",
  "notFound.browse": "Parcourir toutes les entrées →",
  "form.category": "Quel est le problème ?",
  "form.category.lore": "Le texte est faux",
  "form.category.audio": "La narration sonne faux",
  "form.category.pronunciation": "Un mot est mal prononcé",
  "form.category.other": "Autre chose",
  "form.placeholder.line": "Qu’est-ce qui ne va pas ? Citer la phrase aide.",
  "form.placeholder.general": "Que s’est-il passé, et à quoi vous attendiez-vous ?",
  "form.filedAs": "Envoyé en tant que {email}.",
  "form.optional": "Les deux sont facultatifs. Laissez-les vides pour signaler anonymement.",
  "form.name": "Nom",
  "form.email": "E-mail",
  "form.sendHint": "⌘↵ pour envoyer",
  "form.send": "Envoyer",
  "form.sending": "Envoi…",
  "form.failed": "L’envoi a échoué. Réessayez dans un instant.",
  "form.empty": "Dites ce qui ne va pas.",
  "form.thanks": "Merci !",
  "form.sent.line": "Votre signalement sur {name} est chez les éditeurs.",
  "form.sent.general": "Votre retour est chez les éditeurs.",
  "form.noReply": "Il n’y a pas d’adresse de réponse : vous n’aurez de nouvelles que si vous en avez laissé une.",
  "form.support": "Soutenir le projet",
  "form.supportReason":
    "Générer la narration coûte de l’argent à chaque ligne, et l’audio doit être hébergé quelque part. Pensez à soutenir le projet.",
};

const itIT: Table = {
  "report.description": "Segnala un problema con la voce ZoneLore di {name}.",
  "report.inZone": "in {zone}",
  "report.zoneLore": "storia della zona",
  "report.noNarration": "Questa voce non ha ancora una narrazione: l’addon riproduce un segnaposto.",
  "report.notTranslated": "Questa voce non è ancora tradotta.",
  "report.title": "Segnala un problema",
  "report.blurb": "Una storia sbagliata, una lettura scadente, un nome pronunciato male. Arriva ai redattori.",
  "report.browseZone": "Sfoglia tutte le voci di {zone} →",
  "report.loreCredit": "Storia:",
  "notFound.title": "Nessuna voce a questo indirizzo",
  "notFound.body":
    "Questo indirizzo non corrisponde a nessuna voce che conosciamo. Confrontalo con quello mostrato dall’addon, oppure trova la voce e segnalala da lì.",
  "notFound.browse": "Sfoglia tutte le voci →",
  "form.category": "Qual è il problema?",
  "form.category.lore": "Il testo è sbagliato",
  "form.category.audio": "La narrazione suona male",
  "form.category.pronunciation": "Una parola è pronunciata male",
  "form.category.other": "Altro",
  "form.placeholder.line": "Cosa non va? Citare la frase aiuta.",
  "form.placeholder.general": "Cos’è successo, e cosa ti aspettavi invece?",
  "form.filedAs": "Inviato come {email}.",
  "form.optional": "Entrambi facoltativi. Lasciali vuoti per segnalare in forma anonima.",
  "form.name": "Nome",
  "form.email": "E-mail",
  "form.sendHint": "⌘↵ per inviare",
  "form.send": "Invia",
  "form.sending": "Invio…",
  "form.failed": "Invio non riuscito. Riprova tra un momento.",
  "form.empty": "Di’ cosa non va.",
  "form.thanks": "Grazie!",
  "form.sent.line": "La tua segnalazione su {name} è dai redattori.",
  "form.sent.general": "Il tuo commento è dai redattori.",
  "form.noReply": "Non c’è un indirizzo di risposta: avrai notizie solo se ne hai lasciato uno.",
  "form.support": "Sostieni il progetto",
  "form.supportReason":
    "Generare la narrazione costa denaro reale per ogni riga, e l’audio va ospitato da qualche parte. Considera di sostenere il progetto.",
};

const ptBR: Table = {
  "report.description": "Relatar um problema com a entrada do ZoneLore para {name}.",
  "report.inZone": "em {zone}",
  "report.zoneLore": "história da zona",
  "report.noNarration": "Esta entrada ainda não tem narração — o addon toca um som provisório no lugar.",
  "report.notTranslated": "Esta entrada ainda não foi traduzida.",
  "report.title": "Relatar um problema",
  "report.blurb": "História errada, leitura ruim, nome mal pronunciado. Vai para os editores.",
  "report.browseZone": "Ver todas as entradas de {zone} →",
  "report.loreCredit": "História:",
  "notFound.title": "Entrada não encontrada",
  "notFound.body":
    "Esse endereço não corresponde a nenhuma entrada conhecida. Confira com o que o addon mostrou — ou encontre a entrada você mesmo e relate a partir dela.",
  "notFound.browse": "Ver todas as entradas →",
  "form.category": "Qual é o problema?",
  "form.category.lore": "O texto está errado",
  "form.category.audio": "A narração soa errada",
  "form.category.pronunciation": "Uma palavra está mal pronunciada",
  "form.category.other": "Outra coisa",
  "form.placeholder.line": "O que está errado? Citar a frase ajuda.",
  "form.placeholder.general": "O que aconteceu, e o que você esperava?",
  "form.filedAs": "Enviado como {email}.",
  "form.optional": "Ambos opcionais. Deixe em branco para relatar anonimamente.",
  "form.name": "Nome",
  "form.email": "E-mail",
  "form.sendHint": "⌘↵ para enviar",
  "form.send": "Enviar",
  "form.sending": "Enviando…",
  "form.failed": "Não foi possível enviar. Tente de novo em instantes.",
  "form.empty": "Diga o que está errado.",
  "form.thanks": "Obrigado!",
  "form.sent.line": "Seu relato sobre {name} está com os editores.",
  "form.sent.general": "Seu comentário está com os editores.",
  "form.noReply": "Não há endereço de resposta, então você só terá retorno se deixou um.",
  "form.support": "Apoiar o projeto",
  "form.supportReason":
    "Gerar a narração custa dinheiro de verdade por linha, e o áudio precisa ser hospedado em algum lugar. Considere apoiar o projeto.",
};

const ruRU: Table = {
  "report.description": "Сообщить о проблеме с записью ZoneLore для {name}.",
  "report.inZone": "в локации {zone}",
  "report.zoneLore": "история зоны",
  "report.noNarration": "У этой записи пока нет озвучки — аддон проигрывает заглушку.",
  "report.notTranslated": "Эта запись ещё не переведена.",
  "report.title": "Сообщить о проблеме",
  "report.blurb": "Неверная история, плохое чтение, неправильно произнесённое имя. Сообщение попадёт к редакторам.",
  "report.browseZone": "Все записи в локации {zone} →",
  "report.loreCredit": "История:",
  "notFound.title": "Такой записи нет",
  "notFound.body":
    "Этот адрес не указывает ни на одну известную нам запись. Сверьте его с тем, что показал аддон, — или найдите запись сами и сообщите о ней оттуда.",
  "notFound.browse": "Все записи →",
  "form.category": "В чём проблема?",
  "form.category.lore": "Текст неверен",
  "form.category.audio": "Озвучка звучит неправильно",
  "form.category.pronunciation": "Слово произнесено неправильно",
  "form.category.other": "Другое",
  "form.placeholder.line": "Что не так? Полезно процитировать предложение.",
  "form.placeholder.general": "Что произошло и чего вы ожидали?",
  "form.filedAs": "Отправлено от имени {email}.",
  "form.optional": "Оба поля необязательны. Оставьте пустыми, чтобы сообщить анонимно.",
  "form.name": "Имя",
  "form.email": "Эл. почта",
  "form.sendHint": "⌘↵ — отправить",
  "form.send": "Отправить",
  "form.sending": "Отправка…",
  "form.failed": "Не удалось отправить. Попробуйте ещё раз через минуту.",
  "form.empty": "Напишите, что не так.",
  "form.thanks": "Спасибо!",
  "form.sent.line": "Ваше сообщение о записи {name} у редакторов.",
  "form.sent.general": "Ваш отзыв у редакторов.",
  "form.noReply": "Обратного адреса нет, поэтому ответ придёт, только если вы его оставили.",
  "form.support": "Поддержать проект",
  "form.supportReason":
    "Озвучка каждой строки стоит реальных денег, а аудио нужно где-то размещать. Подумайте о поддержке проекта.",
};

const koKR: Table = {
  "report.description": "{name}의 ZoneLore 항목에 대한 문제를 신고합니다.",
  "report.inZone": "{zone}",
  "report.zoneLore": "지역 이야기",
  "report.noNarration": "이 항목에는 아직 내레이션이 없습니다. 애드온은 대체 소리를 재생합니다.",
  "report.notTranslated": "이 항목은 아직 번역되지 않았습니다.",
  "report.title": "문제 신고",
  "report.blurb": "잘못된 이야기, 어색한 낭독, 잘못된 발음. 편집자에게 전달됩니다.",
  "report.browseZone": "{zone}의 모든 항목 보기 →",
  "report.loreCredit": "출처:",
  "notFound.title": "항목이 없습니다",
  "notFound.body":
    "이 주소는 알려진 항목을 가리키지 않습니다. 애드온이 보여준 주소와 비교하거나, 항목을 직접 찾아 그곳에서 신고해 주세요.",
  "notFound.browse": "모든 항목 보기 →",
  "form.category": "어떤 문제인가요?",
  "form.category.lore": "이야기 내용이 틀립니다",
  "form.category.audio": "내레이션이 이상하게 들립니다",
  "form.category.pronunciation": "단어 발음이 틀립니다",
  "form.category.other": "기타",
  "form.placeholder.line": "무엇이 잘못되었나요? 문장을 인용해 주시면 도움이 됩니다.",
  "form.placeholder.general": "무슨 일이 있었고, 대신 무엇을 기대하셨나요?",
  "form.filedAs": "{email}(으)로 접수됩니다.",
  "form.optional": "둘 다 선택 사항입니다. 비워 두면 익명으로 신고됩니다.",
  "form.name": "이름",
  "form.email": "이메일",
  "form.sendHint": "⌘↵ 보내기",
  "form.send": "보내기",
  "form.sending": "보내는 중…",
  "form.failed": "전송되지 않았습니다. 잠시 후 다시 시도해 주세요.",
  "form.empty": "무엇이 잘못되었는지 적어 주세요.",
  "form.thanks": "감사합니다!",
  "form.sent.line": "{name}에 대한 신고가 편집자에게 전달되었습니다.",
  "form.sent.general": "의견이 편집자에게 전달되었습니다.",
  "form.noReply": "회신 주소가 없으므로, 남기지 않으셨다면 답장을 받지 못합니다.",
  "form.support": "프로젝트 후원하기",
  "form.supportReason":
    "내레이션 생성에는 줄마다 실제 비용이 들고, 오디오는 어딘가에 호스팅되어야 합니다. 프로젝트 후원을 고려해 주세요.",
};

const zhCN: Table = {
  "report.description": "报告 {name} 的 ZoneLore 条目存在的问题。",
  "report.inZone": "位于{zone}",
  "report.zoneLore": "区域传说",
  "report.noNarration": "此条目尚无配音——插件会播放占位音效。",
  "report.notTranslated": "此条目尚未翻译。",
  "report.title": "报告问题",
  "report.blurb": "传说有误、朗读不佳、名字读错。会转交给编辑。",
  "report.browseZone": "浏览{zone}的全部条目 →",
  "report.loreCredit": "传说来源：",
  "notFound.title": "没有这个条目",
  "notFound.body": "该地址不对应任何已知条目。请与插件显示的地址核对，或自行找到该条目并从那里报告。",
  "notFound.browse": "浏览全部条目 →",
  "form.category": "是什么问题？",
  "form.category.lore": "传说文本有误",
  "form.category.audio": "配音听起来不对",
  "form.category.pronunciation": "某个词读错了",
  "form.category.other": "其他",
  "form.placeholder.line": "哪里不对？引用原句会很有帮助。",
  "form.placeholder.general": "发生了什么？你原本期望什么？",
  "form.filedAs": "以 {email} 的身份提交。",
  "form.optional": "两项均为选填。留空即匿名报告。",
  "form.name": "姓名",
  "form.email": "邮箱",
  "form.sendHint": "⌘↵ 发送",
  "form.send": "发送",
  "form.sending": "发送中…",
  "form.failed": "发送失败。请稍后再试。",
  "form.empty": "请说明哪里不对。",
  "form.thanks": "谢谢！",
  "form.sent.line": "你关于 {name} 的报告已转交编辑。",
  "form.sent.general": "你的反馈已转交编辑。",
  "form.noReply": "此处没有回复地址，除非你留下了联系方式，否则不会收到回复。",
  "form.support": "支持本项目",
  "form.supportReason": "生成配音每一行都要花真金白银，音频也需要托管。欢迎支持本项目。",
};

const zhTW: Table = {
  "report.description": "回報 {name} 的 ZoneLore 條目問題。",
  "report.inZone": "位於{zone}",
  "report.zoneLore": "區域傳說",
  "report.noNarration": "此條目尚無配音——插件會播放替代音效。",
  "report.notTranslated": "此條目尚未翻譯。",
  "report.title": "回報問題",
  "report.blurb": "傳說有誤、朗讀不佳、名字唸錯。會轉交給編輯。",
  "report.browseZone": "瀏覽{zone}的全部條目 →",
  "report.loreCredit": "傳說來源：",
  "notFound.title": "沒有這個條目",
  "notFound.body": "該網址不對應任何已知條目。請與插件顯示的網址核對，或自行找到該條目並從那裡回報。",
  "notFound.browse": "瀏覽全部條目 →",
  "form.category": "是什麼問題？",
  "form.category.lore": "傳說文字有誤",
  "form.category.audio": "配音聽起來不對",
  "form.category.pronunciation": "某個字唸錯了",
  "form.category.other": "其他",
  "form.placeholder.line": "哪裡不對？引用原句會很有幫助。",
  "form.placeholder.general": "發生了什麼？你原本期望什麼？",
  "form.filedAs": "以 {email} 的身分送出。",
  "form.optional": "兩項皆為選填。留空即匿名回報。",
  "form.name": "姓名",
  "form.email": "電子郵件",
  "form.sendHint": "⌘↵ 送出",
  "form.send": "送出",
  "form.sending": "送出中…",
  "form.failed": "送出失敗。請稍後再試。",
  "form.empty": "請說明哪裡不對。",
  "form.thanks": "謝謝！",
  "form.sent.line": "你關於 {name} 的回報已轉交編輯。",
  "form.sent.general": "你的意見已轉交編輯。",
  "form.noReply": "此處沒有回覆地址，除非你留下了聯絡方式，否則不會收到回覆。",
  "form.support": "支持本專案",
  "form.supportReason": "生成配音每一行都要花真金白銀，音訊也需要託管。歡迎支持本專案。",
};

const TABLES: Record<Lang, Table> = {
  enUS,
  deDE,
  esES,
  esMX,
  frFR,
  itIT,
  ptBR,
  ruRU,
  koKR,
  zhCN,
  zhTW,
};

/** A message in one language, English if that language lacks it, placeholders filled. */
export function t(lang: Lang, key: MessageKey, vars: Record<string, string> = {}): string {
  const text = TABLES[lang]?.[key] ?? enUS[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

/** t() bound to a language, for a component that says several things. */
export function messages(lang: Lang) {
  return (key: MessageKey, vars?: Record<string, string>) => t(lang, key, vars);
}
