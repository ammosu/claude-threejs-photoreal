# 驗證、問題與其他引擎

## 怎麼驗證

| 檢查 | 方法 | 標準 |
|---|---|---|
| 接縫 | `seamScore(data, w, h, 通道)`：跨過重複邊界的平均差值 ÷ 內部相鄰兩欄的平均差值，分子分母各加 1 個色階 | 約 1；大於 2 要看圖 |
| 生成時間 | `performance.now()` 包住每個函式（範例的 `window.__tex.times`） | 單張不超過 0.35 s；整個場景約 1 s |
| 有沒有效果 | `?flat=1` 把同一場景換成純色，同一個鏡頭比對 | 掠射光與高光處要看得出差異 |
| 掠射光 | `?cam=wall`：沿著牆面看 | 木屑壁紙的凹凸要清楚，但不能像月球表面 |
| 高光 | `?cam=glint`：讓窗戶的反光落在桌面上 | 指紋、擦拭痕、灰塵帶、刮痕要在反光中出現 |
| 反照率 | `avg` 要合理：白漆約 0.8、橡木約 0.4–0.5、深色布約 0.05 | 烘焙出的反彈光顏色才會正確 |

**接縫分數的盲點**：如果圖案本身在邊界上就有一條溝，例如 `ropeNormal` 每一格就是一圈繩子，兩圈之間的溝正好落在 v 的邊界上，分數會偏高（實測 2.03），但那是刻意的設計，不是接縫。判斷方式是把貼圖拼成 2×2 看：溝的寬度和其他地方一樣，就沒問題。

## 遇過的問題

| 症狀 | 原因 | 修法 |
|---|---|---|
| 深色桌面看起來像花崗岩 | `wornMaps` 預設的 9000 顆碎屑是給白色桌面用的，亮色碎屑在深色底上太顯眼 | 深色底把 `specks` 降到 2000–3000 |
| 桌面上的使用痕跡完全看不到 | 白色桌面加上斜上方的光，高光和底色差不多亮 | 讓窗戶或燈的反光落在桌面上（範例用 RectAreaLight 當窗戶）；深色表面效果最明顯 |
| 整個場景過曝、牆面一片白 | 白牆反照率約 0.85，ACES 曝光 1.0 太亮 | 曝光改成 0.7 左右，或交給 `threejs-baked-gi` 的曝光流程處理 |
| 書架上的書一半陷在層板下 | `bookGeometry` 的高度方向以 0 為中心（−h/2 … h/2），直立擺放時忘了往上移 | 位置的 y 加 `h / 2` |
| 貼圖重複時看得到直線接縫 | 雜訊的週期不是整數，或和貼圖格數沒有對齊 | 用 `pfbm(u*k, v*k, oct, seed, k)`，k 必須是整數 |
| 換了解析度之後凹凸變強或變弱 | 高度沒有用物理單位，或 `normalBytes` 給錯每格公釐數 | 高度用公釐，給正確的每格公釐數 |
| 布料材質看起來像塑膠 | 沒有 sheen，或 normal map 的格太大 | 用 `fabricMaterial`（sheen 0.3–0.5），格的大小照 recipes.md 的表 |
| 有 roughnessMap 但整片太光亮或太粗糙 | `roughness` 沒設成 1。three.js 會把它和貼圖的 G 通道相乘 | `roughness: 1` |
| `seamScore` 算出 3.5，但看不到接縫 | 舊版公式沒有加 1 個色階：順紋木頭在 u 方向幾乎沒有起伏，兩邊的差值都小於 1 個色階，比值就被放大 | 現在的公式已經加上 1 個色階（實測降到 1.3） |
| GLTFExporter 匯出時貼圖不見 | DataTexture 不能直接匯出 | 先轉成 canvas，做法見 `threejs-procedural-cloth` 的 `exportableMesh` |

## 效能

- 所有生成都在主執行緒上同步執行，整個範例約 1.1 秒。量更大時：
  - 把 `floorMaps` 這類純數學的函式搬到 Web Worker（只依賴 typed array），回傳 `ArrayBuffer`。
  - 或者在建置時跑一次，存成 KTX2／PNG。決定性的程式碼保證每次產生的結果都一樣。
- 顯示記憶體：一張 2048² RGBA8 加上 mipmap 約 22 MB。地板三張約 67 MB。同一張貼圖要用 `rep()` 共用，不要每個物件各 clone 一份圖片。
- 粗糙度貼圖用一半的解析度就夠了（`wornMaps` 就是這樣做）。

## 搬到 Godot／Unreal

- **最簡單**：在瀏覽器裡生成，再把 `data` 存成 PNG（`canvas.toBlob`）匯入。
  - normal map 是 OpenGL 慣例（+Y 朝上），Godot 可以直接用；Unreal 要勾選 Flip Green Channel。
  - 粗糙度在 G 通道，對應 glTF 的 metallicRoughness 與 Godot 的 ORM 打包。
- **改寫成引擎程式碼**：`tex.js` 的雜訊和 `normalBytes` 是純數學，可以逐行改寫成 GDScript／C#／C++。
  - Godot 可以用 `Image.create_from_data` 加 `ImageTexture`。
  - Unreal 可以用 `UTexture2D::CreateTransient` 寫入 mip 0。
- **改寫成 shader**：`wallPatch` 原本就是 shader，可以直接改寫成 Godot 的 `NORMAL_MAP` 處理或 Unreal 的 Material Function。
  - 雜訊類的貼圖也可以在 shader 裡即時計算，但要注意：決定性的「每片地板不同」需要先查表，在 shader 裡逐像素重算會很貴，所以建議還是預先生成貼圖。
