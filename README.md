# threejs-photoreal

一個 Claude Code plugin，包含 10 個 skill：用 three.js 做照片級場景，**全部用程式生成**，不需要模型檔、貼圖或 HDRI。
方法改寫自 [room-at-dawn](https://github.com/Leonxlnx/room-at-dawn)（MIT），每個 skill 都附有可執行的範例、實測數據，以及實際遇過的問題。

## 安裝

```bash
claude plugin marketplace add ammosu/claude-threejs-photoreal      # 或本機路徑
claude plugin install threejs-photoreal@claude-threejs-photoreal
```

更新：修改這個 repo 之後，執行 `claude plugin marketplace update claude-threejs-photoreal`，再在 Claude Code 裡執行 `/reload-plugins`。

## Skill 一覽

| skill | 內容 |
|---|---|
| `threejs-photoreal-interior` | **入口**：整體流程、各步驟用哪個 skill、整合規則、一鍵開新專案（`scripts/new-project.sh`）、驗收清單 |
| `threejs-procedural-cloth` | 不做模擬的布料：棉被、毯子、桌巾、垂下的布、翻角；窗簾（吊環夾出的折、縫邊、亞麻） |
| `threejs-procedural-textures` | 程式生成材質：牆面、木地板、木紋、漆面、織物、使用痕跡、書封、假文字 |
| `threejs-lived-in-props` | 生活感小物：決定性的 PBD 布料垂掛（椅背、桿子、籃緣）、杯子、水壺、襪子、電線、紙團 |
| `threejs-procedural-vegetation` | 樹：分枝骨架、葉片圖集、四層風、三級 LOD |
| `threejs-procedural-pothos` | 黃金葛：會繞過物體生長的藤蔓、心形葉 |
| `threejs-sky-backdrop` | 天空（四種預設，看到的和照明用的一致）與窗外遠景（只建看得到的東西、霧化、房子、樹牆） |
| `threejs-baked-gi` | 用 CPU 路徑追蹤，把光照烘焙到頂點 |
| `threejs-realtime-post` | 即時後製：AO、bloom、窗外分開曝光、調色、自適應解析度 |
| `webgl-deterministic-recording` | 逐格算繪與無頭驗證；電影級輸出（景深、動態模糊、HDR10） |

## 跑範例

各範例之間以相對路徑互相引用（例如 `../../threejs-procedural-textures/`），所以要從 `skills/` 資料夾啟動伺服器：

```bash
cd skills && python3 -m http.server 5420 --bind 127.0.0.1
# 例如 http://127.0.0.1:5420/threejs-sky-backdrop/example/
```

不需要 npm。three 和 three-mesh-bvh 從 jsdelivr 載入。

## 授權

MIT，見 `LICENSE`。改寫自 room-at-dawn 的部分見 `NOTICE`；每個檔案的開頭都註明了來源。
