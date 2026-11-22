# Battleship Mini Demo (Online Turn-Based Skeleton)

Minimal 6×6 two-player Battleship online demo built as a reusable turn-based multiplayer skeleton that runs identically on **Node.js** and **Cloudflare Workers + Durable Objects (SQLite + WebSocket Hibernation)** with a **zero-build native HTML/CSS/JS frontend** (English default + Chinese toggle).

> Technical spec: [GDD/Battleship Mini Demo — Technical GDD.md](GDD/Battleship%20Mini%20Demo%20%E2%80%94%20Technical%20GDD.md)

---

## Features

- **Pure, Platform-Agnostic Game Core (`src/core/`)**: Zero network, timer, or storage dependencies; strictly JSON-serializable state.
- **Dual Runtime Adapters (`src/adapters/`)**:
  - **Node.js (`src/adapters/node/server.ts`)**: Native HTTP static hosting + `/api/*` + `ws` WebSockets + in-memory maps.
  - **Cloudflare Workers + DO (`src/adapters/cloudflare/`)**: Workers Static Assets (`run_worker_first: ["/api/*", "/ws"]`), global `AdminRegistry` DO, and per-room `GameRoom` DO using SQLite storage (`new_sqlite_classes`) and WebSocket Hibernation API (`acceptWebSocket` + `serializeAttachment`).
- **Server-Authoritative & Anti-Cheat**: `getPlayerView(state, playerId)` strips un-sunk enemy ship coordinates while the match is active and reveals full boards only after `FINISHED`.
- **Fail-Closed Admin Auth & Invite Codes**: `ADMIN_TOKEN` bearer auth (rejects all `/api/admin/*` requests when unset or empty), configurable TTL (`1 / 3 / 7 / 15 / 30` days), lazy expiration check without waking `GameRoom` DOs, plus room reset (`4003`) and destroy (`4004`).
- **Nickname Binding + `sessionStorage` Reconnect**: Seamless F5 refresh recovery, case-insensitive cross-device/tab seat takeover (`4002`), dual-tab testing in normal browser tabs, 3rd-player `ROOM_FULL` blocking (`4001`), and live opponent presence indicator. Unexpected disconnects keep the seat for reconnect, while **`Leave / Switch Name` explicitly releases the seat** (`{ type: "leave" }`, with a confirm dialog mid-match) so a different nickname can join; the remaining player returns to `WAITING` and sees a "left the room" chat notice.
- **Zero-Build Bilingual Frontend (`public/`)**: English default with live `EN / 中文` toggle (`localStorage`), placement modal with random fleet generator & 6×6 preview, post-game result modal with board review & mutual rematch (rotating starting player), **mutual in-game `Reset Game`** (returns to Round 1 `PLACING` while preserving seats & chat), and **adapter-layer persistent Room Chat** (last 50 messages retained across reconnects; cleared on Admin Reset/Destroy).

---

## Project Structure

```text
.
├── src/
│   ├── core/                         # Pure game logic (zero Node/CF dependencies)
│   │   ├── types.ts                  # GameState, PlayerView, ClientAction, ServerEvent
│   │   ├── engine.ts                 # createInitialState, seatPlayer, validateShips, applyAction
│   │   ├── view.ts                   # getPlayerView (hides un-sunk enemy ships)
│   │   └── engine.test.ts            # Unit tests (node:test)
│   └── adapters/
│       ├── node/
│       │   ├── server.ts             # Node.js HTTP + ws server
│       │   └── server.test.ts        # Node HTTP/WS integration tests
│       └── cloudflare/
│           ├── index.ts              # Worker entry: auth, /api/* routing, /ws anti-bypass
│           ├── admin-registry.ts     # Singleton DO ("admin-registry") for invite codes & TTL
│           └── game-room.ts          # Per-room DO: WebSocket Hibernation + SQLite storage
├── public/                           # Zero-build static frontend
│   ├── index.html                    # Player entry & match UI (/)
│   ├── admin/
│   │   └── index.html                # Admin Console (/admin/)
│   ├── game.js                       # Player client logic
│   ├── admin.js                      # Admin console logic
│   ├── i18n.js                       # EN (default) / ZH translations
│   └── styles.css                    # Responsive styles
├── .dev.vars.example                 # Local env template (ADMIN_TOKEN)
├── package.json
├── tsconfig.json                     # Node/core TypeScript check
├── tsconfig.cf.json                  # Cloudflare Workers TypeScript check
└── wrangler.jsonc                    # Cloudflare Workers + Static Assets + SQLite DO config
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js 24+** (runs `.ts` files natively via type stripping and `node --test`).

### 1. Install Dependencies

```bash
npm install
```

> **Windows PowerShell note**: If PowerShell script execution policy blocks `npm`, use `npm.cmd` (for example `npm.cmd install`, `npm.cmd test`, `npm.cmd run dev:node`).

### 2. Configure Local `ADMIN_TOKEN`

Copy `.dev.vars.example` to `.dev.vars` (ignored by Git):

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` if desired:

```dotenv
ADMIN_TOKEN=dev-admin-password
```

> If `.dev.vars` is missing or `ADMIN_TOKEN` is empty, all `/api/admin/*` endpoints fail closed with `401 Unauthorized`.

### 3. Run Locally (Node.js or Cloudflare Wrangler)

Start **either** server on `http://localhost:8787`:

- **Node.js adapter (in-memory rooms)**:
  ```bash
  npm run dev:node
  ```
- **Cloudflare Workers + Durable Objects locally (SQLite persisted under `.wrangler/`)**:
  ```bash
  npm run dev:cf
  ```

Open in your browser:

- **Admin Console**: `http://localhost:8787/admin/` (visiting `/admin` redirects to `/admin/`)
- **Player Entry**: `http://localhost:8787/` (or direct invite link `http://localhost:8787/?code=<CODE>`)

### 4. Run Tests & Typechecks

```bash
npm test
npm run typecheck
```

---

## Deploying to Cloudflare Workers

1. Configure your production admin secret (never commit secrets in code or `wrangler.jsonc`):
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```
2. Deploy the Worker, Static Assets, and SQLite Durable Object migrations:
   ```bash
   npx wrangler deploy
   ```

### Isolated Dev Environment (`--env dev`)

[wrangler.jsonc](wrangler.jsonc) defines an isolated `dev` environment (`battleship-mini-demo-dev`) so you can deploy and test another branch (such as `develop`) without overwriting production or sharing Durable Objects data and secrets:

1. Configure the separate dev admin secret once:
   ```bash
   npx wrangler secret put ADMIN_TOKEN --env dev
   ```
2. Deploy to the isolated dev Worker (`battleship-mini-demo-dev.<your-subdomain>.workers.dev`):
   ```bash
   npx wrangler deploy --env dev
   ```

### Cloudflare Operational Notes

- `GET /api/admin/rooms` and `GET /api/rooms/:code/check` only query `AdminRegistry` and never instantiate or wake `GameRoom` DOs.
- `/ws` validates the invite code against `AdminRegistry` in the entrypoint Worker before resolving `GAME_ROOM.idFromName(code)`, preventing invalid/expired codes from creating room instances.
- `GameRoom` uses WebSocket Hibernation (`this.ctx.acceptWebSocket`) and `serializeAttachment`, with zero polling or heartbeat timers.

---

## Reusing This Skeleton for Another Game

To swap Battleship for another turn-based game, replace `src/core/` while preserving the three decoupling constraints:

1. `GameState` must remain pure JSON-serializable (`object`, `array`, `number`, `string`, `boolean`, `null` — no `Map`, `Set`, or class instances).
2. `src/core/` must never call `Date.now()` or `setTimeout()` directly (accept `now` as a parameter from adapters).
3. `src/core/` must never hold `WebSocket` references (identify players by seat IDs such as `"p1"` / `"p2"` and delegate connection presence, takeover, reset, and destroy to `src/adapters/`).
