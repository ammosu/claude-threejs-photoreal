# 錄影腳本：型態與共用骨架

全部用 `playwright-core` ＋本機 Chromium（海灘範例專案：`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`）。
dev server 要先在跑（海灘範例專案：`npx vite --port 5191 --strictPort`）。

## 共用骨架

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/game.html?auto=1&time=4`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__READY__);
  await page.evaluate(() => { window.__TIME__ = 4; });
  // ... 每格 ...
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
```

- 開始前 `rm -rf` 輸出資料夾，避免上一次較長的錄影殘留尾巴影格。
- 影格檔名 `%05d`，ffmpeg 直接吃。存 JPEG（quality 88–92）比 PNG 快很多；要再合成多次、或要逐 byte 比對時存 PNG。
- 每 30 格印一次進度與經過秒數，長片才知道還要多久。

## 後端探測與 fallback

```js
async function launchRenderer(backend) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: backend === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
                                    : ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  try {
    const probe = await browser.newPage();
    const renderer = await probe.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    await probe.screenshot();          // gl-egl 在沒 GPU 的機器上是截圖時才失敗
    await probe.close(); return { browser, renderer };
  } catch (e) { await browser.close(); throw e; }
}
// RECORD_RENDERER=gpu|swiftshader 強制指定；沒指定就 GPU 失敗退 SwiftShader 並印警告
```

錄完寫 `render-info.json`：`{renderer, fps, frameCount, lastTime, width, height, renderSeconds}`。
實例：海灘範例專案 `scripts/record-path.mjs`。

## 型態 1：鏡頭路徑飛覽（無遊戲狀態）

路徑檔：`{fps, keys:[{t, pos:[x,y,z], target:[x,y,z]}], captions:[{from,to,title,text}]}`。
在頁面裡裝一個 `__SETFRAME__(t)`，用 Catmull-Rom 內插 pos 與 target：

```js
window.__SETFRAME__ = t => {
  const p = sample(t, 'pos'), q = sample(t, 'target');
  p[1] = Math.max(p[1], groundHeight(p[0], p[2]) + 0.8);   // 相機不鑽地（0.8 m 是該專案的值）
  camera.position.fromArray(p); camera.lookAt(...q);
  window.__TIME__ = t;                                     // 相機與水面用同一個 t
};
for (let f = 0; f <= n; f++) {
  await page.evaluate(t => { window.__SETFRAME__(t);
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, f / fps);
  await page.screenshot({ path: `${out}/${String(f).padStart(5,'0')}.jpg`, type: 'jpeg', quality: 92 });
}
```

- **兩次 rAF**：第一次 rAF 時頁面的 frame() 讀到新的 `__TIME__` 並畫；等到第二次 rAF 回呼，那一格一定已經畫完送出，再截圖。
- 第二個參數覆寫 fps：`node record-path.mjs B 0.5` 就是預覽。
- 其他 port 的版本（同場景不同實作）：`SCENE_URL=... SETTLE_MS=...`，載入後多等一下再開始。
- 多版本平行跑（三個 process），GPU 上 60 秒影片約 2.5 分鐘（海灘範例專案 實測）。

## 型態 2：遊戲劇本（按鍵＋step）

```js
const g = (fn, arg) => page.evaluate(fn, arg);
const frame = async (dt = 1/FPS) => {
  await g(dt => { if (dt) window.__GAME__.step(dt);
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, dt);
  await page.screenshot({ path: `${out}/${String(n++).padStart(5,'0')}.jpg`, type: 'jpeg', quality: 90 });
};
const hold = async s => { for (let i = 0; i < s * FPS; i++) await frame(); };
const ffwd = s => g(s => window.__GAME__.step(s), s);          // 推進但不截圖
```

- 輸入用真的按鍵：`page.keyboard.down('KeyW')` → 若干 `frame()` → `up`。遊戲每次 update 讀按鍵狀態，所以按住期間每個 step 都算數。
- 走向目標：每格讀玩家位置，算目標方向，**相機 yaw 平滑轉過去**（每格轉差值的 12%）再 `view(yaw)`，畫面不會甩。
- **段落剪接**：在頁面上疊一個全螢幕黑 div，`opacity` 0→1 淡出（0.4 秒，每格都截）→ 黑幕中 `teleport`、`ffwd()` 快轉
  → 1→0 淡入。長途划船、爬下梯子這種無聊段落就這樣跳過，影片時間軸上沒有跳格。
- 這種腳本**依賴 step 與畫面迴圈不重複推進**（hooks.md 第 2 節），否則整段兩倍速。

實例：海灘範例專案 `scripts/record-game.mjs`。

## 型態 3：多版本並排，用固定格數對齊

並排比較時，各版本**必須同一格是同一個時刻**。「走到目標就停」會因為各版本碰撞體不同而差幾格，之後全部錯位。
改成每段固定格數，到了目標就放開按鍵原地站著：

```js
const walk = async (x, z, frames) => {
  await page.keyboard.down('KeyW');
  for (let i = 0; i < frames; i++) {
    const [px,,pz] = await g(() => window.__EXPLORE__.player.toArray());
    if (Math.hypot(x-px, z-pz) > 0.5) { /* 轉 yaw */ } else await page.keyboard.up('KeyW');
    await frame();
  }
  await page.keyboard.up('KeyW');
};
```

HUD 用 `page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' })` 藏掉，只留畫面。
實例：海灘範例專案 `scripts/record-walk.mjs`，三組各錄一次再 `tools/make_walk.py` 並排。

## 型態 4：事件觸發＋DRY 模式

有些動作要「等畫面上出現提示才按」（動物浮出水面才能觀察）。各版本模型高度不同，觸發時間會不同，
但**船與鏡頭的路線必須相同**：路線只由格數決定，按鍵只看提示。

```js
const label = await g(() => { const p = document.querySelector('#target-prompt'); return p.hidden ? '' : p.innerText; });
if (/觀察/.test(label) && t - last >= GAP) { last = t; await page.keyboard.press('KeyE'); log.push([+t.toFixed(2), label]); }
```

- 觸發間隔下限（海灘範例專案 GAP = 2.5 秒）：連按會讓字幕卡擠在一起。
- `DRY=1`：跑同一套邏輯但不截圖，印出 `log` 與任務完成數。先 DRY 確認三組都能完成（7 種都觀察到），再正式錄。
- 錄完把 `log` 寫成 `video/opensea_<g>.json`，合成時字幕依實際觸發時間顯示。
- 腳本最後斷言任務完成，沒完成就 throw，不要默默產出一支缺內容的影片。
- 不錄的前段（上船、划到起點）用 `step()` 快轉。

實例：海灘範例專案 `scripts/record-game-opensea.mjs`、`tools/make_opensea.py`。

## 型態 5：只靠 step 畫（關掉頁面 rAF）＋重拍到兩張相同

用在獨立的小場景（海灘範例專案 潮池），或 iframe 內：

```js
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });   // 頁面迴圈不再畫
// 每格：先跑時間表上到期的動作，再 step
await page.evaluate(dt => window.__TIDEPOOL__.step(dt), i ? 1/fps : 0);
const shots = []; let pick = null;
for (let k = 0; k < 6 && !pick; k++) {
  if (k) await page.evaluate(() => window.__TIDEPOOL__.step(0));               // 同一時間重畫
  const buf = await page.screenshot();
  pick = shots.find(s => s.equals(buf)); shots.push(buf);
}
if (!pick) { /* 6 張都不同：取檔案大小居中的那張 */ }
```

- 動作時間表 `TIMELINE = [[虛擬秒, 動作, 參數], ...]` 從錄影腳本 `export`，其他腳本（遊戲裡的同一段）`import` 同一份，三組動作完全同步。
- 嵌在遊戲主頁的 iframe：進入 iframe 後改呼叫 `iframe.contentWindow.__TIDEPOOL__.step(dt)`，主頁的遊戲不再 step；
  淡黑時呼叫 `step(0)`，iframe 時鐘凍結。

實例：海灘範例專案 `scripts/record-tidepool.mjs`、`scripts/record-game-tidepool.mjs`。
