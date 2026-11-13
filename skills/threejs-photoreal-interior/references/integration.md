# 各 skill 之間的介面與要注意的地方

## 材質：GI 補丁 × 其他 shader 補丁

- `giPatch(mat)` 會**取代** `mat.onBeforeCompile` 和 `customProgramCacheKey`。直接呼叫的話，下面這些補丁都會悄悄失效：
  - `wallPatch`（牆面的大尺度變化）
  - `fabricMaterial({ trans })`（布料逆光）
  - `curtainMaterial`（縫邊、車線、擺動）
  - 植物的風吹
- 範本的 `lit(mat)` 會先取出 instance 上原本的 `onBeforeCompile`，當作 giPatch 的 `onCompile` 串在後面執行；cache key 也會一起合併。
- 兩邊替換的 shader 片段不重疊：GI 換的是 `common`、`project_vertex`、`lights_fragment_maps`；牆面是 `normal_fragment_maps`；逆光是 `lights_fragment_end`。
- 注意：逆光項讀的是即時的平行光。烘焙時要讓布料透光，要用 `giPatch(mat, { back: true, trans })` 加上 `userData.bake = { trans, twoSided: true }`，詳見 `threejs-baked-gi/references/scene-rules.md`。

## 反照率

- 烘焙器在決定反彈光顏色時，讀的是 `material.userData.bake.albedo`；沒有這個欄位的話，就用 `material.color`。
- 有貼圖的材質，`color` 通常是白色，會讓反彈光變得太亮、太白。所以每個 texture 函式都會回傳 `avg`（線性的平均顏色），交給 `lit(mat, { albedo: avg })`。

## 單位與 UV

- 所有材質函式都假設 **UV 以公尺為單位**，再用 `repeat = 1 / 每格公尺數`。範本的 `metres(geometry, 寬, 高)` 會把 Box／Plane 的 0–1 UV 轉成公尺。
- 小物和布料（`thickCloth`、`ribbon`、`cable`）產生的 UV 本來就是公尺。

## 光照的分工

| 光 | 誰負責 | 要注意 |
|---|---|---|
| 天空經由窗戶進來的光 | 烘焙（portal NEE） | 窗戶在 z = 0，`cfg.portal` 要和 `layout.js` 一致 |
| 太陽直射 | `DirectionalLight`，強度等於 `sun.irr` | `normalBias` 設 0、陰影範圍要收緊、4096 的貼圖、牆芯的 `shadowSide = FrontSide` |
| 太陽的反彈光 | 烘焙（`bakeDirect: false`） | |
| 鏡面反射 | `captureEnv`（box projection） | 在烘焙之後拍，探針放在房間中央，box 等於房間 |
| 自發光（燈罩、螢幕） | 材質的 emissive | `userData.gi = false`；要照亮四周的話，得算進烘焙或另外加燈 |

## 陰影漏光（實際遇過）

**症狀**：牆腳和牆角的接縫出現一排亮點。把 shadow bias 加大，反而變成一整條亮線；把太陽關掉就消失。

**原因**：three.js 預設只把物體的「背面」畫進陰影貼圖。牆只有兩張薄面（室內面、室外面）時，被畫進去的面離地板只有幾公釐，剛好被 bias 吃掉。

**修法**：在兩張面中間放一個實心的牆芯，設定如下：
- `MeshBasicMaterial` 黑色、`shadowSide = THREE.FrontSide`。
- `userData.gi = false`、`bakeOccluder = false`，所以不影響烘焙，也不會被存進 gi.bin。
- 離窗洞的四個側面要退 4 mm，不然會和側面重疊，產生黑色閃爍（也遇過）。

## 決定性與 gi.bin

- `giMeshes(root)` 依照走訪順序，對應 gi.bin 裡的每一筆資料。
- 加入新的零件時，放在 `PARTS` 的最後面，或給它最大的 `order`。前面的網格就不會失效，只有新零件會是 stale，得到平光。
- 範本的 `?only=` 會跳過其他零件，這時 stale 很正常。正式驗收時不要加 `?only=`。
- 垂掛布料的結果是決定性的，但前提是碰撞體也一樣。改了椅子的形狀，毛巾就要重新垂掛，烘焙也要重做。

## 效能預算（原專案 → 範本）

| | room-at-dawn | 範本 |
|---|---|---|
| 三角形 | 183 萬 | 10.7 萬 |
| 載入 | 約 7 s | 約 1.6 s |
| 烘焙 | 115 萬取樣點、160 spp、6 worker、約 30 分鐘 | 6.1 萬取樣點、128 spp、26 worker、6 s |
| gi.bin | 約 13 MB | 743 KB |

- 最貴的通常是植物（葉片卡片，原專案窗外的樹約 11.8 萬張）和布料的網格。
- 要在內顯上順跑：用 `AdaptiveRes`，並減少遠景樹的 LOD。
