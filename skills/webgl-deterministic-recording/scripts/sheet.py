"""縮圖總表＋影格異常掃描（全黑格、單格閃爍）。

用法：
  python3 sheet.py <影格資料夾> <輸出.jpg> [縮圖數=24] [glob=*] [欄數=6]

- 掃描（SCAN=0 可關）：每一格縮成 96x54 灰階算平均亮度（0–255），全部影格都掃，不只縮圖那幾張。
    DARK  亮度 < DARK_LUMA（預設 8）：近全黑格（NaN 被 bloom 擴散、context 掛掉、截到清除色）。
    SPIKE 與前後兩格都差 > SPIKE_JUMP（預設 6），且前後兩格彼此差 < SPIKE_STEADY（預設 3）：
          單格閃爍（截到半成品、少一層）。淡入淡出、轉場是連續變化，不會被標成 SPIKE。
  SPIKE 只對連續影格有意義；拿來看一批互不相關的驗證截圖時會誤報，用 SCAN=0 或 STRICT=0。
  門檻是 海灘範例專案 的海灘場景調出來的；很暗的場景要調低 DARK_LUMA。
- 縮圖：從全部影格平均取 N 張，左上角標檔名，存成一張 JPEG 給人看。
- 有 DARK 或 SPIKE 時結束碼為 1（STRICT=0 則一律 0），可以放在錄影腳本後面當關卡。
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageStat

if len(sys.argv) < 3:
    sys.exit(__doc__)
d, out = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 24
pat = sys.argv[4] if len(sys.argv) > 4 else "*"
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 6
DARK_LUMA = float(os.environ.get("DARK_LUMA", 8))
SPIKE_JUMP = float(os.environ.get("SPIKE_JUMP", 6))
SPIKE_STEADY = float(os.environ.get("SPIKE_STEADY", 3))

files = sorted(f for f in glob.glob(os.path.join(d, pat)) if f.lower().endswith((".jpg", ".jpeg", ".png")))
if not files:
    sys.exit(f"no frames in {d} matching {pat}")
print(len(files), "frames")

bad = 0
if os.environ.get("SCAN", "1") == "1":
    lum = [ImageStat.Stat(Image.open(f).convert("L").resize((96, 54))).mean[0] for f in files]
    for i, v in enumerate(lum):
        if v < DARK_LUMA:
            bad += 1
            print("DARK", i, os.path.basename(files[i]), round(v, 1))
        if 0 < i < len(lum) - 1:
            a, b = lum[i - 1], lum[i + 1]
            if abs(v - a) > SPIKE_JUMP and abs(v - b) > SPIKE_JUMP and abs(a - b) < SPIKE_STEADY:
                bad += 1
                print("SPIKE", i, os.path.basename(files[i]), round(a, 1), round(v, 1), round(b, 1))
    print("luma min/max", round(min(lum), 1), round(max(lum), 1), "| flagged", bad)

pick = [files[round(i * (len(files) - 1) / max(1, n - 1))] for i in range(n)] if len(files) > n else files
w, h = Image.open(pick[0]).size
tw = 320
th = round(h * tw / w)
sheet = Image.new("RGB", (cols * tw, ((len(pick) + cols - 1) // cols) * th))
for i, f in enumerate(pick):
    im = Image.open(f).convert("RGB").resize((tw, th))
    ImageDraw.Draw(im).text((4, 4), os.path.basename(f), fill="yellow")
    sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
sheet.save(out, quality=85)
print(out)
sys.exit(1 if bad and os.environ.get("STRICT", "1") == "1" else 0)
