# 場景端 hook：讓時間可以從外面給

目標：腳本可以說「畫第 t 秒」「往前推 dt 秒」「等你準備好」，而且同一個 t 永遠畫出同一張圖。

## 1. 單一時鐘，優先順序：外部覆寫 → 網址凍結 → 真實時間

```js
const clock = new THREE.Clock();
const fixed = params.has('time') ? Number(params.get('time')) : null;
function frame() {
  requestAnimationFrame(frame);
  const t = window.__TIME__ ?? fixed ?? clock.getElapsedTime();
  water.material.uniforms.time.value = t;     // 所有 shader 與 JS 動畫都讀這個值
  // ...update(t)...; composer.render();
}
frame();
window.__SCENE__ = { scene, camera, renderer, water /* … */ };
window.__READY__ = true;                       // 資源載完、迴圈開始之後才設
```

- `?time=4`：靜態截圖、多版本比較都用同一個時間（海灘範例專案 截圖、驗證與遊戲錄影用 `time=4`；鏡頭路徑錄影從 `time=0` 起由 `__TIME__` 驅動）。
- `window.__TIME__`：錄影腳本每格設定。設了之後真實時鐘完全不參與。
- CPU 端若有跟 shader 對應的計算（波高、浮力、腳印是否在水中），也要拿同一個 `t`，
  而且要能任意 seek：`wave(x,z,4)`、`wave(x,z,6)`、再 `wave(x,z,4)`，第一次與第三次要相同（驗證腳本會測）。

實例：海灘範例專案 `src/main.js` 的 `frame()`。

## 2. 有狀態的遊戲：dt 從時鐘差算，step() 推進過的不要再算

遊戲不能只靠 `t` 重算（玩家位置、撿到的東西是累積狀態），所以有一個 `update(dt)`。
規則：**dt 一律是「水面時鐘」的差，不是 `performance.now()` 的差**——時鐘凍結，遊戲就凍結。

`?auto=1` 時開一個 `step(seconds)`，切成小步跑完，最後記下推進到哪：

```js
step(seconds) {
  let remaining = seconds;
  while (remaining > 1e-6) {
    const dt = Math.min(1/60, remaining);
    window.__TIME__ = time() + dt;
    water.material.uniforms.time.value = window.__TIME__;
    explore.update(dt); update(dt, window.__TIME__);
    remaining -= dt;
  }
  water.userData.simTime = window.__TIME__;   // ← 2026-10-21 加的一行
}
```

畫面迴圈的 dt：

```js
// 修正前：const gameDt = clamp(t - lastWaterTime, 0, .1);
const gameDt = Math.max(0, Math.min(.1, t - Math.max(lastWaterTime, water.userData.simTime ?? -Infinity)));
explore.update(gameDt); game.update(gameDt, t);
lastWaterTime = t;
```

為什麼要 `max()`：錄影腳本是「`step(1/30)` → 等兩次 rAF → 截圖」。修正前，step 已經把遊戲推進 1/30 秒，
接著 rAF 裡看到時鐘比上一格多了 1/30 秒，又推進一次 → **整段影片兩倍速**（角色、小船、划槳都是）。
修正後畫面迴圈只補算 `simTime` 之後的部分：step 驅動時補 0；沒人呼叫 step、時鐘自然走時，`simTime` 留在過去，照常推進。
兩種模式共用同一個迴圈，不用切換旗標。

`dt` 上限 0.1 秒：分頁切走回來時不會一次跳太遠。

實例：海灘範例專案 `src/game/index.js`（`step`）、`src/main.js`；commit `90756c4`。
注意同專案的非遊戲遊覽模式（`scene.html?explore=1`）仍用真實時間的 dt，所以只在 game 模式可逐格。

## 3. 子頁／iframe 自己的 step

獨立的小場景（海灘範例專案 的潮池 `tidepool.html`）不經過主迴圈，給它自己的 `step`：

```js
step(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('step requires nonnegative seconds');
  window.__TIME__ = time + seconds; update(window.__TIME__); render();   // 同步畫一格
}
```

- `step(0)`：時鐘不動、重畫一次。錄影時用來「凍結 iframe 的時鐘」以及重拍同一格。
- 嵌在主頁的 iframe 裡時，從主頁呼叫：`document.querySelector('#lagoon iframe').contentWindow.__TIDEPOOL__.step(dt)`。

## 4. 自動化 API 只在 `?auto=1` 掛

`window.__GAME__` 之類的 API（`step`、`teleport`、`view(yaw)`、`steer`、`interact`、`targets()`、狀態快照）
只在 `?auto=1` 時存在。好處：正式頁面沒有作弊入口；腳本若忘了加參數會立刻失敗而不是錄到錯的東西。
**不要給「直接完成任務」的 setter**：自動化走跟玩家一樣的互動路徑，驗證才有意義。

## 5. 特效與動畫：事件時間＋純函數

- 水花、尾流、揚沙、落地緩衝：記錄 `{位置, 事件時間}`，畫面由 `t - 事件時間` 算。不在每格 `particle.y += v*dt`。
- 尾流取樣（每 0.15 秒記一個船尾點）也算事件：取樣本身由時鐘決定，畫面由取樣＋`t` 算。
- 角色動畫混合器（`AnimationMixer`）是有狀態的；`update(0)` 必須是 no-op，見 gotchas 第 3 條。
- 驗證腳本加一條：`step(0)` 前後的角色姿勢快照要 `deepEqual`（海灘範例專案 verify-game 的 "frozen animation clock"）。

## 6. 後處理 sanitize pass（bloom 之前）

```js
const sanitize = new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: /* 標準 vUv */,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
  void main(){ vec4 c = texture2D(tDiffuse, vUv);
    gl_FragColor = any(isnan(c)) || any(isinf(c)) ? vec4(0.,0.,0.,1.) : min(c, vec4(1e4)); }` });
composer.addPass(renderPass); composer.addPass(sanitize); composer.addPass(bloomPass); composer.addPass(outputPass);
```

正常像素原樣通過（海灘範例專案 A 組固定鏡頭前後只差 1 個色階）。實例：`src/main.js`，commit `c234601`。
