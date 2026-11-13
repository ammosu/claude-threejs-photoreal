---
name: webgl-deterministic-recording
description: 把 three.js／WebGL 場景或網頁遊戲做成「可逐格算繪、可無頭驗證」：時間由外部給（__TIME__、?time=、step(秒)）、Playwright 逐格截圖錄影、GPU 與 SwiftShader 兩種無頭後端、回歸腳本寫法，以及錄完怎麼檢查（低格率預覽、縮圖總表、黑格／閃格掃描、片長對真實速度）；另含電影級離線算繪：一格累積多張子畫面做抗鋸齒、薄透鏡景深、180° 快門動態模糊，鏡頭表與拉焦，串流進 ffmpeg 輸出 HDR10（PQ／BT.2020）與 SDR，分段續跑與卡住偵測。當使用者說「錄 three.js 影片」「逐格算繪」「headless 截圖驗證」「Playwright 測 WebGL」「三組同步錄影對照」「影片跑太快／黑格」「錄影畫面偶爾空白」「錄出來角色定格在 T pose」「電影級算繪」「影片要有景深／動態模糊」「HDR10 影片」「4K 算繪」「離線高品質輸出」「cinematic render」「子畫面累積」「拉焦」時使用。
---

# WebGL 逐格錄影與無頭驗證

即時錄螢幕不可重現：無頭瀏覽器的幀率忽快忽慢、每次跑的畫面都不同，幾個版本也對不齊。
做法是**讓時間由外部決定**：腳本設定「現在是第 t 秒」→ 等畫面畫完 → 截圖 → 下一格。
算繪一格花 0.17 秒或 1.6 秒都無所謂，輸出永遠一樣。

這份 skill 的內容都在一個 three.js 海灘場景專案（場景＋遊戲，
A/B/C 三組素材並排比較）實際做過、出過錯、修好。數字除了 Chromium 參數之外，都是**該專案的實測值**，換專案要重量。

| 檔案 | 內容 |
|------|------|
| `references/hooks.md` | 場景端要開的 hook：單一時鐘、`__TIME__`、`?time=`、`__READY__`、`step()`，以及 step 與畫面迴圈不能重複推進 |
| `references/recorders.md` | 四種錄影腳本型態（鏡頭路徑、遊戲劇本、固定格數對齊、事件觸發＋DRY），後端選擇與 fallback |
| `references/gotchas.md` | 症狀 → 原因 → 修法，全部是真的遇過的 |
| `references/verify.md` | Playwright 回歸腳本的寫法與該斷言什麼 |
| `references/compositing.md` | 逐格合成、並排、淡入淡出、ffmpeg |
| `scripts/sheet.py` | 縮圖總表＋全黑格／單格閃爍掃描 |
| `references/cinematic.md` | 電影級離線算繪：子畫面累積（抗鋸齒／景深／快門）、鏡頭表、HDR10 與 SDR 調色、串流 ffmpeg、分段續跑、驗證與踩坑 |
| `scripts/film/` | `accum.js`（累積算繪器＋鏡頭表＋ffmpeg 上傳）、`film-server.mjs`（零依賴靜態伺服器＋ffmpeg sink）、`render-film.mjs`（分段續跑驅動）、`example/`（示範場景） |

## 1. 場景端：所有動畫只看一個時間值

先改場景，再寫錄影腳本。沒有這一步，後面全部白做。

- **一個時間來源**：水、天空、粒子、角色、遊戲邏輯都從同一個 `t` 推算。每格用 `performance.now()` 算 dt、
  或 shader 自己累加 `time += 0.016` 的，逐格錄影都會跑掉。
- **hook**（詳見 `references/hooks.md`）：
  - `window.__TIME__`：有設就覆寫時鐘。`?time=N`：凍結在第 N 秒（靜態截圖用）。
  - `window.__READY__ = true`：資源載完、第一格畫好才設。`window.__SCENE__`：給腳本拿 camera／renderer。
  - `?auto=1` 才掛的 `step(seconds)`：推進時鐘並跑遊戲邏輯，內部切成 ≤ 1/60 秒的小步，一次 step 很長也不會穿牆。
- **有狀態的遊戲**：dt 一律從時鐘差算，時鐘凍結遊戲就凍結。`step()` 推進過的時間，畫面迴圈**不能再算一次**
  （否則錄出來兩倍速，見 gotchas 第 1 條）。
- **特效也要是時間的純函數**：水花、尾流、揚沙、腳印記「事件發生時間」，畫面只由 `t - 事件時間` 算出，不在每格累加狀態。
- **後處理防護**：bloom 之前加一道把 NaN／Inf 換成黑、上限 1e4 的 pass。一個壞像素會被 bloom 擴散成整格空白。

## 2. 錄影迴圈

兩種基本型（程式見 `references/recorders.md`）：

- **A. 設時間＋等兩次 rAF**：`__TIME__ = t`（或 `step(1/fps)`）→ `await` 兩次 `requestAnimationFrame` → `page.screenshot()`。
  頁面自己的 rAF 迴圈負責畫，適合大多數場景與遊戲。
- **B. 關掉頁面的 rAF、只靠 `step()` 同步畫**：`page.addInitScript(() => { window.requestAnimationFrame = () => 0 })`，
  `step(dt)` 裡直接 `update(t); render()`。頁面迴圈與 step 同時畫會偶爾截到半成品時用（海灘範例專案 的潮池頁）。

錄影腳本四種用途：
1. **鏡頭路徑飛覽**：關鍵格（t、pos、target）用 Catmull-Rom 串起來，每格設相機＋`__TIME__`；多個版本同一條路徑 → 逐格對齊。
2. **遊戲劇本**：按鍵 `keyboard.down/up` ＋ `step()`。段落之間淡黑，黑幕期間只 `step()` 不截圖（快轉）。
3. **多版本並排**：走位用**固定格數**而不是「走到為止」，各版本格數才會一樣。
4. **事件觸發**（例如提示出現才按 E）：每版本觸發時間可能不同，把時間寫成 JSON 給字幕用；`DRY=1` 只模擬不截圖，先確認劇本跑得完。

### 無頭後端

| 用途 | Chromium 參數 | 海灘範例專案 實測 |
|------|------|------|
| 錄影（本機 GPU） | `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu` | 約 0.17 秒／格（960×540） |
| 截圖驗證、沒有 GPU 的環境 | `--use-angle=swiftshader --enable-unsafe-swiftshader` | 約 1.6 秒／格 |

GPU 先試，失敗再退 SwiftShader，並把實際的 `UNMASKED_RENDERER_WEBGL` 寫進 `render-info.json`，
事後才知道這批影格是哪個後端畫的。沙箱裡的代理（codex 等）拿不到 GPU，只會走 SwiftShader：
叫它跑 0.5–2 fps 預覽就好，正式影片自己用 GPU 錄。SwiftShader 只能證明「畫得對」，不能證明實機 60 fps。

## 3. 踩坑速查（細節與程式在 `references/gotchas.md`）

| 症狀 | 原因 |
|------|------|
| 遊戲錄影整段兩倍速 | `step(dt)` 更新一次，畫面迴圈又用時鐘差更新一次 |
| 幾格（或 30% 的格）整片空白／只有背景色 | 某材質產生 NaN，bloom 把它擴散到全畫面 |
| 逐格錄影角色停在 rest pose / T pose | `update(0)` 裡先 `restore()` 骨頭，three.js `PropertyMixer` 判斷值沒變就不寫回 |
| 偶爾一格少了水面（或某一層） | 頁面 rAF 與 step 同時畫，截到半成品 |
| SwiftShader 截圖偶爾是一片底色 | GPU 指令還沒做完就截圖 |
| 開過 iframe 子場景後主畫面變空白 | 同時兩個 WebGL context，SwiftShader 撐不住 |
| 錄影前段正常、後來全黑或 404 | 代理（codex）結束時把 dev server 一起關掉了 |
| 倒回時間後狀態不對 | 遊戲狀態（撿到的東西、球的軌跡）不能倒帶；從頭重玩＋固定輸入 |
| 鏡頭穿進物件 | 路徑關鍵格只看座標沒看畫面；低格率預覽才抓得到 |
| 驗證中段莫名失敗、重跑就過 | 驗證期間改了 `src/`，Vite HMR 整頁重載 |
| 背景跑測試回報成功，log 裡卻是失敗 | 背景指令的結束碼是最後一個指令（`tail`）的；看自己印的 `EXIT` 行 |
| SwiftShader 新開的遊戲頁一直等不到 `__READY__` | 前一個遊戲頁還開著；新頁放在 `page.close()` 之後 |
| `DRY=1` 跑完，字幕時間對不上舊影片 | 模擬照樣覆寫輸出的 JSON；先備份 |

## 4. 驗證方式

錄影「跑完沒報錯」不代表影片是對的。依序：

1. **長片之前先預覽**：同一個腳本用 0.5–2 fps 跑一次（`record-path.mjs B 0.5`），
   `python3 scripts/sheet.py <影格資料夾> /tmp/sheet.jpg 24` 拼成縮圖總表**用眼睛看**：
   鏡頭穿物件、構圖、字幕位置、該出現的東西有沒有出現。海灘範例專案 第一次預覽就抓到鏡頭穿過陽傘和小船。
2. **全部影格掃一次**：`sheet.py` 預設會算每格平均亮度，印出 `DARK`（近全黑）與 `SPIKE`（跟前後兩格都差很多、前後兩格彼此接近，
   也就是單格閃爍）。有就去看那幾格；空白格常是 NaN（加 sanitize pass）或半成品（重拍到兩張相同）。
3. **片長對真實速度**：格數 ÷ fps 要等於劇本的虛擬秒數；拿一段已知速度的動作對照
   （海灘範例專案 走路 1.8 m/s，走 10 m 應該約 5.5 秒）。兩倍速 bug 的症狀就是角色、划槳在影片裡明顯太快。
4. **可重現**：同一個時間重拍，畫面應該一樣（快速檢查：`cmp` 兩張 PNG，或比平均亮度）。
   多版本並排時，確認各版本格數一樣、同一格的虛擬時間一樣。
5. **頁面錯誤要讓錄影失敗**：`pageerror` 與 console error 收起來，錄完（或每格）有就 throw；刻意測缺檔時才放行 404。
6. **事件觸發型**：先 `DRY=1` 跑，看印出的觸發時間與任務完成數，再正式錄。
7. 驗證腳本（`references/verify.md`）每次改場景都重跑，重拍的截圖一起 commit，diff 看得出畫面變了什麼。

## 5. 合成

逐格 PNG/JPG → Python PIL 逐格並排、加標籤與字幕 → 直接 pipe 進 ffmpeg（`-f rawvideo -pix_fmt rgb24`），
或先存 PNG 再 `ffmpeg -framerate 30 -i %05d.png -c:v libx264 -pix_fmt yuv420p -crf 20`。
字幕時間表跟錄影劇本共用同一份資料（或至少註明對應），劇本改了字幕才不會錯位。細節見 `references/compositing.md`。

## 6. 電影級離線算繪（細節在 `references/cinematic.md`）

上面的錄影是「一格算一次、截圖」。要做成品影片時，換成**一格累積多張子畫面**：
- 每張子畫面讓投影矩陣做次像素抖動 → 抗鋸齒。
- 相機在光圈圓盤上移動，再加投影錯切 → 薄透鏡景深。
- 每張子畫面取快門時間內的不同時刻 → 動態模糊。

累積在 float 目標裡，調色一次輸出 SDR，或 HDR10（BT.2020、PQ、16-bit 讀回，交給 x265 編成 10-bit）。

1. 場景要先做到第 1 節的「時間純函數」，並提供 `onTime(t)`，把世界和相機都設定到時間 t。
2. 用 `scripts/film/accum.js` 的 `shotList` 寫鏡頭表：每個鏡頭有關鍵格（位置、目標、焦點、fov、光圈半徑 mm）、片長、子畫面數、曝光。
3. 頁面實作 `__film`／`__still`／`__filmRanges`（照抄 `scripts/film/example/film.js`，只改場景和鏡頭表）。
4. 在輸出資料夾裡跑 `film-server.mjs`，再用 `render-film.mjs` 依序：先出靜態圖 → 低規格試跑整片 → 正式 4K。

實測（範例，RTX 4090）：1280×720、每格 16–32 張子畫面，約 0.03 秒一格；180 格，HDR10 與 SDR 的標記、格數都檢查過；重跑時已完成的段落會跳過。
兩個要注意的 ffmpeg 問題（原專案也有）：
- libx264 要另外用 `-x264-params` 指定 colorprim／transfer，不然標記會變成 unknown。
- RGB 轉 YUV 要指定 `out_color_matrix=bt709`，否則 swscale 會用 BT.601，顏色微偏。

## 實例：海灘範例專案（第 1–5 節）；room-at-dawn（第 6 節，`src/render/film.js`、`tools/film.mjs`）

- 時鐘與 hook：`src/main.js`（frame 迴圈、sanitize pass）、`src/game/index.js`（`step()`）、`src/tidepool/index.js`
- 錄影：`scripts/record-path.mjs`、`record-game.mjs`、`record-walk.mjs`、`record-game-opensea.mjs`、`record-tidepool.mjs`、`record-game-tidepool.mjs`
- 驗證：`scripts/verify-game.mjs`、`verify-explore.mjs`、`verify-tidepool.mjs`
- 合成：`tools/make_video.py`、`make_walk.py`、`make_opensea.py`、`make_tidepool.py`
- 修正紀錄：commit `90756c4`（兩倍速）、`c234601`（NaN 空白格）；`NOTES.md`、`PLAYBOOK.md`
