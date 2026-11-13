---
name: threejs-baked-gi
description: 在 three.js 用 CPU 路徑追蹤（web workers＋three-mesh-bvh）把天光、窗光、太陽反彈光烘焙到「每個頂點」，存成檔案，執行時幾乎不花效能卻有照片級的間接光；法線貼圖仍會正確受光，反射用 box-projected 環境貼圖。含可重用的 baker／worker／材質補丁、有窗戶的房間範例、能量檢查（white furnace）、場景建模規則與常見漏光問題。當使用者說「烘焙光照」「bake lighting」「全域光照／GI」「間接光」「室內看起來太假／太平」「窗戶照進來的光」「lightmap」「three.js 寫實室內」「光從牆角漏進來」「烘焙出來有斑點」時使用。
---

# 烘焙光照到頂點（three.js）

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），`src/bake/*`、`src/core/gi.js`。
原專案是黎明、只有天光、窗戶固定在 z=0。這裡改成通用版本：
- 窗口（portal）的位置可以設定，也可以不設（戶外場景）。
- 加上太陽：直射光交給即時光源，烘焙只負責太陽的反彈光。
- worker 的相依套件從 URL 載入，有沒有打包工具都能跑。

**為什麼用頂點而不是 lightmap 貼圖**：不需要第二組 UV、不會有接縫和漏光的 texel、檔案小（半精度浮點）。
另外，除了亮度 `gi`，還存了光的主要方向 `gd`，所以法線貼圖上的皺紋、紋路仍然會正確受光。
代價是**幾何要切得夠細**，因為光只存在頂點上。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/gi.js` | 材質補丁 `giPatch`、`giMeshes`、`packBake`／`applyBake`（.bin 格式）、`placeholderGi`、`captureEnv`（box-projected 反射） |
| `scripts/baker.js` | 主執行緒：收集遮擋三角形、在頂點上產生取樣點（依位置與法線焊接，並往表面內側微移避免接縫漏光），分派給 workers，兩階段追蹤，在網格圖上降噪，寫回屬性 |
| `scripts/worker.js` | 路徑追蹤器：portal 的 NEE＋cosine 取樣用 MIS 合併、太陽 NEE、室外短路徑、final gather、窗外方向表 |
| `example/` | 有一扇窗的房間：天光加太陽，`?bake=256` 現場烘焙；另有 `?test=furnace` 能量檢查 |
| `references/scene-rules.md` | 建模規則：細分、材質標記、半透明、大量重複物件、不參與烘焙的東西、密封外殼 |
| `references/algorithm.md` | 演算法、單位、cfg 各欄位、兩階段的理由、降噪、檔案格式 |
| `references/verification.md` | 能量檢查、要看的數據、常見症狀與修法（都是實際遇過的） |
| `references/engines.md` | 搬到 Godot／Unreal：什麼該交給引擎、什麼值得移植 |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5421 --bind 127.0.0.1
# http://127.0.0.1:5421/example/?bake=256
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

URL 參數：
- `bake=N`：現場烘焙，N 是每點取樣數（spp）。
- `workers=N`：worker 數量。
- `smooth=N`：降噪迭代次數。
- `cam=room|corner|window`：鏡頭預設。
- `view=gi`：去掉材質顏色，只看光。
- `exp=`：曝光。
- `test=furnace&bake=32`：能量檢查。
- 不帶 `bake` 時會載入 `example/gi.bin`（用「下載 gi.bin」存下來）。

`window.__gi` 會帶出耗時、取樣點數、各面平均亮度。

## 流程

1. **建場景**：所有參與烘焙的材質都經過 `giPatch(material)`。幾何依 `references/scene-rules.md` 細分。
2. **cfg**：設定天空亮度、窗口矩形（外側必須是 z 較小的那一側）、室內範圍，以及太陽方向和照度（可選）。
3. **烘焙**：`placeholderGi(root)` → `await runBake(root, cfg, { spp, workers, smooth })` → `packBake(giMeshes(root))` 存檔。
4. **執行時**：建同一個場景（決定性：同 seed、同順序、同頂點數）→ `applyBake(root, buf)`。對不上的網格會標為 stale，並給平光當作後備。
5. **反射**：`captureEnv(renderer, scene, 探針位置, 房間 min, max)`，在套用烘焙之後拍一次（拍兩次的話，光滑表面會互相反射）。
6. **太陽直射**：用 `DirectionalLight`，`intensity` 要等於 cfg 的 `sun.irr`，陰影交給 shadow map。**不要再加 Ambient 或 Hemisphere 光**，間接光已經烘進去了，加了會算兩次。

## 一定要遵守

1. **決定性**：場景生成不能用 `Math.random()`。網格的名稱路徑、順序、頂點數，任何一項改變，該網格的烘焙就會失效（變成 stale）。
2. **細分**：大平面要切開，桌面、架子這類有東西放在上面的表面要切到 1.5–2 cm，大型家具 4–6 cm。否則接觸陰影會糊成一大片。
3. **窗口慣例**：窗口在平面 `z = portal.z` 上，`z < portal.z` 是室外。牆的厚度（窗台、窗框側面）屬於室外，由室外路徑照亮。
4. **被烘焙的牆面要精準對齊**，不可以為了蓋接縫而往外延伸。邊緣頂點會跑到牆外，取樣到外面的天光，結果沿著接縫出現亮點。接縫透光的問題，改在外面包一層不參與烘焙的黑色殼來處理。
5. **即時太陽陰影的 `normalBias` 設 0**，frustum 收緊，貼圖用 4096。否則每條牆腳都會有一條亮線。
6. **曝光要對準室內**：室內大約只有室外的 1/20（範例的地板平均 E 約 0.02，天空約 0.5–1），這是物理上正確的，曝光拉到約 4.5，就像相機那樣。

## 實測（範例，26 個 worker）

- 4 萬 5 千個遮擋三角形、2 萬 5 千個取樣點。
- 64 spp 花 2.3 秒，有明顯斑點；256 spp 花 6 秒，平滑；1024 spp 花 13 秒，跟 256 幾乎看不出差別。
- 能量檢查：天空 0.5 加上頭頂太陽（E = 0.5），平面上每個取樣點都是 1.000。
- 原專案的規模：115 萬個取樣點、160 spp、6 個 worker，約 30 分鐘。
