// Zero-dependency static server + raw-frame sink into ffmpeg, for offline film renders.
//   node film-server.mjs [--port 5430] [--root .]
// Serves files under --root (default: cwd). Output files are written relative to the cwd.
//   POST /api/ff/start?id=hdr   body = JSON ffmpeg argv (reads raw frames on stdin)
//   POST /api/ff/frame?id=hdr&seq=N   body = one raw frame. Each seq is written once, so a client may retry safely.
//   POST /api/ff/end?id=hdr     closes stdin, waits for ffmpeg, returns {code, log}
// Binds 127.0.0.1 only: the API spawns ffmpeg with whatever arguments the page sends.
// Adapted from room-at-dawn (MIT) vite.config.js devApi().
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const PORT = +opt('port', 5430), ROOT = path.resolve(opt('root', '.'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const ff = {};
const body = (req) => new Promise((res, rej) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/ff/')) {
      const id = url.searchParams.get('id') || 'a';
      if (url.pathname === '/api/ff/start') {
        const args = JSON.parse((await body(req)).toString());
        if (ff[id]) { try { ff[id].kill(); } catch {} }
        const out = args[args.length - 1]; if (typeof out === 'string') fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
        p.errLog = ''; p.stderr.on('data', (d) => { p.errLog = (p.errLog + d.toString()).slice(-4000); });
        p.on('exit', (code) => { p.done = true; p.code = code; }); p.stdin.on('error', () => {});
        ff[id] = p; return res.end('ok');
      }
      if (url.pathname === '/api/ff/frame') {
        const p = ff[id], buf = await body(req);
        if (!p || p.done) throw new Error('ffmpeg not running: ' + (p ? p.errLog : ''));
        const seq = url.searchParams.get('seq') || String(p.auto = (p.auto || 0) + 1);
        p.writes = p.writes || new Map();
        if (!p.writes.has(seq)) {
          p.writes.set(seq, (async () => { if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r)); })());
          if (p.writes.size > 8) p.writes.delete(p.writes.keys().next().value);
        }
        await p.writes.get(seq); return res.end('ok');
      }
      if (url.pathname === '/api/ff/end') {
        const p = ff[id];
        if (p) { p.stdin.end(); await new Promise((r) => (p.done ? r() : p.on('exit', r))); }
        res.end(JSON.stringify({ code: p ? p.code : -1, log: p ? p.errLog.slice(-1500) : '' })); delete ff[id]; return;
      }
      res.statusCode = 404; return res.end('nope');
    }
    let file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('outside root'); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.statusCode = 500; res.end(String(e && e.message)); }
});
server.keepAliveTimeout = 600000; server.headersTimeout = 610000; server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => console.log(`film-server http://127.0.0.1:${PORT}/  root ${ROOT}  cwd ${process.cwd()}`));
