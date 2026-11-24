'use strict';
// YYMC 单文件版 —— 内嵌静态站 + 官方房间服务反代（HTTP + WebSocket），启动后自动开浏览器。
// 开发时直接 node server.js --dev 从 ./dist 读资源；打包后由 SEA 的 assets 提供。
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

let sea = null;
try { sea = require('node:sea'); } catch (e) { sea = null; }
const IS_SEA = !!(sea && typeof sea.isSea === 'function' && sea.isSea());

const ARGV = process.argv.slice(2);
const HAS = f => ARGV.includes(f);
const DEV = HAS('--dev') || !IS_SEA;
const NO_OPEN = HAS('--no-open');
const PORT0 = Number((ARGV.find(a => /^--port=/.test(a)) || '').split('=')[1] || process.env.PORT || 8099);

// ---- 资源：dist/index.json + dist/pack<N>.bin（开发）；SEA assets（打包后）----
let INDEX = null;
const CHUNKS = [];
function loadIndex() {
  if (IS_SEA) INDEX = JSON.parse(Buffer.from(sea.getAsset('index')).toString('utf8'));
  else INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'index.json'), 'utf8'));
}
function chunk(n) {
  if (CHUNKS[n]) return CHUNKS[n];
  let buf;
  if (IS_SEA) buf = Buffer.from(sea.getAsset('pack' + n));
  else buf = fs.readFileSync(path.join(__dirname, 'dist', 'pack' + n + '.bin'));
  CHUNKS[n] = buf;
  return buf;
}
function asset(rel) { return INDEX.files[rel] || null; }
function assetBuf(rel) {
  const e = asset(rel);
  if (!e) return null;
  return chunk(e.c).subarray(e.o, e.o + e.l);
}

// ---- 房间服务反代：官方只认 Origin: https://www.bilibili.com ----
const ROOMS = { host: 'xz.honghemc.cn', port: 8443 };
function roomsHeaders(req) {
  const h = Object.assign({}, req.headers);
  delete h.cookie;
  delete h.host;
  h.host = ROOMS.host + ':' + ROOMS.port;
  h.origin = 'https://www.bilibili.com';
  h.referer = 'https://www.bilibili.com/';
  return h;
}
function proxyRooms(req, res) {
  const p = (req.url || '/').replace(/^\/rooms/, '') || '/';
  const up = https.request(
    { host: ROOMS.host, port: ROOMS.port, path: p, method: req.method, headers: roomsHeaders(req) },
    r => {
      const h = Object.assign({}, r.headers);
      delete h['content-security-policy'];
      h['access-control-allow-origin'] = '*';
      res.writeHead(r.statusCode || 502, h);
      r.pipe(res);
    },
  );
  up.on('error', e => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('rooms proxy error: ' + e.message);
  });
  req.pipe(up);
}

function sendAsset(req, res, rel) {
  const e = asset(rel);
  if (!e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + rel); return; }
  const all = chunk(e.c).subarray(e.o, e.o + e.l);
  const imm = !/\.html?$/.test(rel) && !/^index\.html$/.test(rel);
  const headers = {
    'Content-Type': e.m,
    'Accept-Ranges': 'bytes',
    'Cache-Control': imm ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [s, t] = range.replace('bytes=', '').split('-');
    let start = s ? Number(s) : 0;
    let end = t ? Math.min(Number(t), all.length - 1) : all.length - 1;
    if (start > end || start >= all.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${all.length}` }).end();
      return;
    }
    res.writeHead(206, Object.assign({}, headers, {
      'Content-Range': `bytes ${start}-${end}/${all.length}`,
      'Content-Length': end - start + 1,
    }));
    res.end(req.method === 'HEAD' ? undefined : all.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, Object.assign({}, headers, { 'Content-Length': all.length }));
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(all);
}

function handle(req, res) {
  const url = req.url || '/';
  if (url.startsWith('/rooms')) { proxyRooms(req, res); return; }
  let p = decodeURIComponent(url.split('?')[0].split('#')[0]);
  if (p === '/' || p === '') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const rel = p.replace(/^\/+/, '');
  if (asset(rel)) { sendAsset(req, res, rel); return; }
  if (asset(rel + '.html')) { sendAsset(req, res, rel + '.html'); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
}

const server = http.createServer(handle);

// ---- WebSocket 升级：/rooms/p2p 透传到官方信令服务 ----
server.on('upgrade', (req, socket, head) => {
  if (!(req.url || '').startsWith('/rooms')) { socket.destroy(); return; }
  const p = (req.url || '/').replace(/^\/rooms/, '') || '/';
  const up = https.request({
    host: ROOMS.host, port: ROOMS.port, path: p, method: 'GET',
    headers: Object.assign({}, roomsHeaders(req), { connection: 'Upgrade', upgrade: req.headers.upgrade || 'websocket' }),
  });
  up.on('upgrade', (r, upSocket, upHead) => {
    const lines = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n\r\n`);
    if (upHead && upHead.length) upSocket.unshift(upHead);
    if (head && head.length) socket.unshift(head);
    socket.pipe(upSocket); upSocket.pipe(socket);
    const kill = () => { socket.destroy(); upSocket.destroy(); };
    socket.on('error', kill); upSocket.on('error', kill);
    socket.on('close', kill); upSocket.on('close', kill);
  });
  up.on('response', r => {
    socket.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nrooms ws refused: ${r.statusCode}\r\n`);
    socket.destroy();
  });
  up.on('error', () => socket.destroy());
  up.end();
});

function openBrowser(url) {
  if (NO_OPEN) return;
  if (process.platform === 'win32') exec(`start "" "${url}"`, { windowsHide: true });
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

loadIndex();

let port = PORT0;
let tries = 0;
function listen() {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && tries++ < 20) { port++; listen(); return; }
    console.error('启动失败：' + err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    const mb = v => (v / 1048576).toFixed(1) + ' MB';
    console.log('');
    console.log('  YYMC 单文件版已启动');
    console.log('  --------------------------------------------');
    console.log('  游戏入口:  ' + url);
    console.log('  联机反代:  /rooms/*  ->  https://' + ROOMS.host + ':' + ROOMS.port);
    console.log('  内嵌资源:  ' + Object.keys(INDEX.files).length + ' 个文件，' + mb(INDEX.bytes));
    console.log('  --------------------------------------------');
    console.log('  关掉这个窗口就停止服务。');
    console.log('');
    openBrowser(url);
  });
}
listen();
