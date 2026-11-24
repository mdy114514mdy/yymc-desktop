# YYMC Windows 单文件版

把 YYMC（网页版 Minecraft 自研引擎）打成**一个 exe**：双击就起本地服务器，并用默认浏览器打开游戏。游戏本体、区块 worker、4849 个音效全部内嵌，不需要装 Node、不需要联网拉资源。

Release 里的 `YYMC.exe` 约 238 MB。

资源随仓库发布（`site/`，148 MB），克隆下来即可从零编译出成品。

---

## 一、环境要求

| 需要 | 版本 / 说明 |
|---|---|
| 操作系统 | Windows 10/11 x64（脚本用 `start` 开浏览器） |
| Node.js | **≥ 22**，实测 v24.20.0（用到 `--experimental-sea-config` 与 `node:sea`） |
| npm 包 | `postject`（把资源 blob 注入 exe，仓库外安装即可） |
| 磁盘 | 约 700 MB（`site/` 148 + `dist/` 148 + `sea-prep.blob` 148 + exe 238） |

```bash
node -v          # 需要 v22 以上
npm -v
```

---

## 二、从零编译

```bash
git clone https://github.com/mdy114514mdy/yymc-desktop.git
cd yymc-desktop

npm i postject          # 装注入工具
node build.mjs          # 收集资源 → 打 pack → 生成 SEA blob → 注入 → YYMC.exe
```

跑完当前目录会出现：

```
dist/pack0.bin   ~60 MB    资源分片（每片 60 MB）
dist/pack1.bin   ~63 MB
dist/pack2.bin   ~30 MB
dist/index.json  438 KB    路径 → {片号 c, 偏移 o, 长度 l, MIME m}
sea-prep.blob    ~148 MB   SEA 预备 blob（可删）
YYMC.exe         ~238 MB   成品
```

### 各步骤在做什么

1. **收集资源**：按白名单读 `site/`——`index.html`、`favicon.svg`、`game/OpusMC.v6.html`、`game/js/chunk_worker.js`、`game/sounds/sfx/**/*.m4a`。路径与字样有黑名单，命中直接 `exit(1)`。
2. **打 pack**：把每个文件原样写入 `dist/pack<N>.bin`（单文件超过 60 MB 就独占一片），在 `dist/index.json` 记下 `{c,o,l,m}`。
3. **生成 blob**：写 `sea-config.json`（`main` 指向 `server.js`，`assets` 登记 `index` 与 `pack0..N`），执行 `node --experimental-sea-config sea-config.json`。
4. **注入**：复制 `node.exe`（约 89 MB）为 `YYMC.exe`，再用 `postject` 把 blob 写进 `NODE_SEA_BLOB` 段。

### 可选参数

```bash
node build.mjs --dist-only        # 只做第 2 步，生成 dist/，可先验服务器
node build.mjs --with-ogg         # 连 .ogg 音效一起收（+78 MB，仅旧浏览器兜底用）
node build.mjs --site=D:/other/site   # 换资源目录
```

---

## 三、运行与验证

```bash
YYMC.exe                      # 默认 127.0.0.1:8099，自动开浏览器
YYMC.exe --port=9000          # 换端口（被占会自动往后找 20 次）
YYMC.exe --no-open            # 只起服务，不开浏览器
```

黑窗口就是服务器本体，**关掉窗口即停止服务**。

启动后应看到：

```
  YYMC 单文件版已启动
  --------------------------------------------
  游戏入口:  http://127.0.0.1:8099/
  联机反代:  /rooms/*  ->  https://xz.honghemc.cn:8443
  内嵌资源:  4854 个文件，148.3 MB
```

三个端点自检（另开一个命令行）：

```bash
curl -s -o NUL -w "%{http_code} %{size_download}\n" http://127.0.0.1:8099/                        # 200 9598
curl -s -o NUL -w "%{http_code} %{size_download}\n" http://127.0.0.1:8099/game/OpusMC.v6.html     # 200 50847134
curl -s http://127.0.0.1:8099/rooms/api/live                                                      # 一段 JSON
curl -s -r 0-1023 -o NUL -w "%{http_code}\n" http://127.0.0.1:8099/game/OpusMC.v6.html            # 206（Range 生效）
```

联机信令（WebSocket）自检，token 取游戏里登录后 `localStorage['mcjs-account']` 的 `token` 字段：

```bash
TOKEN=<token> node -e "const w=new WebSocket('ws://127.0.0.1:8099/rooms/p2p');w.onopen=()=>w.send(JSON.stringify({t:'host',code:'TEST01',token:process.env.TOKEN,name:'selftest'}));w.onmessage=e=>console.log(e.data.slice(0,200));setTimeout(()=>process.exit(0),8000)"
```

拿到 `{"t":"hosted",...}` 就说明中继全部通了。

---

## 四、为什么需要本机中转

官方房间服务只接受 `Origin: https://www.bilibili.com`。而 `Origin` 是浏览器的 forbidden header：页面 JS 改不了，WebSocket 握手没有可写 header 的入口，Service Worker 也拦不住。

所以必须有人替浏览器补这个头——网页版只能由服务端补，而这个 exe 选择**由你本机补**：`/rooms/*` 的 HTTP 请求与 `/rooms/p2p` 的 WebSocket 升级都在本进程补上 Origin。

补的范围只有登录、云存档与联机信令；建链之后的游戏流量走服务端下发的 TURN 中继，不经过本进程。

---

## 五、目录结构

```
site/                 随仓库发布的资源（148 MB）
server.js             本机中继：静态服务（Range）+ /rooms 反代 + WS 隧道 + 自动开浏览器
build.mjs             资源打包与 SEA 注入
dist/                 build.mjs 产物（git 忽略）
```

`server.js` 里的关键点：资源全部从 SEA 的 `assets` 读（`sea.getAsset('pack'+i)`），`subarray` 零拷贝按 Range 切片输出；`assets` 缺失时回落到 `dist/`，方便 `--dev` 调试。

---

## 六、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `Error: Cannot find module 'node:sea'` | Node 版本过低，升到 22+ |
| `node --experimental-sea-config` 报未知参数 | 同上 |
| 注入后报 `warning: The signature seems corrupted!` | **正常**：往已签名的 node.exe 追加了数据。首次运行可能弹一次 SmartScreen，点「更多信息 → 仍要运行」 |
| 重新构建时报 `EBUSY`/写不进去 | 先关掉正在运行的 `YYMC.exe`（文件被占用） |
| 浏览器打不开 / 页面空白 | 看黑窗口是否还开着；端口被占时会打印实际端口，以窗口里的地址为准 |
| `rooms` 请求 502 | 本机到上游不通（官方服务偶发不可达）。先 `ping xz.honghemc.cn`，再 `curl -I https://xz.honghemc.cn:8443/api/live` |
| exe 体积比预期大 | 音效占了 89 MB，`--with-ogg` 会再 +78 MB |
| 注入阶段崩掉，栈里出现 `v8::base::FatalOOM` / 退出码 `0x80000003` | `postject` 要把 blob 和 exe 整个读进内存（峰值约 0.6 GB），**可用内存不足约 1.5 GB 时会 OOM**。关掉占内存的程序（模拟器、大编辑器）后重跑；`dist/` 与 `sea-prep.blob` 不必重新生成，只重跑注入即可 |

---

## 七、说明

- 资源按需切片读取，**启动零解压**（不像 PyInstaller 每次解到 temp）。
- 语言：站点与音效只收 AAC（`.m4a`），所有现代浏览器都能解。
- 本仓库不包含任何账号/识别码相关的工具或脚本。
