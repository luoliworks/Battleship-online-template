# **Battleship Mini Demo — Technical GDD (v0.3)**

**文档定位**：面向 AI 编程工具（Antigravity）的工程级游戏设计文档（已与当前实现同步），完整定义极简 6×6 海战棋双人联机 Demo 的玩法规则、前后端架构约束、通信协议、多语言与弹窗交互、Cloudflare/Node.js 双端适配方案、环境配置与验收标准。  
**日期**：2026-11-21  
---

# **一、项目定位与目标**

* **项目名称**：Battleship Mini Demo（双人联机骨架验证版）  
* **核心目标**：以极简 6×6 海战棋作为最小玩法载体，完整跑通一套**可同时部署在 Cloudflare Workers \+ Durable Objects 与本地 Node.js** 的双人回合制联机底座。  
* **核心验证目标**：  
  * Admin 单口令登录、邀请码白名单（支持可配置有效期）、房间重置与按需销毁  
  * 服务端权威判定与非对称隐藏信息脱敏（防 F12 抓包作弊）  
  * 断线重连顶号与满员拦截  
  * 基于“昵称绑定 \+ `sessionStorage`”的刷新重连、跨设备找回座位、同浏览器双开自测与满员拦截  
  * 对手在线状态实时指示  
  * 中英文双语 UI（英文默认 \+ 实时切换）与关键阶段弹窗体验（布阵弹窗 / 结算弹窗）  
  * 适配层内置房间聊天（最近 50 条持久化、断线重连可回溯）与对局中双人确认重置（`Reset Game`）  
  * Cloudflare 生产环境与 `dev` 隔离环境（`--env dev`）双环境部署支持  
  * 纯游戏逻辑内核与底层平台外壳彻底解耦（便于后续将 `src/core/` 替换为 Tower Chess 或其他回合制/策略游戏）

---

# **二、游戏规则规格（MVP）**

* **人数上限**：默认 `maxPlayers = 2`（由 Admin 创建房间时写入白名单配置，便于后续扩展）。  
* **棋盘与舰队**：  
  * 双方各持有一块 **6×6** 棋盘（坐标 `x: 0..5, y: 0..5`）。  
  * 每人 **3 艘船**：巡洋舰（长度 3）、驱逐舰 A（长度 2）、驱逐舰 B（长度 2），总计 7 格血量。  
  * 摆放规则：仅允许水平（`H`）或垂直（`V`）放置，不可越界、不可重叠。当前 MVP 前端采用**居中布阵弹窗 \+ 6×6 实时预览**，仅提供 `Randomize Fleet`（一键随机布阵）与 `Confirm & Lock Fleet`（确认锁定）交互（不支持手动拖拽/点选放船）。  
* **开火规则**：**每回合固定各开一炮**（无论是否命中，每次合法开火后均切换回合），保持逻辑最简化与节奏可控。不可重复轰炸同一坐标。  
* **四阶段状态机**：  
  1. `WAITING`：等待两名玩家凭有效邀请码及昵称入座；满 2 人后自动切入 `PLACING`。  
  2. `PLACING`（并行阶段）：双方同时在布阵弹窗内随机并提交 `place_ships`（提交后即锁定该玩家的准备状态）；双方均锁定后自动切入 `PLAYING`，由当前局的 `startingPlayer` 先手（首局默认 `p1`）。  
  3. `PLAYING`（严格回合制）：当前回合玩家提交 `fire(x, y)`，服务端权威判定 `miss`（落空）/ `hit`（命中）/ `sunk`（击沉），随后切换回合。  
  4. `FINISHED`：任一方 3 艘船全部被击沉即判负；对局结束时向双方公开完整棋盘，并弹出**居中胜负结算弹窗**，支持点击 `Review Board`（关闭弹窗复盘查看双方完整棋盘，顶栏仍保留 `Rematch`）或 `Rematch`（重置回 `PLACING` 再来一局），亦可由 Admin 重置或销毁房间。  
* **再来一局（双人确认 \+ 轮换先手）**：  
  * 在 `FINISHED` 阶段，玩家点击“再来一局”发送 `rematch`，服务端记录其投票并广播状态（已点击方界面显示“等待对手确认再来一局...”），防止单方手快清屏影响复盘。  
  * 当 **`p1` 和 `p2` 均确认**后，自动切换下一局先手方（`p1` 与 `p2` 互换），清空双方船只、弹孔与投票记录，状态重置回 `PLACING`。  
* **随时重置对局（`Reset Game`，双人确认）**：  
  * 在 `PLACING` 或 `PLAYING` 阶段，任一玩家点击 `Reset Game` 发送 `reset_game` 后，双方顶栏收到提示横幅，对方可点击同意（再发 `reset_game`）或拒绝（`cancel_reset`），发起方亦可取消。  
  * 双方确认后，保留当前双方座位、昵称与房间聊天记录，将棋局重置回 **Round 1** `PLACING`（由 `p1` 先手），清空双方船只、弹孔与投票记录。

---

# **三、技术栈、环境配置与目录分层**

## **3.1 技术栈**

* **前端**：**零构建的原生 HTML / CSS / JS**（不使用 Vite、React 等打包工具，直接放于 `public/` 目录），并通过 `public/i18n.js` 提供中英文双语支持（**英文为默认语言**，`EN / 中文` 实时切换）。  
* **后端**：TypeScript（纯内核与 Cloudflare / Node.js 双端外壳共享同一套类型与状态机；本地基于 Node.js 24+ 原生 TypeScript 类型剥离运行及 `node --test` 执行测试）。

## **3.2 目录结构（纯内核 \+ 双端薄适配层）**

```textproto
battleship-demo/
├── src/
│   ├── core/                         # 【纯内核】零平台依赖（不碰 CF 也不碰 Node）
│   │   ├── types.ts                  # GameState, PlayerView, ClientAction, ServerEvent
│   │   ├── engine.ts                 # createInitialState / applyAction(state, playerId, action, now)
│   │   ├── view.ts                   # getPlayerView(state, playerId) 视角脱敏投影
│   │   └── engine.test.ts            # 纯逻辑单元测试（脱离网络独立运行）
│   └── adapters/                     # 【适配层】薄外壳，仅管路由、鉴权、连接、在线态与存储
│       ├── cloudflare/
│       │   ├── index.ts              # Worker 入口：/api/* 与 /ws 路由分发
│       │   ├── admin-registry.ts     # 全局唯一 DO（"admin-registry"）：邀请码白名单与过期检查
│       │   └── game-room.ts          # 房间 DO：WebSocket Hibernation + SQLite storage + 广播
│       └── node/
│           ├── server.ts             # Node.js 外壳（原生 HTTP 静态托管 + /api/* + ws 库 + 内存 Map）
│           └── server.test.ts        # Node HTTP / WebSocket 集成测试
├── public/                           # 零构建原生前端
│   ├── index.html                    # 玩家端（自动识别 ?code=，含双语切换、入房、双棋盘、布阵/结算/提示弹窗）
│   ├── admin/
│   │   └── index.html                # 管理端 /admin/（单密码登录、双语切换、建房发码、TTL 选择、复制链接、重置/销毁房间）
│   ├── styles.css                    # 极简清晰样式（含双棋盘与居中弹窗）
│   ├── i18n.js                       # 中英文双语词典与切换逻辑（英文默认，持久化至 localStorage）
│   ├── game.js                       # 玩家端逻辑
│   └── admin.js                      # 管理端逻辑
├── .dev.vars.example                 # 本地环境变量模板（包含 ADMIN_TOKEN 示例）
├── .gitignore                        # 必须忽略 .dev.vars、node_modules、.wrangler
├── package.json                      # 脚本：dev:node / dev:cf / test / typecheck
├── tsconfig.json                     # Node.js 与纯内核 TypeScript 类型检查配置
├── tsconfig.cf.json                  # Cloudflare Workers 独立 TypeScript 类型检查配置
└── wrangler.jsonc                    # Cloudflare Workers + Static Assets + SQLite DO（含 env.dev）配置
```

## **3.3 Admin 密钥与环境配置（不写死在源码中）**

* **认证形态**：采用**单个管理员密码（`ADMIN_TOKEN`）**。  
* **本地开发（双端共用同一配置文件）**：  
  * 在项目根目录提供 `.dev.vars.example`（内容示例：`ADMIN_TOKEN=dev-admin-password`），开发者复制为 `.dev.vars` 并加入 `.gitignore`。  
  * `wrangler dev` 会自动加载 `.dev.vars`；Node.js 端通过 `node --env-file=.dev.vars` 读取同一文件，实现零额外依赖双端统一。  
* **Cloudflare 线上部署（生产与 `dev` 环境彻底隔离）**：  
  * **生产环境**（`battleship-mini-demo`）：通过 `npx wrangler secret put ADMIN_TOKEN` 注入密钥，使用 `npx wrangler deploy` 部署。  
  * **隔离开发/测试环境**（`env.dev` → `battleship-mini-demo-dev`）：为避免分支测试覆盖生产或共用房间数据，需分别运行 `npx wrangler secret put ADMIN_TOKEN --env dev` 与 `npx wrangler deploy --env dev`；该环境的 Worker 域名、Durable Objects 数据与 `ADMIN_TOKEN` 与生产完全隔离。  
* **安全兜底（Fail-Closed）**：若运行环境未配置或 `ADMIN_TOKEN` 为空，服务端直接拒绝所有 `/api/admin/*` 请求，绝不使用硬编码默认密码。

## **3.4 三条硬性解耦约束（Antigravity 实现时必须遵守）**

1. **`GameState` 必须保持纯 JSON 可序列化**：只使用普通对象、数组、数字、字符串、布尔值，禁止放入 `Map`、`Set` 或带方法的类实例。  
2. **内核禁止直接调用 `Date.now()` 或 `setTimeout()`**：所有时间戳由外壳通过参数 `now` 传入，确保状态机完全确定性。  
3. **内核禁止持有任何 `WebSocket` 引用**：内核只识别 `"p1"` / `"p2"` 与玩家昵称，不感知连接对象；在线状态（`presence`）、连接顶号、房间重置/销毁全权由外壳处理。

---

# **四、核心数据模型与通信协议**

## **4.1 隐藏信息脱敏原则（`getPlayerView`）**

* 服务端完整 `GameState` 保存双方全部船只坐标、开火记录、当前阶段、回合归属、`startingPlayer`、`rematchVotes` 与胜者信息。  
* 每次状态变更后，外壳按每个活跃连接的 `playerId` **单独调用 `getPlayerView(state, playerId)` 下发**：  
  * **我方棋盘**：返回我方完整船只位置 \+ 敌方打在我方身上的所有炮弹落点。  
  * **敌方棋盘**：在 `phase !== "FINISHED"` 时，**彻底剥离敌方未击沉船只的坐标**，仅下发我方已开火坐标及其判定结果（`miss` / `hit` / 已击沉船只的完整轮廓），确保抓包无法泄露底牌。  
  * **复盘公开**：当 `phase === "FINISHED"` 时，向双方公开完整双方船只坐标。

## **4.2 路由规划与 `wrangler.jsonc` 配置**

为避免静态页面路径与 API 路径冲突，统一将后端接口收口在 `/api/*` 与 `/ws`：

* 静态页面（由 Workers Static Assets 或 Node.js HTTP 直接托管 `public/`）：  
  * `/` → `public/index.html`（玩家端）  
  * `/admin/` → `public/admin/index.html`（管理端；Node 端对 `/admin` 与 `/admin.html` 做 `302` 重定向至 `/admin/`，Cloudflare Static Assets 原生提供 `/admin/` 并自动将 `/admin` 重定向至 `/admin/`）  
* Cloudflare `wrangler.jsonc` 配置关键点：  
  * `compatibility_date`：设为当前日期（如 `"2026-11-21"`）  
  * `assets`: `{ "directory": "./public", "binding": "ASSETS", "run_worker_first": ["/api/*", "/ws"] }`（静态资源直接由边缘缓存下发，仅 API 与 WebSocket 经过 Worker）  
  * Durable Objects 绑定：`ADMIN_REGISTRY` 与 `GAME_ROOM`，并在 `migrations` 中配置 `new_sqlite_classes` 启用 SQLite 后端  
  * 多环境隔离配置：`env.dev` 指定 `"name": "battleship-mini-demo-dev"` 并显式声明 `durable_objects` 绑定（`ADMIN_REGISTRY` 与 `GAME_ROOM`）

## **4.3 Admin HTTP 接口（`/api/admin/*`）**

所有管理接口必须校验请求头 `Authorization: Bearer <ADMIN_TOKEN>`，未通过返回 `401`：

* **`GET /api/admin/rooms`**：  
  * 兼作 Admin 登录时的口令校验接口。  
  * 只读 `AdminRegistry` 中的邀请码列表（返回 `code`、`note`、`maxPlayers`、`createdAt`、`expiresAt`、`expired`）。  
  * **严禁向 `GameRoom` 发请求探活**，避免唤醒休眠中的房间产生额外内存时长（GB-s）计费。  
* **`POST /api/admin/rooms`**：  
  * 入参：`{ note?: string, maxPlayers?: number, ttlDays?: 1 | 3 | 7 | 15 | 30 }`（默认 `maxPlayers = 2`，`ttlDays = 7`）。  
  * 生成 6 位易读随机邀请码（如 `K7X9M2`，避开易混淆字符 `0/O/1/I`），计算 `expiresAt = now + ttlDays * 86400000` 并存入 `AdminRegistry`。  
  * 返回 `{ code, joinUrl, note, maxPlayers, createdAt, expiresAt }`。  
* **`POST /api/admin/rooms/:code/reset`（重置房间，保留原邀请码）**：  
  * 保留 `AdminRegistry` 中的邀请码与有效期不变。  
  * 唤醒对应 `GameRoom`，向当前在线玩家下发 `{ type: "error", code: "ROOM_RESET", message: "管理员已重置房间，请重新进入" }` 并关闭连接（`close(4003, "ROOM_RESET")`），随后调用 `this.ctx.storage.deleteAll()` 并清空内存缓存，使房间恢复为空房待入座状态。  
* **`DELETE /api/admin/rooms/:code`（彻底销毁房间）**：  
  * 唤醒对应 `GameRoom`，向当前在线玩家下发 `{ type: "error", code: "ROOM_CLOSED", message: "管理员已销毁该房间" }` 并关闭连接（`close(4004, "ROOM_CLOSED")`），调用 `this.ctx.storage.deleteAll()` 清空存储，同时从 `AdminRegistry` 删除该邀请码。

## **4.4 玩家准入预检与 WebSocket 协议**

为解决浏览器原生 `WebSocket` 握手失败时无法读取 HTTP 错误体的问题，采用**“HTTP 预检 \+ WS 精确错误码”**两步法：

1. **轻量预检接口（`GET /api/rooms/:code/check`）**：  
   1. 公开只读接口，**仅查询 `AdminRegistry`，绝不唤醒或拉起 `GameRoom`**。  
   2. 校验逻辑采用懒检查（Lazy TTL Check）：  
      1. 未找到邀请码 → 返回 `404 { ok: false, code: "INVALID_CODE", message: "邀请码无效，请联系 Admin" }`  
      2. 已超过 `expiresAt` → 返回 `410 { ok: false, code: "EXPIRED_CODE", message: "邀请码已过期，请联系 Admin" }`  
      3. 有效 → 返回 `200 { ok: true, code, maxPlayers, expiresAt }`  
2. **WebSocket 建连（`/ws?code=<CODE>&name=<ENCODED_NICKNAME>`）**：  
   1. **入口防绕过校验**：即使客户端跳过预检直接连 `/ws`，入口 Worker 仍必须先查询 `AdminRegistry`；无效或过期的邀请码直接拒绝，**绝不拉起新的 `GameRoom` 实例**。  
   2. 校验通过后，由 `GameRoom` 执行座位分配/找回/满员拦截。  
3. **客户端 → 服务端（`ClientMessage` = `ClientAction` | 适配层 `chat`）**：  
   * 摆船锁定（核心动作）：`{ "type": "place_ships", "ships": [{ "id": "s1", "x": 0, "y": 0, "len": 3, "dir": "H" }, ...] }`  
   * 开火（核心动作）：`{ "type": "fire", "x": 2, "y": 4 }`  
   * 再来一局投票（核心动作）：`{ "type": "rematch" }`  
   * 发起/同意重置对局（核心动作）：`{ "type": "reset_game" }`  
   * 取消/拒绝重置（核心动作）：`{ "type": "cancel_reset" }`  
   * 发送房间聊天（仅适配层处理，不进 `src/core/`，限制 1–200 字符）：`{ "type": "chat", "text": "..." }`  
   * 主动离开并释放座位（适配层处理，调用纯函数 `releaseSeat`）：`{ "type": "leave" }` → 服务端清空该座位、对局回到 `WAITING` / Round 1、写入一条系统聊天消息（`system: "player_left"`），随后以 `close(1000, "LEFT")` 关闭该连接  
4. **服务端 → 客户端（`ServerEvent`）**：  
   1. 状态与在线态快照：`{ "type": "state", "view": PlayerView, "presence": { "selfOnline": true, "opponentOnline": boolean } }`（首次连入、状态变化、断线重连以及对手上线/离线时均下发最新快照，`presence` 由外壳根据当前活跃连接动态计算，不写入纯内核）  
   2. 房间聊天历史（新连接建立时下发，最多最近 50 条）：`{ "type": "chat_history", "messages": ChatMessage[] }`  
   3. 实时聊天消息广播：`{ "type": "chat", "message": ChatMessage }`  
   4. 明确错误提示：`{ "type": "error", "code": "ROOM_FULL" | "INVALID_CODE" | "EXPIRED_CODE" | "INVALID_ACTION" | "REPLACED_BY_NEW_SESSION" | "ROOM_RESET" | "ROOM_CLOSED", "message": "..." }`  
5. **自定义 WebSocket Close Code 约定**：  
   1. `4001`：`ROOM_FULL`（房间已满，请联系 Admin）  
   2. `4002`：`REPLACED_BY_NEW_SESSION`（同名玩家已在其他设备或窗口接入）  
   3. `4003`：`ROOM_RESET`（管理员已重置房间）  
   4. `4004`：`ROOM_CLOSED`（管理员已销毁该房间）

---

# **五、昵称座位绑定、前端交互与 Cloudflare 休眠约束**

## **5.1 昵称绑定 \+ `sessionStorage`（替代随机 `clientId`）**

* **入房流程**：  
  * 玩家打开邀请链接 `/?code=K7X9M2`（或在首页手动输入邀请码），填写昵称（去首尾空格，长度 1–20 字符）点击“进入房间”。  
  * 前端先调用 `GET /api/rooms/:code/check` 校验邀请码，通过后将当前房间的 `{ code, nickname }` 写入 **`sessionStorage`**，再建立 WebSocket 连接。  
* **座位匹配规则（`GameRoom` 持久化保存 `seats`）**：  
  * 服务端按归一化昵称（`nickname.trim().toLowerCase()`）匹配座位，同时保留原始展示名 `displayName` 用于界面显示（如“Alice vs Bob”）。  
  * **本机刷新（F5）**：页面重新加载时从 `sessionStorage` 自动读取当前房间的昵称重连，无感恢复棋局。  
  * **换设备 / 关掉标签页重开**：只要在新设备上输入同一个昵称，服务端识别为已入座玩家，向旧连接发送 `REPLACED_BY_NEW_SESSION` 并关闭（`4002`），将新连接绑定到该座位并立即下发最新 `PlayerView`。  
  * **本地双开自测**：同一浏览器打开两个普通标签页，Tab 1 填 `Alice`、Tab 2 填 `Bob`，因 `sessionStorage` 按标签页隔离，可直接双人联机测试，无需开隐身窗口。  
  * **陌生第 3 人拦截**：输入第 3 个不同昵称且房间已满时，短暂接受 WebSocket → 立即发送 `{ type: "error", code: "ROOM_FULL", message: "房间已满，请联系 Admin" }` → `close(4001)`，前端弹出明确提示。  
  * **掉线 vs 主动离开**：意外断线（关标签页、断网）时服务端**保留座位**等待同名重连；只有点击 `Leave / Switch Name`（发送 `leave`）才会**释放座位**，此后任意新昵称都可入座，不会再触发 `ROOM_FULL`。

## **5.2 前端交互与多语言（i18n）约定**

* **中英文双语支持（英文默认）**：  
  * 由 `public/i18n.js` 统一管理前端翻译词典，默认语言固定为**英文（`en`）**。  
  * 玩家端（入房页与对局顶栏）及管理端（`/admin/` 登录页与控制台顶栏）均提供即时切换按钮（`🌐 中文 / 🌐 EN`），用户选择写入 `localStorage`（`battleship_lang`）持久化保存，刷新或跳转页面自动保持所选语言。  
* **布阵弹窗（`PLACING` 阶段）**：  
  * 双方入座进入 `PLACING` 后，当前未锁船的玩家会看到居中布阵弹窗，内置 **6×6 实时预览棋盘**、对手准备状态徽章以及操作按钮 `Randomize Fleet` 和 `Confirm & Lock Fleet`；确认锁定后弹窗自动关闭并在主界面显示等待对手布阵提示。  
* **胜负结算弹窗（`FINISHED` 阶段）**：  
  * 任一方 3 艘船全部击沉进入 `FINISHED` 后，自动弹出居中结算弹窗展示胜负结果与最后一炮摘要，提供两个按钮：`Review Board`（仅关闭本局结算弹窗便于查看公开后的敌方完整棋盘，顶栏同时保留 `Rematch` 按钮）与 `Rematch`（投票或接受再来一局；若在弹窗未关闭前已投票，也可点击按钮进入等待状态）。  
* **退出 / 切换昵称**：  
  * `Leave / Switch Name` 按钮仅置于游戏主界面顶栏，不放在布阵弹窗内；在 `PLACING` / `PLAYING` 阶段点击会先弹出确认框（`Stay` / `Leave`），其余阶段直接离开。离开时先向服务端发送 `{ type: "leave" }` 释放座位，再清空当前会话的 `sessionStorage` 凭据、关闭 WebSocket 并返回入房表单页，因此可直接换新昵称重新入房。  
  * 留在房间的一方保留座位与昵称，对局回到 `WAITING` / Round 1，聊天区显示居中系统消息“Jack 离开了房间”，并弹出“对手已离开，等待新玩家加入”提示；聊天记录保留（同一座位换人后，旧消息按 `senderId + senderName` 区分，不会被误显示为新玩家本人的消息）。  
* **房间内聊天面板与随时重置**：  
  * **常驻紧凑聊天区**：固定位于双棋盘与图例下方，仅使用 `textContent` 安全渲染消息（含发送者、时间与文本，自己与对手分左右高亮显示）。房间聊天完全由适配层负责（Node 内存 / Cloudflare DO SQLite），每个房间保留最近 **50** 条消息（单条上限 **200** 字符），F5 刷新或断线重连可完整回看；仅在 Admin **重置房间** 或 **销毁房间** 时随房间存储一并清空。  
  * **随时重置对局（`Reset Game`）**：在 `PLACING` / `PLAYING` 阶段显示在状态操作栏；任一方发起重置后弹出确认横幅（`Accept Reset` / `Decline` / `Cancel`），双方同意后重置回 Round 1 `PLACING` 且保留座位与聊天记录。

## **5.3 对手在线状态指示**

外壳监听连接建立与断开（Cloudflare `webSocketClose` / `webSocketError`，Node.js `ws.on("close")`），一旦玩家上线或离线，向房间内另一名在线玩家推送包含最新 `presence.opponentOnline` 的状态消息，界面顶部实时展示“对手在线 / 对手已离线（等待重连...）”。

## **5.4 Cloudflare 休眠与状态恢复约束**

* 房间必须使用 WebSocket Hibernation API（`this.ctx.acceptWebSocket(server)`），并通过 `server.serializeAttachment({ playerId, normalizedName, displayName })` 存储单条连接的轻量身份标签（远低于 16 KiB 上限）。  
* 房间状态与座位表采用 `getState()` 内存缓存 \+ 变更落盘 `this.ctx.storage.put(...)` \+ 缓存为 `null` 时从存储兜底加载。  
* 邀请码过期采用懒检查，**禁止**为房间或邀请码设置轮询或高频心跳，让思考空窗期自然休眠以节省活跃内存时长（GB-s）。

# **六、验收清单（供 Antigravity 自测与人工验收）**

1. **纯内核单测通过**：`src/core/engine.test.ts` 脱离网络独立通过测试（船只越界/重叠校验、每回合固定各开一炮与轮换、重复轰炸拦截、沉船胜负、双人确认再来一局及先手轮换、`getPlayerView` 严格不泄露对手未击沉船只坐标）。  
2. **双端本地可运行**：配置 `.dev.vars` 后，`npm run dev:node`（Node.js 壳）与 `npm run dev:cf`（`wrangler dev`）均可正常访问 `/` 与 `/admin/`（及 `/admin` 重定向），完整打完两局（含再来一局先手互换）。  
3. **Admin 鉴权、发码与 TTL**：未配置或输错 `ADMIN_TOKEN` 返回 401；支持选择 1/3/7/15/30 天有效期（默认 7 天）；过期码与无效码在 `/api/rooms/:code/check` 及 `/ws` 均被精准拦截且不拉起 `GameRoom`。  
4. **昵称重连、跨设备找回与同浏览器双开**：  
   * 同浏览器两个普通标签页分别以不同昵称进入同一房间可顺畅对战；  
   * 任一标签页按 F5 刷新自动恢复战局；  
   * 打开新标签页输入已有玩家昵称可成功接管座位，原标签页收到“同名玩家已在其他设备接入”提示；  
   * 输入第 3 个昵称进入已满房间时，前端准确弹窗提示“房间已满，请联系 Admin”。  
5. **在线状态与防作弊验证**：一方关掉标签页后另一方界面实时显示“对手已离线”，重连后恢复“对手在线”；对局未结束时在浏览器 Network → WS 面板检查收到的 JSON，确认不含对手未击沉船只坐标。  
6. **重置与销毁验证**：Admin 点击“重置房间”后，原连接被断开、房间清空但原邀请码仍可重新进房开新局；点击“销毁房间”后，原邀请码立即失效并无法重连。  
7. **多语言、弹窗交互与双环境构建校验**：首次访问默认为英文且支持一键切换中文并持久化；`PLACING` 弹出含 6×6 预览的布阵弹窗、`FINISHED` 弹出胜负弹窗并支持 `Review Board` 与 `Rematch`；顶栏 `Leave / Switch Name` 可清空会话退回入房页；`npm test`、`npm run typecheck` 及 `npx wrangler deploy --dry-run --env dev` 均通过。  
8. **房间聊天与双人确认 `Reset Game` 校验**：对局双方可在棋盘下方聊天区实时互通消息（最多 200 字、保留最近 50 条、刷新重连自动恢复）；Admin 重置/销毁房间后聊天记录被清空；对局中任一方发起 `Reset Game`、对方同意后棋局恢复 Round 1 `PLACING`（`p1` 先手）且双方座位与聊天记录保持完整。  
9. **主动离开释放座位校验**：对局中 Jack 点击 `Leave / Switch Name` 并确认后，对手 Bob 界面回到 `WAITING` 并看到“Jack 离开了房间”；此时以新昵称 Joe 使用同一邀请码入房可成功入座（不再提示 `ROOM_FULL`），双方进入 Round 1 `PLACING`；再有第 3 个昵称进入仍被 `ROOM_FULL` 拦截。

