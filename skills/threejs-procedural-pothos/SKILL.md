---
name: threejs-procedural-pothos
description: 在 three.js 用程式生成黃金葛（或其他垂吊、蔓生的觀葉植物）：藤蔓用「軟繩」模型生長（靠近盆子時硬、之後被重力拉垂、節點彎折、尾端朝光源翹起），會滑過盆緣、層板、桌緣、牆面而不穿模；心形葉片是摺疊與捲曲的高度場，有六種變化，法線貼圖負責葉脈與斑紋，用探針點避開牆與家具；葉柄、氣根、盆器與土壤也一併生成。含可重用模組、三種擺放情境的範例、穿模檢查。當使用者說「黃金葛」「pothos」「垂吊植物」「藤蔓」「蔓生植物」「室內盆栽」「葉子從架子垂下來」「植物穿進牆裡」「three.js 盆栽」「程式生成室內植物」時使用。
---

# 程式生成黃金葛（three.js）

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），`src/scene/parts/plants.js`。
原專案的三盆黃金葛擺在高架、窗台、牆上層板，光照來自烘焙。這裡改成通用版本：
- 拿掉原本寫死的房間配置。
- 改用一般光源照明。
- 新增 `buildPothos()`，一次組好所有網格。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/pothos.js` | `makeLeafLibrary()`（6 種葉片：幾何、顏色、法線、粗糙度）、`Env`（避障）、`growVine()`、`growPlant()`、`buildPothos()`、`potMaterials()`（石紋、鼠尾草綠釉、陶土、土壤）、`soilDisc()`、`lathe()`、`U`（時間、擺動量） |
| `scripts/util.js` | RNG、value noise、fbm、worley、貼圖工具、`tube()` |
| `example/` | 牆角裡的三盆：高架垂吊並往光源伸、桌上越過桌緣垂下、牆上層板 |
| `references/growth.md` | 藤蔓生長模型、`vines` 和 `growPlant` 的參數、葉片怎麼放 |
| `references/leaf.md` | 葉形公式、六種變化、斑紋與葉脈、材質 |
| `references/verify-engines.md` | 驗證方式、常見問題、效能、搬到 Godot／Unreal |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5423 --bind 127.0.0.1
# http://127.0.0.1:5423/example/   ?cam=room|shelf|table|wall  ?t=3  ?ui=0
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

`window.__pothos` 會帶出葉片數、藤蔓數、生成耗時，以及藤蔓穿模點數（`vinePointsInside`，必須是 0）。

## 用法

```js
import { Env, buildPothos } from './scripts/pothos.js';
const env = new Env({ minX: 0, minZ: 0, maxY: 2.6,                   // 牆面（x = 0、z = 0）與天花板
  boxes: [{ b: [x0, y0, z0, x1, y1, z1], faces: '-x+x+y+z' }],        // 層板、桌子：只能從列出的面被推出去
  pots: [{ x, z, rOut, rIn, y0, yRim, ySoil }] });                    // 盆子：藤蔓可以從盆緣爬出，葉片則視為實心
const { group, stats, paths } = buildPothos([{ seed: 4041, cx: x, cz: z, rIn, rimY: yRim, soilY: ySoil, env,
  light: new THREE.Vector3(...), bias: new THREE.Vector3(0.6, 0, 0.8).normalize(),
  size: [0.078, 0.118], stemR: [0.0027, 0.0015], inter: [0.032, 0.054], bare: 0.07, seg: 0.014,
  vines: [{ th: 30, el: 36, len: 1.3, b0: 0.22, b1: 0.1, ramp: 0.3, hook: 0.38 }, ...],
  shoots: { n: 22, th: [-105, 105], len: [0.06, 0.2] } }]);
scene.add(group);   // 每一幀更新 U.uTime.value（秒），葉片會有很輕微的擺動
```

## 一定要遵守

1. **周圍所有東西都要寫進 `Env`**：牆、層板、桌子、窗簾、旁邊的盆子。藤蔓和葉片只會避開 Env 裡有的東西，沒寫進去的就會穿過去。
2. **`faces` 只列出藤蔓可以被推出去的方向**。例如貼牆的層板不要列 `-z`，否則藤蔓會被推到牆和層板之間的縫裡。
3. **`light` 設在真正的光源位置**（窗戶）。葉面和藤蔓尾端都會轉向它，設錯的話整盆看起來是在背光。
4. 葉片放不下（12 次調整後探針仍然撞到東西）就直接不放。所以空間太擠時葉片會變少，這是正常的，不是 bug。
5. 隨機一律用 `seed`，同一個 seed 每次長得一樣。

## 實測（範例）

三盆共 596 片葉子、87 條莖，生成 0.11 秒。藤蔓穿模檢查 1994 個點，0 個在牆或家具裡面。
