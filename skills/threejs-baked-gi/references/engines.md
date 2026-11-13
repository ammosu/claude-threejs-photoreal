# Godot / Unreal

**大部分不需要移植，引擎都有自己的烘焙。** 這份 skill 的價值在於讓 three.js（網頁）也能有引擎等級的間接光。
到引擎時，用它們的工具就好：

| 需求 | Godot 4 | Unreal 5 |
|---|---|---|
| 靜態間接光 | `LightmapGI`（GPU 烘焙，需要 UV2；匯入時勾 Generate Lightmap UV2） | Lightmass（靜態光）或 GPU Lightmass |
| 動態間接光 | `SDFGI`、`VoxelGI` | Lumen |
| 窗光加速 | `LightmapGI` 調 bounces；室內可放 `ReflectionProbe`（box projection 選項） | Lightmass Portal（就是本 skill 的 portal NEE 概念）、Sphere／Box Reflection Capture |
| 反射 | ReflectionProbe（Box Projection 打勾） | Box Reflection Capture |

## 從本 skill 可以帶過去的觀念

- **窗口 portal**：Unreal 的 Lightmass Portal 做的就是同一件事，室內一定要放。Godot 沒有對應功能，請提高 bounces 或在窗邊加補光。
- **太陽直射交給即時光、間接光烘焙**：兩個引擎的「Stationary／Mixed」光源就是這種分工。
- **曝光對準室內**：Godot 用 CameraAttributes 的 auto exposure，Unreal 用 Post Process 的 Exposure。
- **牆角漏光**：牆要有厚度、不要用單面平面，接縫處重疊在牆**內部**（不在可見面上），lightmap 解析度要夠。
- **決定性生成 + 烘焙檔**：程式生成的場景在引擎裡也要固定 seed，否則每次生成，烘焙就失效了。

## 真的要移植頂點烘焙時（例如低階裝置、不想要 UV2）

- 用網頁版烘焙後，把 `gi` 和 `gd` 寫進 GLB 的頂點屬性（例如 COLOR_0 存 gi 並壓縮範圍，或自訂屬性 `_GI`），在引擎裡用 shader 讀取。
  - Godot：spatial shader 裡用 `COLOR`／`CUSTOM0`，輸出到 `AMBIENT_LIGHT` 或直接乘到 ALBEDO 並關掉環境光。
  - Unreal：Vertex Color 進 Material，接到 Emissive 或 Indirect（要配合 Unlit 或自訂 shading model）。
- 頂點色只有 8 位元，間接光的動態範圍不夠。建議存 log 編碼，或用 UV 通道存浮點。
