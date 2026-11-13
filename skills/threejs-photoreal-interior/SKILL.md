---
name: threejs-photoreal-interior
description: 用 three.js 從零做一個照片級的室內場景，完全用程式生成、不需要模型檔、貼圖或 HDRI 的總綱與起手式。內容包括：整體流程（尺寸與座標 → 外殼與窗 → 主角物件 → 材質 → 小物 → 烘焙光照 → 後製 → 驗證 → 電影輸出）、各步驟該用哪個 skill、跨 skill 整合的規則（決定性、細分、材質要經過 GI 補丁且保留原本的 shader 補丁、反照率、太陽直射與烘焙分工、陰影漏光）、一個指令就能建立可執行的新專案（房間、窗、木地板、牆面、桌椅、掛在椅背的毛巾、書架、杯子、水壺、現場烘焙、後製），以及驗收清單和實測數字。當使用者說「做一個寫實的房間／室內」「three.js 照片級場景」「程式生成整個場景」「不用模型做室內」「room-at-dawn 那種」「從哪裡開始做寫實 3D 場景」「開一個新的寫實場景專案」「把這些 skill 串起來」「寫實室內場景流程」時使用；做其中單一環節時，直接用對應的子 skill。
---

# 照片級室內場景（總綱）

這個 skill 把下面幾個 skill 串成一套流程，並提供一個可以直接執行的專案範本。
方法來自 [room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT）：一間清晨的臥室，全部用程式產生，跑在瀏覽器裡。原專案的規模大約是：

- 183 萬個三角形，載入約 7 秒（RTX 4090）。
- 烘焙的光照檔 gi.bin 約 13 MB，烘一次約 30 分鐘。
- 影片是 4K HDR10。

## 各步驟用哪個 skill

| 步驟 | skill | 交付什麼 |
|---|---|---|
| 0 | `3d-spec-prompt` | 把想法寫成可驗收的規格：氛圍、時間、尺度、主角物件、鏡頭 |
| 1 尺寸與外殼 | 本 skill 的 `template/src/layout.js`、`parts/room.js` | 真實尺寸（公尺）、窗、牆厚、外殼 |
| 2 主角物件 | `threejs-procedural-cloth`（棉被、毯子、窗簾）、`threejs-procedural-vegetation`（窗外的樹）、`threejs-procedural-pothos`（室內植物） | 視線焦點的物件 |
| 2b 天空與窗外 | `threejs-sky-backdrop`（天空預設、雲、窗外的草地、房子、遠方樹牆、只建看得到的東西） | 同一份天空同時給烘焙與畫面 |
| 3 材質 | `threejs-procedural-textures` | 牆、地板、木頭、織物、使用痕跡、書封 |
| 4 小物 | `threejs-lived-in-props` | 掛在椅背的布、杯子、水壺、襪子、電線、紙團 |
| 5 光照 | `threejs-baked-gi` | 天光與太陽反彈光烘焙到頂點，存成 gi.bin；太陽直射用即時光 |
| 6 畫面 | `threejs-realtime-post` | AO、bloom、窗外與室內分開曝光、調色 |
| 7 驗證、錄影 | `webgl-deterministic-recording` | 截圖回歸、逐格算繪、電影輸出（景深、動態模糊、HDR10） |

## 開新專案

```bash
bash <skill 資料夾>/scripts/new-project.sh ~/git_project/my-room
cd ~/git_project/my-room && python3 -m http.server 5430 --bind 127.0.0.1
# http://127.0.0.1:5430/            已經附上烘焙好的 bake/gi.bin
# http://127.0.0.1:5430/?bake=128   改了場景之後重新烘焙，按「下載 gi.bin」，存到 bake/
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

- 這個腳本會把範本複製過去，並把各子 skill 的程式庫複製到 `src/lib/`（gi、post、props、textures、cloth、vegetation、pothos、sky、film），專案從此獨立運作。
- 不需要打包工具，也不用 npm。three 和 three-mesh-bvh 從 jsdelivr 載入。
- URL 參數：
  - `?cam=`：鏡頭（room、desk、window、corner、view＝站在窗邊往外看）。
  - `?t=`：固定時間（樹葉、雲不動，截圖用）。
  - `?view=gi`：只看光照。
  - `?only=furniture`：只建某個零件。
  - `?exp=`：曝光。
- 頁面提供 `window.__ready`、`window.__stats`、`window.__camera`，可以直接接 `webgl-deterministic-recording` 的工具。
- 操作：拖曳轉視角；**WASD／方向鍵走動**（Shift 慢走，會擋牆和家具）；**點一下畫面**改成滑鼠直接轉頭、視線降到 1.6 m（Esc 離開）。環繞模式的鏡頭和注視點都限制在房間內，拉遠、平移都不會穿出牆。

範本的結構：

| 檔案 | 內容 |
|---|---|
| `src/layout.js` | **唯一**放尺寸、太陽、天空（`SKIES` 預設）、窗外配置（`OUTSIDE`）、調色、鏡頭、不能穿過的家具範圍（`BLOCKERS`）的地方 |
| `src/materials.js` | `lit()`（GI 補丁，保留原本的 shader 補丁，記錄反照率）、`solid()`、`tbox()`、`tplane()`、`metres()` |
| `src/scene.js` | 依 `order` 建立每個零件，順序固定 |
| `src/parts/room.js` | 地板、天花板、四面牆、窗洞與窗台、黑色外殼、牆芯 |
| `src/parts/outside.js` | 窗外：天空球、草地、碎石路、樹籬、房子、遠方樹牆、主樹與中遠景樹（只建看得到的，`threejs-sky-backdrop` + `threejs-procedural-vegetation`）。全部 `gi = false`、不擋烘焙光 |
| `src/parts/furniture.js` | 桌子、椅子、掛在椅背的毛巾（PBD）、杯子、水壺、桌上的書、書架上的書 |
| `src/main.js` | 建立場景 → 烘焙、讀檔或平光 → 太陽 → 反射 → 後製 → 鏡頭（環繞＋走動，限制在房間內） |

## 跨 skill 一定要遵守

1. **單位是公尺，座標固定。**X 沿窗牆、Z 往室內（窗牆在 z = 0，z < 0 是室外）、Y 往上。所有尺寸只寫在 `layout.js`。
2. **決定性。**亂數一律用 `RNG(seed)`。零件的順序、名稱、頂點數，只要有一項變了，那個 mesh 的烘焙就會失效；`applyBake` 會回報 stale。
3. **光存在頂點上，所以要細分。**有東西放在上面的表面切到 1.5–2 cm，大面積 4–8 cm。用 `tbox`／`tplane`。
4. **所有被照亮的材質都要經過 `lit()`。**`giPatch` 會直接取代 `onBeforeCompile`，`lit()` 會把原本的補丁串在後面，包括牆面變化（`wallPatch`）、布料逆光、風吹。
   **有貼圖的材質要給 `albedo`**（貼圖的 `avg`），反彈光的顏色才會正確。
5. **太陽的分工：**直射光用 `DirectionalLight`（強度等於烘焙設定的 `sun.irr`），反彈光烘進檔案。**不要再加環境光或半球光。**
6. **牆要有實心的牆芯，牆芯的 `shadowSide` 設成 `FrontSide`。**少了它，太陽會在牆腳和牆角漏出一排亮點（實際遇過；詳見 `references/integration.md`）。
7. **曝光對準室內。**室內大約只有室外的 1/20：`exposure` 約 4.5，窗外用 `ext` 約 0.3 壓暗。
8. **反射在烘焙之後拍。**`captureEnv` 要在 `applyBake`／`runBake` 之後執行，探針放在房間中央。
9. **有窗外遠景時，鏡頭 far 要大於最遠的東西。**範本是 400 m（樹牆在 100 m、草地延伸到 260 m）。far 只有 100 時，遠景被切掉的那一圈會露出白色的地平線霧帶，而且跟著視角移動（實際遇過）。
10. **太陽的陰影相機要涵蓋窗外的樹冠**，樹蔭才會落進來：範本把太陽放在 30 m 外，near 12、far 40。

## 實測（範本，RTX 4090、Chrome headless、1280×800）

- 建立場景 1.2 秒，其中毛巾的垂掛約 0.65 秒；10.7 萬個三角形；從開頁到出畫面約 1.6 秒。
- 現場烘焙 128 spp：61,407 個取樣點、26 個 worker，6 秒，gi.bin 743 KB。重新載入後套用 39 個網格，0 個失效。
- `preview.jpg`：房間、桌邊、窗、只看光。`preview-bake.jpg`：左邊是平光，右邊是烘焙後。

## 進一步

- `references/workflow.md`：每個步驟的做法、要做的決定、交付物和檢查點。
- `references/integration.md`：各 skill 之間的介面、要注意的地方、遇過的問題。
- `references/checklist.md`：驗收清單，以及數字的參考範圍。
