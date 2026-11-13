# 天空

## 解析式天空（烘焙器看到的）

```
y ≥ 0：radiance = mix(horizon, zenith, sqrt(y)) + glow · max(dot(d, glowDir), 0)²
y < 0：radiance = ground
```

- 和 `threejs-baked-gi` 的 `worker.js` 裡的 `sky()` 一模一樣；`skyRadiance(S, d)` 是 JS 版本。
- 單位是線性 RGB。白天的 horizon 約 1，室內烘焙出來的地板 E 約 0.02（只有天光）到 0.1（有陽光）。
- `bakeCfg(S)` 會產生 `{ sky, sun }`。
  - 太陽的方向就是 `glowDir`（光暈在太陽周圍）。
  - `bakeDirect: false`：直射光交給即時的 `DirectionalLight`。

## 天空球（看到的）

一個背面朝內的單位球，頂點著色器用 `xyww` 把它推到無限遠，畫在所有東西後面（`renderOrder -10`）。
不參與光照，也不算烘焙的遮擋物。片段著色器由下往上疊：

| 層 | 做法 | 參數 |
|---|---|---|
| 地平線以下 | 從 horizon × 0.6 漸變到 ground | `ground` |
| 漸層 | 解析式天空本身 | `zenith`、`horizon`、`glow`、`glowDir` |
| 晴空 | 漸層乘上 `clear`，比平均深、比較藍；靠近地平線時淡成灰白（`exp(−7y)`） | `clouds.clear` |
| 高空薄雲 | 拉長的 fbm 條紋，投影在比較高的平面上（`/(y+0.3)`），幾乎不動 | `clouds.veil` |
| 雲層 | 投影在頭頂的平面上（`/(y+0.11)`），fbm5 加上 domain warp，再加一層大尺度的開合 | `cover`（門檻）、`thick`（雲心）、`edge`／`core`（絕對亮度） |
| 雲的受光 | 薄的雲邊靠近太陽方向時更亮，再加上光暈的顏色 | |
| 地平線霧帶 | `exp(−16y)` 混向 horizon | `haze` |
| 低空暖光 | 太陽方向、靠近地平線處加上 glow | |
| 太陽 | 很小的圓盤（半徑約 0.7–1°）加一圈光暈；被雲遮住時減弱 | 有 `sun` 的預設才有 |
| 顯示倍率 | 整體乘上 `display` | 室內 0.3，戶外 1 |

- 雲以 `uTime` 漂移：每秒 0.009／0.0035，乘上 `clouds.speed`。錄影時，`SKY_U.uTime` 要給固定的時間（見 `webgl-deterministic-recording`）。
- 雜訊在著色器裡即時計算（hash 值雜訊加旋轉的 fbm），不需要貼圖，也沒有接縫。

## 預設

| 名稱 | 情境 | 雲 | 天空球 ÷ 解析式 |
|---|---|---|---|
| `dawn` | 原專案的 6:51，太陽還沒出來，東北方低處有暖光 | 碎層積雲（cover 0.5）加一層薄的高空雲；雲邊銀白，雲心藍灰 | 0.934 |
| `day` | 上午，晴時多雲 | 積雲（cover 0.32），雲邊白，底部灰藍 | 1.080 |
| `overcast` | 陰天，沒有太陽 | 幾乎封閉（cover 0.92） | 1.034 |
| `golden` | 黃昏，太陽很低，橘色光暈 | 雲邊被照亮（橘），雲心偏紫 | 1.034 |

## 怎麼調

1. 先調漸層（zenith、horizon、glow），讓烘焙出來的室內符合你要的氣氛。
2. 再調雲：
   - `cover` 決定雲量，`thick` 決定雲心的範圍。
   - `edge`／`core` 決定亮暗。
   - `clear` 讓晴空比平均深。
3. 每改一次就跑 `measureDome`：
   - 比值太高：降低 `edge`／`core`，或讓 `clear` 更深。
   - 比值太低：反過來調。
4. 最後調 `display`：從室內看出去，天空要保有顏色，不能是一片白。

## 不烘焙的場景

- `skyLights(S)`：
  - 半球光：天空色取天頂和地平線的平均，強度是 π × 天頂亮度。
  - 太陽：`DirectionalLight`，強度是 `sun.irr` 的最大值，顏色是 irr 正規化之後的比例；附 4096 陰影。
- `skyEnvironment(renderer, S)`：把天空球（display 1、不畫太陽）做成 PMREM 環境貼圖。
- 植物 skill 的樹葉著色器還會讀 `U.uSkyZen`、`U.uSkyHor`、`U.uSunDir`、`U.uSunCol`，要和預設保持一致（範例有示範）。
