---
name: threejs-procedural-textures
description: 在 three.js 用程式即時生成照片級材質貼圖（不用任何圖檔）：可無縫重複的雜訊、以公釐為單位的高度場轉 normal map、粗糙度與 AO 打包、Canvas2D 轉貼圖、平均反照率（給光照烘焙用）、接縫檢查。內含現成的材質：滾筒漆木屑壁紙加上大尺度的灰泥與漆色變化、烤漆橘皮紋、手摸過的粗糙度、積灰、橡木地板（交錯接縫、每片紋理不同、節疤、四邊微倒角）、通用木紋、對拼橡木貼皮、平織、鬆餅格、毛巾布、羅紋、針織、毛氈、棉繩、使用痕跡（灰塵、油脂、指紋、碎屑、棉絮、頭髮、杯印、細刮痕，同時畫進顏色與粗糙度）、斑點釉、粉體塗裝刮傷、書封圖集與對應 UV 的書本幾何、書頁邊、地形圖海報、照片、假文字。當使用者說「程式生成貼圖」「procedural texture」「不用圖檔的材質」「normal map 怎麼產生」「木地板／木紋貼圖」「牆面看起來太假」「布料材質」「針織／毛巾布 normal map」「使用痕跡」「刮痕／指紋／灰塵」「粗糙度貼圖」「書封／書背」「假文字」「貼圖有接縫」「Canvas 畫貼圖」時使用。
---

# 程式生成材質貼圖

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），出自 `src/core/tex.js`、`rng.js`、`src/scene/materials.js`，以及 `parts/` 底下各零件的材質函式。
原專案的臥室裡一張圖檔都沒有，所有貼圖都在載入時用程式生成。

**核心想法：**
1. **用物理單位設計。**高度以公釐計，貼圖一格代表幾公尺都寫清楚，UV 也用公尺。這樣 `repeat = 1 / tile公尺`，換解析度也不會改變外觀。
2. **大部分的「真實感」在粗糙度，不在顏色。**指紋、擦拭痕、積灰在顏色上幾乎看不出來，要等高光掃過才會顯現。
3. **一律可以重複、可以重現。**雜訊都有週期，亂數一律走 `RNG(seed)`，同一個 seed 每次產生的結果都一樣（光照烘焙、截圖回歸都靠這一點）。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/tex.js` | 基礎：`RNG`、`pnoise`／`pfbm`（每軸可以有不同週期）、`worley`、`vn`（查表的快速雜訊）、`field`、`normalBytes`（公釐單位）、`dataTex`／`canvasTex`／`packTex`／`colorTex`、`avgColor`、`once`（快取）、`rep`（共用圖片、只改 repeat）、`seamScore`、`texData` |
| `scripts/surfaces.js` | `wallNormal`＋`wallPatch`（木屑壁紙加上 3.2 m 尺度的灰泥與漆色變化）、`lacquerNormal`、`smudgeRough`、`dustRough`、`floorMaps`、`woodMaps`、`oakVeneer` |
| `scripts/textiles.js` | `weaveNormal`、`waffleNormal`、`terryNormal`、`ribNormal`、`knitNormal`、`feltNormal`、`ropeNormal`、`fabricMaterial`（sheen 加逆光透光） |
| `scripts/wear.js` | `wornMaps`（一整面用過的表面：顏色與粗糙度兩張）、`speckleTexture`、`scuffTexture`，以及基本筆刷 `softBlob`、`strand`、`fingerprint`、`noiseTile`、`overlay` |
| `scripts/print.js` | `word`／`phrase`（用音節拼出的假字）、`PAL`、`packer`、`fitText`、`paperGrain`、`makeBook`＋`bookAtlas`＋`bookGeometry`、`pagesTexture`、`topoPoster`、`photoPrints` |
| `example/` | 房間一角，每個表面都用程式庫裡的一種材質。`?cam=`（room、desk、glint、fabric、floor、wall、books）；`?flat=1` 換成純色對照 |
| `example/preview.jpg` | 範例截圖 |
| `references/recipes.md` | 每種材質的做法、尺寸、參數，以及怎麼自己加新的 |
| `references/verify-engines.md` | 驗證方式、遇過的問題、效能，以及搬到 Godot／Unreal |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5422 --bind 127.0.0.1
# 開 http://127.0.0.1:5422/example/   （window.__tex 有每張貼圖的生成時間、接縫分數、平均反照率）
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

## 用法

```js
import { rep } from './scripts/tex.js';
import { floorMaps, wallNormal, wallPatch, lacquerNormal } from './scripts/surfaces.js';
import { knitNormal, fabricMaterial } from './scripts/textiles.js';
import { wornMaps } from './scripts/wear.js';

const fl = floorMaps();                                   // UV 用公尺；repeat 已經設好
floor.material = new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughnessMap: fl.roughnessMap, roughness: 1 });
wall.material = wallPatch(new THREE.MeshStandardMaterial({ color: 0xebebe6, roughness: 0.93, normalMap: wallNormal() }));
door.material = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6, normalMap: rep(lacquerNormal(), 9), normalScale: new THREE.Vector2(0.18, 0.18) });
sweater.material = fabricMaterial(0x6f7f6a, { normal: knitNormal(), tileM: 0.1 });
const w = wornMaps({ sizeM: [1.2, 0.6], hands: [[0.55, 0.5]], rings: [[0.9, 0.4, 0.032, 0.6]], prints: 6 });
deskTop.material = new THREE.MeshStandardMaterial({ map: w.map, roughnessMap: w.roughnessMap, roughness: 1 });
```

- 有 `roughnessMap` 的材質，`roughness` 要設成 1。three.js 會把兩者相乘。
- `packTex` 和 `wornMaps` 的粗糙度放在 G 通道，灰階 canvas 也可以直接用。
- 每個材質都會回傳 `avg`（線性的平均顏色），給 `threejs-baked-gi` 當反彈光的反照率。

## 一定要遵守

1. **不能用 `Math.random()`。**每張貼圖都要有固定的 seed。
2. **雜訊的週期必須是整數，而且和貼圖的格數對齊**（例如 `pfbm(u*6, v*6, oct, seed, 6)`）。不對齊就會有接縫。要用 `seamScore` 檢查。
3. **高度以公釐計，用 `normalBytes(H, w, h, 每格公釐數)`。**換解析度時凹凸的強度不會跟著改變；有些材質本來就不是方形格子（地板 1.1 × 1.9 mm），兩個軸要分開給。
4. **粗糙度要和顏色一起畫。**`wornMaps` 每一筆都同時畫進兩張 canvas，而且用同一個 `new RNG(i)`，兩張的形狀才會對齊。
5. **深色的表面，碎屑和亮點要減量**（範例的深色桌面從 9000 降到 2500），不然看起來會像花崗岩。
6. **Canvas 畫的文字和圖案一律自己編**（`word()`、幾何圖形），不要放真實的書名、品牌或商標。
7. 最大的貼圖（2048²）建立需要 0.1–0.35 秒，同一張用 `once` 快取，再用 `rep()` 共用。不要每個物件各產生一次。

## 實測（RTX 4090、Chrome headless，範例整體 1.1 秒）

| 貼圖 | 尺寸 | 時間 | 接縫分數 (x/y) |
|---|---|---|---|
| `floorMaps` | 2048² × 3 張 | 0.32 s | 顏色 0.96／1.10、法線 1.00／1.02、粗糙度 0.89／1.05 |
| `woodMaps` | 1024² × 3 | 0.20–0.23 s | 顏色 0.93／1.12、法線 1.30／1.06 |
| `wornMaps`（1.2 × 0.6 m，3400 px/m） | 4080×2040＋一半大小的粗糙度 | 0.13 s | 不重複 |
| `oakVeneer` | 1024² × 3 | 0.10 s | 0.98–1.06 |
| `wallNormal` | 1024² | 0.04 s | 1.00／1.07 |
| `lacquerNormal`、`smudgeRough` | 512² | 0.02–0.04 s | 0.98–1.04 |
| 織物 7 種 | 128²–512² | 1–19 ms | 0.94–1.10（棉繩的 y 是 2.03，是刻意的溝，見 verify-engines.md） |
| `bookAtlas`（12 本） | 2048×1536 | 0.05–0.08 s | — |

接縫分數約等於 1 表示看不出接縫，大於 2 就要檢查。計算時分子分母各加 1 個色階，避免順紋木頭這類幾乎沒有起伏的方向，因為小於 1 個色階的雜訊而算出很大的比值。
