---
name: threejs-lived-in-props
description: 用程式在 three.js 生成「有人住過」的生活小物，不需要模型檔：毛巾或衣物掛在椅背、橫桿、籃子邊上（決定性的 PBD 布料垂掛，碰撞體可以是任何 mesh，同一個 seed 每次結果相同）、有厚度和捲邊的布片、B-spline 加密、襪子、地上的充電線、留有茶漬水位線的馬克杯、旋到一半的保溫瓶、紙團、軟繩洗衣籃，以及共用的幾何工具：緞帶、管線、旋轉成形、參數曲面網格。附有房間一角的範例和垂掛的品質數據（拉伸、穿模）。當使用者說「生活感」「場景太乾淨」「加一些小東西」「雜物」「毛巾掛在椅背」「衣服披在椅子上」「布蓋在籃子上」「布料掛在桿子上」「不要物理模擬的布料垂掛」「PBD 布料」「襪子／電線／馬克杯／水壺／紙團建模」「程式生成道具」「lived-in」「clutter」時使用。
---

# 生活感小物

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），出自 `src/scene/parts/clutter.js`、`decor.js`、`desk.js`。
原專案的毛衣披在椅背上，是用一個小型、決定性的 PBD 求解器垂掛出來的，其餘小物都是參數化幾何。
這裡把求解器改成通用版：碰撞體可以是任何 mesh，搭配兩種起始姿勢（橫桿、圓形邊緣），再加上原專案的小物和幾何工具。

**和 `threejs-procedural-cloth` 的分工：**
- 那邊是「設計出來的」大片布料，例如床上的棉被和窗簾，不做模擬。
- 這邊是「掛在東西上」的小塊布。形狀取決於底下的物體，所以用 PBD 讓它垂到定位：約 0.3–0.8 秒、200 步，每次結果都一樣。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/props.js` | 只依賴 three。包含 `RNG`、`fbm2`／`fbm3`、`orient`、`merge`、`lath`、`sampleGrid`、`skin`、`gridNormals`、`refine`、`thickCloth`、`surfacePoints`、`drapeCloth`、`overBar`、`overRim`、`ribbon`、`cable`、`sock`、`mug`、`bottle`、`paperBall`、`ropeBasket` |
| `example/` | 房間一角：椅背上的毛巾、洗衣籃邊上的毛巾、襪子、牆上插座拉出的充電線、邊桌上的馬克杯和水壺、紙團、一疊雜誌。`?cam=`（room、chair、basket、basketClose、floor、table）；`?steps=0` 看起始姿勢；`?collider=1` 顯示碰撞點；`?skew=`、`?gather=` |
| `example/preview.jpg` | 範例截圖 |
| `references/drape.md` | 垂掛的做法、參數、起始姿勢、驗證數據、遇過的問題 |
| `references/props.md` | 各小物與幾何工具的做法、數值，以及搬到 Godot／Unreal |

範例的貼圖和書封借用了 `threejs-procedural-textures`（相對路徑 `../../threejs-procedural-textures/`）。兩個 skill 要放在同一層資料夾。

## 跑範例

```bash
cd <skill 資料夾>/.. && python3 -m http.server 5425 --bind 127.0.0.1
# 開 http://127.0.0.1:5425/threejs-lived-in-props/example/   （window.__props 有垂掛數據與耗時）
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

## 用法：把布掛到東西上

```js
import { surfacePoints, drapeCloth, overBar, refine, thickCloth } from './scripts/props.js';
const D = 0.015, W = 27, H = 61;                                         // 0.39 × 0.9 m 的毛巾，粒子間距 1.5 cm
const res = drapeCloth({ W, H, D, floor: 0.004,
  collider: surfacePoints(chairMeshes, 0.007),                            // 椅子表面每 7 mm 一個點，帶法線
  ...overBar({ cx: 1.32, top: 0.895, cz: 0.93, W, D, fold: 26, skew: 0.12, gather: 0.85 }) });
console.log(res.stats);                                                  // p99Stretch < 0.2、inside ≈ 0
const R = refine(res.P, W, H);                                           // 加密一次，再加上厚度
scene.add(new THREE.Mesh(thickCloth(R.P, R.W, R.H, { th: () => 0.005, uv: (i, j) => [i * D / 2, j * D / 2] }), towelMaterial));
```

## 一定要遵守

1. **起始姿勢決定結果。**直接讓一塊平布從上方落下，大多會整塊滑掉。要用 `overBar`／`overRim`：一開始就對折掛在桿上，並釘住折線中段。
2. **布要比桿子窄**，起始折彎的半徑 `rho` 要大於「桿子厚度的一半加 2 cm」。否則布的邊緣會從桿子端點滑下去，或者一開始就插在桿子下方的物體裡（實際遇過，見 `references/drape.md`）。
3. **碰撞體的三角形要朝外**（封閉實體，或用 `orient()` 處理過）。`surfacePoints` 會帶法線，求解器靠法線把穿到背面的粒子推回正確的一側。
   像衣物堆這種單層曲面，沒有法線時會造成大片拉扯（p99 拉伸 49%，加上法線後 26%）。
4. **加 `skew` 和 `gather`。**沒加的布會像一塊板子一樣筆直掛著；`skew` 約 0.12、`gather` 約 0.85，會有斜的下擺和自然的垂波。
5. **看 `stats`。**要看的是拉伸（`p99Stretch`）；壓縮是布起了皺褶，不算錯誤。`inside` 是最後仍在碰撞體裡的粒子數，應該是 0 或個位數。
6. **決定性：**求解器沒有亂數，步數固定、約束順序固定。場景生成的其他部分一樣要走 `RNG(seed)`，烘焙的光照才會對得上。
7. 垂掛的結果是靜態的。要即時互動，請看 `references/drape.md` 的引擎章節。

## 實測（RTX 4090、Chrome，範例整體 1.55 秒、8.2 萬個三角形）

| 布 | 粒子 | 耗時 | p99 拉伸 | 最大拉伸 | 穿模粒子 |
|---|---|---|---|---|---|
| 椅背毛巾（不加 skew／gather） | 1647 | 0.65 s | 11% | 23% | 0 |
| 椅背毛巾（skew 0.12、gather 0.85） | 1647 | 0.66 s | 19% | 92% | 2 |
| 洗衣籃毛巾（overRim、skew 0.15、gather 0.85） | 693 | 0.30 s | 10% | 29% | 4 |

求解器的迭代次數預設是前段 20、最後 60 步 60。用原專案的 5／12 會比較快，但下垂的部分會被拉長（p99 拉伸 35% 以上）。
