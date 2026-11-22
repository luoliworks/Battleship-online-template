import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  applyAction,
  createInitialState,
  releaseSeat,
  seatPlayer,
} from "../../core/engine.ts";
import type {
  ChatMessage,
  ClientAction,
  ClientMessage,
  ErrorCode,
  GameState,
  PlayerId,
  ServerEvent,
} from "../../core/types.ts";
import { getPlayerView } from "../../core/view.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const ALLOWED_TTL_DAYS = [1, 3, 7, 15, 30] as const;
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_MAX_PLAYERS = 2;
const MAX_NOTE_LENGTH = 100;
const MAX_CHAT_LENGTH = 200;
const MAX_CHAT_HISTORY = 50;
const MAX_BODY_BYTES = 16 * 1024;
const MS_PER_DAY = 86_400_000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface RoomMeta {
  code: string;
  note: string;
  maxPlayers: number;
  createdAt: number;
  expiresAt: number;
}

interface SeatInfo {
  normalizedName: string;
  displayName: string;
}

interface RoomInstance {
  state: GameState;
  seats: {
    p1: SeatInfo | null;
    p2: SeatInfo | null;
  };
  connections: {
    p1: WebSocket | null;
    p2: WebSocket | null;
  };
  chatMessages: ChatMessage[];
}

export interface NodeServerOptions {
  adminToken?: string;
  publicDir?: string;
  now?: () => number;
}

export interface NodeServerHandle {
  server: Server;
  wss: WebSocketServer;
  getActiveRoomCount: () => number;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function writeUpgradeError(
  socket: Duplex,
  status: number,
  statusText: string,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  const headers = [
    `HTTP/1.1 ${status} ${statusText}`,
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  socket.write(headers + body);
  socket.destroy();
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const bufA = Buffer.from(expected, "utf8");
  const bufB = Buffer.from(actual, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isAuthorizedAdmin(req: IncomingMessage, adminToken: string): boolean {
  if (adminToken.trim() === "") {
    return false;
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const providedToken = authHeader.slice("Bearer ".length);
  return constantTimeEqual(adminToken, providedToken);
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      return { ok: false, message: "请求体过大" };
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") {
    return { ok: true, value: {} };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: "请求体必须是 JSON 对象" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: "请求体不是合法 JSON" };
  }
}

function generateRoomCode(existing: Map<string, RoomMeta>): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!;
    }
    if (!existing.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to generate unique room code");
}

function normalizeCodeOrNull(raw: string): string | null {
  try {
    return decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    return null;
  }
}

function parseRequestUrl(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

function sendWsEvent(ws: WebSocket | null, event: ServerEvent): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcastRoomEvent(room: RoomInstance, event: ServerEvent): void {
  const payload = JSON.stringify(event);
  const playerIds: PlayerId[] = ["p1", "p2"];
  for (const playerId of playerIds) {
    const ws = room.connections[playerId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function broadcastRoomState(room: RoomInstance): void {
  const playerIds: PlayerId[] = ["p1", "p2"];
  for (const playerId of playerIds) {
    const ws = room.connections[playerId];
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    const opponentId: PlayerId = playerId === "p1" ? "p2" : "p1";
    const opponentWs = room.connections[opponentId];
    const event: ServerEvent = {
      type: "state",
      view: getPlayerView(room.state, playerId),
      presence: {
        selfOnline: true,
        opponentOnline:
          opponentWs !== null && opponentWs.readyState === WebSocket.OPEN,
      },
    };
    ws.send(JSON.stringify(event));
  }
}

export function createNodeServer(options: NodeServerOptions = {}): NodeServerHandle {
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? "";
  const now = options.now ?? (() => Date.now());
  const defaultPublicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../public",
  );
  const publicDir = path.resolve(options.publicDir ?? defaultPublicDir);

  const roomsRegistry = new Map<string, RoomMeta>();
  const gameRooms = new Map<string, RoomInstance>();
  const wss = new WebSocketServer({ noServer: true });

  function teardownRoom(
    code: string,
    errorCode: Extract<ErrorCode, "ROOM_RESET" | "ROOM_CLOSED">,
    message: string,
    closeCode: number,
  ): void {
    const room = gameRooms.get(code);
    if (!room) {
      return;
    }
    gameRooms.delete(code);

    const playerIds: PlayerId[] = ["p1", "p2"];
    for (const playerId of playerIds) {
      const ws = room.connections[playerId];
      room.connections[playerId] = null;
      if (!ws) {
        continue;
      }
      sendWsEvent(ws, { type: "error", code: errorCode, message });
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(closeCode, errorCode);
      }
    }
  }

  function handleRoomJoin(ws: WebSocket, code: string, displayName: string): void {
    const meta = roomsRegistry.get(code);
    const currentNow = now();
    if (!meta) {
      sendWsEvent(ws, {
        type: "error",
        code: "INVALID_CODE",
        message: "邀请码无效，请联系 Admin",
      });
      ws.close(4000, "INVALID_CODE");
      return;
    }
    if (currentNow > meta.expiresAt) {
      sendWsEvent(ws, {
        type: "error",
        code: "EXPIRED_CODE",
        message: "邀请码已过期，请联系 Admin",
      });
      ws.close(4000, "EXPIRED_CODE");
      return;
    }

    let room = gameRooms.get(code);
    if (!room) {
      room = {
        state: createInitialState(currentNow),
        seats: { p1: null, p2: null },
        connections: { p1: null, p2: null },
        chatMessages: [],
      };
      gameRooms.set(code, room);
    }

    const normalizedName = displayName.toLowerCase();
    let playerId: PlayerId | null = null;

    if (room.seats.p1?.normalizedName === normalizedName) {
      playerId = "p1";
    } else if (room.seats.p2?.normalizedName === normalizedName) {
      playerId = "p2";
    } else if (room.seats.p1 === null) {
      playerId = "p1";
    } else if (room.seats.p2 === null) {
      playerId = "p2";
    }

    if (playerId === null) {
      sendWsEvent(ws, {
        type: "error",
        code: "ROOM_FULL",
        message: "房间已满，请联系 Admin",
      });
      ws.close(4001, "ROOM_FULL");
      return;
    }

    const oldWs = room.connections[playerId];
    if (oldWs && oldWs !== ws) {
      // Detach old socket before closing so its close handler does not clear the new session.
      room.connections[playerId] = null;
      sendWsEvent(oldWs, {
        type: "error",
        code: "REPLACED_BY_NEW_SESSION",
        message: "同名玩家已在其他设备或窗口接入",
      });
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        oldWs.close(4002, "REPLACED_BY_NEW_SESSION");
      }
    }

    room.seats[playerId] = { normalizedName, displayName };
    room.connections[playerId] = ws;
    room.state = seatPlayer(room.state, playerId, displayName, currentNow);

    const assignedPlayerId = playerId;
    const activeRoom = room;

    broadcastRoomState(activeRoom);
    sendWsEvent(ws, {
      type: "chat_history",
      messages: activeRoom.chatMessages,
    });

    const handleDisconnect = () => {
      if (
        gameRooms.get(code) === activeRoom &&
        activeRoom.connections[assignedPlayerId] === ws
      ) {
        activeRoom.connections[assignedPlayerId] = null;
        broadcastRoomState(activeRoom);
      }
    };

    ws.on("close", handleDisconnect);
    ws.on("error", handleDisconnect);

    ws.on("message", (data) => {
      if (
        gameRooms.get(code) !== activeRoom ||
        activeRoom.connections[assignedPlayerId] !== ws
      ) {
        return;
      }

      let message: ClientMessage;
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        message = JSON.parse(text) as ClientMessage;
      } catch {
        sendWsEvent(ws, {
          type: "error",
          code: "INVALID_ACTION",
          message: "消息格式错误，必须为 JSON",
        });
        return;
      }

      if (message && typeof message === "object" && message.type === "leave") {
        // Voluntary leave: free the seat so a different nickname can join.
        const leaverName =
          activeRoom.seats[assignedPlayerId]?.displayName ?? displayName;
        const leftAt = now();
        activeRoom.seats[assignedPlayerId] = null;
        activeRoom.connections[assignedPlayerId] = null;
        activeRoom.state = releaseSeat(activeRoom.state, assignedPlayerId, leftAt);

        const notice: ChatMessage = {
          id: randomUUID(),
          senderId: assignedPlayerId,
          senderName: leaverName,
          text: `${leaverName} left the room`,
          createdAt: leftAt,
          system: "player_left",
        };
        activeRoom.chatMessages.push(notice);
        if (activeRoom.chatMessages.length > MAX_CHAT_HISTORY) {
          activeRoom.chatMessages = activeRoom.chatMessages.slice(
            -MAX_CHAT_HISTORY,
          );
        }

        broadcastRoomState(activeRoom);
        broadcastRoomEvent(activeRoom, { type: "chat", message: notice });
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, "LEFT");
        }
        return;
      }

      if (message && typeof message === "object" && message.type === "chat") {
        const text = typeof message.text === "string" ? message.text.trim() : "";
        if (text.length === 0) {
          sendWsEvent(ws, {
            type: "error",
            code: "INVALID_ACTION",
            message: "聊天消息不能为空",
          });
          return;
        }
        if (text.length > MAX_CHAT_LENGTH) {
          sendWsEvent(ws, {
            type: "error",
            code: "INVALID_ACTION",
            message: "聊天消息不能超过 200 个字符",
          });
          return;
        }

        const chatMsg: ChatMessage = {
          id: randomUUID(),
          senderId: assignedPlayerId,
          senderName:
            activeRoom.seats[assignedPlayerId]?.displayName ?? displayName,
          text,
          createdAt: now(),
        };
        activeRoom.chatMessages.push(chatMsg);
        if (activeRoom.chatMessages.length > MAX_CHAT_HISTORY) {
          activeRoom.chatMessages = activeRoom.chatMessages.slice(
            -MAX_CHAT_HISTORY,
          );
        }
        broadcastRoomEvent(activeRoom, {
          type: "chat",
          message: chatMsg,
        });
        return;
      }

      const result = applyAction(
        activeRoom.state,
        assignedPlayerId,
        message as ClientAction,
        now(),
      );
      if (!result.ok) {
        sendWsEvent(ws, {
          type: "error",
          code: result.code,
          message: result.message,
        });
        return;
      }

      activeRoom.state = result.state;
      broadcastRoomState(activeRoom);
    });
  }

  async function handleStaticRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    if (pathname === "/admin" || pathname === "/admin.html") {
      res.writeHead(302, { Location: "/admin/" });
      res.end();
      return;
    }

    const mappedPathname = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const relativePath = mappedPathname.replace(/^\/+/, "");
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(relativePath);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    const resolvedPath = path.resolve(publicDir, decodedPath);
    if (
      resolvedPath !== publicDir &&
      !resolvedPath.startsWith(publicDir + path.sep)
    ) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    try {
      const info = await stat(resolvedPath);
      if (!info.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      const content = await readFile(resolvedPath);
      res.writeHead(200, { "Content-Type": contentType });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(content);
      }
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    }
  }

  async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = parseRequestUrl(req.url);
    if (!url) {
      sendJson(res, 400, {
        ok: false,
        code: "INVALID_ACTION",
        message: "无效的请求路径",
      });
      return;
    }
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (!pathname.startsWith("/api/")) {
      await handleStaticRequest(req, res, pathname);
      return;
    }

    // Public room pre-check (reads roomsRegistry only, never wakes/creates GameRoom)
    const checkMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/check$/);
    if (checkMatch && method === "GET") {
      const code = normalizeCodeOrNull(checkMatch[1]!);
      const meta = code ? roomsRegistry.get(code) : undefined;
      if (!meta) {
        sendJson(res, 404, {
          ok: false,
          code: "INVALID_CODE",
          message: "邀请码无效，请联系 Admin",
        });
        return;
      }

      if (now() > meta.expiresAt) {
        sendJson(res, 410, {
          ok: false,
          code: "EXPIRED_CODE",
          message: "邀请码已过期，请联系 Admin",
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        code: meta.code,
        maxPlayers: meta.maxPlayers,
        expiresAt: meta.expiresAt,
      });
      return;
    }

    // Admin endpoints (Fail-Closed Bearer token check)
    if (pathname.startsWith("/api/admin/")) {
      if (!isAuthorizedAdmin(req, adminToken)) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "管理员认证失败",
        });
        return;
      }

      if (pathname === "/api/admin/rooms" && method === "GET") {
        const currentNow = now();
        const rooms = Array.from(roomsRegistry.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((meta) => ({
            code: meta.code,
            note: meta.note,
            maxPlayers: meta.maxPlayers,
            createdAt: meta.createdAt,
            expiresAt: meta.expiresAt,
            expired: currentNow > meta.expiresAt,
          }));
        sendJson(res, 200, { ok: true, rooms });
        return;
      }

      if (pathname === "/api/admin/rooms" && method === "POST") {
        const bodyResult = await readJsonBody(req);
        if (!bodyResult.ok) {
          sendJson(res, 400, {
            ok: false,
            code: "INVALID_ACTION",
            message: bodyResult.message,
          });
          return;
        }

        const body = bodyResult.value;
        const rawNote = body.note;
        let note = "";
        if (rawNote !== undefined) {
          if (typeof rawNote !== "string") {
            sendJson(res, 400, {
              ok: false,
              code: "INVALID_ACTION",
              message: "备注必须是字符串",
            });
            return;
          }
          note = rawNote.trim();
          if (note.length > MAX_NOTE_LENGTH) {
            sendJson(res, 400, {
              ok: false,
              code: "INVALID_ACTION",
              message: `备注长度不能超过 ${MAX_NOTE_LENGTH} 个字符`,
            });
            return;
          }
        }

        const rawMaxPlayers = body.maxPlayers;
        let maxPlayers = DEFAULT_MAX_PLAYERS;
        if (rawMaxPlayers !== undefined) {
          if (
            typeof rawMaxPlayers !== "number" ||
            !Number.isInteger(rawMaxPlayers) ||
            rawMaxPlayers < 2
          ) {
            sendJson(res, 400, {
              ok: false,
              code: "INVALID_ACTION",
              message: "maxPlayers 必须是大于等于 2 的整数",
            });
            return;
          }
          maxPlayers = rawMaxPlayers;
        }

        const rawTtlDays = body.ttlDays;
        let ttlDays: number = DEFAULT_TTL_DAYS;
        if (rawTtlDays !== undefined) {
          if (
            typeof rawTtlDays !== "number" ||
            !ALLOWED_TTL_DAYS.includes(
              rawTtlDays as (typeof ALLOWED_TTL_DAYS)[number],
            )
          ) {
            sendJson(res, 400, {
              ok: false,
              code: "INVALID_ACTION",
              message: "ttlDays 仅支持 1 / 3 / 7 / 15 / 30",
            });
            return;
          }
          ttlDays = rawTtlDays;
        }

        const createdAt = now();
        const expiresAt = createdAt + ttlDays * MS_PER_DAY;
        const code = generateRoomCode(roomsRegistry);
        const meta: RoomMeta = {
          code,
          note,
          maxPlayers,
          createdAt,
          expiresAt,
        };
        roomsRegistry.set(code, meta);

        sendJson(res, 201, {
          ok: true,
          code,
          joinUrl: `/?code=${code}`,
          note,
          maxPlayers,
          createdAt,
          expiresAt,
        });
        return;
      }

      const resetMatch = pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/reset$/);
      if (resetMatch && method === "POST") {
        const code = normalizeCodeOrNull(resetMatch[1]!);
        if (!code || !roomsRegistry.has(code)) {
          sendJson(res, 404, {
            ok: false,
            code: "INVALID_CODE",
            message: "房间不存在",
          });
          return;
        }

        teardownRoom(
          code,
          "ROOM_RESET",
          "管理员已重置房间，请重新进入",
          4003,
        );
        sendJson(res, 200, { ok: true, code });
        return;
      }

      const deleteMatch = pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/);
      if (deleteMatch && method === "DELETE") {
        const code = normalizeCodeOrNull(deleteMatch[1]!);
        if (!code || !roomsRegistry.has(code)) {
          sendJson(res, 404, {
            ok: false,
            code: "INVALID_CODE",
            message: "房间不存在",
          });
          return;
        }

        teardownRoom(code, "ROOM_CLOSED", "管理员已销毁该房间", 4004);
        roomsRegistry.delete(code);
        sendJson(res, 200, { ok: true, code });
        return;
      }
    }

    sendJson(res, 404, {
      ok: false,
      code: "NOT_FOUND",
      message: "接口不存在",
    });
  }

  const server = createServer((req, res) => {
    void handleHttpRequest(req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "服务器内部错误",
        });
      } else {
        res.end();
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = parseRequestUrl(req.url);
    if (!url || url.pathname !== "/ws") {
      writeUpgradeError(socket, 404, "Not Found", {
        ok: false,
        code: "NOT_FOUND",
        message: "无效的 WebSocket 路径",
      });
      return;
    }

    const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
    const displayName = (url.searchParams.get("name") ?? "").trim();

    // Anti-bypass check: verify code in roomsRegistry before touching gameRooms.
    const meta = roomsRegistry.get(code);
    if (!meta) {
      writeUpgradeError(socket, 404, "Not Found", {
        ok: false,
        code: "INVALID_CODE",
        message: "邀请码无效，请联系 Admin",
      });
      return;
    }

    if (now() > meta.expiresAt) {
      writeUpgradeError(socket, 410, "Gone", {
        ok: false,
        code: "EXPIRED_CODE",
        message: "邀请码已过期，请联系 Admin",
      });
      return;
    }

    if (displayName.length < 1 || displayName.length > 20) {
      writeUpgradeError(socket, 400, "Bad Request", {
        ok: false,
        code: "INVALID_ACTION",
        message: "昵称长度需为 1–20 个字符",
      });
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRoomJoin(ws, code, displayName);
    });
  });

  async function close(): Promise<void> {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    if (server.listening) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  return {
    server,
    wss,
    getActiveRoomCount: () => gameRooms.size,
    close,
  };
}

const isMainEntry =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const port = Number(process.env.PORT || 8787);
  const { server } = createNodeServer();
  server.listen(port, () => {
    console.log(`Battleship Node server listening on http://localhost:${port}`);
  });
}
