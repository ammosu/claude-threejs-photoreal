# 搬到 Godot / Unreal

這套方法本質上是「用數學產生一個靜態網格加上貼圖」，跟引擎無關。有三條路，依需求選擇。

## 路線 A：在網頁生成，匯出 GLB（最快，推薦先試）

1. 範例頁按「下載 GLB」（使用 `GLTFExporter`，binary）。先經過 `exportableMesh()`，因為 GLTFExporter 寫不了 DataTexture 格式的 normal map；轉換時 cavity 通道會被丟掉。實測檔案約 5.4 MB（13 萬三角形，含兩張 1024 貼圖），並帶有 `KHR_texture_transform` 與 `KHR_materials_sheen`。
2. 匯入引擎：
   - Godot 4：直接把 .glb 拖進專案。
   - Unreal 5：Import → glTF，或先轉成 FBX。
3. 材質要重接（GLB 只會帶出 base color 與 normal）：
   - cavity：GLB 裡已經沒有這個通道。需要的話，另外把 `normalCavity()` 的 A 通道存成一張灰階 PNG（或塞進 ORM 貼圖的 R＝AO），在引擎裡用 `1 + 0.3·min(c·2 − 1, 0)` 乘到 albedo。
     - Godot：在 StandardMaterial3D 開 `detail`，或改用 ShaderMaterial。
     - Unreal：用 Material 節點：TextureSample.A → 運算 → Multiply BaseColor。
   - sheen：
     - Godot：StandardMaterial3D 的 `rim` 參數可以近似。
     - Unreal：Shading Model 選 Cloth，填 Fuzz Color。
4. 光照交給引擎處理：Godot 用 LightmapGI／SDFGI，Unreal 用 Lumen。原專案的逐頂點烘焙不需要搬過去。

適合：場景裡幾件固定的布，例如床、桌巾、沙發毯。

## 路線 B：把演算法改寫成引擎內的程式（需要在遊戲中產生或變化時）

這些函式都是純數學：雜訊、Field、crease、drape、relaxUV。可以一對一翻譯。

| 項目 | Godot 4 | Unreal 5 |
|---|---|---|
| 語言 | GDScript（慢，13 萬三角形約數秒）或 C#／GDExtension C++ | C++ |
| 建網格 | `ArrayMesh.add_surface_from_arrays` 或 `SurfaceTool` | `UProceduralMeshComponent::CreateMeshSection`，或 Geometry Script（`UDynamicMesh`） |
| 陣列 | `PackedFloat32Array`／`PackedVector3Array` | `TArray<float>`／`TArray<FVector>` |
| 法線 | `SurfaceTool.generate_normals()` | `UKismetProceduralMeshLibrary::CalculateTangentsForMesh` |
| 貼圖 | `Image.create_from_data` → `ImageTexture` | `UTexture2D::CreateTransient` 後寫入 mip 資料 |
| 印花 | Canvas2D 不能用，改成 `Image` 逐像素畫，或事先在網頁畫好匯出成 PNG | 同左；或直接在 Material 裡用程序化節點 |

注意：
- **seed 要完全一致**：`mulberry32` 與 `hash2` 用到 32 位元整數乘法（`Math.imul`）。
  - GDScript 的 int 是 64 位元，要自己 `& 0xFFFFFFFF` 並處理有號數。
  - C++ 用 `uint32_t` 即可。
  - 翻譯完先比對同一個 seed 在幾個點的數值，確認和 JS 版相同。
- 編輯器階段才生成、存成 `.tres`／Static Mesh 資產，比每次進遊戲都重新計算好。
- 在 Unreal，Geometry Script 可以做成 Editor Utility，讓美術調參數、按一下就重建。

## 路線 C：可以互動的布

這套方法產生的是**靜止狀態**，角色碰到不會動。需要互動時：
- **Unreal Chaos Cloth**／**Godot SoftBody3D**：可以把設計好的形狀當成初始姿勢，或當作模擬的目標。
  模擬的網格要大幅減面（數千個頂點），細節交給 normal map。
- **淺層互動**（被坐、被壓）：在 vertex shader 用一個「壓痕點」把附近頂點往下推，再把皺褶淡化。效果跟原專案的「書壓平布」一樣，只是改成即時計算。
- **風吹的窗簾、旗子**：原專案的樹用 vertex shader 做多層擺動，只依賴時間。這個做法也適用於垂布，而且兩個引擎都很容易移植。

## 效能預算（遊戲）

- 網頁範例約 13 萬個三角形。遊戲中一般道具建議 5k–20k。可以這樣處理：
  1. 降低格網解析度（例如 96×64）。大形狀還在，細皺褶交給 normal map。
  2. 或者在 Blender／引擎裡把高面數版本烘成 normal map，貼到低面數網格上。
- 多個 LOD：直接用不同解析度各生成一次。因為是程式生成，這很容易。
