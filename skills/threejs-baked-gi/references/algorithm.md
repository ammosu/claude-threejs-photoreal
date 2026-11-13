# 演算法與資料格式

## 單位

- 存的值 `gi` = **照度 / π**（線性 RGB）。漫反射的出射輝度 = 反照率 × gi。
- 天空的值是輝度。在均勻天空 L 下，水平面的 gi = L（能量檢查就是靠這一點）。
- 太陽的 `irr` 是垂直照度，對 gi 的貢獻 = irr · cosθ / π。這個值要跟 `DirectionalLight` 的 intensity 一致（three 的漫反射是 albedo/π × 照度）。
- shader 裡：`irradiance += gi * PI`，並且關掉 IBL 的漫反射，只留下鏡面反射。

## cfg

```js
{
  sky: { zenith, horizon, glow, glowDir, ground },   // 地平線到天頂用 sqrt(dy) 內插；glow 是太陽方向的暖色暈；地平線以下用 ground
  portal: { x0, x1, y0, y1, z, area },              // 選填；室外 = z < portal.z
  room: [xmin, ymin, zmin, xmax, ymax, zmax],       // 有 portal 時必填，用來判斷「在室內」
  sun: { dir, irr, radius: 0.01, bakeDirect: false },// 選填；dir 指向太陽
  maxDepth: 6, extDepth: 0.45,                      // 最大反彈次數；窗外方向表的取樣平面放在 portal.z - extDepth
  imports: { three, bvh },                          // worker 載入用的 URL，預設 jsdelivr +esm
  jobWeight: (S, a, b) => 1,                        // 選填：某些區塊多取樣（原專案在窗邊 ×3、室外 ×0.3）
}
```

## 兩階段

1. **第一階段（完整路徑追蹤）**：spp = 總數的 1/5，介於 12–48。
   - 每個路徑頂點：
     - 若在室內，往窗口矩形取一個點做 NEE，跟 cosine 取樣用 balance heuristic 合併（MIS），權重 ≤ 1。這樣窗邊和房間深處都穩定。
     - 若有太陽，做太陽 NEE（陰影射線）。
   - 光線出窗後打到室外物體：用最多 4 次反彈的短路徑估算（也加太陽 NEE，所以被曬亮的草地會把光反彈進室內）。
   - Russian roulette 從第 2 次反彈開始。
   - 結果經過清理與平滑後，變成**每個遮擋頂點的出射快取**（正面和背面各一份）。
2. **第二階段（final gather）**：用全部的 spp。
   - 每個樣本只做一次反彈，打到的三角形就用重心座標內插第一階段的快取。
   - 往窗口方向的光查「窗外方向表」：128×96 的方位角 × 仰角表，預先對整個窗口平均並模糊過。這消除了樹葉與天空交錯造成的椒鹽雜訊，又不改變總量。
   - 太陽直射只在 `bakeDirect: true` 時才寫進結果。第一階段的快取一定包含直射，否則反彈光會少掉。

## 主要方向 `gd`

- 每個樣本的貢獻依亮度加權，累加入射方向，存成平均方向向量。
- shader 用 `(1 + k·dot(N_貼圖, gd)) / (1 + k·dot(N_幾何, gd))` 縮放亮度，k = 1.6，限制在 0–2.5。
  效果是法線貼圖上朝向光源的那一側變亮、背對的變暗，總量不變。

## 降噪（在網格圖上）

- 取樣點依「位置（0.2 mm）+ 法線（約 2.4°）」焊接，取樣點之間的邊就是網格的邊。
- **修復**：如果某個樣本超過 35% 的第一條射線在 4 cm 內打到單面物體的背面，代表它在別的幾何裡面，就用鄰居的平均值取代（迭代 4 次）。
- **邊緣感知平滑**：只在法線夾角 cos ≥ 0.9 的鄰居之間平滑，權重是 `1 / (1 + (亮度差 / (0.3 × 平均亮度))²)`，自身權重至少 0.6。第一階段做 3 次，第二階段做 `smooth` 次（範例用 2）。

## 檔案格式（.bin）

```
uint32 magic 'GIB1' | uint32 json長度 | json(manifest) | padding到4 | float16[]
manifest = { version, meta, meshes: [{ key: '路徑#n', count, off, back }] }
資料依序：gi(3·count) gd(3·count) [giB(3·count)]
```

範例場景是 25k 個取樣點，原專案 115 萬個取樣點約 13 MB。

## 跟原專案不同的地方

- 移除了「窗外變暗」的 uniform（`giExt`），那是原專案為了調色加的。
- `jobMult` 原本寫死了窗邊和室外的判斷，改成可選的 `cfg.jobWeight`。
- worker 改成動態 import，因為 module worker 不吃 import map。
- 新增太陽、無 portal 模式，以及任意 `portal.z`。
