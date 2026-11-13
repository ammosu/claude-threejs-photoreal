# 驗證、問題排除、搬到其他引擎

## 驗證

- `window.__pothos.vinePointsInside` 必須是 0：檢查每條藤蔓中心線上的點，有沒有落在牆後或 Env 的盒子裡面（往內 1 mm 才算）。
- 固定鏡頭截圖（`?ui=0&t=3&cam=...`），拼成 2×2 一起看：
  - `room`：整體輪廓，三盆的姿態有沒有不同。
  - `shelf`：往光源伸的長弧、葉面有沒有朝向光源。
  - `table`：越過桌緣時有沒有沿著桌面滑出去再垂下，而不是直接穿過桌板。
  - `wall`：貼牆的那一側，葉片有沒有插進牆裡。
- 葉片的探針檢查已經內建在生成過程中，放不下的葉子會直接被丟掉。

## 常見問題

| 症狀 | 原因 | 修法 |
|---|---|---|
| 藤蔓卡在牆和層板之間的縫 | 層板的 `faces` 包含朝牆的那一面 | 貼牆的面不要列進 faces |
| 藤蔓穿過窗簾、旁邊的家具 | 沒有寫進 Env | 補上 box，用 faces 限制推出的方向 |
| 整盆看起來在背光 | `light` 的位置錯了 | 設在窗戶或主光源上 |
| 葉子太少、某一側光禿禿 | 空間太擠，探針一直撞到，葉子被丟掉 | 給更多空間，或把 `size` 調小 |
| 藤蔓全部筆直垂下，沒有生氣 | 全部都用垂吊參數 | 加幾條 b0 很小、ramp 很長的「往光源伸的長弧」，再加 shoots |
| 葉片反射窗戶時整片發白 | 拿掉了天空反光壓縮 | 保留 leafShader 裡的 radiance 壓縮 |
| 每次重新整理形狀都不同 | 用了 Math.random | 一律用 seed |

## 效能

- 每種葉形一個 InstancedMesh，共 6 個 draw call。每片葉子 13×7 個頂點，幾百到幾千片都很輕。
- 主要成本在莖：每條藤蔓一個管子網格。數量多時可以先合併成一個網格（原專案就是合併的），範例為了簡單沒有合併。
- 生成約 0.1 秒（三盆），可以在載入時即時生成。

## Godot / Unreal

- **最快的做法**：用 GLTFExporter 把 `group` 匯出成 GLB。InstancedMesh 會以 `EXT_mesh_gpu_instancing` 匯出，或者先展開成一般網格。
  到引擎裡要重接材質：雙面、背面偏淡、粗糙度貼圖。
- **在引擎裡生成**：`growVine`、`addLeaf`、`Env.push` 都是純向量運算，可以一對一翻譯。
  - 莖：Godot 用 `SurfaceTool`；Unreal 用 Procedural Mesh 或 Geometry Script 的 sweep。
  - 葉片：Godot 用 `MultiMeshInstance3D`；Unreal 用 Instanced Static Mesh。
  - 葉片貼圖：把 `makeLeafLibrary()` 產生的 6 套貼圖存成 PNG 帶過去。
- **互動**（被角色撥動）：生成的是靜止姿勢。可以在 vertex shader 用一個「推開點」讓附近的葉子往外偏，或者只把最下面一段藤蔓改成物理模擬的繩子。
- **其他蔓生植物**：常春藤、綠蘿、毬蘭這類都可以用同一個生長模型，只要換葉形（rowAng／rowLen）和 vines 的參數。
