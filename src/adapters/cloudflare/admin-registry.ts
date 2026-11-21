import { DurableObject } from "cloudflare:workers";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const ALLOWED_TTL_DAYS = [1, 3, 7, 15, 30] as const;
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_MAX_PLAYERS = 2;
const MAX_NOTE_LENGTH = 100;
const MS_PER_DAY = 86_400_000;
const ROOM_KEY_PREFIX = "room:";

export interface RoomMeta {
  code: string;
  note: string;
  maxPlayers: number;
  createdAt: number;
  expiresAt: number;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeCode(raw: string): string | null {
  try {
    const normalized = decodeURIComponent(raw).trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export class AdminRegistry extends DurableObject {
  private async generateUniqueCode(): Promise<string> {
    const bytes = new Uint8Array(CODE_LENGTH);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      crypto.getRandomValues(bytes);
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!;
      }
      const existing = await this.ctx.storage.get<RoomMeta>(
        `${ROOM_KEY_PREFIX}${code}`,
      );
      if (!existing) {
        return code;
      }
    }
    throw new Error("Failed to generate unique room code");
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (pathname === "/rooms" && method === "GET") {
      const now = Date.now();
      const entries = await this.ctx.storage.list<RoomMeta>({
        prefix: ROOM_KEY_PREFIX,
      });
      const rooms = Array.from(entries.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((meta) => ({
          code: meta.code,
          note: meta.note,
          maxPlayers: meta.maxPlayers,
          createdAt: meta.createdAt,
          expiresAt: meta.expiresAt,
          expired: now > meta.expiresAt,
        }));
      return jsonResponse(200, { ok: true, rooms });
    }

    if (pathname === "/rooms" && method === "POST") {
      const rawText = (await request.text()).trim();
      let body: Record<string, unknown> = {};
      if (rawText !== "") {
        try {
          const parsed: unknown = JSON.parse(rawText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return jsonResponse(400, {
              ok: false,
              code: "INVALID_ACTION",
              message: "请求体必须是 JSON 对象",
            });
          }
          body = parsed as Record<string, unknown>;
        } catch {
          return jsonResponse(400, {
            ok: false,
            code: "INVALID_ACTION",
            message: "请求体不是合法 JSON",
          });
        }
      }

      let note = "";
      if (body.note !== undefined) {
        if (typeof body.note !== "string") {
          return jsonResponse(400, {
            ok: false,
            code: "INVALID_ACTION",
            message: "备注必须是字符串",
          });
        }
        note = body.note.trim();
        if (note.length > MAX_NOTE_LENGTH) {
          return jsonResponse(400, {
            ok: false,
            code: "INVALID_ACTION",
            message: `备注长度不能超过 ${MAX_NOTE_LENGTH} 个字符`,
          });
        }
      }

      let maxPlayers = DEFAULT_MAX_PLAYERS;
      if (body.maxPlayers !== undefined) {
        if (
          typeof body.maxPlayers !== "number" ||
          !Number.isInteger(body.maxPlayers) ||
          body.maxPlayers < 2
        ) {
          return jsonResponse(400, {
            ok: false,
            code: "INVALID_ACTION",
            message: "maxPlayers 必须是大于等于 2 的整数",
          });
        }
        maxPlayers = body.maxPlayers;
      }

      let ttlDays: number = DEFAULT_TTL_DAYS;
      if (body.ttlDays !== undefined) {
        if (
          typeof body.ttlDays !== "number" ||
          !ALLOWED_TTL_DAYS.includes(
            body.ttlDays as (typeof ALLOWED_TTL_DAYS)[number],
          )
        ) {
          return jsonResponse(400, {
            ok: false,
            code: "INVALID_ACTION",
            message: "ttlDays 仅支持 1 / 3 / 7 / 15 / 30",
          });
        }
        ttlDays = body.ttlDays;
      }

      const createdAt = Date.now();
      const expiresAt = createdAt + ttlDays * MS_PER_DAY;
      const code = await this.generateUniqueCode();
      const meta: RoomMeta = {
        code,
        note,
        maxPlayers,
        createdAt,
        expiresAt,
      };
      await this.ctx.storage.put(`${ROOM_KEY_PREFIX}${code}`, meta);

      return jsonResponse(201, {
        ok: true,
        code,
        joinUrl: `/?code=${code}`,
        note,
        maxPlayers,
        createdAt,
        expiresAt,
      });
    }

    const checkMatch = pathname.match(/^\/rooms\/([^/]+)\/check$/);
    if (checkMatch && method === "GET") {
      const code = normalizeCode(checkMatch[1]!);
      const meta = code
        ? await this.ctx.storage.get<RoomMeta>(`${ROOM_KEY_PREFIX}${code}`)
        : undefined;
      if (!meta) {
        return jsonResponse(404, {
          ok: false,
          code: "INVALID_CODE",
          message: "邀请码无效，请联系 Admin",
        });
      }
      if (Date.now() > meta.expiresAt) {
        return jsonResponse(410, {
          ok: false,
          code: "EXPIRED_CODE",
          message: "邀请码已过期，请联系 Admin",
        });
      }
      return jsonResponse(200, {
        ok: true,
        code: meta.code,
        maxPlayers: meta.maxPlayers,
        expiresAt: meta.expiresAt,
      });
    }

    const existsMatch = pathname.match(/^\/rooms\/([^/]+)\/exists$/);
    if (existsMatch && method === "GET") {
      const code = normalizeCode(existsMatch[1]!);
      const meta = code
        ? await this.ctx.storage.get<RoomMeta>(`${ROOM_KEY_PREFIX}${code}`)
        : undefined;
      if (!meta) {
        return jsonResponse(404, {
          ok: false,
          code: "INVALID_CODE",
          message: "房间不存在",
        });
      }
      return jsonResponse(200, { ok: true, code: meta.code });
    }

    const deleteMatch = pathname.match(/^\/rooms\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") {
      const code = normalizeCode(deleteMatch[1]!);
      const meta = code
        ? await this.ctx.storage.get<RoomMeta>(`${ROOM_KEY_PREFIX}${code}`)
        : undefined;
      if (!meta) {
        return jsonResponse(404, {
          ok: false,
          code: "INVALID_CODE",
          message: "房间不存在",
        });
      }
      await this.ctx.storage.delete(`${ROOM_KEY_PREFIX}${meta.code}`);
      return jsonResponse(200, { ok: true, code: meta.code });
    }

    return jsonResponse(404, {
      ok: false,
      code: "NOT_FOUND",
      message: "接口不存在",
    });
  }
}
