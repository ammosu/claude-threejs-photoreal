# 電影級離線算繪：子畫面累積、景深、快門、HDR10

來源：room-at-dawn（MIT）的 45 秒影片，規格是 4K、HDR10（PQ／BT.2020、10-bit HEVC）、另附 SDR 4K 與 1080p。
程式在 `src/render/film.js`、`tools/film.mjs`、`src/main.js`（makePrep）、`src/render/pipeline.js`（renderAccum／present）。
這裡把它整理成通用版，放在 `scripts/film/`。所有東西都在本機實測過（RTX 4090、Linux、playwright-core）。

| 檔案 | 內容 |
|---|---|
| `scripts/film/accum.js` | `Accumulator`（累積、調色、讀回）、`shotList`（鏡頭表）、`applyShotCamera`、`ffStart`／`ffFrame`／`ffEnd`、`ffArgs` |
| `scripts/film/film-server.mjs` | 不需安裝任何套件：靜態檔案加上 `/api/ff/*`（把原始影格寫進 ffmpeg 的 stdin）。只綁 127.0.0.1 |
| `scripts/film/render-film.mjs` | 分段、可續跑、有卡住偵測的無頭驅動腳本，最後做合併編碼（HDR10、SDR、1080p） |
| `scripts/film/example/` | 示範場景：棋盤格與細線（測抗鋸齒）、不同深度的球加上拉焦（測景深）、旋轉的風扇（測動態模糊）、6 倍白的燈條（測 HDR） |

## 為什麼要用子畫面累積

即時算繪的抗鋸齒（MSAA、FXAA）、後製景深、後製動態模糊都是近似，近看會露餡。
離線時可以「一格畫 N 次再平均」，每次只微調一點點：

| 效果 | 每張子畫面變動什麼 | 序列 |
|---|---|---|
| 抗鋸齒 | 投影矩陣平移 ±0.5 像素：`m[8] += 2·jx/w`、`m[9] += 2·jy/h` | Halton(2, 3) |
| 景深（薄透鏡） | 相機位置在光圈圓盤上移動 (lx, ly)，投影再反向錯切 `−m[0]·lx/focus`，讓焦平面保持清晰 | Halton(5, 7)，半徑取平方根，分布均勻 |
| 動態模糊 | 每張子畫面取不同時間 `t + shutter·((i+0.5)/n − 0.5)`，**整個世界和相機都依這個時間設定** | 均勻分布 |

三者共用同一組 N 張子畫面，所以成本就是 N 倍的算繪。

- 180° 快門 = 半格時間：30 fps 時 `shutter = 1/60`。
- `onTime(t)` 要把**所有會動的東西**設定到時間 t，包括相機。這也是為什麼場景必須是「時間的純函數」（見 `hooks.md`）。
  原專案的相機在一格內不動，只有世界在動；這裡的範例讓相機也依子時間移動，所以也有相機的動態模糊。
- 景深的 `aperture` 是透鏡半徑（公尺）。原專案用 4–10 mm；範例要讓效果明顯，用到 14–35 mm。`focus` 是沿視線方向的距離（`applyShotCamera` 會算）。
- 累積的目標是 **FloatType** render target。每張子畫面先畫進 HalfFloat target，再以權重 1/N 疊加上去。three.js 畫進 render target 時不會做色調映射和 sRGB 轉換，所以累積的是場景線性 HDR。
- **NaN 防護**：疊加和調色時都把 NaN 換成 0。一張子畫面壞掉不會毀掉整格。

### 子畫面數

| 鏡頭 | 原專案 | 說明 |
|---|---|---|
| 大景、光圈小 | 32 | |
| 一般 | 48–64 | |
| 淺景深特寫、葉子在風裡 | 96 | 景深與動態模糊都會讓「一張張的殘影」更明顯 |

- `render-film.mjs --samples S` 是基準值，每個鏡頭再乘上自己的 `samples / 16`，最少 4 張。
- **看到一層層的殘影就是子畫面不夠**。範例用 `--samples 8`（拉焦鏡頭等於 32 張），在 35 mm 光圈下風扇和棋盤格就看得出殘影。
- 預覽用 8，正式算繪用 16 或更高。

## 調色與兩種輸出

`present(mode, { exposure, fade, peak })`：
- **SDR**：`ACES(c·曝光·淡入淡出)` → sRGB → 8-bit。
- **HDR10**：
  - BT.709 轉 BT.2020 矩陣。
  - 場景線性 1.0 對應 SDR 參考白 203 nits。
  - 從峰值的 60% 開始以指數柔性壓縮到 `peak`（預設 1000 nits）。
  - 套用 PQ 曲線，寫進 HalfFloat target。
- 讀回：
  - HDR 的 half float 用查表（`halfLut`）轉成 0–65535，送給 ffmpeg 當 `rgba64le`。
  - SDR 直接 `rgba`。
  - GL 讀回的列是由下往上，所以 ffmpeg 要加 `vflip`。
- 每個鏡頭可以有自己的曝光（`exp`，相機在暗角落會開大光圈），第一個鏡頭淡入、最後一個鏡頭淡出。

## 送給 ffmpeg

- 頁面用 `fetch` 把每格 POST 到 `film-server.mjs`，伺服器寫進 ffmpeg 的 stdin。不需要先存 PNG，4K 也不會塞爆硬碟。
- **用 Blob 當 body**：Chrome 會用參照的方式把 Blob 交給網路行程，原專案實測 66 MB 的影格比直接送 typed array 快約 9 倍。
  Blob 失敗時（blob 儲存空間滿了）會先 `gc()` 再退回 typed array。
- 每格帶 `seq`，伺服器同一個 seq 只寫一次，所以 client 重送是安全的。
- **中間檔**：ultrafast、crf 8，盡量不拖慢算繪。**最終檔**等全部算完再用 slow preset 重新編碼。

```
HDR10 最終：libx265 slow crf 12，yuv420p10le，bt2020 / smpte2084 / bt2020nc / tv，
            x265-params: hdr10=1:hdr10-opt=1:repeat-headers=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,180
            -tag:v hvc1（Apple 播放器要這個）
SDR 最終： libx264 slow crf 17；1080p 版本用 lanczos 縮小，crf 19
```

`out/soundtrack.m4a` 存在的話，合併時會自動混入音軌（`-shortest`）。

## 分段、續跑、卡住偵測

- 每個鏡頭切成 `--chunk` 格一段（預設 60），每段各自輸出中間檔，完成後寫一個 `.done`。重跑時，有 `.done` 的段落直接跳過。
- 卡住偵測：每 15 秒問一次頁面 `__filmProgress.frame`，5 分鐘沒有前進就判定卡住，重開瀏覽器重算這一段，最多 4 次。
  頁面大部分時間都在忙著算繪，查詢慢回應是正常的，所以查詢本身另外有 30 秒逾時。
- 瀏覽器參數：`--js-flags=--expose-gc --max-old-space-size=8192`（4K 影格很大），以及三個停用背景節流的旗標。
- **把 WebSocket 換成假的**（`addInitScript`）：在 Vite 底下，別處存了一個檔案就會觸發 HMR，算到一半整頁重載。
- 失敗要讓腳本失敗：ffmpeg 回傳碼不是 0 就丟錯，這一段不會被標成完成。

## 用法

```bash
# 1) 在輸出資料夾裡啟動伺服器（輸出路徑相對於 cwd）；--root 是頁面所在的資料夾
cd /path/to/work && node <skill 資料夾>/scripts/film/film-server.mjs --port 5430 --root <專案>
# 2) 先出幾張靜態圖確認構圖與景深
PW=<playwright-core>/index.mjs node .../render-film.mjs --url http://127.0.0.1:5430/<page>.html --stills 1.5,4.5 --w 1280 --h 720 --samples 32
# 3) 低規格試跑整片，看 SDR
node .../render-film.mjs --url ... --w 1280 --h 720 --samples 8 --out out/test --name test --hdr 0
# 4) 正式：4K、HDR10 + SDR
node .../render-film.mjs --url ... --out out/film --name myfilm
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

`PW`：如果 `playwright-core` 不在 node 的解析路徑上，就指定它的 `index.mjs`（例如 `<任何裝了 playwright-core 的專案>/node_modules/playwright-core/index.mjs`）。
Chromium 會自動找 `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` 裡最新的一個，也可以用 `--chrome` 指定。

### 頁面需要提供的介面

```js
window.__ready = true;                                   // 場景建好
window.__filmRanges = (fps) => shots.ranges(fps);        // [{shot, name, from, to}]
window.__film = async ({ w, h, fps, samples, shot, from, to, out, hdr, sdr }) => ({ hdr: 0, sdr: 0, stages });
window.__still = async (t, { w, h, samples }) => {};     // 畫一張 SDR 到畫布
window.__filmProgress = { frame, at };                   // 每格更新
```

`example/film.js` 是完整的實作，換成自己的場景時，只需要改 `setWorld(t)` 和鏡頭表。

## 驗證（實測結果）

- `ffprobe -count_frames`：格數 = 片長 × fps（範例 6 秒 × 30 = 180 格）。
- HDR10 要檢查 `yuv420p10le`、`bt2020nc`、`smpte2084`、`bt2020`，而且第一格要有 `mastering_display_metadata` 和 `content_light_level_metadata`（`ffprobe -show_frames -read_intervals "%+#1"`）。
- SDR 要檢查 primaries 和 transfer 都是 `bt709`，**不能是 unknown**（見下方問題表）。
- 抽格檢查：`ffmpeg -ss T -i x.mp4 -frames:v 1 f.png`。
  HDR 要先做色調映射才能看：`zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`。
- 續跑：同樣的指令再跑一次，應該立刻結束，沒有任何段落被重算。
- 效能：範例 1280×720、16–32 張子畫面，約 0.03 秒一格。原專案 4K、32–96 張、場景 180 萬個三角形，算完整片要好幾個小時，所以才需要分段續跑。

## 問題（做這份 skill 時實際遇過）

| 症狀 | 原因 | 修法 |
|---|---|---|
| SDR 檔的 transfer 和 primaries 顯示 unknown | 這版 ffmpeg 加 libx264，`-color_primaries`／`-color_trc` 不會寫進串流的 VUI（原專案也有這個問題） | 另外加 `-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709` |
| SDR 顏色微微偏掉 | rgba 轉 yuv 時，swscale 預設用 BT.601 矩陣，但檔案標記成 BT.709 | 在 `format=yuv420p` 前面加 `scale=out_color_matrix=bt709:out_range=tv` |
| 淺景深或快速運動出現一層層殘影 | 子畫面不夠 | 該鏡頭的 `samples` 提高（96 以上） |
| 影片上下顛倒 | GL 讀回的列由下往上 | ffmpeg 加 `vflip` |
| HDR 檔在播放器裡顏色很淡 | 播放器不支援 HDR，或檔案缺少 HDR 標記 | 檢查標記；不支援 HDR 的平台改用 SDR 檔 |
| 沒有 zscale 濾鏡 | ffmpeg 編譯時沒有 libzimg | 改用 `scale=out_color_matrix=bt2020:out_range=tv,format=yuv420p10le` |
| 算到一半整頁重載 | Vite HMR | 把 WebSocket 換成假的（驅動腳本已內建） |
| 偶發一格全黑 | NaN 經由後製擴散 | 累積和調色已內建 NaN 防護；自己加的後製也要防 |
