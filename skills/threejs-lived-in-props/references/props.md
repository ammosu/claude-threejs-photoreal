# 小物與幾何工具

## 幾何工具

| 函式 | 做什麼 | 重點 |
|---|---|---|
| `orient(g)` | 把繞向和頂點法線不一致的三角形翻過來 | 程式產生的曲面常常兩種繞向都有，不處理的話，背面剔除會吃掉一半 |
| `merge(geos, { color })` | `mergeGeometries` 的寬鬆版 | 有些有 index、有些沒有，有些有 color、有些沒有，都能合併 |
| `lath(profile, segs, maxSeg)` | Lathe，但會把長的輪廓段切細 | 頂點色、烘焙光照都存在頂點上，高的杯壁至少每 1.2 cm 要有一圈頂點 |
| `sampleGrid(fn, nu, nv, { closedU, from, face, rows })` | 在 (u, v) 格子上取樣參數曲面，算出平滑法線 | 極點和捏在一起的列會借下一列的法線；`from`／`face` 用來統一法線朝外 |
| `skin(G, uS, vS)` | 一層網格，UV 以公尺計 | |
| `gridNormals`、`refine` | 粒子網格的法線，以及一次 B-spline 加密 | 粗的模擬結果直接變平滑，不用重新模擬 |
| `thickCloth(P, W, H, opts)` | 有厚度的布 | 兩層表面再加上半圓捲邊；沒有捲邊的邊保持開口 |
| `ribbon(samples)` | 扁平帶，剖面是跑道形 | 襪子、背帶、鞋帶。每個取樣點有自己的寬度和厚度 |
| `cable(points, r)` | 電線／繩子 | 先密集取樣，再只在轉彎或每 3 cm 留一圈；用平行傳輸的座標系，管子不會扭轉 |

## 小物

### 襪子 `sock(m4, { seed, bend, leg, length, width, cuff })`
- 一條沿路徑走的扁平帶：腳踝處依 `bend` 轉彎；路徑本身帶一點正弦晃動。
- 腳跟用高斯函數鼓起；腳趾在最後 4 cm 用 `sqrt(1 − t²)` 收尖；厚度 4.4 mm 加上雜訊。
- 有些地方微微翹起（最多 1.8 mm），看起來是脫下來隨手一丟的皺。
- 前 5 cm 是羅紋袖口，分開成另一個 geometry，材質可以不同。

### 馬克杯 `mug({ glaze, tea, old })`
- 杯身用 lathe：不上釉的圈足、外壁、杯口圓唇、內壁。杯口的釉比較薄，顏色往胎色混一半。
- **茶漬**畫在頂點色裡：
  - 目前水位 `tea` 有一條深色線，高度隨圓周起伏約 ±1.2 mm。
  - 更高處 `old` 還有一條較淡的舊水位線。
  - 兩條線之間有一層薄薄的殘膜。
  - 深淺沿圓周由兩個正弦相乘變化。
- 把手是 tube，在 z 方向壓扁 1.55 倍；茶面是一個圓盤。
- 材質要開 `vertexColors: true`，搭配低粗糙度（約 0.13），像釉面。

### 保溫瓶 `bottle()`
- 瓶身用 lathe，有肩部。
- 瓶蓋只旋到一半，所以看得到兩圈螺紋（細 torus）和一點鋼瓶頸。
- 瓶蓋的防滑紋：半徑沿圓周以 60 倍頻率起伏 0.28 mm（`sampleGrid` 一圈 240 段）。
- 提環是半個 torus，瓶蓋下方露出一點墊圈。
- 回傳三個部分：塗裝瓶身、鋼、提環，各自給不同材質。配上 `threejs-procedural-textures` 的 `scuffTexture`，就有用過的刮痕。

### 紙團 `paperBall(r, seed)`
- 細分 2 次的二十面體，每個頂點乘上 `0.76 + 0.5·|2·fbm − 1|`（ridged）：會有銳利的摺痕和平坦的面。
- 材質要 `flatShading`，摺面才會分明。底部對齊 y = 0。

### 繩編洗衣籃 `ropeBasket({ H, R0, R1, TH })`
- 輪廓依序是：底、往上外擴的外壁、捲起的籃口、往下的內壁。
- 軟籃子從來不是正圓：越往上越橢圓（2、3 倍頻），整體再往一側傾斜 1.2 cm。
- 回傳 `rimR(角度)`，給 `overRim` 掛布用。
- UV 以公尺計，搭配 `ropeNormal`：v 方向每 1.4 cm 一圈繩子。

### 充電線
- 範例的做法：從插座往下垂到地面，在地上繞一個鬆鬆的圈。
- 控制點直接寫在範例裡，地上部分的高度是半徑加 0.1 mm，然後交給 `cable(points, 0.0015)`。
- 原專案的線本身不算烘焙的遮擋物（太細），但會投射即時陰影。

## 搬到 Godot／Unreal

- 全部都是純幾何，沒有用到 three.js 特有的功能，可以匯出 GLB（頂點色、UV 都會保留）。
- 要在引擎裡即時生成：`lath`、`ribbon`、`cable`、`sampleGrid` 是很直接的網格建構，可以對應到 Godot 的 `SurfaceTool`／`ArrayMesh`，或 Unreal 的 `ProceduralMeshComponent`。
- 馬克杯的茶漬放在頂點色。Godot 的 StandardMaterial3D 要開 `vertex_color_use_as_albedo`；Unreal 要在材質裡乘上 Vertex Color。
