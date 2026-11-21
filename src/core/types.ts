export const BOARD_SIZE = 6;

export interface ShipSpec {
  id: string;
  name: string;
  len: number;
}

export const FLEET_SPEC: readonly ShipSpec[] = [
  { id: "s1", name: "巡洋舰", len: 3 },
  { id: "s2", name: "驱逐舰 A", len: 2 },
  { id: "s3", name: "驱逐舰 B", len: 2 },
];

export type PlayerId = "p1" | "p2";
export type GamePhase = "WAITING" | "PLACING" | "PLAYING" | "FINISHED";
export type Direction = "H" | "V";
export type ShotResult = "miss" | "hit" | "sunk";

export interface ShipPlacement {
  id: string;
  x: number;
  y: number;
  len: number;
  dir: Direction;
}

export interface ShotRecord {
  x: number;
  y: number;
  result: ShotResult;
  sunkShipId: string | null;
}

export interface LastShot {
  by: PlayerId;
  x: number;
  y: number;
  result: ShotResult;
  sunkShipId: string | null;
}

export interface PlayerState {
  displayName: string | null;
  ships: ShipPlacement[];
  ready: boolean;
  shotsFired: ShotRecord[];
}

export interface GameState {
  phase: GamePhase;
  round: number;
  startingPlayer: PlayerId;
  currentTurn: PlayerId | null;
  players: {
    p1: PlayerState;
    p2: PlayerState;
  };
  winner: PlayerId | null;
  lastShot: LastShot | null;
  rematchVotes: {
    p1: boolean;
    p2: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

export type ClientAction =
  | { type: "place_ships"; ships: ShipPlacement[] }
  | { type: "fire"; x: number; y: number }
  | { type: "rematch" };

export type ErrorCode =
  | "ROOM_FULL"
  | "INVALID_CODE"
  | "EXPIRED_CODE"
  | "INVALID_ACTION"
  | "REPLACED_BY_NEW_SESSION"
  | "ROOM_RESET"
  | "ROOM_CLOSED";

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; code: "INVALID_ACTION"; message: string };

export interface PlayerView {
  boardSize: number;
  phase: GamePhase;
  round: number;
  startingPlayer: PlayerId;
  currentTurn: PlayerId | null;
  winner: PlayerId | null;
  lastShot: LastShot | null;
  self: {
    id: PlayerId;
    displayName: string | null;
    ready: boolean;
    rematchVoted: boolean;
  };
  opponent: {
    id: PlayerId;
    displayName: string | null;
    ready: boolean;
    rematchVoted: boolean;
    shipsRemaining: number;
  };
  myBoard: {
    ships: ShipPlacement[];
    incomingShots: ShotRecord[];
  };
  enemyBoard: {
    myShots: ShotRecord[];
    revealedShips: ShipPlacement[];
  };
}

export interface PresenceState {
  selfOnline: boolean;
  opponentOnline: boolean;
}

export type ServerEvent =
  | { type: "state"; view: PlayerView; presence: PresenceState }
  | { type: "error"; code: ErrorCode; message: string };
