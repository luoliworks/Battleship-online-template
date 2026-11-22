import type { PlayerId } from "./types.ts";

export const SEAT_RECLAIM_GRACE_MS = 120_000;

export interface SeatInfo {
  normalizedName: string;
  displayName: string;
  disconnectedAt?: number | null;
}

export interface SeatsMap {
  p1: SeatInfo | null;
  p2: SeatInfo | null;
}

export type SeatOnlineMap = Record<PlayerId, boolean>;

export type SeatResolution =
  | { kind: "reclaim"; playerId: PlayerId }
  | { kind: "empty"; playerId: PlayerId }
  | { kind: "takeover"; playerId: PlayerId; previous: SeatInfo }
  | { kind: "full" };

const PLAYER_IDS: readonly PlayerId[] = ["p1", "p2"];

/**
 * Determine how a connecting player should be assigned a seat.
 * Preference order:
 * 1. Reclaim an existing seat matching `normalizedName` (even if offline past grace).
 * 2. Take an empty seat (`p1` before `p2`).
 * 3. Lazy takeover of an offline seat whose grace period has elapsed (oldest disconnect first).
 * 4. Reject as full.
 */
export function resolveSeat(
  seats: SeatsMap,
  online: SeatOnlineMap,
  normalizedName: string,
  now: number,
  graceMs: number = SEAT_RECLAIM_GRACE_MS,
): SeatResolution {
  for (const playerId of PLAYER_IDS) {
    if (seats[playerId]?.normalizedName === normalizedName) {
      return { kind: "reclaim", playerId };
    }
  }

  for (const playerId of PLAYER_IDS) {
    if (seats[playerId] === null) {
      return { kind: "empty", playerId };
    }
  }

  let candidateId: PlayerId | null = null;
  let candidateDisconnectedAt = Infinity;

  for (const playerId of PLAYER_IDS) {
    const seat = seats[playerId];
    if (!seat || online[playerId]) {
      continue;
    }
    if (
      typeof seat.disconnectedAt === "number" &&
      now - seat.disconnectedAt >= graceMs &&
      seat.disconnectedAt < candidateDisconnectedAt
    ) {
      candidateId = playerId;
      candidateDisconnectedAt = seat.disconnectedAt;
    }
  }

  if (candidateId !== null) {
    const previous = seats[candidateId]!;
    return {
      kind: "takeover",
      playerId: candidateId,
      previous: { ...previous },
    };
  }

  return { kind: "full" };
}

/**
 * Normalize `disconnectedAt` metadata against live socket presence:
 * - Offline seats without a numeric `disconnectedAt` (e.g., after deploy/migration) start grace now.
 * - Online seats with a stale numeric `disconnectedAt` are cleared to `null`.
 */
export function stampMissingDisconnects(
  seats: SeatsMap,
  online: SeatOnlineMap,
  now: number,
): { seats: SeatsMap; changed: boolean } {
  let changed = false;
  const next: SeatsMap = {
    p1: seats.p1 ? { ...seats.p1 } : null,
    p2: seats.p2 ? { ...seats.p2 } : null,
  };

  for (const playerId of PLAYER_IDS) {
    const seat = next[playerId];
    if (!seat) {
      continue;
    }
    if (online[playerId]) {
      if (typeof seat.disconnectedAt === "number") {
        seat.disconnectedAt = null;
        changed = true;
      }
    } else if (typeof seat.disconnectedAt !== "number") {
      seat.disconnectedAt = now;
      changed = true;
    }
  }

  return { seats: next, changed };
}

/**
 * Remaining grace period (in ms) before an offline seat becomes eligible for lazy takeover.
 * Returns `null` when the seat is unoccupied, online, or has no `disconnectedAt` timestamp.
 */
export function getSeatExpiresInMs(
  seat: SeatInfo | null,
  isOnline: boolean,
  now: number,
  graceMs: number = SEAT_RECLAIM_GRACE_MS,
): number | null {
  if (!seat || isOnline || typeof seat.disconnectedAt !== "number") {
    return null;
  }
  return Math.max(0, seat.disconnectedAt + graceMs - now);
}
