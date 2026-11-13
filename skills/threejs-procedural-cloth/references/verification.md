# 驗證

## 數據（`window.__cloth`）

| 欄位 | 目標 | 不對時 |
|---|---|---|
| `penetrations` | 0 | 平坦區有頂點低於床墊面。檢查 `hemElev` 的下限（2.4 mm）、負值皺褶是否太深、sag 是否和 drape 一致 |
| `uvStretch.p5 / p95` | 約 0.9 / 1.1 | 沒有攤平，或翻折片疊在高的東西上 |
| `maxElevation` | 棉被 < 0.27 m | `LOBE_SCALE` 或長折振幅太大、soft cap 沒套用 |
| `ms` | < 1 s | 主要時間花在 UV 攤平和皺紋貼圖：可降 iters 或 N |
| `tris` | 視用途 | 網頁 10–15 萬可以接受；遊戲請看 engines.md |

## 固定鏡頭（`?ui=0&cam=...`）

逐張檢查：
- `top`：輪廓、翻角形狀、兩側垂下的量。
- `side` / `left`：垂布長度，以及有沒有撞進床架。
- `close` + `tex=checker`：10 cm 的格子要大致等大，翻折片上不能有拉成條狀的格子。
- `stage=1..4`（`cam=wide`）：每一階段都應該比前一階段更像被子。若某一階段反而變差，就是該階段的參數有問題。

用 Playwright 批次截圖：
```js
for (const q of ['stage=5&cam=wide', 'stage=5&cam=close&tex=checker', 'stage=1&cam=wide']) {
  await page.goto(`http://127.0.0.1:5420/example/?ui=0&${q}`);
  await page.waitForSelector('body[data-ready="1"]');
  await page.screenshot({ path: `shot-${q}.jpg` });
  stats[q] = await page.evaluate(() => window.__cloth);
}
```
拼成 2×2 總表一次看完，比逐張開檔更快發現問題。

## 症狀對照（做這個範例時實際遇過的）

| 症狀 | 原因 | 修法 |
|---|---|---|
| 翻角附近的花紋被拉成深色長條 | 翻折片疊在大捲上，但平整區只蓋到 q > −0.46，翻折片其實延伸到 −0.55 | 用 `QMAX` 依翻折深度自動計算平整區範圍 |
| 被子兩側幾乎沒有垂下 | 輪廓只比床寬 15 cm，扣掉圓角包覆的 11 cm 後所剩無幾 | 每側多出 30 cm 以上 |
| 垂布插進床架 | 床架和床墊一樣寬 | 床架做窄一點，或把床架寫進支撐物 |
| 看起來像山脈或岩石 | 沒有削峰、團塊剖面太尖，或皺褶用了雜訊 | 先做 `erodePeaks`；團塊用範例的剖面 |
| 看起來像塑膠 | 沒有 cavity、沒有 sheen、roughness 太低 | 用 `cottonMaterial`，roughness 0.9 |
| 網格上看得到格子面 | B 用雙線性取樣 | 改用 `Field.cubic` |
| 每次重新整理形狀都不同 | 某處用了 `Math.random()` | 全部改用 `RNG(seed)` |
| 印花整片偏移 | 攤平後沒有把 UV 平均值移回原位 | `relaxUV` 已經內建，自己改寫時記得保留 |
| three r18x 警告 PCFSoftShadowMap | 新版已移除 | 不要設定 `shadowMap.type` |
