import { cloneShip, cloneShot, isShipSunk } from "./engine.ts";
import {
  BOARD_SIZE,
  FLEET_SPEC,
  type GameState,
  type PlayerId,
  type PlayerView,
} from "./types.ts";

export function getPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const opponentId: PlayerId = playerId === "p1" ? "p2" : "p1";
  const self = state.players[playerId];
  const opponent = state.players[opponentId];

  const sunkEnemyShips = opponent.ships.filter((ship) =>
    isShipSunk(ship, self.shotsFired),
  );

  const revealedShips =
    state.phase === "FINISHED"
      ? opponent.ships.map(cloneShip)
      : sunkEnemyShips.map(cloneShip);

  return {
    boardSize: BOARD_SIZE,
    phase: state.phase,
    round: state.round,
    startingPlayer: state.startingPlayer,
    currentTurn: state.currentTurn,
    winner: state.winner,
    lastShot: state.lastShot ? { ...state.lastShot } : null,
    self: {
      id: playerId,
      displayName: self.displayName,
      ready: self.ready,
      rematchVoted: state.rematchVotes[playerId],
      resetVoted: Boolean(state.resetVotes?.[playerId]),
    },
    opponent: {
      id: opponentId,
      displayName: opponent.displayName,
      ready: opponent.ready,
      rematchVoted: state.rematchVotes[opponentId],
      resetVoted: Boolean(state.resetVotes?.[opponentId]),
      shipsRemaining: FLEET_SPEC.length - sunkEnemyShips.length,
    },
    myBoard: {
      ships: self.ships.map(cloneShip),
      incomingShots: opponent.shotsFired.map(cloneShot),
    },
    enemyBoard: {
      myShots: self.shotsFired.map(cloneShot),
      revealedShips,
    },
  };
}
