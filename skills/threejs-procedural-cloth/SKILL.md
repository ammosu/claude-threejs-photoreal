---
name: threejs-procedural-cloth
description: 用程式「設計」出照片級的靜態布料（不做物理模擬）：沒鋪好的棉被、毯子、桌巾、垂下床緣或桌緣的布、翻起一角的被子、布上放東西，以及掛在桿子上的窗簾（吊環夾出的折、往下鬆開與散開、綁起下擺、車線與雙層縫邊、亞麻平織）。方法是平面高度場（團塊＋有方向的長折＋削峰＋逐條畫上的皺褶）→ 包到支撐物上 → 高的折往一側倒 → 翻角 → 依 3D 曲面攤平 UV → 細皺紋 normal map＋凹處變暗，含可重用程式庫、分階段範例、驗證數據，以及搬到 Godot／Unreal 的做法。當使用者說「程式生成布料」「棉被／床單／毯子／桌巾建模」「布料皺褶」「布垂下床邊」「被子翻一角」「布料不要用模擬」「cloth without simulation」「procedural cloth」「布上的花紋被拉長」「布料看起來像塑膠／像山」「窗簾建模」「程式生成窗簾」「窗簾皺褶」「curtain」「布簾」時使用。
---

# 程式設計布料（不模擬）

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），`src/scene/parts/bed.js` 的棉被、毯子、枕頭。
這裡把它拆成可重用的程式庫，附一個可以分階段檢視的範例。

**核心想法：布料不是「模擬」出來的，而是「設計」出來的。**
在平面座標上定義「每一點的布比支撐物高多少」，再把這張平面包到支撐物上。
好處是每一步都可控、可重現（同一個 seed 每次都一樣）、0.5 秒內建完，
而且其他東西（書、手機、另一條毯子）可以直接查詢同一個高度函式，保證貼在布面上。
代價是**布是靜態的**：不會被角色推動（要互動請看 `references/engines.md`）。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/cloth.js` | 程式庫（ES module，只依賴 three）：RNG／雜訊、Field、團塊、折痕族、皺褶、支撐物 drape、翻角、格網、UV 攤平、皺紋材質、印花、棉布材質、`exportableMesh`（匯出 GLB 前的轉換） |
| `example/index.html` + `main.js` | 一張床上沒鋪的棉被，`?stage=1..5` 逐步加上每個效果 |
| `scripts/curtain.js` | 窗簾：`curtainPanel`（不會伸長的剖面積分）、`auditPanel`、`linenTextures`（亞麻平織）、`curtainMaterial`（縫邊、車線、收納摺痕、逆光透光、微擺動）、`curtainRing` |
| `example/curtain.html` | 一對窗簾掛在窗前，`?cam=`（front、angle、top、hem、stitch、above）、`?tied=1`、`?fullness=`、`?loops=`、`?tex=checker` |
| `example/preview-*.jpg` | 範例的完成圖與各階段圖（`preview-curtain.jpg` 是窗簾） |
| `references/shape.md` | 高度場設計：團塊、長折、削峰、皺褶、平整區 |
| `references/drape-curl.md` | 支撐物、傾倒、平面扭曲、翻角、縫邊、在布上放東西、疊第二層布 |
| `references/uv-material.md` | UV 攤平、細皺紋 normal map＋cavity、印花、材質 |
| `references/verification.md` | 要看哪些數據、哪些鏡頭、常見症狀對照 |
| `references/curtain.md` | 窗簾：剖面積分與寬度求解、θ(s) 的組成、材質、參數、驗證、遇過的問題 |
| `references/engines.md` | 搬到 Godot／Unreal：匯出 GLB、改寫成 GDScript／C++、互動布料怎麼接 |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5420 --bind 127.0.0.1
# 開 http://127.0.0.1:5420/example/
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

URL 參數：
- `stage=1..5`：分別是團塊、加長折、加削峰、加皺褶、加翻角與傾倒。
- `cam=wide|close|top|side|left|foot`：鏡頭預設。
- `tex=checker`：換成 10 cm 棋盤格，用來檢查 UV 拉伸。
- `relax=0`：關掉 UV 攤平，拿來對照。
- `ui=0`：隱藏數據面板，截圖時用。

完成後 `window.__cloth` 會帶出驗證數據，`body[data-ready="1"]` 則表示已經可以截圖。
畫面上的「下載 GLB」按鈕可以把布料匯出給其他引擎使用。

## 流程

| 步 | 做什麼 | 為什麼 | 程式庫 |
|---|---|---|---|
| 1 | 平面座標裡定輪廓（四角）與「到縫邊的距離」 | 縫邊、皺褶淡出、翻角都要用 | `quadEdge` |
| 2 | **團塊**：手擺 5–10 個橢圓，各自有高度與角度，用 smooth-max 接起來 | 大形狀決定「這是什麼狀態的被子」，雜訊做不出來 | `makeLobes` `lobesAt` |
| 3 | **長折**：2–3 組有方向的 billow 雜訊，依區域換方向 | 被子的折會順著被拉的方向跑 | `foldFamily` |
| 4 | 垂下的部分做縱向波浪；整體 domain warp；soft cap 限高 | 垂布不是平的；避免出現尺畫的直線；最高的那團不要太誇張 | `softCap` |
| 5 | **削峰**：每一點最多比周圍（模糊兩次後）高約 1.2 cm，凹谷保持銳利 | 有填充物的布沒有尖峰；這一步讓它從「山」變成「被子」 | `Field.erodePeaks` |
| 6 | **皺褶一條一條畫**：從夾點扇形發散，加上其餘地方順著拉力場散佈，在平整區與縫邊附近減弱 | 皺褶用雜訊做會像大理石紋，要用「帳篷形剖面」的線段 | `CreaseSet` `crease` |
| 7 | 縫邊：平帶、車線凹槽、皺縮 | 邊緣是真實幾何，近看才可信 | 範例 `hemElev` |
| 8 | **包上支撐物**：平坦區＋圓角＋垂直往下 | 一張平面就能同時表現床上與床邊 | `boxSupport` |
| 9 | **高的折往一側倒**：倒的距離依該處高度決定 | 鼓包會變成一邊陡、一邊緩，不像對稱的饅頭 | 範例 `place` |
| 10 | **翻角**：越過折線的部分先沿圓筒捲起，再平躺回被子上；被壓住的區域設為平整區 | 加入一個說故事的細節 | `curl` |
| 11 | 依 3D 曲面**攤平 UV**（多重網格、邊長約束） | 印花在陡峭的折上不會被拉長 | `relaxUV` `uvStretch` |
| 12 | 材質：可重複的細皺紋 normal map（alpha 存 cavity）＋印花＋sheen | 幾何管公分級，貼圖管公釐級 | `wrinkleTexture` `sprigPrintTexture` `cottonMaterial` |

## 一定要遵守

1. **隨機一律走 `RNG(seed)`／`pn(...,seed)`，不能用 `Math.random()`。** 截圖回歸、烘焙光照、多人同步都靠它。
2. **大形狀用三次插值取樣（`Field.cubic`），皺褶用雙線性（`Field.bil`）。** 大形狀如果用雙線性，網格上會看到 5 mm 的格子面。
3. **皺褶不要用雜訊做。** 雜訊做出來是一團一團的；真實皺褶是有方向、兩端漸細的線。
4. **先削峰，再加皺褶。** 順序反過來，皺褶的脊線也會被削平。
5. **翻角底下的平整區要蓋住整個翻折範圍**（範例用 `QMAX` 自動計算）。沒蓋滿的話，翻過來的那片會疊在高團塊上，花紋會被拉成條狀（實際遇過，見 `references/verification.md`）。
6. **UV 攤平用的是「未翻折」的形狀 U**，翻折那片的拉伸要另外檢查。`relaxUV` 要求格數是 8 的倍數。
7. **垂布不能撞到底下的東西**：範例把床架做得比床墊窄。支撐物以外的碰撞不在這套方法的處理範圍內。
8. 兩個相鄰的邊同時垂下時，轉角需要錐形或三角布片，`boxSupport` 不處理，請只讓相對的兩邊垂下。

## 數值起點（範例實測）

- 棉被平躺厚度 5 cm，團塊高度 × `LOBE_SCALE`（0.3 是普通睡過，1 是堆成大捲），最高 soft cap 23 cm。
- 長折間距約 12 cm、長約 60 cm、振幅 3–4 cm；削峰半徑 5 格（2.5 cm），上限 1.2 cm。
- 皺褶寬 2.4–4 cm，高度約寬的 0.16–0.3 倍，30% 是凹槽；每個夾點 4–7 條，其他地方散佈 200 組。
- 網格約 7 mm（288×192），約 13 萬個三角形，建模約 0.45 秒（其中 UV 攤平約 0.15 秒），穿模 0，UV 拉伸 p5／p95 約 0.92／1.08。

## 窗簾（垂掛的布）

棉被的方法是「高度場包到支撐物上」，窗簾不適用。窗簾改成：**每一條水平剖面都是一條長度固定的線**，
沿著布積分行進角度 θ(s) 畫出來，再用二分法調整 θ 的倍數，讓這一列剛好等於該高度要的寬度。
布不會伸長，所以 UV 直接用公尺，紋理也不會變形。細節見 `references/curtain.md`。

```js
import { curtainPanel, auditPanel, linenTextures, curtainMaterial, curtainRing, CU } from './scripts/curtain.js';
const p = curtainPanel({ x0t: 0.27, x1t: 0.95, x0h: 0.25, x1h: 0.97, zc: 0.12, yTop: 2.29, yHem: 0.02, loops: 7, seed: 4101 });
const lin = linenTextures();
scene.add(new THREE.Mesh(p.geo, curtainMaterial({ map: lin.map, normalMap: lin.normalMap, yTop: 2.29 })));
console.log(auditPanel(p));   // crossings 必須是 0；stretchP95Pct 應該小於 1
```

- 範例實測：一片約 10 萬個三角形、0.2 秒建好，拉伸 p95 為 0.4–0.7 %，交叉 0。
- 坑：`depth` 夾太緊時，布會少掉 5–15 %。空間不夠就降 `fullness`，不要壓深度。
- 坑：下擺收得太窄時，折會互相穿過，門檻跟 seed 有關（範例右片在約 0.67 倍時仍有交叉，0.79 倍才通過）。要看 `crossings`，必要時換 seed。
- 預設 `depth` [-0.11, 0.16] 不會讓布縮短，但桿子要離牆約 12 cm。
