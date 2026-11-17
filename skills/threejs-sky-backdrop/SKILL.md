---
name: threejs-sky-backdrop
description: 在 three.js 用程式做天空與窗外遠景，不需要 HDRI 或圖檔。天空的同一份參數同時用在三個地方：烘焙光照用的解析式天空、看得到的天空球（雲層、高空薄雲、地平線霧帶、太陽），以及不烘焙時用的太陽光、半球光與環境貼圖。內含四種預設（清晨、白天、陰天、黃昏）和一個量測工具，確認看到的天空和照亮場景的天空亮度一致。遠景部分包括：只建從室內窗戶看得到的東西（窗洞可見性與 LOD）、隨距離變淡的大氣霧化、遠處逐漸變粗的草地網格、碎石小路、樹籬、鄰居房子（陶瓦屋頂、窗戶、煙囪、天窗）、封住地平線的遠方樹牆，並可以搭配 threejs-procedural-vegetation 種樹。當使用者說「天空」「sky shader」「雲」「程式生成天空」「不用 HDRI」「窗外景色」「遠景」「背景房子」「地平線」「大氣透視」「霧化」「窗外的樹」「天空和光照對不上」「清晨／黃昏／陰天的天空」「只建看得到的東西」「god rays」「雲隙光」「光束從樹葉間透出來」「日夜變化」「全景天空接縫」時使用。
---

# 天空與遠景

來源：[room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），出自 `src/scene/sky.js`、`src/scene/parts/exterior.js`。

**核心想法：天空只描述一次。**
- 烘焙器用的是一個解析式的天空：從地平線到天頂的漸層，加上太陽方向的光暈。
- 看得到的天空球在同一個漸層上加了雲，但要讓**平均亮度維持和漸層差不多**：雲間的晴空比平均暗，雲邊比較亮，雲心大致相等。
- 這樣窗外看到的天空，和照進房間的光才會對得上。`measureDome` 用來量這件事。

## 檔案

| 路徑 | 內容 |
|---|---|
| `scripts/sky.js` | `SKIES`（dawn、day、overcast、golden）、`skyRadiance`（和 `threejs-baked-gi` 的 worker 同一個公式）、`bakeCfg`、`skyDome`、`SKY_U`（uTime）、`skyLights`、`skyEnvironment`、`measureDome` |
| `scripts/backdrop.js` | `windowVisibility`（窗洞可見性與 LOD）、`hazePatch`（大氣霧化，會保留原本的 shader 補丁）、`grassTexture`、`roofTexture`、`windowTexture`、`crownTexture`、`Soup`、`houses`、`lawn`、`gravelPath`、`hedge`、`crownWall` |
| `example/` | 二樓的房間（地板高出花園 5.5 m）往窗外看：草地、小路、樹籬、三棟房子、樹、遠方樹牆 |
| `example/preview*.jpg` | 四種天空從室內看出去；窗前、仰望天空；外面俯瞰 |
| `references/sky.md` | 天空著色器的每一層、預設參數、怎麼調、和烘焙怎麼接 |
| `references/backdrop.md` | 可見性判斷、霧化、各遠景元件、效能數據、遇過的問題、搬到其他引擎 |
| `references/outdoor-sky-and-rays.md` | 戶外自由移動鏡頭的天空、全景圖接縫、日夜連續變化、雲隙光（god rays）pass。整理自 MengTo/Skills，尚未實測 |

範例的樹借用了 `threejs-procedural-vegetation`（相對路徑 `../../threejs-procedural-vegetation/`）。

## 跑範例

```bash
cd <skill 資料夾>/.. && python3 -m http.server 5426 --bind 127.0.0.1
# http://127.0.0.1:5426/threejs-sky-backdrop/example/
```
（`<skill 資料夾>` 是載入這個 skill 時顯示的 Base directory；裝成 plugin 時位於 `~/.claude/plugins/cache/` 底下）

- `?sky=dawn|day|overcast|golden`：天空預設。
- `?cam=window|wide|up|out`：從房間看出去／窗前／仰望天空／外面俯瞰。
- `?cull=0`：不做可見性裁切，拿來比較。
- `?t=5`：固定時間，雲不會飄。

`window.__sky` 帶有耗時、三角形數、葉片數，以及天空球對解析式天空的比值。

## 用法

```js
import { SKIES, skyDome, bakeCfg, skyLights, skyEnvironment, measureDome, SKY_U } from './scripts/sky.js';
const S = SKIES.dawn;
scene.add(skyDome(S));                                       // 有烘焙的室內：display 0.3（預設）；戶外：skyDome(S, { display: 1 })
const cfg = { ...bakeCfg(S), portal, room };                 // 交給 threejs-baked-gi 的 runBake
// 不烘焙的場景：
const { sun, hemi } = skyLights(S); scene.add(hemi); if (sun) scene.add(sun, sun.target);
scene.environment = skyEnvironment(renderer, S);
console.log(measureDome(renderer, S));                       // ratio 0.85–1.15
renderer.setAnimationLoop((ms) => { SKY_U.uTime.value = ms / 1000; ... });
```

## 一定要遵守

1. **天空只描述一次**：烘焙、天空球、光源都從同一個預設產生。改了天空的顏色，就要重新烘焙。
2. **調完雲要跑 `measureDome`。**它會把天空球畫進一張 float cube map，用 cos 加權算出上半球的平均，和解析式天空比較。
   - 比值要在 0.85–1.15 之間，否則窗外的天空會和照進來的光對不上。
   - 加上 `{ pure: true }` 會只畫漸層，結果必須剛好是 1.000，用來確認量測本身沒問題。
3. **雲的顏色是絕對亮度**，和天空同一個單位，不是乘數。我試過改成跟著漸層縮放，清晨的比值掉到 0.73，所以改回原專案的寫法。
4. **有烘焙的室內，天空球要畫暗一點**（`display` 約 0.3）。曝光是對準室內的，天空照實際亮度畫會變成一片白、失去顏色；這和照明用的亮度無關。
5. **只建看得到的東西。**`windowVisibility` 從房間裡多個眼睛位置，穿過有厚度的窗洞往外看。
   - 看不到的葉片：交給植物 skill 的 `lodAt` 回傳 0，只留少量大卡片，讓烘焙時還有樹蔭。
   - 只有斜看才看得到的：回傳 1，變稀疏。
6. **遠景要加 `hazePatch`。**距離 10 m 以外，往地平線的顏色淡出，否則遠處的房子和樹會和近景一樣深、一樣飽和，看起來像貼紙。

## 實測（RTX 4090、Chrome headless、1280×800）

| 項目 | 數值 |
|---|---|
| 天空球 ÷ 解析式天空 | dawn 0.934、day 1.080、overcast 1.034、golden 1.034；pure 模式 1.000 |
| 遠景（草地、路、樹籬、房子、樹牆） | 31–34 ms |
| 樹（4 棵主樹、8 棵中景、26 棵遠景） | 生成 0.14–0.16 s，建 mesh 0.31 s |
| 可見性裁切 | 葉片 117,808 → 97,589（−17%），三角形 42.5 萬 → 38.3 萬。省下的主要是貼著外牆、在窗戶兩側的兩棵樹 |
| 天空環境貼圖加上兩次量測 | 約 0.09 s |
