import { DurableObject } from "cloudflare:workers";
import { applyAction, createInitialState, seatPlayer } from "../../core/engine.ts";
import type {
  ClientAction,
  ErrorCode,
  GameState,
  PlayerId,
  ServerEvent,
} from "../../core/types.ts";
import { getPlayerView } from "../../core/view.ts";

const STATE_KEY = "state";
const SEATS_KEY = "seats";

interface SeatInfo {
  normalizedName: string;
  displayName: string;
}

interface SeatsMap {
  p1: SeatInfo | null;
  p2: SeatInfo | null;
}

interface SocketAttachment {
  playerId: PlayerId;
  normalizedName: string;
  displayName: string;
}

function getSocketAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    const raw = ws.deserializeAttachment() as Partial<SocketAttachment> | null;
    if (
      raw &&
      (raw.playerId === "p1" || raw.playerId === "p2") &&
      typeof raw.normalizedName === "string" &&
      typeof raw.displayName === "string"
    ) {
      return {
        playerId: raw.playerId,
        normalizedName: raw.normalizedName,
        displayName: raw.displayName,
      };
    }
  } catch {
    // Ignore invalid attachments on closed or unattached sockets.
  }
  return null;
}

function sendEvent(ws: WebSocket, event: ServerEvent): void {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    // Socket already closed or closing.
  }
}

export class GameRoom extends DurableObject {
  private stateCache: GameState | null = null;
  private seatsCache: SeatsMap | null = null;

  private async loadRoom(
    now: number,
  ): Promise<{ state: GameState; seats: SeatsMap }> {
    if (this.stateCache && this.seatsCache) {
      return { state: this.stateCache, seats: this.seatsCache };
    }

    const [storedState, storedSeats] = await Promise.all([
      this.ctx.storage.get<GameState>(STATE_KEY),
      this.ctx.storage.get<SeatsMap>(SEATS_KEY),
    ]);

    const state = storedState ?? createInitialState(now);
    const seats: SeatsMap = storedSeats ?? { p1: null, p2: null };

    this.stateCache = state;
    this.seatsCache = seats;
    return { state, seats };
  }

  private async saveRoom(state: GameState, seats: SeatsMap): Promise<void> {
    this.stateCache = state;
    this.seatsCache = seats;
    await this.ctx.storage.put({
      [STATE_KEY]: state,
      [SEATS_KEY]: seats,
    });
  }

  private broadcastState(state: GameState, excludeWs?: WebSocket): void {
    const activeByPlayer: Record<PlayerId, WebSocket | null> = {
      p1: null,
      p2: null,
    };

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) {
        continue;
      }
      const att = getSocketAttachment(ws);
      if (att) {
        activeByPlayer[att.playerId] = ws;
      }
    }

    const playerIds: PlayerId[] = ["p1", "p2"];
    for (const playerId of playerIds) {
      const ws = activeByPlayer[playerId];
      if (!ws) {
        continue;
      }
      const opponentId: PlayerId = playerId === "p1" ? "p2" : "p1";
      const event: ServerEvent = {
        type: "state",
        view: getPlayerView(state, playerId),
        presence: {
          selfOnline: true,
          opponentOnline: activeByPlayer[opponentId] !== null,
        },
      };
      sendEvent(ws, event);
    }
  }

  private async teardownRoom(
    errorCode: Extract<ErrorCode, "ROOM_RESET" | "ROOM_CLOSED">,
    message: string,
    closeCode: number,
  ): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.serializeAttachment(null);
      sendEvent(ws, {
        type: "error",
        code: errorCode,
        message,
      });
      try {
        ws.close(closeCode, errorCode);
      } catch {
        // Ignore already closed sockets.
      }
    }

    this.stateCache = null;
    this.seatsCache = null;
    await this.ctx.storage.deleteAll();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/internal/reset" && request.method === "POST") {
      await this.teardownRoom(
        "ROOM_RESET",
        "管理员已重置房间，请重新进入",
        4003,
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (pathname === "/internal/destroy" && request.method === "POST") {
      await this.teardownRoom(
        "ROOM_CLOSED",
        "管理员已销毁该房间",
        4004,
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (pathname !== "/ws") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const displayName = (url.searchParams.get("name") ?? "").trim();
    if (displayName.length < 1 || displayName.length > 20) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: "INVALID_ACTION",
          message: "昵称长度需为 1–20 个字符",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    const now = Date.now();
    const { state: currentState, seats: currentSeats } = await this.loadRoom(now);
    const normalizedName = displayName.toLowerCase();

    let playerId: PlayerId | null = null;
    if (currentSeats.p1?.normalizedName === normalizedName) {
      playerId = "p1";
    } else if (currentSeats.p2?.normalizedName === normalizedName) {
      playerId = "p2";
    } else if (currentSeats.p1 === null) {
      playerId = "p1";
    } else if (currentSeats.p2 === null) {
      playerId = "p2";
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (playerId === null) {
      server.accept();
      sendEvent(server, {
        type: "error",
        code: "ROOM_FULL",
        message: "房间已满，请联系 Admin",
      });
      server.close(4001, "ROOM_FULL");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);

    // Close any prior socket occupying this same seat before binding the new session.
    for (const existingWs of this.ctx.getWebSockets()) {
      if (existingWs === server) {
        continue;
      }
      const att = getSocketAttachment(existingWs);
      if (att && att.playerId === playerId) {
        existingWs.serializeAttachment(null);
        sendEvent(existingWs, {
          type: "error",
          code: "REPLACED_BY_NEW_SESSION",
          message: "同名玩家已在其他设备或窗口接入",
        });
        try {
          existingWs.close(4002, "REPLACED_BY_NEW_SESSION");
        } catch {
          // Ignore closing errors on stale sockets.
        }
      }
    }

    const attachment: SocketAttachment = {
      playerId,
      normalizedName,
      displayName,
    };
    server.serializeAttachment(attachment);

    const nextSeats: SeatsMap = {
      p1: currentSeats.p1 ? { ...currentSeats.p1 } : null,
      p2: currentSeats.p2 ? { ...currentSeats.p2 } : null,
    };
    nextSeats[playerId] = { normalizedName, displayName };

    const nextState = seatPlayer(currentState, playerId, displayName, now);
    await this.saveRoom(nextState, nextSeats);
    this.broadcastState(nextState);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const att = getSocketAttachment(ws);
    if (!att) {
      return;
    }

    let action: ClientAction;
    try {
      const text =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      action = JSON.parse(text) as ClientAction;
    } catch {
      sendEvent(ws, {
        type: "error",
        code: "INVALID_ACTION",
        message: "消息格式错误，必须为 JSON",
      });
      return;
    }

    const now = Date.now();
    const { state, seats } = await this.loadRoom(now);
    const result = applyAction(state, att.playerId, action, now);
    if (!result.ok) {
      sendEvent(ws, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }

    await this.saveRoom(result.state, seats);
    this.broadcastState(result.state);
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const att = getSocketAttachment(ws);
    if (!att) {
      return;
    }
    ws.serializeAttachment(null);
    const { state } = await this.loadRoom(Date.now());
    this.broadcastState(state, ws);
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    await this.handleDisconnect(ws);
    try {
      const safeCode =
        code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
      ws.close(safeCode, reason);
    } catch {
      // Socket may already be closed.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }
}
