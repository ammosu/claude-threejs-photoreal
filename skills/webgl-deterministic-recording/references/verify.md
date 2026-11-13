# 無頭回歸驗證腳本

沒有單元測試框架也可以：一支 Node 腳本、`playwright-core`、`node:assert/strict`，跑真的頁面、真的輸入、真的 WebGL。
驗證用 SwiftShader（可重現、不需 GPU），每次改場景重跑，截圖一起 commit。

實例：海灘範例專案 `scripts/verify-game.mjs`（七個任務、三組角色、手機、缺檔）、
`verify-explore.mjs`、`verify-tidepool.mjs`。

## 骨架

```js
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
function monitor(page, missingOk = false) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' &&
    !(missingOk && /404|Failed to load resource/.test(m.text()))) errors.push(m.text()); });
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); monitor(page);
  await page.goto(`http://localhost:${process.env.PORT || 5191}/game.html?auto=1&time=4`);
  await page.waitForFunction(() => window.__READY__);
  await page.evaluate(() => window.__TIME__ = 4);
  // ... 劇本與斷言 ...
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ ...measurements, checks: [...] }, null, 2));
} finally { await browser.close(); }
```

- `PORT`、輸出資料夾（`GAME_SHOTS`）用環境變數，同一支腳本可以驗另一個 worktree 的版本。
- `results.json` 寫下量測值（接觸距離、IK 誤差、CPU 每次 update 的毫秒數）。commit 後，下次 diff 看得出數字怎麼變。

## 推進時間：只用 step，不用 waitForTimeout

```js
const step = async s => {
  await page.evaluate(s => window.__GAME__.step(s), s);
  const audit = await page.evaluate(() => window.__GAME__.cameraAudit);   // 每步順便檢查不變量
  assert(audit.minObserved >= audit.minimum - 1e-5, JSON.stringify(audit));
};
const at = (x, z) => page.evaluate(([x, z]) => { const g = window.__GAME__; g.teleport(x, z); g.step(.35); }, [x, z]);
```

`waitForTimeout` 依賴機器速度；`step(1.5)` 永遠是遊戲裡的 1.5 秒。SwiftShader 很慢也不影響結果。
`teleport` 跳過無關的走路，但**互動本身走真的路徑**：按 `KeyE`、按住 `KeyW`，不直接改狀態。

## 該斷言什麼

| 類別 | 例子（海灘範例專案） |
|------|------|
| 任務能完成 | 撿完 8 個貝殼 `state.shells === 8`；划到小島再回來；`completed` 為真、完成畫面可見 |
| 輸入路徑 | 按住 W 1.5 秒後有腳印；按 S 把船拉回（位置往岸上移 > 0.5 m）；手機虛擬搖桿 `pointerdown/move/up` 後玩家移動 > 1 m |
| 規則限制 | 在海上按 E 下船要被拒絕；走到岬角不會爬上小島 |
| 確定性 | `step(0)` 前後角色姿勢 `deepEqual`；`wave(x,z,4)`、`wave(x,z,6)`、`wave(x,z,4)` 第一與第三相同、與第二不同 |
| 幾何接觸 | 坐下、站上塔頂時腳與表面距離 < 0.1 m；穿模計數 |
| 鏡頭 | 整段劇本中鏡頭到角色的最小距離 ≥ 1.6 m（多個水邊位置各轉一圈） |
| 切換與保留 | 鍵盤切換 A/B/C 後玩家位置與進度不變；iframe 關閉後 `src` 是 `about:blank`、重開進度還在 |
| 缺檔 | `page.route('**/assets/tripo/*.glb', r => r.fulfill({ status: 404 }))` 後仍可完成互動、角色退回備用模型；這時才放行 404 |
| 版面 | 手機 viewport 下 `document.documentElement.scrollWidth <= innerWidth` |
| 頁面錯誤 | 最後 `assert.deepEqual(errors, [])` |

## 截圖

- 截圖函式內建「等兩次 rAF ＋ `gl.finish()` ＋檔案過小重拍」（gotchas 第 5 條），失敗就斷言失敗，不要存一張空白圖當結果。
- 固定時間（`?time=4`、`__TIME__=4`）、固定 viewport（1280×720、`deviceScaleFactor: 1`）、同一個 Chromium，截圖才能前後比較。
- 截圖要**有人看**：腳本通過只代表斷言成立，畫面對不對（穿模、浮空、黑格）要看圖。把截圖拼成總表一次看完（`scripts/sheet.py <shots dir> /tmp/s.jpg 30 '*.png'`）。

## 量測工具腳本（probe）

回歸腳本之外，針對單一問題寫 probe：固定幾個情境 × 各組，印數字並存近照，修之前跑一次當基準，修完再跑。
海灘範例專案 例子：`probe-clip.mjs`（穿模深度）、`probe-ground.mjs`（物件底部離地距離）、`probe-ik.mjs`（IK 誤差）、`probe-sea.mjs`。
用 `?auto=1` 的 API 回傳量測值（例如 `__GAME__.penetration()`），不要靠截圖目測。

## 交給其他代理（codex 等）時

- 附上驗證腳本與錄影腳本，要它自己跑、自己看截圖。海灘範例專案 的 Opus 版沒附錄影器，30% 黑格是交回來之後我們錄影才發現，多花一輪修。
- 它的沙箱多半沒有 GPU：只跑 SwiftShader 驗證與低格率預覽，正式錄影自己來。
- 「不能改」清單寫明 hook（`__TIME__`、`__READY__`、`__SCENE__`、`step`）與 port。
