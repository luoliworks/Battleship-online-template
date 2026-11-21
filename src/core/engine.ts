import {
  BOARD_SIZE,
  FLEET_SPEC,
  type ActionResult,
  type ClientAction,
  type GameState,
  type PlayerId,
  type PlayerState,
  type ShipPlacement,
  type ShotRecord,
  type ShotResult,
} from "./types.ts";

export interface GridCell {
  x: number;
  y: number;
}

function createEmptyPlayerState(displayName: string | null = null): PlayerState {
  return {
    displayName,
    ships: [],
    ready: false,
    shotsFired: [],
  };
}

export function cloneShip(ship: ShipPlacement): ShipPlacement {
  return {
    id: ship.id,
    x: ship.x,
    y: ship.y,
    len: ship.len,
    dir: ship.dir,
  };
}

export function cloneShot(shot: ShotRecord): ShotRecord {
  return {
    x: shot.x,
    y: shot.y,
    result: shot.result,
    sunkShipId: shot.sunkShipId,
  };
}

function clonePlayerState(player: PlayerState): PlayerState {
  return {
    displayName: player.displayName,
    ships: player.ships.map(cloneShip),
    ready: player.ready,
    shotsFired: player.shotsFired.map(cloneShot),
  };
}

function cloneState(state: GameState): GameState {
  return {
    phase: state.phase,
    round: state.round,
    startingPlayer: state.startingPlayer,
    currentTurn: state.currentTurn,
    players: {
      p1: clonePlayerState(state.players.p1),
      p2: clonePlayerState(state.players.p2),
    },
    winner: state.winner,
    lastShot: state.lastShot ? { ...state.lastShot } : null,
    rematchVotes: {
      p1: state.rematchVotes.p1,
      p2: state.rematchVotes.p2,
    },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function getOpponentId(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function hasCellHit(shots: readonly ShotRecord[], x: number, y: number): boolean {
  return shots.some((shot) => shot.x === x && shot.y === y);
}

export function isShipSunk(ship: ShipPlacement, shots: readonly ShotRecord[]): boolean {
  const cells = getShipCells(ship);
  return cells.every((cell) => hasCellHit(shots, cell.x, cell.y));
}

function invalidAction(message: string): ActionResult {
  return {
    ok: false,
    code: "INVALID_ACTION",
    message,
  };
}

export function createInitialState(now: number): GameState {
  return {
    phase: "WAITING",
    round: 1,
    startingPlayer: "p1",
    currentTurn: null,
    players: {
      p1: createEmptyPlayerState(),
      p2: createEmptyPlayerState(),
    },
    winner: null,
    lastShot: null,
    rematchVotes: {
      p1: false,
      p2: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function seatPlayer(
  state: GameState,
  playerId: PlayerId,
  displayName: string,
  now: number,
): GameState {
  const next = cloneState(state);
  next.players[playerId].displayName = displayName;
  next.updatedAt = now;

  if (
    next.phase === "WAITING" &&
    next.players.p1.displayName !== null &&
    next.players.p2.displayName !== null
  ) {
    next.phase = "PLACING";
  }

  return next;
}

export function getShipCells(ship: ShipPlacement): GridCell[] {
  const cells: GridCell[] = [];
  for (let i = 0; i < ship.len; i += 1) {
    cells.push({
      x: ship.dir === "H" ? ship.x + i : ship.x,
      y: ship.dir === "V" ? ship.y + i : ship.y,
    });
  }
  return cells;
}

export function validateShips(
  ships: ShipPlacement[],
): { ok: true } | { ok: false; message: string } {
  if (!Array.isArray(ships) || ships.length !== FLEET_SPEC.length) {
    return {
      ok: false,
      message: `舰队必须包含 ${FLEET_SPEC.length} 艘船`,
    };
  }

  const seenIds: Record<string, boolean> = {};
  const occupiedCells: Record<string, boolean> = {};
  const actualLengths: number[] = [];

  for (const ship of ships) {
    if (!ship || typeof ship !== "object") {
      return { ok: false, message: "船只数据格式无效" };
    }
    if (typeof ship.id !== "string" || ship.id.trim().length === 0) {
      return { ok: false, message: "船只 ID 无效" };
    }
    if (seenIds[ship.id]) {
      return { ok: false, message: `船只 ID 重复: ${ship.id}` };
    }
    seenIds[ship.id] = true;

    if (ship.dir !== "H" && ship.dir !== "V") {
      return { ok: false, message: `船只 ${ship.id} 朝向必须是 H 或 V` };
    }
    if (
      !Number.isInteger(ship.x) ||
      !Number.isInteger(ship.y) ||
      !Number.isInteger(ship.len) ||
      ship.len <= 0 ||
      ship.len > BOARD_SIZE
    ) {
      return { ok: false, message: `船只 ${ship.id} 坐标或长度必须是合法整数` };
    }

    actualLengths.push(ship.len);

    const cells = getShipCells(ship);
    for (const cell of cells) {
      if (
        cell.x < 0 ||
        cell.x >= BOARD_SIZE ||
        cell.y < 0 ||
        cell.y >= BOARD_SIZE
      ) {
        return { ok: false, message: `船只 ${ship.id} 越界` };
      }
      const key = `${cell.x},${cell.y}`;
      if (occupiedCells[key]) {
        return { ok: false, message: `船只在坐标 (${cell.x}, ${cell.y}) 发生重叠` };
      }
      occupiedCells[key] = true;
    }
  }

  const expectedLengths = FLEET_SPEC.map((spec) => spec.len).sort((a, b) => a - b);
  const sortedActual = [...actualLengths].sort((a, b) => a - b);
  for (let i = 0; i < expectedLengths.length; i += 1) {
    if (sortedActual[i] !== expectedLengths[i]) {
      return {
        ok: false,
        message: "舰队长度配置必须为 1 艘长度 3 与 2 艘长度 2",
      };
    }
  }

  return { ok: true };
}

function handlePlaceShips(
  state: GameState,
  playerId: PlayerId,
  ships: ShipPlacement[],
  now: number,
): ActionResult {
  if (state.phase !== "PLACING") {
    return invalidAction("当前阶段不可摆船");
  }
  if (state.players[playerId].ready) {
    return invalidAction("你已提交布阵，无法重复修改");
  }

  const validation = validateShips(ships);
  if (!validation.ok) {
    return invalidAction(validation.message);
  }

  const next = cloneState(state);
  next.players[playerId].ships = ships.map(cloneShip);
  next.players[playerId].ready = true;
  next.updatedAt = now;

  if (next.players.p1.ready && next.players.p2.ready) {
    next.phase = "PLAYING";
    next.currentTurn = next.startingPlayer;
  }

  return { ok: true, state: next };
}

function handleFire(
  state: GameState,
  playerId: PlayerId,
  x: number,
  y: number,
  now: number,
): ActionResult {
  if (state.phase !== "PLAYING") {
    return invalidAction("当前不在开火阶段");
  }
  if (state.currentTurn !== playerId) {
    return invalidAction("还没轮到你的回合");
  }
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= BOARD_SIZE ||
    y < 0 ||
    y >= BOARD_SIZE
  ) {
    return invalidAction("开火坐标越界");
  }

  const attacker = state.players[playerId];
  if (hasCellHit(attacker.shotsFired, x, y)) {
    return invalidAction("不能重复轰炸同一坐标");
  }

  const opponentId = getOpponentId(playerId);
  const defender = state.players[opponentId];

  const next = cloneState(state);
  const nextAttacker = next.players[playerId];

  let hitShip: ShipPlacement | null = null;
  for (const ship of defender.ships) {
    const cells = getShipCells(ship);
    if (cells.some((cell) => cell.x === x && cell.y === y)) {
      hitShip = ship;
      break;
    }
  }

  let result: ShotResult = "miss";
  let sunkShipId: string | null = null;

  const placeholderRecord: ShotRecord = {
    x,
    y,
    result: "miss",
    sunkShipId: null,
  };
  const nextShots = [...nextAttacker.shotsFired, placeholderRecord];

  if (hitShip) {
    if (isShipSunk(hitShip, nextShots)) {
      result = "sunk";
      sunkShipId = hitShip.id;
    } else {
      result = "hit";
    }
  }

  placeholderRecord.result = result;
  placeholderRecord.sunkShipId = sunkShipId;
  nextAttacker.shotsFired = nextShots;

  next.lastShot = {
    by: playerId,
    x,
    y,
    result,
    sunkShipId,
  };
  next.updatedAt = now;

  const allDefenderShipsSunk =
    defender.ships.length > 0 &&
    defender.ships.every((ship) => isShipSunk(ship, nextShots));

  if (allDefenderShipsSunk) {
    next.phase = "FINISHED";
    next.winner = playerId;
    next.currentTurn = null;
  } else {
    // Fixed one shot per turn: always alternate turn after any legal shot.
    next.currentTurn = opponentId;
  }

  return { ok: true, state: next };
}

function handleRematch(
  state: GameState,
  playerId: PlayerId,
  now: number,
): ActionResult {
  if (state.phase !== "FINISHED") {
    return invalidAction("对局尚未结束，无法发起再来一局");
  }

  const next = cloneState(state);
  next.rematchVotes[playerId] = true;
  next.updatedAt = now;

  if (next.rematchVotes.p1 && next.rematchVotes.p2) {
    const nextStarter: PlayerId = next.startingPlayer === "p1" ? "p2" : "p1";
    next.phase = "PLACING";
    next.round += 1;
    next.startingPlayer = nextStarter;
    next.currentTurn = null;
    next.winner = null;
    next.lastShot = null;
    next.rematchVotes = { p1: false, p2: false };
    next.players.p1 = createEmptyPlayerState(next.players.p1.displayName);
    next.players.p2 = createEmptyPlayerState(next.players.p2.displayName);
  }

  return { ok: true, state: next };
}

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: ClientAction,
  now: number,
): ActionResult {
  if (!action || typeof action !== "object") {
    return invalidAction("无效的操作格式");
  }

  switch (action.type) {
    case "place_ships":
      return handlePlaceShips(state, playerId, action.ships, now);
    case "fire":
      return handleFire(state, playerId, action.x, action.y, now);
    case "rematch":
      return handleRematch(state, playerId, now);
    default:
      return invalidAction("不支持的操作类型");
  }
}
