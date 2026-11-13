# UV 攤平與布料材質

## UV：依 3D 曲面攤平

- 初始 UV 就是平面座標（公尺），所以貼圖的 `repeat = 1 / tile 公尺`。
- 但布包上床緣、倒向一邊之後，3D 表面會比平面長。不攤平的話，花紋在陡坡上會被拉長（範例 `relax=0` 時 p5 約 0.52，代表有些邊被拉長將近兩倍）。
- `relaxUV(U, nu, nv, uv, iters)`：
  - 約束：每條格邊（橫、直、兩條對角線）的 UV 長度，要等於 3D 弧長。
  - 由粗到細做四層（stride 8、4、2、1），每層做 Gauss-Seidel，正反方向交替掃。
  - 換層時依弧長內插。
  - 最後把 UV 的平均值移回原位，所以印花不會整片位移。
- **U 用「未翻折、已傾倒、已包上床緣」的形狀**。翻折那片沿用同一組 UV（因為它是同一塊布）。
- 用 `uvStretch()` 看 p5、p50、p95，目標是 0.9–1.1。剩下的拉伸幾乎都在翻折片上，請用 `tex=checker` 檢查。
- 成本約 0.15 秒（288×192 格）。若要更快，iters 可以減半，品質損失不大。

## 細皺紋：可重複的 normal map，alpha 存 cavity

`wrinkleTexture({ N: 1024, tileM: 0.64 })`

- 跟幾何的皺褶用同一個 `crease()`，只是尺度是公釐級，而且畫在會循環的格子上（wrap，N 必須是 2 的冪）。內容包括：
  - 60 組成束或扇形的拉力皺褶，旁邊會分出小皺褶。
  - 1700 條短的揉皺痕，依「忙碌度」雜訊分區聚集。
  - 約 3 cm 的柔和起伏。
- `normalCavity`：
  - RGB 是切線空間法線。
  - A 是「這點比周圍 3 mm 平均高多少」，0.5 代表平。材質會用它把凹處壓暗。只靠 normal map 只會改變受光方向，看起來像塑膠；加上 cavity 才像布。
- 貼圖旋轉 0.4 rad（`tex.rotation`），避免皺紋方向跟印花或格網對齊。
- N = 2048 會比較細緻，但建立時間約變成 4 倍（原專案用 2048）。

## 材質：`cottonMaterial`

- 使用 `MeshPhysicalMaterial`，參數 roughness 0.9、sheen 0.35（sheenRoughness 0.5，白色），normalScale 1.1。
- `onBeforeCompile` 插入：`diffuseColor *= 1 + uCav·min(cavity·2 - 1, 0)`，只壓暗凹處、不提亮凸處，`uCav` 約 0.3。
- `side: DoubleSide`：翻折片與垂下的底面都會被看到。
- 原專案還有兩個加分項：
  - 第二層織紋 detail normal（約 4 cm 一個 tile、96 根紗）。
  - 用低頻正弦在世界座標做 ±1% 的色偏，讓布看起來不是同一種白。

## 印花

`sprigPrintTexture({ S: 1024, tileM: 0.74 })`

- Canvas2D 畫成 15×15 格，每格放一枝隨機偏移、旋轉的小枝葉。
- 每枝都畫 9 次（偏移 ±S），所以貼圖可以無縫重複。
- 最後蓋一層 12% 的底色，看起來像洗過幾次。
- 換花紋時只要替換 `sprig()` 這個函式。請保持「每個 tile 對應實際公尺數」這個規則。

## 給烘焙光照或其他引擎用

- 平均反照率：可以把貼圖縮成 1×1 讀出來，烘焙時拿來算布料反彈光的顏色。
- 匯出 GLB 時，cavity 的 alpha 和 `onBeforeCompile` 不會一起帶出去。到其他引擎要用材質節點重做一次：讀 normal map 的 A，再乘到 base color。詳見 engines.md。
