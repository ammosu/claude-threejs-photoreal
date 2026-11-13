// Headless film render on the real GPU, in resumable chunks, then the final encodes.
// Needs film-server.mjs running (same cwd!) and a page that exposes the contract below.
//   node render-film.mjs --url http://127.0.0.1:5430/example/film.html                 all shots, 3840x2160 30 fps, HDR10 + SDR
//   node render-film.mjs --url ... --w 1280 --h 720 --samples 8 --shots 0 --out out/test --hdr 0
//   node render-film.mjs --url ... --stills 1.5,4 --w 1280 --h 720                   SDR stills -> out/still_<t>.jpg
//   node render-film.mjs --concat --out out/film --name myfilm                          only the final encodes from finished chunks
// Page contract:
//   window.__ready                         set when the scene is built
//   window.__filmRanges(fps)  -> [{shot, name, from, to}]   frame ranges per shot
//   window.__film({w,h,fps,samples,shot,from,to,out,hdr,sdr}) -> {hdr: exitCode, sdr: exitCode}   renders frames [from,to) of one shot
//   window.__still(t, {w,h,samples})       one SDR frame to the canvas
//   window.__filmProgress = {frame, at}    updated every frame (watchdog)
// playwright-core: PW=/path/to/playwright-core/index.mjs if it is not resolvable from here.
// Adapted from room-at-dawn (MIT) tools/film.mjs (puppeteer/Windows -> playwright-core/Linux).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const { chromium } = await import(process.env.PW || 'playwright-core');
const argv = process.argv.slice(2);
const o = { url: '', w: 3840, h: 2160, fps: 30, samples: 16, out: 'out/film', name: 'film', shots: '', stills: '', concat: false, noconcat: false, hdr: 1, sdr: 1, chunk: 60, max: 0, threads: 8, chrome: '' };
for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'concat' || k === 'noconcat') { o[k] = true; continue; } const v = argv[++i]; o[k] = ['url', 'shots', 'stills', 'out', 'name', 'chrome'].includes(k) ? v : Number(v); }
const outDir = path.dirname(o.out), base = path.basename(o.out);
fs.mkdirSync(outDir, { recursive: true });
const stamp = () => new Date().toISOString().slice(11, 19);

function concat(kind) {
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(base + '_') && f.endsWith(`_${kind}.mp4`) && fs.existsSync(path.join(outDir, f.replace(`_${kind}.mp4`, '.done')))).sort();
  if (!files.length) return console.log('no finished chunks for', kind);
  const list = path.join(outDir, `list_${kind}.txt`); fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const snd = path.join(outDir, 'soundtrack.m4a'), hasSnd = fs.existsSync(snd);
  const src = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...(hasSnd ? ['-i', snd, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'copy', '-shortest'] : ['-an'])];
  const run = (args, dst) => { execFileSync('ffmpeg', [...src, ...args, '-movflags', '+faststart', dst], { stdio: ['ignore', 'ignore', 'inherit'] }); console.log(stamp(), 'wrote', dst, (fs.statSync(dst).size / 1e6).toFixed(1) + ' MB'); };
  // libx264 only writes primaries/transfer into the stream VUI via -x264-params (the -color_* flags alone left them 'unknown')
  const c709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709'];
  if (kind === 'hdr') {
    run(['-c:v', 'libx265', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv',
      '-x265-params', `pools=${o.threads}:aq-mode=3:hdr10=1:hdr10-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,180:log-level=error`,
      '-tag:v', 'hvc1'], path.join(outDir, `${o.name}_hdr10.mp4`));
  } else {
    run(['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-threads', String(o.threads), '-pix_fmt', 'yuv420p', ...c709], path.join(outDir, `${o.name}_sdr.mp4`));
    if (o.h > 1080) run(['-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-threads', String(o.threads), '-pix_fmt', 'yuv420p', ...c709], path.join(outDir, `${o.name}_1080p_sdr.mp4`));
  }
}
if (o.concat) { if (o.hdr) concat('hdr'); if (o.sdr) concat('sdr'); process.exit(0); }

const pwDir = path.join(os.homedir(), '.cache/ms-playwright');
const exe = o.chrome || (fs.existsSync(pwDir) ? fs.readdirSync(pwDir).filter((d) => d.startsWith('chromium-')).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-linux64/chrome')).find((p) => fs.existsSync(p)) : undefined);
const stillMode = o.stills !== '';
const vw = stillMode ? o.w : 960, vh = stillMode ? o.h : 540;
let browser = null, page = null;
async function open() {
  if (browser) { try { await browser.close(); } catch {} }
  browser = await chromium.launch({ executablePath: exe, headless: true,
    args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', '--mute-audio', '--js-flags=--expose-gc --max-old-space-size=8192'] });
  page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(0);
  // no HMR socket: a file saved elsewhere must not reload the page in the middle of a render (matters under Vite)
  await page.addInitScript(() => { window.WebSocket = class { constructor() { this.readyState = 3; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
  page.on('console', (m) => { const t = m.text(); if (/^\[(film|gpu)\]/.test(t) || m.type() === 'error') console.log(stamp(), t.slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message));
  await page.goto(o.url, { waitUntil: 'load', timeout: 180_000 });
  await page.waitForFunction('window.__ready || window.__error', null, { timeout: 0, polling: 500 });
  const err = await page.evaluate('window.__error'); if (err) throw new Error(err);
  console.log(stamp(), 'GPU:', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }));
}
await open();

if (stillMode) {
  for (const t of o.stills.split(',').map(Number)) {
    await page.evaluate(async ([t, o]) => { await window.__still(t, { w: o.w, h: o.h, samples: o.samples }); }, [t, o]);
    const file = path.join(outDir, `still_${String(t).replace('.', '_')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 }); console.log('still', file);
  }
  await browser.close(); process.exit(0);
}

const ranges = await page.evaluate((fps) => window.__filmRanges(fps), o.fps);
const want = o.shots === '' ? null : o.shots.split(',').map(Number);
const chunks = [];
for (const r of ranges) { if (want && !want.includes(r.shot)) continue; for (let a = r.from; a < r.to; a += o.chunk) chunks.push({ shot: r.shot, name: r.name, from: a, to: Math.min(r.to, a + o.chunk) }); }
if (o.max) chunks.length = Math.min(chunks.length, o.max);
const t0 = Date.now(); let done = 0;
for (const c of chunks) {
  const tag = String(c.shot + 1).padStart(2, '0') + '_' + c.name + '_' + String(c.from).padStart(5, '0');
  const mark = `${o.out}_${tag}.done`;
  if (fs.existsSync(mark)) { done++; continue; }                     // resumable: finished chunks are skipped
  for (let attempt = 1; ; attempt++) {
    try {
      await page.evaluate(() => { window.__filmProgress = { frame: -1, at: Date.now() }; });
      const job = page.evaluate(([o, c]) => window.__film({ w: o.w, h: o.h, fps: o.fps, samples: o.samples, out: o.out, shot: c.shot, from: c.from, to: c.to, hdr: !!o.hdr, sdr: !!o.sdr }), [o, c]);
      let alive = true; job.then(() => (alive = false), () => (alive = false));
      const dog = (async () => {                                      // watchdog: no new frame for 5 minutes -> retry the chunk
        let lastSeen = Date.now(), lastFrame = -2;
        while (alive) {
          await new Promise((r) => setTimeout(r, 15000)); if (!alive) return;
          const fr = await Promise.race([page.evaluate(() => window.__filmProgress.frame), new Promise((r) => setTimeout(() => r(null), 30000))]);
          if (fr !== null && fr !== lastFrame) { lastFrame = fr; lastSeen = Date.now(); }
          if (Date.now() - lastSeen > 300000) throw new Error('stalled');
        }
      })();
      const res = await Promise.race([job, dog.then(() => job)]);
      if ((o.hdr && res.hdr !== 0) || (o.sdr && res.sdr !== 0)) throw new Error('ffmpeg exit ' + JSON.stringify(res));
      fs.writeFileSync(mark, JSON.stringify(res)); done++;
      console.log(stamp(), `chunk ${done}/${chunks.length} ${tag} ok  ${JSON.stringify(res.stages || {})}  elapsed ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      break;
    } catch (e) {
      console.log(stamp(), `chunk ${tag} attempt ${attempt} failed: ${String(e.message).slice(0, 200)}`);
      if (attempt >= 4) { console.log('giving up'); process.exit(2); }
      await open();
    }
  }
}
await browser.close();
if (!o.noconcat) { if (o.hdr) concat('hdr'); if (o.sdr) concat('sdr'); }
console.log(stamp(), 'film done');
