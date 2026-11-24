# YYMC Windows 单文件版

把 YYMC（网页版 Minecraft 自研引擎）打成**一个 exe**：双击就起本地服务器，并用默认浏览器打开游戏。游戏本体、区块 worker、4849 个音效全部内嵌，不需要装 Node、不需要联网拉资源。

Release 里的 `YYMC.exe` 约 238 MB。

## 为什么要在本机起中转

官方房间服务只接受 `Origin: https://www.bilibili.com`。`Origin` 是浏览器的 forbidden header：页面 JS 改不了，WebSocket 握手没有可写 header 的入口，Service Worker 也拦不住。所以必须有人替浏览器补这个头——网页版只能由服务端补，而这个 exe 选择**由你本机补**。

补的范围只有 `/rooms/*`（登录、云存档、联机信令）。补完之后的联机流量走服务端下发的 TURN 中继，不经过本进程。

## 用法

```
YYMC.exe                     默认 127.0.0.1:8099，自动开浏览器
YYMC.exe --port=9000         换端口（被占用会自动往后找）
YYMC.exe --no-open           只起服务，不开浏览器
```

黑窗口就是服务器本体，关掉即停止。

## 构建

需要 Node >= 22（用 SEA 把运行时和资源打进一个 exe），以及 `postject`：

```bash
npm i postject
node build.mjs              # 默认只收 .m4a 音效
node build.mjs --with-ogg   # 连 ogg 一起收（+78MB）
node build.mjs --dist-only  # 只生成 dist/ 资源包，便于先验服务器
```

`build.mjs` 做三件事：收集 `../mirror/` 下的入口页、游戏本体、`js/chunk_worker.js`、`game/sounds/sfx/**/*.m4a` → 打成 `dist/pack<N>.bin`（每片 60 MB）+ `dist/index.json`（路径→片号/偏移/长度/MIME）→ `node --experimental-sea-config` 出 blob、复制 `node.exe`、用 `postject` 注入 `NODE_SEA_BLOB`。

## 资源随仓库一起来

`site/` 目录里就是构建要用的全部资源，克隆下来即可直接编译（约 148 MB，其中音效 89 MB 是 4849 个 `.m4a`）：

```
site/index.html
site/favicon.svg
site/game/OpusMC.v6.html          （48.5 MB 单文件游戏）
site/game/js/chunk_worker.js      （11 MB 区块 worker）
site/game/sounds/sfx/**/*.m4a     （4849 个音效）
```

换别的资源目录用 `node build.mjs --site=/path/to/site`。

## 说明

- 资源是按需切片读的，**启动零解压**（不像 PyInstaller 每次解到 temp）。
- 因为往已签名的 `node.exe` 追加了数据，postject 会报 `signature seems corrupted`，属正常；首次运行可能触发一次 SmartScreen 提示。
- 不包含任何账号/识别码相关工具。
