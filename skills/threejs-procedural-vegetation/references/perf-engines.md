# 效能、LOD、搬到其他引擎

## 數量（範例實測）

| 項目 | 數量 |
|---|---|
| 主樹 3 棵 | 6 萬張葉片卡片 |
| 中景 12 棵＋遠景 30 棵 | 2.6 萬張葉片卡片 |
| 樹皮 | 13.7 萬個三角形 |
| draw call | 樹皮 1 個、葉片 1 個（全部合併），加上兩者的陰影 |

所有樹共用一個樹皮網格和一個 InstancedMesh，所以 draw call 很少。

主要的成本：
- **overdraw**：大量 alpha test 卡片互相重疊。由近到遠排序可以讓被遮住的片段提早剔除。
- **陰影 pass**：葉片會再畫一次。陰影貼圖的範圍收緊，比單純提高解析度有效。

## LOD

- 樹的層級（`S.lod`）：0 主樹 → 1 中景 → 2 遠景。
- 細枝的層級：`opts.lodAt(x, y, z)` 回傳 2（完整）、1（卡片放大、間距放大）、0（一張大葉叢，或什麼都不放）。
  - 範例依離相機的距離判斷：小於 30 m 為 2，小於 60 m 為 1，其他為 0。
  - 原專案依「從房間透過窗洞看不看得到」判斷，看不到的地方只留大卡片維持遮蔭。
- 相機會大範圍移動的遊戲：請改為**依距離切換幾組預先生成的網格**，不要即時重新生成。或者按區塊生成，每塊各自有 LOD。

## 其他可做的優化

- `alphaToCoverage: true` 配合 MSAA，可以讓葉緣更柔和（原專案有開）。
- 動態解析度：原專案依幀率調整渲染解析度，在內顯上也能順跑。
- 遠景樹改用預先算繪的看板（impostor）。

## Godot / Unreal

| 需求 | 做法 |
|---|---|
| 直接用現成工具 | Unreal 的 SpeedTree 或 PCG 植生；Godot 的 MultiMeshInstance3D 加上外部做好的樹 |
| 把這裡生成的樹帶過去 | 用 `GLTFExporter` 匯出（樹皮網格 + InstancedMesh，GLTF 支援 `EXT_mesh_gpu_instancing`）；或展開成一般網格再匯出 |
| 風 | 屬性 aW1／aW2／aW3 存到 UV2、UV3、頂點色，在引擎的 shader 裡照 `wind.md` 的公式重寫。Godot 的 spatial shader 寫在 `VERTEX`；Unreal 用 World Position Offset |
| 葉片卡片 | Godot：MultiMesh，每個實例的自訂資料（`INSTANCE_CUSTOM`）存 aLeaf；Unreal：Instanced Static Mesh，用 Per Instance Custom Data |
| 葉片圖集 | 把 `buildAtlas()` 的三張圖存成 PNG 帶過去（mip 要在引擎裡手動處理覆蓋率；Unreal 的 texture 有 alpha coverage 相關設定） |
| 透光 | Godot：`BACKLIGHT`；Unreal：Two Sided Foliage 的 Subsurface Color |

在引擎裡生成：骨架演算法是純數學，用 GDScript／C#／C++ 都能一對一翻譯。請一樣用相同的 RNG（注意 32 位元整數運算），才能和網頁版產生同一棵樹。
