# YYMC Windows 单文件版

把 YYMC（网页版 Minecraft 自研引擎）打成**一个 exe**：双击就起本地服务器，并用默认浏览器打开游戏。游戏本体、区块 worker、4849 个音效全部内嵌，不需要装 Node、不需要联网拉资源。

## 下载（Release 直链）

| 版本 | 文件 | 大小 | 直链 |
|---|---|---|---|
| **v1.0.1** | `YYMC.exe` | 238.9 MB | https://github.com/mdy114514mdy/yymc-desktop/releases/download/v1.0.1/YYMC.exe |
| v1.0.1 | 整页（含更新记录） | — | https://github.com/mdy114514mdy/yymc-desktop/releases/tag/v1.0.1 |
| v1.0.0 | `YYMC.exe`（旧版） | 237.9 MB | https://github.com/mdy114514mdy/yymc-desktop/releases/download/v1.0.0/YYMC.exe |

资源随仓库发布（`site/`，148 MB），克隆下来即可从零编译出成品。

---

## 一、环境要求

| 需要 | 版本 / 说明 |
|---|---|
| 操作系统 | Windows 10/11 x64（脚本用 `start` 开浏览器） |
| Node.js | **≥ 22**，实测 v24.20.0（用到 `--experimental-sea-config` 与 `node:sea`） |
| npm 包 | `postject`（把资源 blob 注入 exe） |
| 磁盘 | 约 700 MB（`site/` 148 + `dist/` 148 + `sea-prep.blob` 148 + exe 238） |

## 二、从零编译

```bash
git clone https://github.com/mdy114514mdy/yymc-desktop.git
cd yymc-desktop
npm i postject
node build.mjs
```

产物：`dist/pack0..2.bin`（资源分片）、`dist/index.json`、`sea-prep.blob`、**`YYMC.exe`**（约 238 MB）。

各步骤：①按白名单收集 `site/` → ②打成 `<60 MB` 的 pack 片并记 `{片号,偏移,长度,MIME}` → ③`node --experimental-sea-config` 生成 blob → ④复制 `node.exe` 并用 `postject` 注入 `NODE_SEA_BLOB`。

可选参数：`--dist-only`（只生成 dist/）、`--with-ogg`（连 ogg 音效一起收，+78 MB）、`--site=<dir>`（换资源目录）。

## 三、运行与验证

```bash
YYMC.exe                  # 默认 127.0.0.1:8099，自动开浏览器
YYMC.exe --port=9000      # 换端口（被占自动 +1）
YYMC.exe --no-open        # 只起服务
```

```bash
curl -s -o NUL -w "%{http_code} %{size_download}\n" http://127.0.0.1:8099/                     # 200 9598
curl -s -o NUL -w "%{http_code} %{size_download}\n" http://127.0.0.1:8099/game/OpusMC.v6.html  # 200 50847134
curl -s http://127.0.0.1:8099/rooms/api/live                                                   # JSON
curl -s -r 0-1023 -o NUL -w "%{http_code}\n" http://127.0.0.1:8099/game/OpusMC.v6.html         # 206
```

## 四、为什么需要本机中转

官方房间服务只接受 `Origin: https://www.bilibili.com`。`Origin` 是浏览器的 forbidden header：页面 JS 改不了，WebSocket 握手没有可写 header 的入口，Service Worker 也拦不住。所以必须有人在浏览器之外补上——网页版只能由服务端补，而这个 exe 选择**由你本机补**：`/rooms/*` 的 HTTP 与 WebSocket 都在本进程补 Origin，建链之后的游戏流量走服务端下发的 TURN，不经过本进程。

## 五、更新记录

| 版本 | 变化 |
|---|---|
| **v1.0.1** | **修区块"永久毒化"**：看门狗把 20 秒无应答的区块记进毒名单后永久跳过（主线程也跳过），那块永远不建网格 → 能看穿地面看到洞穴。改为：识别页面停顿（间隔 >2.5 s 重置心跳）· 毒名单按 2/4/8/16/32 s 退避重试（最多 4 次）· 建成即清除 · 重启上限 3→8 · 退避用尽补空块 |
| v1.0.0 | 首个单文件版 |

## 六、常见问题

| 现象 | 处理 |
|---|---|
| `Cannot find module 'node:sea'` | Node 版本过低，升到 22+ |
| 注入后报 `warning: The signature seems corrupted!` | 正常（往已签名的 node.exe 追加了数据），首次运行可能弹一次 SmartScreen |
| 注入阶段 `v8::base::FatalOOM` / 退出码 `0x80000003` | `postject` 峰值约 0.6 GB，可用内存不足约 1.5 GB 会 OOM；关掉占内存的程序重跑，`dist/` 与 blob 不必重做 |
| 重新构建写不进去 | 先关掉正在运行的 `YYMC.exe` |
| `rooms` 请求 502 | 本机到上游不通，`curl -I https://xz.honghemc.cn:8443/api/live` 复核 |

---

# YYMC — Windows single-file build (English)

A self-written Minecraft-like web engine packaged as **one .exe**: double-click, it starts a local server and opens the game in your default browser. The game body, the chunk worker and all 4849 sound files are embedded — no Node install, no network fetch.

## Download (release direct link)

| Version | File | Size | Direct link |
|---|---|---|---|
| v1.0.0 | `YYMC.exe` | 237.9 MB | https://github.com/mdy114514mdy/yymc-desktop/releases/download/v1.0.0/YYMC.exe |
| v1.0.0 | release page | — | https://github.com/mdy114514mdy/yymc-desktop/releases/tag/v1.0.0 |

## Requirements

Windows 10/11 x64, Node.js ≥ 22 (tested on v24.20.0), the `postject` npm package, ~700 MB free disk.

## Build from scratch

```bash
git clone https://github.com/mdy114514mdy/yymc-desktop.git
cd yymc-desktop
npm i postject
node build.mjs          # -> YYMC.exe (~238 MB)
```

Pipeline: collect whitelisted files from `site/` → pack them into ≤60 MB `dist/packN.bin` chunks with an `index.json` (`chunk, offset, length, mime`) → `node --experimental-sea-config` produces the blob → copy `node.exe` and inject `NODE_SEA_BLOB` with `postject`.

Flags: `--dist-only` (assets only), `--with-ogg` (+78 MB, legacy browsers), `--site=<dir>` (alternate asset root).

## Run

```bash
YYMC.exe                 # 127.0.0.1:8099, opens the browser
YYMC.exe --port=9000     # pick a port (auto-increments if busy)
YYMC.exe --no-open       # server only
```

The console window *is* the server; closing it stops everything.

## Why a loopback relay

The official room service only accepts `Origin: https://www.bilibili.com`, and `Origin` is a forbidden header — page JS cannot set it, a WebSocket handshake has nowhere to put it, and a Service Worker cannot rewrite it. Something outside the browser must add it. A web page would need a server-side relay; this exe does it **on your machine**: `/rooms/*` (HTTP and WebSocket) gets the header added locally, and once a peer connection is established the traffic goes through the TURN relay the server hands out, never through this process.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module 'node:sea'` | Node too old, use ≥ 22 |
| `warning: The signature seems corrupted!` after injection | Expected — data was appended to a signed node.exe. SmartScreen may prompt once |
| `v8::base::FatalOOM` / exit code `0x80000003` during injection | `postject` peaks around 0.6 GB; free ~1.5 GB of RAM and re-run; `dist/` and the blob can be reused |
| Rebuild cannot write the exe | Close the running `YYMC.exe` first |
| `/rooms` returns 502 | Upstream unreachable; check `curl -I https://xz.honghemc.cn:8443/api/live` |

## Notes

- Assets are read as slices from the embedded pack — **no extraction on startup**.
- Only AAC (`.m4a`) sound files ship by default; `--with-ogg` adds the Ogg fallback.
- This repository contains no account/recovery tooling.
