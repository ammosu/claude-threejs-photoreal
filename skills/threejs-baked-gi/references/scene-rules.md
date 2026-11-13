# 讓烘焙正確的建模規則

（原專案 `docs/ARCHITECTURE.md` 的規則，加上做範例時新學到的。）

## 材質

- 參與烘焙的材質一律用 `giPatch(new MeshStandardMaterial(...))` 或 Physical。沒有補丁的材質不會被當成取樣點，但仍然是遮擋物。
- 反彈光的顏色取自 `material.color`（線性值）。**有貼圖的材質要給平均反照率**：`mat.userData.bake = { albedo: [r, g, b] }`（線性），否則會用 color（通常是白色）來算反彈，結果偏亮。
- 反照率在烘焙時上限是 0.92，避免能量發散。

## 細分（光只存在頂點上）

- `maxEdge`：
  - 物件擺放的表面（桌面、架子、地板）：1.5–2 cm。
  - 大型家具的面：4–6 cm。
  - 牆面：8 cm 起，接觸陰影要清楚的話再加密。
  - 小道具：用預設。
- 每個方塊最好都有倒角（≥ 1.5 mm）。尖銳的 90° 邊上，頂點的法線取樣容易出問題。
- 範例的 `holePlane()` 讓窗洞邊緣剛好落在格線上，窗框附近的光才會清楚。

## 特殊標記

| 情況 | 標記 | 原因 |
|---|---|---|
| 平貼在牆或地上的薄東西（海報、地毯） | `mesh.userData.bakeOccluder = false` | 不然會在背後的表面挖出一圈暗暈 |
| 不受烘焙光照的東西（天空球、玻璃、自發光） | `mesh.userData.gi = false` | 不產生取樣點 |
| 不應該擋光的東西 | `material.userData.bake = { ignore: true }` | 從遮擋物中移除 |
| 半透明布料、葉子 | `giPatch(m, { back: true, trans: new Color(...) })`，加上 `m.userData.bake = { albedo, trans: 0.3, transColor, twoSided: true, thru: 0 }` | `trans` 是漫穿透機率，`thru` 是光直接穿過的比例（紗簾、有洞的葉片卡）。會額外存一份背面的光 `giB` |
| 大量相同的小東西（葉子） | 用 `InstancedMesh`，設 `userData.giInstanced = true`、`giNormal`、`giAnchor`（實例的局部座標） | 每個實例只取一個光照樣本 |
| 風吹、動畫 | 寫在 vertex shader（`giPatch(m, { onCompile, key })`） | 烘焙的是靜止姿勢 |

## 密封

- 室內只能透過窗口取得光。牆、天花板、地板必須形成封閉的空間。
- 被烘焙的平面**不可以往外延伸蓋住接縫**（見 verification.md 的症狀表），要在外面加一層 `gi = false`、`bakeOccluder = false` 的黑殼。
- 原專案另外有「不透光的建築本體」：從室外看是一整棟房子，烘焙時則完全遮住室內。

## 決定性（烘焙檔和場景要對得上）

- 烘焙檔用「網格的名稱路徑 + 第幾個」當 key，並比對頂點數。所以：
  - 隨機一律用 seed。
  - 物件建立順序要固定（原專案每個零件有 `order`）。
  - 名稱不要用到隨機或時間。
- 改了某個零件之後，只會有該零件變成 stale，其他網格照常套用。
  原專案可以 `?only=bed` 單獨重新烘焙一個零件，再合併回去。
