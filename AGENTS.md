# GSend

瀏覽器對瀏覽器傳檔案和文字的 Web App：揀檔案或打字，對方輸入 4 位數字碼或掃 QR，就經 WebRTC 直接收到；兩部裝置都按過「記住」，之後互傳不用碼。網站 gsend.cc 就是 App 本身。JetPiggy 的產品，公開 repo `github.com/JetPiggy/GSend`。

前端在 `src/`（React + Vite），信令伺服器在 `worker/`（Cloudflare Worker + Durable Objects），兩邊共用 `shared/protocol.ts`。伺服器只做介紹：檔案和文字只在兩個瀏覽器之間傳。

## 先讀

- `README.md`：運作方式、安全模型、指令、目錄和現況。
- `PLAN.md`：產品定義和已定案的決定。要推翻一條，先在 `PLAN.md` 寫明改甚麼和原因。
- `docs/`：未實作的設計提案，例如 `nearby-discovery.md`（附近裝置探索）。
- `design/notes.md`：介面設計的基線；改介面就更新它。
- `public/privacy.html`：私隱頁，寫明伺服器經手甚麼、記錄甚麼。

## 硬規則

- **每個 commit 都公開。** repo 是公開的，gsend.cc 也是。檔案、commit 訊息和 `public/` 只寫可以公開的內容：沒有個人姓名、個人帳戶名、私人電郵、本機路徑和秘密（金鑰、密碼、token）。連結只用 `github.com/JetPiggy/GSend` 和 gsend.cc；對外聯絡寫 `gsend@jetpiggy.com`，私隱查詢寫 `privacy@jetpiggy.com`。只適用某部電腦的資料寫在 git 不追蹤的 `CLAUDE.local.md`。
- **gsend.cc 是唯一的網址。** `wrangler.jsonc` 的 `workers_dev` 和 `preview_urls` 保持 `false`：workers.dev 的網址帶着帳戶的個人子網域。
- **伺服器只做介紹。** 檔案內容、檔名、大小、類型和文字訊息只在兩個瀏覽器之間傳；沒有帳戶、cookie、分析工具和第三方追蹤。一個改動會令伺服器、Cloudflare 或其他第三方收到或記錄的資料有變（包括 `wrangler.jsonc` 的 `observability`），先告訴使用者私隱頁和 README 要跟着改。私隱頁的內容等使用者要求才改；改的時候英文和中文兩段一齊改，並更新「最後更新」日期。
- **品牌素材是輸出檔。** `public/img/` 的飛豬圖、`public/` 的 App 圖示和 `public/fonts/` 的字型來自 JetPiggy 的品牌素材，正本不在這個 repo；哪些不在 MIT 授權範圍內，見 `NOTICE`。建置只用 repo 裏的檔案。圖示由 `npm run icons` 從 `public/img/face.webp` 產生；改了介面字串要重跑 `npm run fonts`。
- **署名用 JetPiggy。** 版權和公開的署名寫 JetPiggy；commit 身分是 `JetPiggy <hello@jetpiggy.com>`。
- **只 commit 自己的改動。** 同一個 checkout 可能有其他 session 在改：`git add` 只加自己改過的檔案。

## 發佈方式

`git push` 只更新 GitHub。gsend.cc 要跑 `npm run deploy`（build 之後 `wrangler deploy`，Worker 和靜態檔一齊上載）才會更新，沒有自動部署。

| 做甚麼 | 甚麼時候 |
|---|---|
| commit | 改完、`npm run check` 通過、在瀏覽器驗證過，就直接 commit；不同的事分開 commit |
| push 和部署 | 一件事做完，把會公開的改動逐項列給使用者；使用者確認之後 push，再 `npm run deploy`。push 了就要部署，否則網站仍然是舊版 |
| force push、改寫歷史、刪除分支或 repo | 一定先問使用者 |

部署之前：

- 檢查 `public/` 和這次的改動，沒有「每個 commit 都公開」列出的東西。
- 工作目錄有別人未 commit 的檔案時，從那個 commit 的 `git archive` 部署，不從工作目錄部署。

部署之後，`npx wrangler deployments list` 顯示最近一次上載的時間，分得出「未部署」和「快取」。`index.html` 以 `max-age=0, must-revalidate` 送出，部署之前已經開着的分頁仍然跑舊版：測試之前兩部裝置都要重新載入。

## 在本機測試兩部裝置

兩部「裝置」要兩個 origin，各自有 IndexedDB 身分和 OPFS：`http://localhost:5173` 和 `http://peer.localhost:5173`（Vite 接受 `.localhost` 子網域）。`npm run dev` 同時跑 App 和 Worker。在 Claude 桌面 App 的瀏覽器窗格，用 `preview_start` 名稱 `gsend`（`.claude/launch.json`）；窗格不接受 `127.0.0.1`。本機沒有 `.dev.vars` 就沒有 TURN，路線只會是 `lan` 或 `direct`。

看似 bug、其實不是：

- 窗格被其他視窗蓋住時停止繪畫，截圖和滑鼠點擊會逾時：改用頁面 JS 操作。WebRTC 傳輸也會變慢（先快到大約 20%，之後每 0.4 秒大約 1%，最後一下衝完）；舊版本一樣，是環境問題，不是退步。
- 幾毫秒內連續改兩個檔案，Vite 可能送出舊模組（「X is not defined」）：`touch` 那個檔案再重新載入。
- 改 `App.tsx` 會熱更新出第二個 `GSendClient`，頁面顯示記不住裝置（`devices.notRemembered`）：重新載入分頁。
- 重新載入會從 `sessionStorage` 接回上一個數字碼連線：計時的測試之前先結束連線。
- 身分載入期間大約 0.5 秒，裝置列表顯示記不住裝置：之後再讀頁面。

其他 session 在改同一個 checkout 時，每次存檔都會熱更新，已配對裝置的測試撐不住。改用隔離的副本：把 `git archive HEAD` 解壓到暫存資料夾，複製自己改過的檔案過去，跑 `npm ci --prefer-offline`，在 `.claude/launch.json` 臨時加一項 `npm --prefix <副本> run dev -- --port 5175 --strictPort`（這一項不 commit）。新的 origin 要先用數字碼配對一次：連線中兩邊都按「記住」。

- 令已配對的裝置「連不上」：凍結它的分頁，`setTimeout(() => { const e = Date.now() + 15000; while (Date.now() < e) {} }, 1000)`。每個分頁是獨立的程序，另一個分頁照常運行。
- 新舊版本混用：每個 dev server 有自己的 Worker 和 Durable Objects，另一個 port 上的舊版加入不到這邊產生的碼。在隔離的副本裏由 git 取出舊模組（例如 `git show <舊 commit>:src/core/handshake.ts > handshake-old.ts`），令 client 在 `location.hostname.startsWith("old.")` 時用它，再開 `old.localhost:<port>` 做「舊裝置」。這個開關只留在副本，不 commit。
