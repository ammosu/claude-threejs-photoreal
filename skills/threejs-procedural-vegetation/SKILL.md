---
name: threejs-procedural-vegetation
description: 在 three.js 用程式生成寫實的落葉樹（不用模型檔）：分枝骨架（樹幹→主枝→枝→細枝）長成樹皮管，十幾萬片葉片用 InstancedMesh 卡片＋Canvas2D 畫的葉片圖集（複葉、單葉、葉叢），風在 vertex shader 分四層擺動（樹冠→主枝→枝→葉片翻動）且只依時間決定，影子跟著動，含樹種參數、遠近三級 LOD、葉片透光／背面偏淡／天空反光、可重用程式庫與範例。當使用者說「程式生成樹」「procedural tree」「three.js 樹木／森林／樹林」「樹葉被風吹」「樹太假／像棉花糖」「葉子貼圖」「leaf atlas」「樹的 LOD」「大量樹葉效能」「風吹動畫」「樹的影子」時使用。
---

# 程式生成樹木（three.js）

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），`src/scene/parts/exterior.js`。
原專案的樹只從窗戶看，葉子的光照來自烘焙。這裡改成通用版本：
- 任意地面高度。
- LOD 改用回呼函式決定。
- 葉片改用一般的太陽光加天光照明，以「樹冠內的深度」代替烘焙的天空可見度。
- 陰影用的深度材質也跟著風動。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/util.js` | RNG（mulberry32）、value noise、fbm、向量小工具、DataTexture、高度場轉 normal map |
| `scripts/atlas.js` | `buildAtlas()`：4×4 葉片圖集，含顏色、法線、參數三張（參數存葉片薄度、光澤、隨機 id），mip 會保留覆蓋率；`barkMaps()` 產生樹皮貼圖 |
| `scripts/tree.js` | `makeTree(S, bark, leaves, { lodAt, keep })`、`SPECIES`、`Bark`（樹皮管）、`Leaves`（instanced 卡片）、`Soup` |
| `scripts/materials.js` | `U`（共用 uniforms：時間、風、太陽、天空色）、`barkMaterial()`、`leafMaterial()`，各自附陰影用的深度材質 |
| `example/` | 三棵主樹（刺槐、椴樹、白蠟），外加中景一圈、遠景一排，放在草地上 |
| `references/structure.md` | 骨架怎麼長：樹種參數、主枝分布、枝、細枝、葉片卡片的朝向與色調 |
| `references/atlas-shading.md` | 葉片圖集怎麼畫、mip 覆蓋率、葉片 shader 的每一項 |
| `references/wind.md` | 四層風：屬性怎麼帶、數值、怎麼確認有在動 |
| `references/perf-engines.md` | 數量與效能、LOD、Godot／Unreal 怎麼做 |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5422 --bind 127.0.0.1
# http://127.0.0.1:5422/example/
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

URL 參數：
- `cam=ground|under|wide|leaf`：鏡頭預設。
- `t=12.5`：固定時間，截圖可以重現。
- `wind=0..2`：風力。
- `only=hero`：只生成主樹。
- `ui=0`：隱藏面板。

`window.__veg` 會帶出各階段耗時、葉片卡片數、樹皮三角形數、fps。

## 用法

```js
import { buildAtlas, barkMaps } from './scripts/atlas.js';
import { Bark, Leaves, makeTree } from './scripts/tree.js';
import { U, barkMaterial, leafMaterial } from './scripts/materials.js';
const bark = new Bark(), leaves = new Leaves();
makeTree({ seed: 101, lod: 0, sp: 'rob', x: 0, z: 0, y: 0, H: 14, R: 4.3, trunk: 0.5, first: 0.36, limbs: 9, az0: 0.9,
  lean: [0.03, -0.01], d2: 2.8, d3: 6, sparse: 1 }, bark, leaves, { lodAt: (x, y, z) => 2 });
const atlas = buildAtlas(), bm = barkMaterial(barkMaps()), lm = leafMaterial(atlas);
const barkMesh = new THREE.Mesh(bark.geo(), bm.material); barkMesh.customDepthMaterial = bm.depth; barkMesh.frustumCulled = false;
const leafMesh = leaves.build(lm.material, cameraPos); leafMesh.customDepthMaterial = lm.depth;
// 每一幀：U.uTime.value = 秒數；太陽改變時同步 U.uSunDir 和 U.uSunCol
```

`lod` 的三個等級：
- `0`：主樹，從樹幹一路長到細枝，每片葉都是一張卡片。
- `1`：中景，長到枝為止，葉子用葉叢卡片。
- `2`：遠景，只長主枝，葉子用大的葉叢卡片。

## 一定要遵守

1. **全部隨機走 `RNG(seed)`**：同一個 seed 每次長得一樣，截圖、烘焙、多人連線才能一致。
2. **同一根細枝上的頂點和葉片共用同一組風參數**（aW1／aW2／aW3）。不共用的話，葉子會跟枝條分家。
3. **陰影一定要配深度材質**（`customDepthMaterial`）：不配的話，影子是方形卡片，而且不會隨風動。
4. **葉片圖集的 mip 要保留覆蓋率**（`buildAtlas` 已經處理）。沒處理的話，遠一點的樹會因為 alpha test 而稀疏到幾乎消失。
5. **卡片要由近到遠排序**（`leaves.build(mat, eye)`）：讓 early-z 先擋掉被遮住的片段，對 alpha test 的大量卡片效能影響很大。
6. **太陽改變時同步 `U.uSunDir`**，葉片的透光才會出現在正確的那一側。
7. 細枝的樹皮管最多切 6 邊。太細的管子用太多邊只會浪費三角形；需要烘焙時，BVH 也比較好切分。

## 實測（範例，RTX 4090，960×640）

- 三棵主樹共 6 萬張葉片卡片；加上中景和遠景共 8.6 萬張，樹皮 13.7 萬個三角形。
- 生成時間：樹 0.14 秒、圖集 0.23 秒、樹皮貼圖 0.05 秒。
- 含 4096 陰影貼圖約 44 fps（Playwright 無頭模式，實際瀏覽器會更高）。
- 原專案：11.8 萬張葉片卡片、樹皮 15 萬個三角形，在 Radeon 780M 內顯上配合動態解析度維持幀率。
