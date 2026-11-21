import { AdminRegistry } from "./admin-registry.ts";
import { GameRoom } from "./game-room.ts";

export { AdminRegistry, GameRoom };

export interface Env {
  ADMIN_REGISTRY: DurableObjectNamespace;
  GAME_ROOM: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  ASSETS?: Fetcher;
}

const TEXT_ENCODER = new TextEncoder();

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const bytesA = TEXT_ENCODER.encode(expected);
  const bytesB = TEXT_ENCODER.encode(actual);
  if (bytesA.length !== bytesB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i]! ^ bytesB[i]!;
  }
  return diff === 0;
}

function isAuthorizedAdmin(request: Request, adminToken: string | undefined): boolean {
  if (typeof adminToken !== "string" || adminToken.trim() === "") {
    return false;
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const provided = authHeader.slice("Bearer ".length);
  return constantTimeEqual(adminToken, provided);
}

function getAdminRegistryStub(env: Env): DurableObjectStub {
  const id = env.ADMIN_REGISTRY.idFromName("admin-registry");
  return env.ADMIN_REGISTRY.get(id);
}

function getGameRoomStub(env: Env, code: string): DurableObjectStub {
  const id = env.GAME_ROOM.idFromName(code);
  return env.GAME_ROOM.get(id);
}

function normalizeCode(raw: string): string | null {
  try {
    const normalized = decodeURIComponent(raw).trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Public room pre-check: reads AdminRegistry only, never wakes GameRoom.
    const checkMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/check$/);
    if (checkMatch && method === "GET") {
      const code = normalizeCode(checkMatch[1]!);
      if (!code) {
        return jsonResponse(404, {
          ok: false,
          code: "INVALID_CODE",
          message: "邀请码无效，请联系 Admin",
        });
      }
      return getAdminRegistryStub(env).fetch(
        `https://admin-registry/rooms/${encodeURIComponent(code)}/check`,
      );
    }

    // Admin endpoints (Fail-Closed Bearer token check).
    if (pathname.startsWith("/api/admin/")) {
      if (!isAuthorizedAdmin(request, env.ADMIN_TOKEN)) {
        return jsonResponse(401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "管理员认证失败",
        });
      }

      const registry = getAdminRegistryStub(env);

      if (pathname === "/api/admin/rooms" && (method === "GET" || method === "POST")) {
        const body = method === "POST" ? await request.text() : undefined;
        return registry.fetch("https://admin-registry/rooms", {
          method,
          headers:
            method === "POST"
              ? { "Content-Type": "application/json" }
              : undefined,
          body,
        });
      }

      const resetMatch = pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/reset$/);
      if (resetMatch && method === "POST") {
        const code = normalizeCode(resetMatch[1]!);
        if (!code) {
          return jsonResponse(404, {
            ok: false,
            code: "INVALID_CODE",
            message: "房间不存在",
          });
        }
        const existsRes = await registry.fetch(
          `https://admin-registry/rooms/${encodeURIComponent(code)}/exists`,
        );
        if (!existsRes.ok) {
          return existsRes;
        }
        await getGameRoomStub(env, code).fetch("https://game-room/internal/reset", {
          method: "POST",
        });
        return jsonResponse(200, { ok: true, code });
      }

      const deleteMatch = pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/);
      if (deleteMatch && method === "DELETE") {
        const code = normalizeCode(deleteMatch[1]!);
        if (!code) {
          return jsonResponse(404, {
            ok: false,
            code: "INVALID_CODE",
            message: "房间不存在",
          });
        }
        const delRes = await registry.fetch(
          `https://admin-registry/rooms/${encodeURIComponent(code)}`,
          { method: "DELETE" },
        );
        if (!delRes.ok) {
          return delRes;
        }
        await getGameRoomStub(env, code).fetch(
          "https://game-room/internal/destroy",
          { method: "POST" },
        );
        return jsonResponse(200, { ok: true, code });
      }

      return jsonResponse(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "接口不存在",
      });
    }

    // WebSocket room upgrade with entry-point anti-bypass check.
    if (pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return jsonResponse(426, {
          ok: false,
          code: "INVALID_ACTION",
          message: "需要 WebSocket 升级请求",
        });
      }

      const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
      if (!code) {
        return jsonResponse(404, {
          ok: false,
          code: "INVALID_CODE",
          message: "邀请码无效，请联系 Admin",
        });
      }

      // Check AdminRegistry first so invalid/expired codes never instantiate a GameRoom DO.
      const checkRes = await getAdminRegistryStub(env).fetch(
        `https://admin-registry/rooms/${encodeURIComponent(code)}/check`,
      );
      if (!checkRes.ok) {
        return checkRes;
      }

      const displayName = (url.searchParams.get("name") ?? "").trim();
      if (displayName.length < 1 || displayName.length > 20) {
        return jsonResponse(400, {
          ok: false,
          code: "INVALID_ACTION",
          message: "昵称长度需为 1–20 个字符",
        });
      }

      return getGameRoomStub(env, code).fetch(request);
    }

    if (pathname.startsWith("/api/")) {
      return jsonResponse(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "接口不存在",
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
