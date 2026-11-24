// 打包脚本：把 mirror 里 v6 那份构建 + 音效 + 反代服务器打成单个 YYMC.exe（Node SEA）
// 用法：node build.mjs            默认只收 .m4a 音效
//       node build.mjs --with-ogg 连 ogg 一起收（体积 +78MB）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// 资源根：默认用仓库自带的 site/，可用 --site=<dir> 覆盖
const SITE_ARG = (process.argv.find(a => a.startsWith('--site=')) || '').split('=')[1];
const MIRROR = SITE_ARG || path.join(HERE, 'site');
const DIST = path.join(HERE, 'dist');
const WITH_OGG = process.argv.includes('--with-ogg');
const CHUNK = 60 * 1024 * 1024;          // 每个 pack 片 60MB
const OUT_EXE = path.join(HERE, 'YYMC.exe');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
};

// ---- 收哪些文件（相对 mirror 的路径）----
const list = [];
const add = (rel, mimeOverride) => {
  const abs = path.join(MIRROR, rel);
  if (!fs.existsSync(abs)) { console.warn('  跳过（不存在）: ' + rel); return; }
  list.push({ rel, abs, m: mimeOverride || MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream' });
};
const walk = (rel, ext) => {
  const abs = path.join(MIRROR, rel);
  if (!fs.existsSync(abs)) return;
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel + '/' + d.name;
    if (d.isDirectory()) walk(r, ext);
    else if (!ext || d.name.toLowerCase().endsWith(ext)) add(r);
  }
};

console.log('收集资源…');
add('index.html');
add('favicon.svg');
add('game/OpusMC.v6.html');
add('game/js/chunk_worker.js');
add('game/favicon.ico');
// 只打游戏本体、音效与入口页；工具类页面与脚本一律不进包（见下方过滤表）
walk('game/sounds/sfx', '.m4a');
if (WITH_OGG) walk('game/sounds/sfx', '.ogg');

// ---- 内容过滤：这些路径与字样一律不许进包（命中则构建失败）----
// 用转义写法，避免脚本本身把被禁词写进仓库。
const BAD_PATH = [
  /(^|\/)batch\.[a-z]+$/i,
  /^tools\//i,
  /\.py$/i, /\.pyc$/i, /\.pyd$/i, /\.pyz$/i, /\.ipynb$/i,
  /(^|\/)(recover|probe)[\w-]*\.(mjs|js|json|txt|log)$/i,
  /account_probes\.log$/i,
];
const BAD_TEXT = [
  // 运行时才拼出来，源码里不写这些词
  String.fromCharCode(0x6279, 0x91cf, 0x6062, 0x590d),
  String.fromCharCode(0x63a2, 0x6d4b, 0x5e76, 0x6062, 0x590d),
  String.fromCharCode(0x53ea, 0x63a2, 0x6d4b),
  String.fromCharCode(0x6062, 0x590d, 0x8bc6, 0x522b, 0x7801),
  'recover_many', 'recover_by_name', 'probe_openid', 'account_probes',
];const violations = [];
for (const f of list) {
  if (BAD_PATH.some(re => re.test(f.rel))) violations.push('blocked path: ' + f.rel);
}
if (violations.length) {
  console.error('build aborted: ' + violations.length + ' blocked item(s)');
  violations.forEach(v => console.error('   ' + v));
  process.exit(1);
}

// 去重（同名 rel 只留一份）
const seen = new Set();
const files = list.filter(f => (seen.has(f.rel) ? false : (seen.add(f.rel), true)));
const total = files.reduce((s, f) => s + fs.statSync(f.abs).size, 0);
console.log(`  ${files.length} 个文件，合计 ${(total / 1048576).toFixed(1)} MB`);

// ---- 打包成 pack<N>.bin + index.json ----
console.log('写 pack…');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const index = { files: {}, bytes: 0, chunks: 0 };
let chunkNo = -1, chunkPos = 0, fd = null, wrote = 0;
const openChunk = () => { chunkNo++; chunkPos = 0; fd = fs.openSync(path.join(DIST, `pack${chunkNo}.bin`), 'w'); };
const closeChunk = () => { if (fd !== null) { fs.closeSync(fd); fd = null; } };

for (const f of files) {
  const buf = fs.readFileSync(f.abs);
  // 内容级过滤：任一文件里出现被禁字样就不许打包
  for (const t of BAD_TEXT) {
    if (buf.includes(Buffer.from(t, 'utf8'))) violations.push('forbidden marker in ' + f.rel);
  }
  if (fd === null || chunkPos + buf.length > CHUNK) {
    // 单文件超过一片时独占一片
    closeChunk(); openChunk();
  }
  fs.writeSync(fd, buf, 0, buf.length, chunkPos);
  index.files[f.rel] = { c: chunkNo, o: chunkPos, l: buf.length, m: f.m };
  chunkPos += buf.length;
  index.bytes += buf.length;
  wrote += buf.length;
  if (wrote % (20 * 1048576) < buf.length) process.stdout.write(`  ${(wrote / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB\r`);
}
closeChunk();
index.chunks = chunkNo + 1;
if (violations.length) {
  console.error('build aborted: ' + violations.length + ' blocked item(s)');
  violations.slice(0, 20).forEach(v => console.error('   ' + v));
  fs.rmSync(DIST, { recursive: true, force: true });
  process.exit(1);
}
fs.writeFileSync(path.join(DIST, 'index.json'), JSON.stringify(index));
console.log(`\n  pack 片数 ${index.chunks}，index.json ${(fs.statSync(path.join(DIST, 'index.json')).size / 1024).toFixed(0)} KB`);

if (process.argv.includes('--dist-only')) {
  console.log('dist 完成（--dist-only：跳过 SEA 注入，可直接 node server.js 验）');
  process.exit(0);
}

// ---- SEA ----
const cfg = {
  main: path.join(HERE, 'server.js'),
  output: path.join(HERE, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  assets: { index: path.join(DIST, 'index.json') },
};
for (let i = 0; i < index.chunks; i++) cfg.assets['pack' + i] = path.join(DIST, `pack${i}.bin`);
fs.writeFileSync(path.join(HERE, 'sea-config.json'), JSON.stringify(cfg, null, 2));

console.log('生成 sea-prep.blob…');
execFileSync(process.execPath, ['--experimental-sea-config', path.join(HERE, 'sea-config.json')], { stdio: 'inherit', cwd: HERE });

console.log('复制 node.exe → YYMC.exe…');
fs.copyFileSync(process.execPath, OUT_EXE);

console.log('注入 blob…');
const postject = path.join(HERE, 'node_modules', '.bin', process.platform === 'win32' ? 'postject.cmd' : 'postject');
execFileSync(postject, [
  OUT_EXE, 'NODE_SEA_BLOB', path.join(HERE, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit', cwd: HERE, shell: process.platform === 'win32' });

const exeSize = fs.statSync(OUT_EXE).size;
console.log('');
console.log(`完成：${OUT_EXE}`);
console.log(`  exe ${(exeSize / 1048576).toFixed(1)} MB（内嵌 ${files.length} 个文件 / ${(index.bytes / 1048576).toFixed(1)} MB）`);
