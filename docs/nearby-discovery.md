# 附近裝置探索(Nearby discovery)設計提案

> 狀態:**提案,尚未實作**。撰寫於 2026-10-14。
> 範圍:讓兩台在同一個網路上、從沒配對過的 GSend 裝置,不輸入數字碼也能找到彼此。
> 最後一節是需要你拍板的決策清單。

## 0. 結論先講

**建議做方案 B:只有當 GSend 首頁開著、而且在前景時,才讓同一個網路上的 GSend 互相看得到。**
在清單上點一下對方,實際做的事是:照常開一個數字碼 session,再把這組碼**直接遞給**你點的那一台。
對方螢幕跳出提示、顯示同一組碼,對方確認兩邊的碼一樣後按「接受」,就跟今天輸入數字碼完全一樣地加入。

這樣做的好處是安全模型幾乎不變:數字碼、首次使用即作廢、per-IP 限速、續傳、TURN 全部沿用。
新增的只有一件事:**誰能被遞碼**。答案是「跟你同一個公開 IP(或同一個 IPv6 /64)、而且首頁正開在前景的裝置」。

代價也要講清楚:

- 伺服器**不新增任何儲存**,但會在記憶體裡保留一份「這個網路上現在有哪些首頁開著」的即時名單。
  README 現在說的「no registry」只能用在已配對裝置那段,不能再當成整個服務的說法。
- IP 位址多了一個用途,從「計算加入次數」變成「也用來決定誰算附近」,隱私頁要寫明。
- 這會推翻 PLAN.md §8 的一項否決(「附近裝置探索(瀏覽器無 mDNS)」)。依 PLAN 自己的規則,要先更新 §8 並寫下原因。

---

## 1. 今天怎麼連,還差什麼

| 情境 | 今天的做法 | 摩擦 |
|---|---|---|
| 自己的裝置,配對過 | 裝置清單點一下,零輸入 | 已解決(§18) |
| 第一次連,手機 → 筆電 | 筆電什麼都不選直接按「取得數字碼」(`landing.receiveOnly`),手機掃 QR | 掃一下,已經很短 |
| 第一次連,筆電 ↔ 筆電、桌機 ↔ 桌機 | 讀對方螢幕上的 4 位數字,自己打進去(打到第 4 位就自動加入) | 要看得到對方螢幕、要打字、60 秒內 |
| 朋友來家裡,用他的手機 | 掃 QR 或輸入數字碼 | 同上 |

所以附近探索**真正多出來的價值**集中在:沒有相機的第一次連線、兩台裝置不在同一個視線範圍(不同房間),以及「不用打字」本身。
已配對的裝置不受影響,它們本來就免碼。

數據方面,`/api/stats` 從 8/31 至今約 50 個 session,連上的 43 個裡 `lan` 只有 7 個。
但這個數字**不能直接說明同網路的 session 很少**:同一個 Wi-Fi 上的兩台裝置,mDNS host candidate 解析失敗時常常改走 srflx,會被記成 `internet`。
我們其實不知道有多少 session 是同一個網路(見 §8 的「先量再做」選項)。

---

## 2. 分組怎麼算(所有 IP 方案共用)

### 2.1 分組的 key

- **只讀 `CF-Connecting-IP`。** 這個 header 由 Cloudflare 邊緣填入,經過 Cloudflare 的 client 偽造不了。
  絕不接受 client 自報的位址(例如從 STUN 拿到的 srflx 再回報上來)。
  PairDrop 2026-10 的 CVE-2026-108555 正是這一類問題:自架、沒放在 Cloudflare 後面的實例信任了偽造的 `cf-connecting-ip`,
  遠端攻擊者只要知道受害者的公開 IP,就能「進入別人網路的探索房間」,看起來像本地裝置。
- **IPv4:用完整的 /32。** 不用 /24,因為同一個 /24 裡的鄰居(機房、ISP 位址池)是陌生人。
- **IPv6:用 /64 前綴**(把 `::` 展開後的前 4 個 hextet)。
  SLAAC 加上隱私延伸(RFC 8981 temporary addresses),每台裝置、甚至每次連線的完整位址都不一樣,只有 /64 代表「同一個 LAN segment」。
  PairDrop 的 `IPV6_LOCALIZE=4` 也是同樣的選擇,而且它的文件特別提到經過 Cloudflare 時尤其需要。
- **IPv4-mapped IPv6**(`::ffff:a.b.c.d`)當成 IPv4 處理。
- **沒有 header 就拒絕,不要退回共用 key。** `worker/index.ts` 的 JoinGuard 現在用 `?? "anonymous"`。
  對限速來說無害,但對分組來說,這會把所有缺 header 的連線放進同一個房間。本機開發另外寫一個只在 dev 生效的 fallback。
- **Pseudo IPv4 必須維持 Off(預設值)。** 設成 Overwrite 時,`CF-Connecting-IP` 會被換成由完整 IPv6 位址雜湊出來的 class E IPv4,/64 分組就失效了。
  實作時可以優先讀 `CF-Connecting-IPv6`(如果存在)做保險。
- **房名 = `HMAC-SHA256(NEARBY_KEY, "4:" + 位址 | "6:" + /64 前綴)`**,再交給 `idFromName`,`NEARBY_KEY` 用 `wrangler secret put` 設定。
  目的是讓 Durable Object 的名字和任何 log 裡都不出現原始 IP。
  要誠實說明:這擋的是意外外洩,擋不了營運者自己(他握有 key)。
- **不需要像 §18.3 那樣按時間窗輪換。** 輪換的目的是避免「伺服器存著的名字」變成長期標籤。
  但這個房間什麼都不存,它的輸入(IP)本來就隨每個請求到達 Cloudflare。
  輪換只會在窗界把同一個網路切成兩個房間,沒有隱私上的收益。

### 2.2 IPv4、IPv6 與 dual-stack

| 情境 | 結果 |
|---|---|
| 同一個家用 Wi-Fi,兩台都走 IPv6 | 同一個 /64,互相看得到 |
| 同一個家用 Wi-Fi,兩台都走 IPv4 | 同一個公開 IPv4,互相看得到 |
| 同一個 Wi-Fi,一台走 IPv6、一台走 IPv4 | **看不到**(false negative) |
| 手機走行動網路的 IPv6 | 通常每支手機各自一個 /64(3GPP 的設計),只看得到自己,這是對的 |
| 手機走行動網路的 IPv4(CGNAT) | 跟同一個出口的陌生人分在一起(**false positive**) |
| VPN、iCloud Private Relay、企業 proxy | 看不到自己的其他裝置,反而可能看到同一個出口的陌生人 |
| 家裡有訪客網路或多個 VLAN | IPv6 是不同 /64,看不到;IPv4 若共用同一個 NAT 則看得到 |

**Dual-stack 不一致沒有乾淨的解法:**

- 瀏覽器每次連線各自決定走哪個 family(Happy Eyeballs,RFC 8305),同一台裝置重連後甚至可能換 family、換房間。
- 要強制兩種 family 都連一次,需要「只有 A record」和「只有 AAAA record」的兩個 hostname。
  Cloudflare 的 IPv6 Compatibility 是**整個 zone** 的設定,而且只有 Enterprise 能關,免費方案做不到。
- 讓 client 自己回報另一個 family 的位址:無法驗證,等於讓任何人宣稱任何 IP、進入任何網路的房間(就是上面那個 CVE)。

所以設計原則是:**false negative 可以接受,false positive 必須無害。**
看不到對方,代價只是改用數字碼,而在方案 B 裡,數字碼和 QR 本來就在傳送方的畫面上。

### 2.3 False positive:陌生人共用同一個 IP

辦公室、學校、咖啡店、飯店、校園 Wi-Fi(大型 NAT,或整棟樓一個扁平的 /64)、行動網路 CGNAT、VPN 與 Private Relay 的出口,都會讓陌生人分到同一個房間。
`request.cf` 給得出 ASN(哪家業者),但給不出「這個 IP 是不是很多人共用」,無法可靠地判斷 CGNAT。

對策:

1. **擁擠上限。** 房間超過 N 個成員(建議 10)後,新進來的只收到 `crowded`:看不到任何人,也不被列出,介面改提示用數字碼。
   一般家庭很少同時開著 10 個以上的 GSend 首頁,校園或 CGNAT 在使用量增加後會超過。
   這是經驗法則,不是保證:一個 CGNAT 位址上剛好有 3 個陌生人同時開著 GSend,仍然可能發生。
2. **陌生人能看到的東西要極少**,而且什麼都做不了,除非對方按接受(見 §3、§4)。
3. (選配,不放 v1)連上之後,如果這個「附近」session 實際走的是 `relay`,提示「這台裝置可能不在同一個網路」。
   這個訊號很弱,因為同一個 Wi-Fi 也常常走 `internet`,只能當提示,不能當閘門。

---

## 3. 陌生人會看到什麼,以及濫用情境

**清單上每一筆只有一個伺服器指派的隨機標籤**:顏色 + 動物,例如「🦊 藍色狐狸」。
同一個房間裡不會重複,每次造訪重新抽。伺服器只送索引,由各自的 client 用自己的語言顯示,加上 emoji。
這樣中文裝置和英文裝置看到的是同一隻動物,沿用 README 裡「取消原因傳代碼、不傳句子」的做法。
每台裝置在自己的首頁上大字顯示「這台裝置在附近顯示為:🦊 藍色狐狸」,使用者靠這個知道要點哪一個。

**絕對不出現在清單上的東西:**

- 裝置名稱(`identity.name`):「Michael 的 iPhone」這種名字,正是 AirDrop 洩漏身分的方式。
- 裝置 id:它是公鑰雜湊,是穩定識別碼,會讓同一個網路上的人跨次追蹤同一台裝置。
- 作業系統、瀏覽器、是否已配對。
- 要傳的檔名、大小、數量:隱私頁承諾伺服器收不到這些,所以邀請提示也不能寫「3 個檔案、12 MB」。

**陌生人能推斷的:** 現在這個網路上開著幾個 GSend 首頁,以及它們何時出現、何時消失。

| # | 濫用情境 | 風險 | 對策 |
|---|---|---|---|
| 1 | 陌生人推東西給你(unsolicited push / cyber-flashing,AirDrop 的老問題) | 收到不想要的內容 | 必須由你按「接受」才加入;提示不含任何內容;同一個來源被拒一次後,本次造訪不再顯示它的提示;每個 socket 每分鐘最多送幾次邀請;一次只顯示一個提示,30 秒後自動消失 |
| 2 | 你點錯人(mis-tap) | 對方拿到你的數字碼,按接受就收到你佇列裡的東西 | 標籤在每台裝置自己的首頁上大字顯示;HostPanel 寫明「已通知 🦊 藍色狐狸」;§17 的「對方一進來就看到、隨時可中止」照舊。殘餘風險要「你點錯」加上「對方是會自動接受的惡意 client」同時成立,與 §17 接受的猜碼風險同級 |
| 3 | 灌爆房間(開很多 socket 塞滿上限) | 該網路的附近功能失效 | 只影響攻擊者自己所在的網路,數字碼照常可用 |
| 4 | 遠端攻擊者進入你的房間 | — | 做不到:key 來自 Cloudflare 填的 `CF-Connecting-IP`,除非攻擊者真的跟你共用公開 IP(CGNAT、VPN) |
| 5 | 跨次追蹤 | — | 標籤每次造訪重抽,不送 device id |
| 6 | 消耗免費額度 | Durable Objects 的每日 100k requests 全站共用,超過後**連數字碼流程都會失敗** | 跟現在 `role=host` 的暴露同一類,不是新問題;必要時用 Cloudflare 的 rate limiting rule 擋在 Worker 前面(要先確認免費方案的額度) |
| 7 | 自動配對把一次連線變成永久關係 | 見下 | 建議附近 session **不自動配對** |

**第 7 點要特別說明,而且它其實是今天就存在的行為。**
`src/core/handshake.ts` 在 code 模式下,只要握手成功就會記住對方,並由裝置數多的一方交出群組秘密。
也就是說,今天任何一次數字碼 session(包括傳一個檔給同事)都會讓對方加入你的群組。
加入後,對方能在會合房間裡看到你其他裝置何時在線(只看到 id,其他裝置不認得對方的公鑰,所以呼叫不到它們)。
對方之後也能免碼、零點擊地把檔案推進當初配對的那台裝置的資料夾。
附近探索會讓這種「順手連一下」變得更頻繁,所以建議附近 session 不自動配對,改成在 session 裡由**雙方**各按一次「記住這台裝置」。
數字碼 session 要不要比照辦理,是另一個值得單獨檢討的問題(見 §10)。

> 2026-10-14 更新:數字碼 session 已經改成雙方各按一次「記住」才配對(`Handshake.consent()`、控制訊息 `pair`),
> 證明身分本身不再記住任何東西。附近 session 直接沿用 code 模式即可,不必另開 `"nearby"` 模式。

---

## 4. 接受與確認:直接用數字碼當比對碼

```
A(有檔案,在首頁)              NearbyRoom DO                  B(在首頁,前景)
點「🦊 藍色狐狸」
host(files) → 從 SessionRoom 拿到 4719(跟今天一模一樣)
offer {to: 🦊, code: 4719} ──►  只轉給 🦊 那一個 socket ──►  提示卡:
HostPanel 顯示 4719 + QR                                      「🦉 綠色貓頭鷹 想傳東西給這台裝置
「已通知 🦊 藍色狐狸,                                          請確認對方螢幕上的數字碼是 4719」
 對方應該看到 4719」                                           [接受]  [拒絕]
                                                              接受 → join("4719"),跟手動輸入一模一樣
◄──────── 之後全是現有的數字碼流程:burn on first use、resume、TURN、指標 ────────►
                                                              拒絕 → decline,A 顯示「對方拒絕了」
```

**為什麼直接用數字碼當比對碼:**

- 傳送方的 HostPanel 本來就大字顯示它,不需要再引入一個新的「比對碼」概念。
- 它保護的是接收方:確認這個提示來自眼前那台裝置。同時有陌生人發邀請的話,數字會不一樣。
- 安全性可以化約回現有的數字碼模型。唯一新增的問題是「誰能被遞碼」,答案是同一個網路上、傳送方親手點的那一台。
- **接受之前就先把碼送過去,並沒有削弱什麼。** 碼只會到被點的那一台。如果那一台是惡意的,它本來就會自動接受。
  伺服器本來就看得到數字碼。
  這樣協定只需要 `offer` 和 `decline` 兩種訊息,不需要「接受 → 回報 → 再送碼」的來回。
- **退路是現成的。** 對方拒絕或沒有回應,A 已經在數字碼和 QR 的畫面上,直接念碼或讓對方掃就好。

**其他確認方式,以及為什麼不選:**

| 方式 | 優點 | 缺點 |
|---|---|---|
| Bluetooth 式 numeric comparison(兩邊都要按確認) | 能擋「點錯人 + 對方自動接受」 | 傳送方多一次點擊,而且違反 §17「開了通道就開始送」;可以當成可選開關 |
| Passkey 式(B 要輸入 A 畫面上的數字) | 最能擋點錯人 | 等於回到今天的流程,沒有省到任何事 |
| 由兩端 DTLS fingerprint 推導的 SAS | 連惡意伺服器都擋得住 | 必須在接受**之前**就跟陌生人建立 peer connection(會暴露 ICE candidate);而且超出現有威脅模型,因為數字碼流程本來就信任伺服器做介紹 |

**建議:** 用數字碼本身當比對碼,只有接收方需要按接受。
如果你想把「點錯人」的殘餘風險也收掉,可以再加傳送方確認(上表第一列),代價是多一次點擊。

---

## 5. 對隱私頁與 README 的影響

### 5.1 `public/privacy.html`(英文與中文兩段都要改,並更新「最後更新」日期)

**「What the server handles / 伺服器會經手什麼」新增一條**(草稿,實作時再定稿):

> **Your network, for the nearby list.** While GSend's home screen is open and in front, the server groups it with other GSend home screens that reach it from the same public address (the same IPv4 address, or the same IPv6 /64) and shows each of them a random animal name for this device. Nothing else is shown: not your device's name, and not what you are about to send. The grouping is worked out from your IP address when the page connects, held in memory only while the page is open, and never written down. People who share your public address, on an office, school or café network or on some mobile networks, can see that a GSend screen is open nearby. They cannot send to it or receive from it unless the person at that screen accepts. "Show this device nearby" turns this off.

> **你所在的網路(用於「附近」清單)。** GSend 首頁開著而且在前景時,伺服器會把它和從同一個公開位址連進來的其他 GSend 首頁放在一起(同一個 IPv4 位址,或同一個 IPv6 /64),並讓它們看到這台裝置的一個隨機動物名稱。除此之外什麼都不顯示:不是你的裝置名稱,也不是你要傳的東西。這個分組是在頁面連線時從你的 IP 位址算出來的,只在頁面開著時存在記憶體裡,從不寫下來。和你共用公開位址的人(辦公室、學校、咖啡店的網路,或部分行動網路)可以看到附近有一個 GSend 畫面開著。除非那個畫面前的人按下接受,他們無法傳東西給它,也無法從它接收。「在附近顯示這台裝置」可以關掉這個功能。

**修改既有的 IP 那一條:** 從「用來在一分鐘內計算加入次數」改成兩個用途:計算加入次數,以及在首頁開著時決定哪些畫面算附近。兩者都不寫下來。

**「What stays on your device / 留在你裝置上的東西」新增:** 「在附近顯示這台裝置」這個開關。

「There are no accounts, no cookies and no third-party trackers…」那一句仍然成立,不用改。

### 5.2 `README.md`

- **How it works:** 補一句,說明同一個網路上的裝置可以直接點,不用輸入數字碼。
- **Security model:** 新增一段「Nearby devices are a third problem」。重點是:在同一個網路上不是秘密,所以它**不能取代**數字碼,只決定「誰可以被遞碼」。真正的閘門仍然是數字碼,加上接收方比對過的接受。殘餘風險就是 §3 第 2 點。
- **「The server's only job is introductions… nothing else」:** 就儲存而言仍然成立。但要補一句:附近功能在記憶體裡保留每個網路目前開著的首頁名單,頁面一關就消失。
- **Current status 裡的「no registry, no accounts, nothing to leak」:** 那段講的是已配對裝置,對那個功能仍然成立。附近功能那段則要直接寫明它**是**一份即時、只在記憶體、按網路分組的名單,不能讓讀者以為整個服務都沒有名單。
- **Layout 表:** 加上新檔案(見 §9)。

### 5.3 `PLAN.md`

- §8 的「附近裝置探索(瀏覽器無 mDNS)」要移出否決清單,並記下原因:IP 分組不需要 mDNS,當初的否決理由已經不成立;但隱私代價是新的,當時沒有評估過。
- 新增 §19,記錄最後的決策(選了哪個方案、§10 的各項怎麼定)。

### 5.4 誠實的一句話

方案 B 之下,「伺服器不保存任何可識別的東西」就**儲存**而言仍然成立。
但伺服器現在會**根據你的 IP 決定誰看得到你**,這是一個新用途。
IP 位址在台灣個資法與 GDPR 底下都可能算個人資料,新的用途應該在隱私頁寫明(這不是法律意見)。

---

## 6. Durable Objects 成本

**計費事實**(Cloudflare 文件,2026-10 查證):

- 免費方案:Durable Objects 每天 100,000 requests、13,000 GB-s duration,每天 00:00 UTC 重置。**任何一項超過,同類操作就直接失敗。**
- 付費方案:每月含 1M requests,超過每百萬 $0.15;含 400,000 GB-s,超過每百萬 GB-s $12.50。
- 建立一條 WebSocket 算 1 個 request。收到的 WebSocket 訊息以 20:1 計費。送出的訊息不收費,protocol-level ping 也不收費。
- 可以 hibernate 的閒置物件不計 duration。`setWebSocketAutoResponse` 的回應不計 duration。
  文件**沒有說明** auto-response 的訊息算不算 request,以下估算按最壞情況算(算 request)。

**每次造訪的估算(方案 B):**

| 項目 | 數量 |
|---|---|
| 建立 WebSocket | 1 request |
| heartbeat(每 20 秒一次,最多 10 分鐘 = 30 次,÷20) | ≤ 1.5 request(最壞情況) |
| offer / decline(偶爾幾則,÷20) | < 1 request |
| 加入、離開的廣播 | 送出的訊息,免費 |
| SQLite 讀寫 | **0**(這個 DO 不碰 storage,也就不需要 alarm 或清理) |
| duration | 每個事件只醒來幾毫秒,其餘時間 hibernate,可以忽略 |

合計每次造訪約 2–3 requests。光看這一項,免費額度大約撐得住每天三萬多次首頁造訪。

**對照方案 A(常駐):** 一個分頁開 8 小時 ≈ 1 + 1,440 次 ping ÷ 20 = 約 73 requests,還沒算重連。
每台裝置每天大約 80 個 requests,成本跟「開著的分頁數 × 時數」成正比,不是跟造訪次數。

**現況:** 從 8/31 至今約 50 個 session,不管 A 或 B,成本都可以忽略。

**真正要注意的兩點:**

1. 免費額度是**全站共用**的。今天沒配對的訪客開首頁,不會花任何 DO request;附近功能讓**每一次首頁造訪**都開始花額度。
   如果被惡意刷爆,壞掉的是全部,包括數字碼。
2. 擁擠上限讓每個房間的廣播量有上界(≤ 10 × 10)。CGNAT 位址再擁擠,也不會出現一個扇出成千上萬的熱點物件。

---

## 7. 方案比較

| | A 常駐 IP presence(原始構想) | **B 首頁前景、限時(建議)** | C 反向 QR「接收模式」 |
|---|---|---|---|
| 什麼時候被列出 | 只要頁面開著,包括背景分頁、已安裝的 PWA、session 進行中 | 只有首頁在前景,而且最近 10 分鐘內有互動 | 從不被列出 |
| 第一次連線,筆電 ↔ 筆電 | 一點 + 對方接受 | 一點 + 對方接受 | **沒有幫助**(筆電沒有相機) |
| 第一次連線,手機 → 筆電 | 一點 + 對方接受 | 一點 + 對方接受 | 筆電按一下,手機掃一下(今天就做得到) |
| 陌生人的曝光 | 高:時間長,背景分頁也在 | 低:只在有人盯著首頁時 | 無 |
| 伺服器狀態 | 記憶體名單,長時間存在 | 記憶體名單,短暫存在 | 無變化 |
| DO 成本 | 跟開著的分頁時數成正比 | 跟造訪次數成正比 | 無變化 |
| 隱私頁與 README | 要改,而且很難寫得好看 | 要改(§5) | 不用改 |
| PLAN §8 | 推翻 | 推翻 | 不涉及 |
| 工作量 | 中 | 中 | 小(主要是文案和一顆按鈕) |

### 方案 A:常駐 IP presence

就是原始構想:每個開著的 GSend 頁面都加入它那個網路的附近房間。
問題在於 A 比 B 多涵蓋的那些時候(背景分頁、桌上沒人看的 PWA、session 進行中),**多出來的幾乎全是曝光,不是便利**:
GSend 沒有 server push,也沒有通知,沒人看著的分頁收到邀請也沒人能按接受。
陌生人卻可以一直看到「這個網路上有一台 GSend 開著」,看一整天。

### 方案 B:首頁前景、限時的附近房間(建議)

細節見 §8。它的取捨是:接收方必須把 GSend 首頁打開放在前景。
但第一次連線時,接收方本來就得打開 gsend.cc 來輸入數字碼,所以這不是新增的步驟。

**更保守的變形 B′:** 接收方要先按「讓附近裝置看到我」才會被列出,類似 Apple 後來把 AirDrop 的「所有人」改成只開 10 分鐘。
曝光更少,但多一次點擊,把「點一下 + 接受」對比「輸入 4 位數」的優勢吃掉大半。
如果你對陌生人看到「附近有 GSend 開著」這件事很在意,B′ 是合理的退路。

### 方案 C:反向 QR「接收模式」

今天其實已經做得到:筆電首頁什麼都不選,直接按「取得數字碼」,就是一個等著收的 session;手機掃 QR 加入之後就能傳。
要做的只是把它變成看得見的功能,例如一顆「從手機傳到這台」按鈕,加上更清楚的文案。
零伺服器改動、零隱私影響,但對沒有相機的兩台電腦沒有幫助。
**不管選哪個方案,C 都值得做**,它成本很低,也不衝突。

### 其他技術(都不建議)

- **mDNS / 區域網路廣播:** 瀏覽器不開放。WebRTC 的 host candidate 被 mDNS 混淆成隨機的 `.local` 名字,無法用來列舉附近裝置。
- **Web Bluetooth:** 瀏覽器只能當 central,不能廣播(沒有 peripheral role),兩個瀏覽器互相看不到。
- **Web NFC:** 只有 Android Chrome,而且要實際碰在一起。
- **超音波配對:** 要麥克風權限,環境噪音下不可靠,而且會讓「為什麼要麥克風」成為新的信任問題。
- **client 自報 IP / candidate:** 無法驗證,見 §2.1 的 CVE。

---

## 8. 建議:方案 B 的具體規則

**什麼時候在房間裡**(四個條件全部成立):

1. 在首頁(`phase === "idle"`,沒有進行中的 session)。
2. `document.visibilityState === "visible"`。轉到背景超過 60 秒才離開,讓 iOS 選檔案、短暫切 app 時標籤不會一直換。
3. 最近 10 分鐘內有過互動。桌機視窗被別的視窗蓋住時仍然算 `visible`,沒有這個時限的話,一個忘了關的分頁會整天被列出。
   超過時限後,改顯示一顆「重新在附近顯示」按鈕。
4. 「在附近顯示這台裝置」是開的。建議**預設開**,存在本機,隱私頁要寫。

例外:傳送方點了某台裝置之後,要多待到碼送出去為止,所以連線會撐到 `offer` 送出後才關。

**房間的行為(`NearbyRoom` DO):**

- 連線時指派一個隨機 handle(64-bit)和一個房內不重複的標籤索引(例如 12 色 × 16 種動物),全部放在 socket tag 或 attachment 裡,**不寫 storage**。
- 送出 `{t: "nearby", self: {label}, peers: [{id, label}]}`,之後有人加入或離開就廣播。
- 成員到達 10 個上限後,新來的只收到 `{t: "crowded"}`。
- `offer {to, code}`:只轉給 `to` 那一個 socket。每個 socket 每分鐘最多 6 次,同一時間只能有一個未回應的邀請。
- `decline {to}`:轉成 `declined` 給對方。
- heartbeat 跟 `DeviceGroup` 一樣用 auto-response,並同樣淘汰太久沒有回應的成員。

**接收方的 client:**

- 只有在使用者按了接受、而且邀請還沒過期(30 秒)時,才會呼叫 `join(code)`。絕不自動加入。
- 一次只顯示一個提示。拒絕過的來源,本次造訪不再顯示它的提示。

**session 之後:** 附近 session 不自動配對。雙方都按了「記住這台裝置」才執行現有的配對握手。

**已配對的裝置會重複出現:** 同一個網路上的兩台已配對裝置,會同時出現在「已配對」和「附近」兩個清單裡。
要去重,就得送一個由群組秘密推導出來的標記,但陌生人會因此看到「這兩筆屬於同一個群組」,而且在 6 小時的窗內可以串連。
**v1 建議不去重**,在附近清單上方寫「已配對的裝置請用上面的清單」。

**選項:先量再做。** 如果你還不確定值不值得,可以先在 `SessionRoom` 加一個匿名計數:
host 的網路 key 只在記憶體裡保留到 guest 加入為止(最多 60 秒),比對後只記一個「同一網路:是 / 否」到 `Metrics`,跟現有的 `lan` / `internet` 計數一樣。
跑幾週就知道有多少數字碼 session 本來可以免碼。這也要在隱私頁加一句,但改動遠比整個附近功能小。

---

## 9. 實作大綱(方案 B)

順序很重要:**先改文件,再寫程式**,這是 PLAN.md 自己的規則。

| 步驟 | 檔案 | 內容 |
|---|---|---|
| 0 | `PLAN.md` | §8 移除否決並寫明原因;新增 §19 記錄決策 |
| 1 | `shared/protocol.ts` | `NearbyClientMessage` / `NearbyServerMessage`(`nearby`、`joined`、`left`、`offer`、`declined`、`crowded`、`error`);常數 `NEARBY_CAP`、`NEARBY_OFFER_TTL_MS`、`NEARBY_OFFERS_PER_MINUTE`、標籤組數 |
| 2 | `worker/nearby-room.ts`(新) | `NearbyRoom` DO,結構仿照 `worker/device-group.ts`:hibernatable WebSocket、auto-response heartbeat、淘汰沒有回應的成員、標籤指派、擁擠上限、offer 轉送與限速。不碰 storage |
| 3 | `worker/index.ts` | `role=nearby` 路由;`networkKey(request)`:讀 `CF-Connecting-IP`(或 `CF-Connecting-IPv6`)、解析、v4 用 /32、v6 用 /64、mapped 當 v4、沒有 header 就拒絕;HMAC 後交給 `env.NEARBY.idFromName` |
| 4 | `wrangler.jsonc`、`worker/env.d.ts`、`worker-configuration.d.ts` | 新增 `NEARBY` binding 與 migration `v4`(`new_sqlite_classes: ["NearbyRoom"]`);`env.d.ts` 宣告 `NEARBY_KEY`;執行 `npm run cf-typegen`;部署前執行 `npx wrangler secret put NEARBY_KEY` |
| 5 | `src/core/nearby.ts`(新) | `NearbyLink`:結構仿照 `src/core/group.ts`(重連 backoff、`Heartbeat`、`wake()`),事件有 `onPeers`、`onOffer`、`onDeclined`、`onCrowded` |
| 6 | `src/core/client.ts` | 依 §8 的四個條件決定 `NearbyLink` 開關;`sendToNearby(peer, files, text)` = `host()`,收到 `hello` 拿到碼後 `offer`,再關掉連線;收到的 offer 放進 snapshot;`acceptNearby()` 呼叫 `join(code)` 並標記 `via: "nearby"`;`declineNearby()` |
| 7 | `src/core/handshake.ts` | 新增 `"nearby"` 模式:跟 code 模式一樣是 advisory,但不自動 `rememberDevice`,也不送 `group-invite`,要等雙方都按「記住這台裝置」 |
| 8 | `src/ui/NearbyList.tsx`(新)、`src/ui/DeviceList.tsx` 或 `src/ui/Landing.tsx` | 首頁右欄、已配對清單下方的「附近」區塊;自己的標籤;擁擠時的提示 |
| 9 | `src/ui/NearbyPrompt.tsx`(新)、`src/ui/Landing.tsx` | 接受卡:來源標籤、數字碼、接受與拒絕、30 秒倒數 |
| 10 | `src/ui/HostPanel.tsx`、`src/ui/TransferPanel.tsx` | HostPanel:「已通知 🦊…」與「對方拒絕了」;TransferPanel:附近 session 的「記住這台裝置」按鈕 |
| 11 | `src/i18n/strings.ts` | 標籤詞表(中英各一份 + emoji)與所有新字串 |
| 12 | `public/privacy.html`、`README.md` | §5 的修改 |

**驗證:**

- 本機:`wrangler dev` 底下兩個分頁的 IP 都是 loopback,要用 dev-only 的 fallback key 讓它們分在同一組,並用 `localhost` + `peer.localhost` 模擬兩台裝置。
- 真機:同一個家用 Wi-Fi,分別在 IPv6 和 IPv4 下測試;手機切到行動網路後應該看不到筆電;dual-stack 不一致時應該什麼都看不到;用腳本開 11 個 socket 測擁擠上限。
- 安全:拒絕之後同一個來源不再跳提示;沒按接受絕不加入;清單和網路請求裡都看不到裝置名稱或 device id。

粗估規模:Worker 約 200 行,client 約 250 行,UI 約 250 行,加上文件。

---

## 10. 需要你決定的事

1. **要不要做附近探索,也就是推翻 PLAN §8?** 建議:做方案 B。
   如果你更重視「陌生人連附近有 GSend 開著都不該知道」,就選 B′(要先按一下才被列出),或只做 C。
2. **附近 session 要不要自動配對?** 建議:**不要**,改成雙方各按一次「記住這台裝置」。
3. **「在附近顯示這台裝置」預設開還是關?** 建議:預設開,但只在首頁前景、10 分鐘內有效(§8)。
4. **「點錯人 + 對方自動接受」的殘餘風險,要不要用傳送方確認來收掉?** 建議:不要,與 §17 的取捨一致;HostPanel 照樣顯示對方已加入,並可隨時中止。
5. **擁擠上限設多少?** 建議 10。
6. **要不要先量再做(§8 最後一段)?** 想先確認需求再動手的話,這是成本最低的一步。
7. **方案 C(反向 QR 接收模式)要不要順便做?** 建議要,它跟上面的選擇都不衝突。

**另外,值得單獨檢討、但不在這份提案範圍內的一件事:** 今天任何數字碼 session 都會自動配對並交出群組秘密(§3 第 7 點)。
傳一個檔給同事,就讓對方永久加入你的群組,能看到你其他裝置何時在線,並能零點擊推檔到那台裝置。
這可能比附近探索本身更值得先處理。(2026-10-14:已處理,見 §3 第 7 點的更新。)

---

## 參考

- Cloudflare Durable Objects 計費:<https://developers.cloudflare.com/durable-objects/platform/pricing/>
- Cloudflare IPv6 Compatibility(zone-wide,只有 Enterprise 能關):<https://developers.cloudflare.com/network/ipv6-compatibility/>
- PairDrop `IPV6_LOCALIZE`(以 /64 分組 IPv6):<https://github.com/schlagmichdoch/PairDrop/blob/master/docs/host-your-own.md>
- PairDrop CVE-2026-108555(偽造 `cf-connecting-ip` 進入別人的探索房間):<https://www.vulncheck.com/advisories/pairdrop-through-1.11.2-ip-spoofing-via-cf-connecting-ip-header>
- RFC 8305 Happy Eyeballs v2;RFC 8981 IPv6 Temporary Address Extensions
