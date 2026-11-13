# 合成：影格 → 並排、字幕、片頭片尾 → mp4

錄影腳本只產出乾淨的影格；標籤、字幕、並排都在 Python（PIL）做。好處：改字幕不用重錄，重錄不用重做版面。

實例：海灘範例專案 `tools/make_walk.py`（最簡單的三欄並排）、`tools/make_video.py`（片頭＋四宮格＋片尾，pipe 進 ffmpeg）、
`tools/make_opensea.py`（依觸發時間 JSON 顯示字幕）、`tools/make_tidepool.py`。

## 1. 最簡單：逐格存 PNG，再 ffmpeg

```python
frames = {g: sorted(glob.glob(f"video/frames/walk_{g}/*.jpg")) for g in "ABC"}
n = min(len(v) for v in frames.values())          # 各組格數不同時以最短為準——但應該先查為什麼不同
for i in range(n):
    im = Image.new("RGB", (PW * 3, PH))
    for k, g in enumerate("ABC"):
        pane = Image.open(frames[g][i]).convert("RGB").resize((PW, PH), Image.Resampling.LANCZOS)
        label(pane, NAMES[g], COLORS[g]); im.paste(pane, (k * PW, 0))
    im.save(f"{OUT}/c_{i:05d}.png", compress_level=1)   # 暫存檔，壓縮等級 1 快很多
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{OUT}/c_%05d.png",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", out], check=True)
```

- 合成前先清空暫存資料夾，不然上次較長的輸出會留下多的格。
- `-pix_fmt yuv420p`：不加的話很多播放器（瀏覽器、簡報）放不出來。
- （一般 ffmpeg 常識）輸出寬高要是偶數（libx264 yuv420p 的限制）。

## 2. 不落地：rawvideo pipe

片頭、片尾、淡入淡出全部逐格算時，直接把 RGB bytes 寫進 ffmpeg stdin，省掉幾千張暫存 PNG：

```python
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                       "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
put = lambda im: ff.stdin.write(im.tobytes())
fade = lambda im, a: Image.blend(Image.new("RGB", im.size, "black"), im, max(0., min(1., a)))
for f in range(TITLE_S * FPS): t = f / FPS; put(fade(title, min(t / FADE, (TITLE_S - t) / FADE)))
for f in range(n): ...                                   # 主體：每格貼三組＋依 t 找字幕格
ff.stdin.close(); ff.wait()
```

`-movflags +faststart`：網頁／簡報裡邊下載邊播。

## 3. 字幕跟劇本同步

- 鏡頭路徑：字幕放在同一份 `path.json` 的 `captions: [{from, to, title, text}]`，錄影與合成讀同一份。
- 固定時間表（潮池）：`TIMELINE` 在錄影腳本 `export`；合成腳本若是 Python，至少在字幕表旁註明「與 record-xxx.mjs 的 TIMELINE 對應」，改一邊就改另一邊。
- 事件觸發（外海觀察）：錄影寫出 `video/<name>_<g>.json`（實際觸發時間＋提示文字），合成依它顯示「觀察到 X」。

## 4. 版本並排的公平性

- 同一條鏡頭路徑、同一個虛擬時間、同一個 viewport；並排格同一格 = 同一時刻。
- 標籤顏色與名稱各組固定，跟簡報其他頁一致。
- 嵌進簡報的版本另外用較高 crf 重編（海灘範例專案 用 crf 27）壓檔案大小；原始 crf 20 保留。

## 5. 完成後

- （一般做法，非該專案腳本）`ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4`：片長 = 片頭 + 格數/fps + 片尾。
- 用 `scripts/sheet.py` 對合成後的暫存格（或 `ffmpeg -vf fps=1` 抽格）再拼一張總表看一次：字幕位置、標籤、淡入淡出。
