# 踩坑紀錄：症狀 → 原因 → 修法

每一條都在 海灘範例專案 真的發生過。括號內是 commit 或檔案。

## 1. 遊戲錄影整段兩倍速

- **症狀**：逐格錄的遊戲影片裡，角色走路、小船、划槳都快得不自然；靜態截圖與驗證腳本都正常。
- **原因**：錄影每格做「`__GAME__.step(1/30)` → 等兩次 rAF → 截圖」。`step()` 已經把遊戲推進 1/30 秒並設定 `__TIME__`；
  接著頁面的 rAF 迴圈看到時鐘比上次畫面多了 1/30 秒，用這個差當 dt 又更新一次。每格推進兩次。
- **修法**：`step()` 結束時記下 `simTime`，畫面迴圈的 dt 改成 `t - max(lastFrameTime, simTime)`（程式見 hooks.md 第 2 節）。
- **教訓**：「step 推進」與「畫面迴圈推進」只能有一個負責一段時間。只要錄影腳本有 step 又有等 rAF，就要檢查這一點。
  驗證腳本通常只 step 不錄影，抓不到這個 bug；要看影片的實際速度才發現。
- 修正後要重錄所有用到 step 的影片（海灘範例專案：外海、遊戲精華、遊戲潮池、走位四支）。（`90756c4`）

## 2. 整格空白、只剩背景色（偶發，或 30% 的格）

- **症狀**：某幾格整片是天空色／清除色，前後格正常。另一個版本（同場景 Opus 實作）錄影時約 30% 的格全黑。
- **原因**：某個像素算出 NaN 或 Inf（例子：茅草材質 alpha test 加 bump map；某棵棕櫚在遊戲模式的某角度），
  bloom 的模糊把那一個像素擴散到整個畫面。
- **修法**：bloom 之前加 sanitize pass（NaN/Inf → 黑、上限 1e4，hooks.md 第 6 節）。根本原因仍要找：哪個材質在什麼角度產生 NaN。
- **怎麼抓到**：`scripts/sheet.py` 的 `DARK` / `SPIKE` 掃描，或驗證腳本「截圖檔案大小過小」斷言。（`c234601`、PLAYBOOK「換模型比較」）

## 3. 逐格錄影，角色停在 rest pose / T pose

- **症狀**：即時玩正常，逐格錄影某些格（或整段靜止時）角色變回綁骨姿勢。
- **原因**：角色 `update(dt)` 的流程是 `restore()`（骨頭回到 rest）→ `mixer.update(dt)` → 程序化 IK。
  時鐘凍結（`?time=`、`step(0)`）或 step 之後的畫面迴圈（hooks.md 的修正讓它補算 0），都會呼叫 `update(0)`。
  `restore()` 把骨頭改回 rest，但 three.js 的 `PropertyMixer` 發現動畫輸出值跟上次 apply 時一樣，**就不寫回骨頭**，
  於是 rest pose 留在畫面上。
- **修法**：dt = 0 且已經擺過姿勢時直接 return，不 restore：

  ```js
  // A dt=0 call (a render between offline steps) keeps the current pose. Re-running restore() there would leave
  // the rest pose on screen: three.js PropertyMixer skips writing values that did not change since its last apply.
  if (!dt && posed && !animation) return; posed = true;
  ```
- **驗證**：`step(0)` 前後角色姿勢快照 `deepEqual`。（`src/game/character.js` 的 `update()`）
- 推廣：任何「先重設再疊加」的流程（骨頭、粒子、變形）在 dt = 0 時都要確認重設之後真的會被寫回。

## 4. 偶爾一格少了一層（水面不見）

- **症狀**：無頭 GPU 截圖偶爾截到缺水面的畫面，同一時間重畫就正常。
- **原因**：頁面自己的 rAF 迴圈與 `step()` 的同步 render 交錯，截到半成品。
- **修法**：錄影時用 `addInitScript` 把 `requestAnimationFrame` 換成 no-op，只靠 `step()` 畫；
  每格重拍（`step(0)`）直到有兩張 byte 完全相同才採用，最多 6 次，都不同時取檔案大小居中那張。
  完成後仍要掃一次單格閃爍。（`scripts/record-tidepool.mjs`）

## 5. SwiftShader 截圖偶爾是一片底色

- **症狀**：驗證截圖某張是純清除色，同姿勢重拍正常。
- **修法**：截圖前等兩次 rAF 並呼叫 `renderer.getContext().finish()`；截圖檔案小於門檻（海灘範例專案 1280×720 PNG 用 100 KB）就重拍，
  重拍 3 次仍太小就讓驗證失敗：

  ```js
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__SCENE__.renderer.getContext().finish(); r(); }))));
    frame = await page.screenshot({ path });
    if (frame.length > 100000) break;
  }
  assert(frame.length > 100000, `${name}: unexpectedly empty software-rendered frame`);
  ```
  （`scripts/verify-game.mjs` 的 `shot()`）

## 6. 開過 iframe 子場景後，主場景畫面變空白

- **症狀**：遊戲裡開潮池（iframe 內另一個 three.js 頁面）再關掉，SwiftShader 下主畫面變空白。
- **原因**：同時存在兩個 WebGL context。
- **修法**：關閉時把 iframe `src` 設成 `about:blank` 真正卸載；開著時主場景設 `suspended` 跳過繪製。
  進度存在主頁（輪詢 iframe 的狀態），不靠 iframe 存活。驗證腳本斷言關閉後 `src === 'about:blank'`、重開後進度還在。
  （`src/game/lagoon.js`）

## 7. 錄到一半全是錯誤或 404

- **原因**：dev server 被別的程序關掉。codex 等代理執行結束時，會把它啟動（或接手）的 Vite 一起結束。
- **修法**：錄影前確認 port 有回應；dev server 自己在背景開，brief 裡寫「伺服器已在跑，不要另開或關掉」。

## 8. 想倒回某個時間重錄，狀態卻不對

- **原因**：時鐘可以 seek，遊戲狀態不行——撿過的東西、球的軌跡、任務進度不會因為 `__TIME__` 變小而還原。
- **修法**：重錄一段 = 重新載入頁面（或遊戲的 replay）＋同一串輸入。劇本要從乾淨狀態開始、只用確定性輸入。

## 9. 鏡頭穿過物件、構圖不對

- **原因**：鏡頭關鍵格只看座標設計；內插後的路徑會擦過物件。
- **修法**：正式錄之前用 0.5–2 fps 預覽、拼縮圖總表看。海灘範例專案 第一次預覽就抓到鏡頭穿過陽傘和小船。
  遊戲第三人稱鏡頭另外做碰撞，驗證腳本斷言整段劇本中鏡頭與角色的最小距離（`cameraAudit.minObserved >= 1.6`）。

## 10. SwiftShader 同時開兩頁很慢

- 軟體算繪下桌機頁還在跑時再開手機頁，載入約 40 秒；`waitForFunction` 的 timeout 要放寬（海灘範例專案 120 秒），
  或先關掉前一頁。（`b583de8`、`scripts/verify-explore.mjs`）
- 更糟的情況：主遊戲頁（已經跑了一長串互動、開過 iframe）還開著時再開一個**完整遊戲頁**，放寬到 120 秒也一直等不到 `__READY__`。
  新的檢查要開新頁時，放在主頁 `page.close()` 之後（海灘範例專案：「跳過推船後船槳要在」那段，`scripts/verify-game.mjs`）。

## 11. 效能數字不能從無頭截圖得出

- SwiftShader 每格 1.6 秒，只代表「畫得對、可重現」，不能聲稱實機 60 fps。要量 CPU 成本，量 `step()` 的毫秒數並註明「不是 GPU 幀率」。

## 12. 驗證跑到一半莫名失敗：自己改了 src

- **症狀**：回歸腳本在中段失敗，錯誤跟改動無關（例如 `querySelector(...)` 是 null、iframe 不見）；重跑就過。
- **原因**：腳本跑在 Vite dev server 上，驗證期間存檔 `src/` 底下任何檔案（連只改註解），HMR 都會讓頁面整頁重新載入，正在進行的流程就斷了。
  海灘範例專案：`sea.js` 12:12:19 存檔，`verify-game` 12:12:20 失敗。
- **修法**：驗證或錄影在跑時，不碰 `src/`；要邊跑邊改，用另一個 port 的 worktree，或用打包好的 `dist/`。

## 13. 背景指令「成功」，測試其實失敗

- **症狀**：`node verify.mjs > log; tail -3 log` 丟到背景，通知說 exit code 0，就提交了；之後才發現 log 裡是失敗。
- **原因**：背景指令的結束碼是**最後一個指令**（`tail`）的，不是測試的。
- **修法**：`node verify.mjs > log 2>&1; echo "EXIT $?" >> log`，看 log 最後那行 `EXIT` 再決定提交；不要在同一串指令最後接 `tail`、`cp` 這類一定成功的指令。

## 14. 模擬（DRY）也會寫檔

- `DRY=1` 只是不截圖，劇本仍照跑，可能覆寫給字幕或合成用的資料（海灘範例專案：`video/opensea_<g>.json` 的觀察時間）。
  影片沒重錄時，這些檔要對應舊影片：跑之前備份，跑完還原。

## 15. 除錯腳本得到 NaN

- 頁面用 `?time=N` 凍結時，`window.__TIME__` 可能還是 `undefined`；`step(target - window.__TIME__)` 得到 `step(NaN)`，之後時鐘、位置全是 NaN，
  看起來像程式的 bug。除錯腳本一開始先設 `window.__TIME__ = N`，跟正式腳本一樣。
