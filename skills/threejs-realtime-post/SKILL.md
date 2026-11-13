---
name: threejs-realtime-post
description: three.js 即時寫實後製，一個小類別就能用，不需要 EffectComposer：HDR 半精度場景、半解析度接觸陰影 AO（14 個取樣、IGN 雜訊、依深度模糊）、窗外與室內分開曝光（像手機 HDR 合成，窗戶不會死白）、6 層 bloom、調色（曝光、白平衡、光線中的暗角、暗部／中間調／亮部分別偏色、飽和度加植物綠色增豔、以中灰為支點的對比、Uchimura 膠片曲線，高光往白色收而不是撞到原色、顆粒與 dither）、色調預設（neutral／dawn／warm／flat），以及自適應解析度（守住影格時間）。附有窗外陽光花園的房間範例，可與 three.js 預設 ACES 對照。當使用者說「three.js 後製」「post processing」「寫實調色」「color grading」「tone mapping 太灰／太平」「ACES 看起來不對」「窗戶過曝」「室內外亮度差太多」「SSAO／AO」「接觸陰影」「bloom」「暗角」「底片顆粒」「畫面有色帶 banding」「自適應解析度」「掉幀時降解析度」時使用。
---

# 即時寫實後製

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），出自 `src/render/pipeline.js`、`look.js`、`src/game/game.js`。
原專案的即時遊玩、截圖、電影輸出都用同一套調色。這裡只整理了即時的部分。
電影輸出（子畫面累積、HDR10）請看 `webgl-deterministic-recording` 的第 6 節。**注意：那邊的 `Accumulator` 有自己的 ACES 調色，沒有 AO、bloom，也沒有窗外分開曝光，所以兩邊目前不是同一套調色。**要讓影片和即時畫面一致，就把這裡的 `FINAL_FS` 搬到 `Accumulator.present` 裡。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/post.js` | `Post`（`setSize`、`render(scene, camera, target)`、`setLook`）、`LOOK`（中性預設）、`LOOKS`（neutral、dawn、warm、flat）、`AdaptiveRes`（`tick(dt, renderMs)`；60 Hz 螢幕上要傳入實測的算繪時間才會把解析度調回去） |
| `example/` | 有窗戶的房間：沙發、書架、立燈、角落盆栽，窗外是陽光下的草地與樹 |
| `example/preview.jpg` | 六格比較：完整後製／three.js ACES／窗外不壓暗／dawn 色調／角落 AO 開與關 |
| `references/passes.md` | 每個 pass 的做法和數值、調色參數表、遇過的問題、效能、搬到 Godot／Unreal |

## 跑範例

```bash
cd <skill 資料夾> && python3 -m http.server 5423 --bind 127.0.0.1
# 開 http://127.0.0.1:5423/example/
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

範例的 URL 參數：

| 參數 | 作用 |
|---|---|
| `?post=three` | 換成 three.js 的 ACES，拿來對照 |
| `?ao=0`、`?bloom=0` | 關掉 AO 或 bloom |
| `?ext=1` | 窗外不壓暗 |
| `?grade=0` | 不調色 |
| `?look=dawn`、`?look=warm` | 換色調預設 |
| `?cam=` | 鏡頭：room、corner、window |
| `?res=adaptive` | 開啟自適應解析度 |

## 用法

```js
import { Post, LOOKS, AdaptiveRes } from './scripts/post.js';
const renderer = new THREE.WebGLRenderer({ antialias: false });          // 抗鋸齒由 HDR render target 的 MSAA 負責
const post = new Post(renderer, { ext: 'wp.z < -1.75' })                 // 選用：世界座標的條件，符合的算「窗外」
  .setLook({ ...LOOKS.neutral, exposure: 1.3, ext: 0.35 });              // 窗外亮度乘 0.35
post.setSize(innerWidth, innerHeight, { msaa: 4 });
renderer.setAnimationLoop(() => post.render(scene, camera));
```

- `Post` 會把 renderer 設成 `LinearSRGBColorSpace` 加 `NoToneMapping`。色調映射和 sRGB 轉換都由最後一個 pass 處理，**不要再開 three.js 的 toneMapping**。
- `ext` 是一段 GLSL 布林運算式，可以用 `wp`（世界座標）。天空（沒有深度的像素）一律算窗外。
  例如窗在 z = −1.5 的牆上，就寫 `wp.z < -1.75`。
- 截圖或錄影時把 `look.grain` 設成 0，或者固定 `post.frame`，雜訊才會每格一樣（顆粒和 AO 的雜訊種子都由 `frame` 決定）。

## 一定要遵守

1. **場景要用線性 HDR 的亮度。**天空比白牆亮 3–5 倍，燈罩的 emissive 也要大於 1，bloom 和膠片曲線才有東西可以處理。
2. **曝光要依場景設定。**沒有 GI 的場景約 1–1.5；用 `threejs-baked-gi` 烘焙過的房間會高很多（原專案是 19）。
3. **窗外要分開曝光。**`ext` 0.2–0.4 接近手機 HDR 照片的效果，1 則是真實相機（窗戶會死白）。原專案的 SDR 用 0.21、HDR 用 0.55。
4. **AO 只是補充。**它只在「被照亮得不強」的地方作用（亮度大於 0.6 開始淡出，2.5 時完全消失），窗外的 AO 也減半，所以不會把有陽光的地方弄髒。
   主要的明暗還是要靠真正的光照或烘焙。
5. **bloom 不要太強。**強光源旁的物體要看得出形狀。預設值 0.04；原專案用 0.08，但它沒有離牆很近的點光源。
6. 顆粒之外還要加 1/255 的 dither，否則牆面的漸層會出現色帶。

## 實測（RTX 4090、Chrome headless、1280×800、MSAA 4）

- 完整後製的影格時間為 0.8–2.0 ms（CPU 端量測，含 `gl.finish`），three.js 單純 ACES 為 1.5–1.8 ms。在這張卡上兩者分不出差別。
  在弱顯卡上，AO 是最貴的一步：每個像素 14 次取樣，再加兩次模糊。
- 窗外：`ext=0.35` 時看得見樹和草地；`ext=1` 時整個窗戶死白（three.js ACES 也一樣）。
- 角落 AO：比對 `?cam=corner&grade=0` 開與關 AO 的截圖。整張平均暗 1.5 個色階，牆角線、盆栽底部、葉片之間、窗台下方最多暗 55 個色階；5.6% 的像素差超過 8 個色階。
- 中性預設和 three.js ACES 比起來：暗部較深、高光往白色收得比較柔和，植物的綠色比較飽和。dawn 預設偏冷、偏藍。
