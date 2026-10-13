/**
 * Every user-visible string. English is the source of truth: its keys define the type,
 * so a missing or stray translation is a compile error rather than a gap someone spots
 * in production.
 *
 * Placeholders are written `{name}` and filled by `format`.
 */

export const en = {
  "app.back": "Back to start",
  "app.endSession": "End session",
  "app.footer": "Browser to browser. Files never touch a server.",
  "app.privacy": "Privacy",
  "app.language": "切換到中文",
  "app.languageShort": "中文",
  "app.by": "by JetPiggy",
  "app.work": "Work mode",
  "app.workShort": "Work",
  "app.workHint": "Words only: hides the pig and the handwriting",

  // The red handwriting. Brand dress only: work mode hides all of it.
  "hand.note": "Lasts 60 seconds,\nworks once.",
  "hand.stamp1": "No cables",
  "hand.stamp2": "No chat apps",
  "hand.stamp3": "No trace",

  "ended.title": "Session ended",
  "ended.default": "The session is closed.",
  "ended.startOver": "Start over",
  "ended.retry": "Try again",
  "ended.retryOffline": "{name} is offline right now. Try again works once GSend is open on it.",
  "ended.unsaved":
    "These files are still only in this browser. Save the ones you want before starting over, which lets go of them.",
  "ended.sent": "Sent",
  "ended.received": "Received",
  "ended.queued": "Not sent",
  "ended.count": "{count} · {size}",
  "ended.text": "text",

  "landing.ask": "Enter the 4 digits on the other screen",
  "landing.askSub": "Receiving starts with the last one",
  "landing.codeLabel": "4-digit code",
  "landing.joinAgain": "Try again",
  "landing.qrHint": "Or scan the QR code on the other screen — no typing needed.",
  "landing.sendTitle": "Or, send",
  "landing.dropAnywhere": "Drop files anywhere on the page",
  "landing.dropRelease": "Let go to add them",
  "landing.chooseFiles": "Choose files",
  "landing.textPlaceholder": "Or type, or paste a link",
  "landing.textLabel": "Text to send",
  "landing.getCode": "Get a code →",
  "landing.staged": "{count} file(s) · {size}",
  "landing.clear": "Clear",
  "landing.limitDisk": "Files are limited only by the receiving device's free disk space.",
  "landing.limitSize": "Up to {size} per file.",

  "host.creating": "Getting a code…",
  "host.title": "On the other device, open {host}",
  "host.subtitle": "and enter these 4 digits, or scan the QR code below.",
  "host.burnNote":
    "The code dies the moment one device joins, expires after 60 seconds, and only 12 attempts a minute are allowed. Sending starts on its own once a device is through — watch this screen and stop it if the device is not yours.",
  "host.copy": "Copy link",
  "host.codeLabel": "Code {code}",
  "host.expiresIn": "Expires in {seconds}s",
  "host.expired": "Expired",
  "host.qrAlt": "QR code for this session",
  "host.linkCopied": "Copied",
  "host.cancel": "Cancel",
  "host.queuedFiles": "{count} file(s) · {size} — starts moving the moment a device joins.",
  "host.queuedText": "Text queued — it goes the moment a device joins.",
  "host.queuedNothing": "Nothing queued. This session will receive whatever the other device sends.",

  "pairing.waitingTitle": "Waiting for the other device",
  "pairing.waitingBody":
    "The other device dropped off. It has a few minutes to come back before this session closes.",
  "pairing.almostThere": "Almost there",
  "pairing.connecting": "Connecting",
  "pairing.connectingBody": "Connecting to the other device…",
  "pairing.noDirectRoute":
    "Could not open a direct connection between these two networks. Mobile data usually blocks it — putting both devices on the same Wi-Fi is the reliable fix.",
  "pairing.code": "Code",
  "pairing.relay": "Relay server",
  "pairing.relayEngaged": "brought in",
  "pairing.relayStandby": "standing by",

  "transfer.session": "This session",
  "transfer.sessionMeta": "{count} item(s) · up {up} · down {down}",
  "transfer.peerJoined": "A device joined and is receiving. Stop the session if that was not you.",
  "transfer.stop": "Stop",
  "transfer.dismiss": "Dismiss",
  "transfer.empty": "Nothing has moved yet. Drop files anywhere on the page, or type a message.",
  "transfer.dropRelease": "Let go to send them",
  "transfer.saveFolder": "Arriving files are written straight into {folder}.",
  "transfer.saveBrowser":
    "Received files sit in this browser's storage and survive a reload, until you press Save.",
  "transfer.chooseFiles": "Choose files",
  "transfer.chooseFolder": "Choose where to save",
  "transfer.textPlaceholder": "Type, or paste a link",
  "transfer.textLabel": "Text to send",
  "transfer.send": "Send",
  "transfer.copy": "Copy",
  "transfer.save": "Save",
  "transfer.saveAll": "Save all",
  "transfer.cancel": "Cancel",
  "transfer.route": "Route",
  "transfer.savingIn": "Saving to",
  "transfer.browser": "this browser",
  "transfer.limit": "Per file",
  "transfer.limitDisk": "free disk space",
  "transfer.paired": "Paired device",
  "transfer.burned": "{code} · used up",
  "transfer.relayNote":
    "No direct route was found between these two devices, so this connection runs through a relay server and is slower. Putting both on the same Wi-Fi usually allows a direct one — unless the network keeps its devices apart, as guest Wi-Fi often does.",

  // The route the bytes actually take, as measured.
  "route.lan": "Direct · same network",
  "route.internet": "Direct",
  "route.relay": "Through a relay",
  "route.unknown": "Connected",

  "remember.open":
    "Remember {name}? Once you both agree, each device appears in the other's list and the next transfer between them needs no code.",
  "remember.asked":
    "{name} asked to remember this device. Agree too, and the next transfer between you needs no code.",
  "remember.waiting": "Waiting for {name} to agree. Nothing is remembered until it does.",
  "remember.paired": "{name} is now in your devices. Unpair it there at any time.",
  "remember.ask": "Remember",
  "remember.agree": "Remember it too",

  "status.connected": "Connected",
  "status.direct": "Connected · direct",
  "status.relayed": "Connected · via relay",
  "status.peerAway": "The other device dropped off — waiting for it to come back",
  "status.reconnecting": "Reconnecting…",
  "status.lost": "Connection lost",
  "status.connecting": "Connecting…",

  "row.sent": "Sent",
  "row.received": "Received",
  "row.saved": "Saved",
  "row.savedTo": "Saved · {name}",
  "row.cancelled": "Cancelled",
  "row.paused": "Paused — waiting to reconnect",
  "row.pending": "Waiting for the other device",
  "row.left": "{time} left",

  "notice.multiDownload":
    "Browsers ask before downloading several files at once, and drop the rest until that is answered. If only some arrived, allow it and save the others from their own buttons.",
  "notice.regrouped":
    "This device joined the other one's group. {count} device(s) it knew before are in the old group and need pairing again.",
  "notice.folderBlocked":
    "No folder chosen, so the files are still waiting in the browser. If the picker said the folder holds system files, that was the browser refusing it, not GSend: it will not hand a site Downloads, Desktop or Documents themselves, nor a drive root, your user folder, Windows, Program Files or AppData. Make a new folder inside Downloads (GSend, say) and pick that one — files you receive later will go there on their own.",

  "devices.title": "Remembered devices",
  "devices.titleSub": "no code needed",
  "devices.manage": "Manage",
  "devices.done": "Done",
  "devices.manageTitle": "Devices",
  "devices.sendTo": "Send to {name}",
  "devices.connectTo": "Connect to {name}",
  "devices.offlineChip": "{name} is offline. It comes online while GSend is open on it.",
  "devices.thisDevice": "This device",
  "devices.online": "online",
  "devices.offline": "offline",
  "devices.rename": "Rename",
  "devices.unpair": "Unpair",
  "devices.unpairAll": "Forget every device",
  "devices.none": "None yet. Connect once with a code and both choose Remember, and it appears here.",
  "devices.offlineNote": "A device shows as online while this page is open on it.",
  "devices.connecting": "Connecting to {name}…",
  "devices.verifying": "Checking that this really is {name}…",
  "devices.notRemembered":
    "This browser will not keep a durable store, so devices cannot be remembered here. Private browsing is the usual reason.",
  "devices.namePrompt": "Name this device",
  "devices.savingTo": "Files sent to this device go straight into {folder}.",
  "devices.savingNowhere":
    "Files sent to this device wait in the browser until you save them. Pick a folder and they land in it on their own.",
  "devices.changeFolder": "Change",
  "devices.displaced":
    "GSend is open in another tab or window on this device, and that one is what your other devices reach.",
  "devices.useThisTab": "Use this tab",

  "error.badCode": "Enter the 4 digits shown on the other device.",
  "error.unknownDevice": "That device could not prove which device it is, so nothing was sent.",
  "error.stopped": "You stopped the session.",
  "error.nobodyJoined": "Nobody joined in time. Start a new session.",
  "error.peerEnded": "The other device ended the session.",
  "error.deviceBusy": "That device is in another session right now. Try again once it has finished.",
  "error.deviceUnreachable":
    "The other device did not answer. Check that GSend is open and in front on it, then try again.",
  "error.sessionIdle": "The session was closed after sitting idle.",
  "error.expiredWhileAway": "The session expired while this page was away. Start a new one.",
  "error.serverLost": "Lost the connection to the server.",
  "error.peerGone": "The other device left and did not come back.",
  "error.idle": "session idle",

  "server.code_not_found": "That code does not exist. Check the digits and try again.",
  "server.code_expired": "That code has expired. Ask for a fresh one.",
  "server.session_full": "That code has already been used by another device.",
  "server.bad_key": "This session could not be resumed.",
  "server.rate_limited": "Too many attempts. Wait a minute and try again.",
  "server.no_capacity": "The server is busy right now. Try again in a moment.",
  "server.bad_request": "Malformed request.",

  "cancel.sender-cancelled": "Cancelled by the sender",
  "cancel.receiver-cancelled": "Cancelled by the receiver",
  "cancel.sender-reloaded": "The sender's page reloaded and cannot re-read the file",
  "cancel.too-large": "The receiving device cannot take a file this large (limit {limit} MB)",
  "cancel.peer-lost": "The other device lost this transfer",
  "cancel.write-failed": "Could not write to storage",
  "cancel.assemble-failed": "Could not assemble the file",
  "cancel.stream-gap": "The stream lost its place",
  "cancel.read-failed": "The sender could not read the file",
  "cancel.unknown": "Stopped",
} as const;

export type MessageKey = keyof typeof en;

/**
 * Enforced to be complete: a missing key will not compile. Written for Hong Kong:
 * 部 for devices, 揀 for picking, 裏, full-width punctuation.
 */
export const zh: Record<MessageKey, string> = {
  "app.back": "回到首頁",
  "app.endSession": "結束連線",
  "app.footer": "瀏覽器對瀏覽器直接傳送，檔案不經伺服器。",
  "app.privacy": "私隱",
  "app.language": "Switch to English",
  "app.languageShort": "EN",
  "app.by": "JetPiggy 出品",
  "app.work": "工作模式",
  "app.workShort": "工作",
  "app.workHint": "只顯示文字，收起飛豬和手寫字",

  "hand.note": "碼 60 秒內有效，\n用一次就作廢。",
  "hand.stamp1": "不用線",
  "hand.stamp2": "不用通訊軟件",
  "hand.stamp3": "無痕",

  "ended.title": "連線已結束",
  "ended.default": "這次連線已經關閉。",
  "ended.startOver": "重新開始",
  "ended.retry": "再試一次",
  "ended.retryOffline": "「{name}」現在離線。在那部裝置打開 GSend 之後，就可以再試一次。",
  "ended.unsaved": "這些檔案現在只在這個瀏覽器裏。想留的請先儲存，按「重新開始」之後就不會再保留。",
  "ended.sent": "送出",
  "ended.received": "收到",
  "ended.queued": "未送出",
  "ended.count": "{count} 個 · {size}",
  "ended.text": "文字",

  // A no-break space keeps "4 位數字" on one line when the sentence wraps.
  "landing.ask": "輸入對方畫面上的 4\u00a0位數字",
  "landing.askSub": "打齊就開始接收",
  "landing.codeLabel": "4 位數字碼",
  "landing.joinAgain": "再試一次",
  "landing.qrHint": "掃對方畫面上的 QR 也可以，不用打數字。",
  "landing.sendTitle": "或者，傳出",
  "landing.dropAnywhere": "把檔案拖到頁面任何地方",
  "landing.dropRelease": "放手就加入",
  "landing.chooseFiles": "揀檔案",
  "landing.textPlaceholder": "或者打字、貼連結",
  "landing.textLabel": "要傳送的文字",
  "landing.getCode": "產生數字碼 →",
  "landing.staged": "{count} 個檔案 · {size}",
  "landing.clear": "清除",
  "landing.limitDisk": "檔案大小只受接收裝置的剩餘磁碟空間限制。",
  "landing.limitSize": "每個檔案最大 {size}。",

  "host.creating": "正在取得數字碼…",
  "host.title": "在另一部裝置打開 {host}",
  "host.subtitle": "輸入這 4 個數字，或者掃下面的 QR。",
  "host.burnNote":
    "數字碼在第一部裝置加入後就作廢，60 秒後失效，每分鐘只容許 12 次嘗試。有裝置連上就會自動開始傳送，請留意這個畫面；如果不是你的裝置，立即中止。",
  "host.copy": "複製連結",
  "host.codeLabel": "數字碼 {code}",
  "host.expiresIn": "{seconds} 秒後失效",
  "host.expired": "已失效",
  "host.qrAlt": "這次連線的 QR 碼",
  "host.linkCopied": "已複製",
  "host.cancel": "取消",
  "host.queuedFiles": "{count} 個檔案 · {size}，有裝置加入就立即開始傳送。",
  "host.queuedText": "文字已排好，有裝置加入就送出。",
  "host.queuedNothing": "未揀任何東西。這次連線會接收對方傳來的東西。",

  "pairing.waitingTitle": "正在等另一部裝置",
  "pairing.waitingBody": "另一部裝置斷線了。它有幾分鐘時間回來，否則這次連線會關閉。",
  "pairing.almostThere": "就快好",
  "pairing.connecting": "連線中",
  "pairing.connectingBody": "正在連線到另一部裝置…",
  "pairing.noDirectRoute":
    "這兩個網絡之間開不到直接連線。流動數據通常會擋住這種連線，讓兩部裝置連上同一個 Wi-Fi 最可靠。",
  "pairing.code": "數字碼",
  "pairing.relay": "中繼伺服器",
  "pairing.relayEngaged": "已加入",
  "pairing.relayStandby": "待命",

  "transfer.session": "這次連線",
  "transfer.sessionMeta": "{count} 項 · 上傳 {up} · 下載 {down}",
  "transfer.peerJoined": "有一部裝置已加入並開始接收。如果不是你，請立即中止這次連線。",
  "transfer.stop": "中止",
  "transfer.dismiss": "知道了",
  "transfer.empty": "還未有東西傳過。把檔案拖到頁面任何地方，或者打字傳過去。",
  "transfer.dropRelease": "放手就傳送",
  "transfer.saveFolder": "收到的檔案會直接寫入「{folder}」。",
  "transfer.saveBrowser": "收到的檔案先存在這個瀏覽器裏，重新載入也不會不見，直到你按「儲存」。",
  "transfer.chooseFiles": "揀檔案",
  "transfer.chooseFolder": "揀儲存位置",
  "transfer.textPlaceholder": "打字、貼連結",
  "transfer.textLabel": "要傳送的文字",
  "transfer.send": "傳送",
  "transfer.copy": "複製",
  "transfer.save": "儲存",
  "transfer.saveAll": "全部儲存",
  "transfer.cancel": "取消",
  "transfer.route": "路線",
  "transfer.savingIn": "存到",
  "transfer.browser": "這個瀏覽器",
  "transfer.limit": "每個檔案上限",
  "transfer.limitDisk": "接收裝置的磁碟空間",
  "transfer.paired": "已配對裝置",
  "transfer.burned": "{code}（已作廢）",
  "transfer.relayNote":
    "這兩部裝置之間找不到直接路線，所以這次經中繼伺服器傳送，會慢一些。讓兩部裝置連上同一個 Wi-Fi 通常就可以直連，除非那個網絡刻意把裝置隔開，訪客 Wi-Fi 經常這樣。",

  "route.lan": "直連 · 同一網絡",
  "route.internet": "直連",
  "route.relay": "經中繼伺服器",
  "route.unknown": "已連線",

  "remember.open": "要記住「{name}」嗎？雙方都同意之後，兩部裝置會出現在對方的清單，下次互傳不用數字碼。",
  "remember.asked": "「{name}」想記住這部裝置。你也同意的話，下次互傳就不用數字碼。",
  "remember.waiting": "正在等「{name}」同意。對方同意之前，甚麼都不會記住。",
  "remember.paired": "「{name}」已加入你的裝置清單，隨時可以在那裏解除配對。",
  "remember.ask": "記住",
  "remember.agree": "我也記住",

  "status.connected": "已連線",
  "status.direct": "已連線 · 直連",
  "status.relayed": "已連線 · 經中繼",
  "status.peerAway": "另一部裝置斷線了，正在等它回來",
  "status.reconnecting": "重新連線中…",
  "status.lost": "連線中斷",
  "status.connecting": "連線中…",

  "row.sent": "已送出",
  "row.received": "已收到",
  "row.saved": "已儲存",
  "row.savedTo": "已存檔 · {name}",
  "row.cancelled": "已取消",
  "row.paused": "已暫停，等待重新連線",
  "row.pending": "正在等另一部裝置",
  "row.left": "剩 {time}",

  "notice.multiDownload":
    "瀏覽器一次下載多個檔案之前會先問你，未回答之前其餘的會被丟掉。如果只存到幾個，請在網址列容許，再用各行的「儲存」存回其餘的。",
  "notice.regrouped": "這部裝置加入了對方的裝置群組。原本認識的 {count} 部留在舊群組，需要重新配對一次。",
  "notice.folderBlocked":
    "未揀到資料夾，檔案仍然留在瀏覽器裏。如果剛才顯示「資料夾包含系統檔案」，那是瀏覽器拒絕，不是 GSend：「下載」「桌面」「文件」這些資料夾本身，還有磁碟根目錄、用戶資料夾、Windows、Program Files、AppData 都不能直接揀。在「下載」裏面新增一個資料夾（例如 GSend）再揀它就可以，之後收到的檔案都會自動存進去。",

  "devices.title": "已記住的裝置",
  "devices.titleSub": "不用數字碼",
  "devices.manage": "管理",
  "devices.done": "收起",
  "devices.manageTitle": "裝置",
  "devices.sendTo": "傳送到「{name}」",
  "devices.connectTo": "連線到「{name}」",
  "devices.offlineChip": "「{name}」離線。在那部裝置打開 GSend 就會變成在線。",
  "devices.thisDevice": "這部裝置",
  "devices.online": "在線",
  "devices.offline": "離線",
  "devices.rename": "改名",
  "devices.unpair": "解除配對",
  "devices.unpairAll": "忘記所有裝置",
  "devices.none": "未有。用數字碼連線一次、雙方都按「記住」，之後就會在這裏出現。",
  "devices.offlineNote": "裝置只要開着這個頁面，就會顯示為在線。",
  "devices.connecting": "正在連線到「{name}」…",
  "devices.verifying": "正在確認對方真的是「{name}」…",
  "devices.notRemembered": "這個瀏覽器不提供長期儲存，所以記不住裝置，通常是因為無痕模式。",
  "devices.namePrompt": "為這部裝置改名",
  "devices.savingTo": "傳到這部裝置的檔案會直接寫入「{folder}」。",
  "devices.savingNowhere": "傳到這部裝置的檔案會先留在瀏覽器等你儲存。揀一個資料夾，之後就會自動存進去。",
  "devices.changeFolder": "更改",
  "devices.displaced": "這部裝置的另一個分頁或視窗也開着 GSend，其他裝置現在連到的是那一個。",
  "devices.useThisTab": "改用這個分頁",

  "error.badCode": "請輸入另一部裝置上顯示的 4 位數字。",
  "error.unknownDevice": "對方無法證明自己是哪一部裝置，所以沒有傳送任何東西。",
  "error.stopped": "你中止了這次連線。",
  "error.nobodyJoined": "時限內沒有人加入。請重新開始。",
  "error.peerEnded": "另一部裝置結束了這次連線。",
  "error.deviceBusy": "那部裝置正在另一個連線中，等它完成之後再試。",
  "error.deviceUnreachable": "對方裝置沒有回應。請確認那部裝置開着 GSend、而且在前景，再試一次。",
  "error.sessionIdle": "連線閒置太久，已經關閉。",
  "error.expiredWhileAway": "這個頁面離開期間，連線已經失效。請重新開始。",
  "error.serverLost": "與伺服器的連線中斷了。",
  "error.peerGone": "另一部裝置離開之後沒有回來。",
  "error.idle": "閒置太久",

  "server.code_not_found": "這個數字碼不存在。請檢查數字再試。",
  "server.code_expired": "這個數字碼已經失效。請對方產生一個新的。",
  "server.session_full": "這個數字碼已經被另一部裝置用了。",
  "server.bad_key": "無法恢復這次連線。",
  "server.rate_limited": "嘗試次數太多。請等一分鐘再試。",
  "server.no_capacity": "伺服器現在太忙。請稍後再試。",
  "server.bad_request": "請求格式錯誤。",

  "cancel.sender-cancelled": "傳送方已取消",
  "cancel.receiver-cancelled": "接收方已取消",
  "cancel.sender-reloaded": "傳送方的頁面重新載入了，讀不回這個檔案",
  "cancel.too-large": "接收裝置收不下這麼大的檔案（上限 {limit} MB）",
  "cancel.peer-lost": "另一部裝置遺失了這次傳送",
  "cancel.write-failed": "寫入儲存空間失敗",
  "cancel.assemble-failed": "組合檔案失敗",
  "cancel.stream-gap": "資料串流出現缺口",
  "cancel.read-failed": "傳送方讀不到這個檔案",
  "cancel.unknown": "已停止",
};

export const DICTIONARIES = { en, zh } as const;
export type Language = keyof typeof DICTIONARIES;

export type MessageParams = Record<string, string | number>;

/** A translatable message plus whatever it needs interpolated. */
export interface Message {
  key: MessageKey;
  params?: MessageParams;
}

export function format(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
