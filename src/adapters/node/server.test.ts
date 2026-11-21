import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import type { ServerEvent, ShipPlacement } from "../../core/types.ts";
import { createNodeServer, type NodeServerHandle } from "./server.ts";

const P1_SHIPS: ShipPlacement[] = [
  { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
  { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
  { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
];

const P2_SHIPS: ShipPlacement[] = [
  { id: "s1", x: 3, y: 1, len: 3, dir: "V" },
  { id: "s2", x: 0, y: 5, len: 2, dir: "H" },
  { id: "s3", x: 5, y: 0, len: 2, dir: "V" },
];

interface TestWsClient {
  ws: WebSocket;
  nextEvent: (predicate?: (ev: ServerEvent) => boolean) => Promise<ServerEvent>;
  waitForClose: () => Promise<{ code: number; reason: string }>;
  close: () => Promise<void>;
}

async function startTestServer(options?: {
  adminToken?: string;
  now?: () => number;
}): Promise<{
  handle: NodeServerHandle;
  baseUrl: string;
  wsBaseUrl: string;
}> {
  const handle = createNodeServer(options);
  await new Promise<void>((resolve) => {
    handle.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = handle.server.address() as AddressInfo;
  return {
    handle,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsBaseUrl: `ws://127.0.0.1:${address.port}`,
  };
}

function connectWsClient(url: string): Promise<TestWsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const eventQueue: ServerEvent[] = [];
    const waiters: Array<{
      predicate?: (ev: ServerEvent) => boolean;
      resolve: (ev: ServerEvent) => void;
    }> = [];
    let closedInfo: { code: number; reason: string } | null = null;
    const closeWaiters: Array<(info: { code: number; reason: string }) => void> =
      [];

    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString("utf8")) as ServerEvent;
      const waiterIndex = waiters.findIndex(
        (w) => !w.predicate || w.predicate(ev),
      );
      if (waiterIndex >= 0) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        waiter!.resolve(ev);
      } else {
        eventQueue.push(ev);
      }
    });

    ws.on("close", (code, reasonBuf) => {
      closedInfo = { code, reason: reasonBuf.toString("utf8") };
      while (closeWaiters.length > 0) {
        const fn = closeWaiters.shift()!;
        fn(closedInfo);
      }
    });

    const client: TestWsClient = {
      ws,
      nextEvent(predicate) {
        const idx = eventQueue.findIndex((ev) => !predicate || predicate(ev));
        if (idx >= 0) {
          const [matched] = eventQueue.splice(idx, 1);
          return Promise.resolve(matched!);
        }
        return new Promise((res) => {
          waiters.push({ predicate, resolve: res });
        });
      },
      waitForClose() {
        if (closedInfo) {
          return Promise.resolve(closedInfo);
        }
        return new Promise((res) => {
          closeWaiters.push(res);
        });
      },
      async close() {
        if (ws.readyState === WebSocket.CLOSED) {
          return;
        }
        const closed = client.waitForClose();
        ws.close();
        await closed;
      },
    };

    const onError = (err: Error) => {
      ws.off("open", onOpen);
      reject(err);
    };
    const onOpen = () => {
      ws.off("error", onError);
      resolve(client);
    };

    ws.once("error", onError);
    ws.once("open", onOpen);
  });
}

function connectWsExpectUpgradeFailure(
  url: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;

    ws.on("unexpected-response", (_req, res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on("end", () => {
        settled = true;
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode ?? 0,
          body: JSON.parse(text) as Record<string, unknown>,
        });
      });
    });

    ws.on("open", () => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error("Expected upgrade failure, but connection opened"));
      }
    });

    ws.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

describe("Node.js Adapter Server", () => {
  it("enforces fail-closed ADMIN_TOKEN authentication on /api/admin/*", async () => {
    // 1. Empty token -> always rejects
    const emptyServer = await startTestServer({ adminToken: "" });
    try {
      const resNoAuth = await fetch(`${emptyServer.baseUrl}/api/admin/rooms`);
      assert.equal(resNoAuth.status, 401);

      const resEmptyBearer = await fetch(
        `${emptyServer.baseUrl}/api/admin/rooms`,
        {
          headers: { Authorization: "Bearer " },
        },
      );
      assert.equal(resEmptyBearer.status, 401);

      const resCreate = await fetch(`${emptyServer.baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers: {
          Authorization: "Bearer anything",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(resCreate.status, 401);
    } finally {
      await emptyServer.handle.close();
    }

    // 2. Configured token -> rejects wrong/missing, accepts valid
    const authServer = await startTestServer({ adminToken: "secret-pass" });
    try {
      const missing = await fetch(`${authServer.baseUrl}/api/admin/rooms`);
      assert.equal(missing.status, 401);

      const wrong = await fetch(`${authServer.baseUrl}/api/admin/rooms`, {
        headers: { Authorization: "Bearer wrong-pass" },
      });
      assert.equal(wrong.status, 401);

      const valid = await fetch(`${authServer.baseUrl}/api/admin/rooms`, {
        headers: { Authorization: "Bearer secret-pass" },
      });
      assert.equal(valid.status, 200);
      const data = (await valid.json()) as { ok: boolean; rooms: unknown[] };
      assert.equal(data.ok, true);
      assert.deepEqual(data.rooms, []);
    } finally {
      await authServer.handle.close();
    }
  });

  it("creates and lists rooms with clean codes and TTL without creating active GameRooms", async () => {
    let clock = 1_700_000_000_000;
    const { handle, baseUrl } = await startTestServer({
      adminToken: "admin-123",
      now: () => clock,
    });

    try {
      const headers = {
        Authorization: "Bearer admin-123",
        "Content-Type": "application/json",
      };

      // Invalid TTL rejected
      const badTtl = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ttlDays: 5 }),
      });
      assert.equal(badTtl.status, 400);

      // Default room creation (ttlDays = 7, maxPlayers = 2)
      const createRes = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers,
        body: JSON.stringify({ note: "测试房间 A" }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        ok: boolean;
        code: string;
        joinUrl: string;
        note: string;
        maxPlayers: number;
        createdAt: number;
        expiresAt: number;
      };
      assert.equal(created.ok, true);
      assert.match(created.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      assert.equal(created.joinUrl, `/?code=${created.code}`);
      assert.equal(created.note, "测试房间 A");
      assert.equal(created.maxPlayers, 2);
      assert.equal(created.createdAt, clock);
      assert.equal(created.expiresAt, clock + 7 * 86_400_000);

      // Listing rooms must NOT wake/create GameRoom instances
      const listRes = await fetch(`${baseUrl}/api/admin/rooms`, { headers });
      assert.equal(listRes.status, 200);
      const listData = (await listRes.json()) as {
        ok: boolean;
        rooms: Array<{ code: string; expired: boolean }>;
      };
      assert.equal(listData.rooms.length, 1);
      assert.equal(listData.rooms[0]?.code, created.code);
      assert.equal(listData.rooms[0]?.expired, false);
      assert.equal(handle.getActiveRoomCount(), 0);

      // Advance clock past TTL -> marked expired in list
      clock += 7 * 86_400_000 + 1;
      const listExpired = await fetch(`${baseUrl}/api/admin/rooms`, { headers });
      const expiredData = (await listExpired.json()) as {
        rooms: Array<{ expired: boolean }>;
      };
      assert.equal(expiredData.rooms[0]?.expired, true);
      assert.equal(handle.getActiveRoomCount(), 0);
    } finally {
      await handle.close();
    }
  });

  it("blocks invalid and expired codes in both /check and /ws without creating GameRooms", async () => {
    let clock = 1_700_000_000_000;
    const { handle, baseUrl, wsBaseUrl } = await startTestServer({
      adminToken: "admin-123",
      now: () => clock,
    });

    try {
      // Unknown code pre-check & ws bypass
      const unknownCheck = await fetch(`${baseUrl}/api/rooms/ZZZZZZ/check`);
      assert.equal(unknownCheck.status, 404);
      const unknownBody = (await unknownCheck.json()) as { code: string };
      assert.equal(unknownBody.code, "INVALID_CODE");

      const wsUnknown = await connectWsExpectUpgradeFailure(
        `${wsBaseUrl}/ws?code=ZZZZZZ&name=Alice`,
      );
      assert.equal(wsUnknown.statusCode, 404);
      assert.equal(wsUnknown.body.code, "INVALID_CODE");
      assert.equal(handle.getActiveRoomCount(), 0);

      // Create 1-day room
      const createRes = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttlDays: 1 }),
      });
      const { code } = (await createRes.json()) as { code: string };

      const validCheck = await fetch(
        `${baseUrl}/api/rooms/${code.toLowerCase()}/check`,
      );
      assert.equal(validCheck.status, 200);
      assert.equal(handle.getActiveRoomCount(), 0);

      // Invalid nickname length rejected on /ws
      const wsBadName = await connectWsExpectUpgradeFailure(
        `${wsBaseUrl}/ws?code=${code}&name=${encodeURIComponent("   ")}`,
      );
      assert.equal(wsBadName.statusCode, 400);
      assert.equal(handle.getActiveRoomCount(), 0);

      // Expire the room
      clock += 86_400_000 + 1;
      const expiredCheck = await fetch(`${baseUrl}/api/rooms/${code}/check`);
      assert.equal(expiredCheck.status, 410);
      const expiredBody = (await expiredCheck.json()) as { code: string };
      assert.equal(expiredBody.code, "EXPIRED_CODE");

      const wsExpired = await connectWsExpectUpgradeFailure(
        `${wsBaseUrl}/ws?code=${code}&name=Alice`,
      );
      assert.equal(wsExpired.statusCode, 410);
      assert.equal(wsExpired.body.code, "EXPIRED_CODE");
      assert.equal(handle.getActiveRoomCount(), 0);
    } finally {
      await handle.close();
    }
  });

  it("handles seating, presence updates, 3rd-player ROOM_FULL (4001), and same-name takeover (4002)", async () => {
    const { handle, baseUrl, wsBaseUrl } = await startTestServer({
      adminToken: "admin-123",
    });

    try {
      const createRes = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-123",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const { code } = (await createRes.json()) as { code: string };

      // Player 1 joins
      const p1 = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=Alice`,
      );
      const p1Init = await p1.nextEvent();
      assert.equal(p1Init.type, "state");
      assert.equal(p1Init.view.phase, "WAITING");
      assert.equal(p1Init.view.self.id, "p1");
      assert.equal(p1Init.presence.opponentOnline, false);

      // Player 2 joins -> PLACING & both online
      const p2 = await connectWsClient(`${wsBaseUrl}/ws?code=${code}&name=Bob`);
      const p2Init = await p2.nextEvent();
      assert.equal(p2Init.type, "state");
      assert.equal(p2Init.view.phase, "PLACING");
      assert.equal(p2Init.view.self.id, "p2");
      assert.equal(p2Init.presence.opponentOnline, true);

      const p1OnP2Join = await p1.nextEvent();
      assert.equal(p1OnP2Join.type, "state");
      assert.equal(p1OnP2Join.view.phase, "PLACING");
      assert.equal(p1OnP2Join.presence.opponentOnline, true);

      // 3rd stranger rejected with ROOM_FULL + close 4001
      const p3 = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=Charlie`,
      );
      const p3Err = await p3.nextEvent();
      assert.deepEqual(p3Err, {
        type: "error",
        code: "ROOM_FULL",
        message: "房间已满，请联系 Admin",
      });
      const p3Closed = await p3.waitForClose();
      assert.equal(p3Closed.code, 4001);

      // Same-name takeover (case-insensitive "alice") kicks old p1 with 4002
      const p1New = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=alice`,
      );
      const p1OldErr = await p1.nextEvent((ev) => ev.type === "error");
      assert.equal(p1OldErr.type, "error");
      assert.equal(p1OldErr.code, "REPLACED_BY_NEW_SESSION");
      const p1OldClosed = await p1.waitForClose();
      assert.equal(p1OldClosed.code, 4002);

      const p1NewState = await p1New.nextEvent();
      assert.equal(p1NewState.type, "state");
      assert.equal(p1NewState.view.self.id, "p1");
      assert.equal(p1NewState.presence.opponentOnline, true);

      // Bob remains online and sees opponent still online (no offline flicker)
      const p2AfterTakeover = await p2.nextEvent();
      assert.equal(p2AfterTakeover.type, "state");
      assert.equal(p2AfterTakeover.presence.opponentOnline, true);

      // Disconnect p1New -> Bob immediately gets opponentOnline: false
      await p1New.close();
      const p2OnP1Leave = await p2.nextEvent();
      assert.equal(p2OnP1Leave.type, "state");
      assert.equal(p2OnP1Leave.presence.opponentOnline, false);

      // Even while p1 is offline, a 3rd stranger is still blocked (seat reserved)
      const strangerDuringOffline = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=Eve`,
      );
      const strangerErr = await strangerDuringOffline.nextEvent();
      assert.equal(strangerErr.type, "error");
      assert.equal(strangerErr.code, "ROOM_FULL");
      const strangerClose = await strangerDuringOffline.waitForClose();
      assert.equal(strangerClose.code, 4001);

      await p2.close();
    } finally {
      await handle.close();
    }
  });

  it("plays over WebSocket without leaking un-sunk enemy ships and enforces turn rules", async () => {
    const { handle, baseUrl, wsBaseUrl } = await startTestServer({
      adminToken: "admin-123",
    });

    try {
      const createRes = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-123",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const { code } = (await createRes.json()) as { code: string };

      const p1 = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=Alice`,
      );
      await p1.nextEvent();
      const p2 = await connectWsClient(`${wsBaseUrl}/ws?code=${code}&name=Bob`);
      await p2.nextEvent();
      await p1.nextEvent();

      // Both place ships
      p1.ws.send(JSON.stringify({ type: "place_ships", ships: P1_SHIPS }));
      const p1AfterPlace = await p1.nextEvent();
      const p2AfterP1Place = await p2.nextEvent();
      assert.equal(p1AfterPlace.type, "state");
      assert.equal(p2AfterP1Place.type, "state");
      assert.equal(p2AfterP1Place.view.opponent.ready, true);
      assert.deepEqual(p2AfterP1Place.view.enemyBoard.revealedShips, []);

      p2.ws.send(JSON.stringify({ type: "place_ships", ships: P2_SHIPS }));
      const p1Playing = await p1.nextEvent();
      const p2Playing = await p2.nextEvent();
      assert.equal(p1Playing.type, "state");
      assert.equal(p2Playing.type, "state");
      assert.equal(p1Playing.view.phase, "PLAYING");
      assert.equal(p1Playing.view.currentTurn, "p1");
      assert.deepEqual(p1Playing.view.enemyBoard.revealedShips, []);
      assert.equal(
        JSON.stringify(p1Playing.view.enemyBoard).includes('"s1"'),
        false,
      );

      // Illegal out-of-turn fire from p2 -> INVALID_ACTION sent only to p2
      p2.ws.send(JSON.stringify({ type: "fire", x: 0, y: 0 }));
      const p2Err = await p2.nextEvent();
      assert.equal(p2Err.type, "error");
      assert.equal(p2Err.code, "INVALID_ACTION");

      // Legal fire from p1 hitting P2's s1 at (3,1) -> turn switches to p2
      p1.ws.send(JSON.stringify({ type: "fire", x: 3, y: 1 }));
      const p1AfterFire = await p1.nextEvent();
      const p2AfterFire = await p2.nextEvent();
      assert.equal(p1AfterFire.type, "state");
      assert.equal(p2AfterFire.type, "state");
      assert.equal(p1AfterFire.view.lastShot?.result, "hit");
      assert.equal(p1AfterFire.view.currentTurn, "p2");
      assert.deepEqual(p1AfterFire.view.enemyBoard.revealedShips, []);

      await p1.close();
      await p2.close();
    } finally {
      await handle.close();
    }
  });

  it("supports admin reset (4003, preserves code) and destroy (4004, invalidates code)", async () => {
    const { handle, baseUrl, wsBaseUrl } = await startTestServer({
      adminToken: "admin-123",
    });

    try {
      const headers = {
        Authorization: "Bearer admin-123",
        "Content-Type": "application/json",
      };
      const createRes = await fetch(`${baseUrl}/api/admin/rooms`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const { code } = (await createRes.json()) as { code: string };

      const p1 = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=Alice`,
      );
      await p1.nextEvent();
      const p2 = await connectWsClient(`${wsBaseUrl}/ws?code=${code}&name=Bob`);
      await p2.nextEvent();
      await p1.nextEvent();
      assert.equal(handle.getActiveRoomCount(), 1);

      // Reset room
      const resetRes = await fetch(`${baseUrl}/api/admin/rooms/${code}/reset`, {
        method: "POST",
        headers,
      });
      assert.equal(resetRes.status, 200);
      assert.equal(handle.getActiveRoomCount(), 0);

      const p1ResetErr = await p1.nextEvent((ev) => ev.type === "error");
      assert.equal(p1ResetErr.type, "error");
      assert.equal(p1ResetErr.code, "ROOM_RESET");
      assert.equal((await p1.waitForClose()).code, 4003);

      const p2ResetErr = await p2.nextEvent((ev) => ev.type === "error");
      assert.equal(p2ResetErr.type, "error");
      assert.equal(p2ResetErr.code, "ROOM_RESET");
      assert.equal((await p2.waitForClose()).code, 4003);

      // Code still valid and fresh players can enter
      const checkAfterReset = await fetch(`${baseUrl}/api/rooms/${code}/check`);
      assert.equal(checkAfterReset.status, 200);

      const freshP1 = await connectWsClient(
        `${wsBaseUrl}/ws?code=${code}&name=NewPlayer`,
      );
      const freshState = await freshP1.nextEvent();
      assert.equal(freshState.type, "state");
      assert.equal(freshState.view.phase, "WAITING");
      assert.equal(freshState.view.round, 1);

      // Destroy room
      const delRes = await fetch(`${baseUrl}/api/admin/rooms/${code}`, {
        method: "DELETE",
        headers,
      });
      assert.equal(delRes.status, 200);
      assert.equal(handle.getActiveRoomCount(), 0);

      const delErr = await freshP1.nextEvent((ev) => ev.type === "error");
      assert.equal(delErr.type, "error");
      assert.equal(delErr.code, "ROOM_CLOSED");
      assert.equal((await freshP1.waitForClose()).code, 4004);

      // Destroyed code is rejected by both /check and /ws
      const checkAfterDel = await fetch(`${baseUrl}/api/rooms/${code}/check`);
      assert.equal(checkAfterDel.status, 404);

      const wsAfterDel = await connectWsExpectUpgradeFailure(
        `${wsBaseUrl}/ws?code=${code}&name=Alice`,
      );
      assert.equal(wsAfterDel.statusCode, 404);
      assert.equal(wsAfterDel.body.code, "INVALID_CODE");
    } finally {
      await handle.close();
    }
  });
});
