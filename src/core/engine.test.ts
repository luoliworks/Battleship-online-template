import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAction,
  createInitialState,
  releaseSeat,
  seatPlayer,
  validateShips,
} from "./engine.ts";
import {
  SEAT_RECLAIM_GRACE_MS,
  getSeatExpiresInMs,
  resolveSeat,
  stampMissingDisconnects,
  type SeatsMap,
} from "./seats.ts";
import type { GameState, ShipPlacement } from "./types.ts";
import { getPlayerView } from "./view.ts";

const P1_SHIPS: ShipPlacement[] = [
  { id: "s1", x: 0, y: 0, len: 3, dir: "H" }, // (0,0), (1,0), (2,0)
  { id: "s2", x: 0, y: 2, len: 2, dir: "V" }, // (0,2), (0,3)
  { id: "s3", x: 4, y: 4, len: 2, dir: "H" }, // (4,4), (5,4)
];

const P2_SHIPS: ShipPlacement[] = [
  { id: "s1", x: 3, y: 1, len: 3, dir: "V" }, // (3,1), (3,2), (3,3)
  { id: "s2", x: 0, y: 5, len: 2, dir: "H" }, // (0,5), (1,5)
  { id: "s3", x: 5, y: 0, len: 2, dir: "V" }, // (5,0), (5,1)
];

function setupPlayingState(): GameState {
  let state = createInitialState(1000);
  state = seatPlayer(state, "p1", "Alice", 1001);
  state = seatPlayer(state, "p2", "Bob", 1002);

  const r1 = applyAction(state, "p1", { type: "place_ships", ships: P1_SHIPS }, 1003);
  assert.equal(r1.ok, true);
  state = r1.state;

  const r2 = applyAction(state, "p2", { type: "place_ships", ships: P2_SHIPS }, 1004);
  assert.equal(r2.ok, true);
  return r2.state;
}

describe("Pure Battleship Core Engine", () => {
  it("starts in WAITING, preserves JSON serializability, and enters PLACING once both players seat", () => {
    const initial = createInitialState(100);
    assert.equal(initial.phase, "WAITING");
    assert.equal(initial.round, 1);
    assert.equal(initial.startingPlayer, "p1");
    assert.equal(initial.currentTurn, null);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(initial)), initial);

    const afterP1 = seatPlayer(initial, "p1", "Alice", 200);
    assert.equal(afterP1.phase, "WAITING");
    assert.equal(afterP1.players.p1.displayName, "Alice");
    assert.equal(initial.players.p1.displayName, null);

    const afterP2 = seatPlayer(afterP1, "p2", "Bob", 300);
    assert.equal(afterP2.phase, "PLACING");
    assert.equal(afterP2.players.p2.displayName, "Bob");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(afterP2)), afterP2);
  });

  it("validates ship bounds, overlap, counts, lengths, directions, and IDs", () => {
    assert.equal(validateShips(P1_SHIPS).ok, true);

    // Horizontal out-of-bounds (x=4, len=3 -> 4,5,6)
    assert.equal(
      validateShips([
        { id: "s1", x: 4, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Vertical out-of-bounds (y=5, len=2 -> 5,6)
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 0, y: 5, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Negative coordinate
    assert.equal(
      validateShips([
        { id: "s1", x: -1, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Overlap at (1, 0)
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 1, y: 0, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Wrong ship count
    assert.equal(validateShips(P1_SHIPS.slice(0, 2)).ok, false);

    // Wrong fleet lengths (3, 3, 2 instead of 3, 2, 2)
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 0, y: 1, len: 3, dir: "H" },
        { id: "s3", x: 0, y: 2, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Duplicate IDs
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
        { id: "s1", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );

    // Invalid direction, non-integer coordinate, and oversized length
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 3, dir: "D" as "H" },
        { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );
    assert.equal(
      validateShips([
        { id: "s1", x: 0.5, y: 0, len: 3, dir: "H" },
        { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );
    assert.equal(
      validateShips([
        { id: "s1", x: 0, y: 0, len: 999, dir: "H" },
        { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
        { id: "s3", x: 4, y: 4, len: 2, dir: "H" },
      ]).ok,
      false,
    );
  });

  it("locks placement once submitted and rejects modifying or placing out of phase", () => {
    let state = createInitialState(100);
    state = seatPlayer(state, "p1", "Alice", 101);

    const earlyPlace = applyAction(
      state,
      "p1",
      { type: "place_ships", ships: P1_SHIPS },
      102,
    );
    assert.equal(earlyPlace.ok, false);

    state = seatPlayer(state, "p2", "Bob", 103);
    const p1Place = applyAction(
      state,
      "p1",
      { type: "place_ships", ships: P1_SHIPS },
      104,
    );
    assert.equal(p1Place.ok, true);
    assert.equal(state.players.p1.ready, false);
    assert.equal(p1Place.state.phase, "PLACING");
    assert.equal(p1Place.state.players.p1.ready, true);

    // Opponent view during PLACING must not leak p1's already-locked ships
    const p2ViewDuringPlacing = getPlayerView(p1Place.state, "p2");
    assert.equal(p2ViewDuringPlacing.opponent.ready, true);
    assert.deepEqual(p2ViewDuringPlacing.enemyBoard.revealedShips, []);
    assert.equal(JSON.stringify(p2ViewDuringPlacing.enemyBoard).includes('"s1"'), false);

    const duplicatePlace = applyAction(
      p1Place.state,
      "p1",
      { type: "place_ships", ships: P2_SHIPS },
      105,
    );
    assert.equal(duplicatePlace.ok, false);

    const p2Place = applyAction(
      p1Place.state,
      "p2",
      { type: "place_ships", ships: P2_SHIPS },
      106,
    );
    assert.equal(p2Place.ok, true);
    assert.equal(p2Place.state.phase, "PLAYING");
    assert.equal(p2Place.state.currentTurn, "p1");
  });

  it("enforces turn order, rejects duplicate/out-of-bounds shots, and always alternates turns on miss, hit, and sunk", () => {
    let state = setupPlayingState();
    assert.equal(state.currentTurn, "p1");

    // Cannot vote rematch before FINISHED
    const earlyRematch = applyAction(state, "p1", { type: "rematch" }, 1999);
    assert.equal(earlyRematch.ok, false);

    // p2 cannot fire on p1's turn
    const wrongTurn = applyAction(state, "p2", { type: "fire", x: 0, y: 0 }, 2000);
    assert.equal(wrongTurn.ok, false);

    // Out-of-bounds & non-integer shots
    const oob = applyAction(state, "p1", { type: "fire", x: 6, y: 0 }, 2001);
    assert.equal(oob.ok, false);
    const nonInt = applyAction(state, "p1", { type: "fire", x: 1.5, y: 0 }, 2001);
    assert.equal(nonInt.ok, false);

    // p1 hits p2's ship s1 at (3,1) -> result is "hit", turn STILL switches to p2
    const p1Hit = applyAction(state, "p1", { type: "fire", x: 3, y: 1 }, 2002);
    assert.equal(p1Hit.ok, true);
    assert.equal(p1Hit.state.lastShot?.result, "hit");
    assert.equal(p1Hit.state.currentTurn, "p2");
    state = p1Hit.state;

    // p2 misses at (5,5) -> result is "miss", turn switches back to p1
    const p2Miss = applyAction(state, "p2", { type: "fire", x: 5, y: 5 }, 2003);
    assert.equal(p2Miss.ok, true);
    assert.equal(p2Miss.state.lastShot?.result, "miss");
    assert.equal(p2Miss.state.currentTurn, "p1");
    state = p2Miss.state;

    // p1 cannot fire at (3,1) again
    const dupShot = applyAction(state, "p1", { type: "fire", x: 3, y: 1 }, 2004);
    assert.equal(dupShot.ok, false);

    // p1 sinks p2's destroyer s3: (5,0) hit -> p2 shoots -> (5,1) sunk -> turn still switches to p2
    const p1HitS3 = applyAction(state, "p1", { type: "fire", x: 5, y: 0 }, 2005);
    assert.equal(p1HitS3.ok, true);
    assert.equal(p1HitS3.state.lastShot?.result, "hit");
    state = p1HitS3.state;

    const p2Shot2 = applyAction(state, "p2", { type: "fire", x: 5, y: 4 }, 2006);
    assert.equal(p2Shot2.ok, true);
    state = p2Shot2.state;

    const p1SinkS3 = applyAction(state, "p1", { type: "fire", x: 5, y: 1 }, 2007);
    assert.equal(p1SinkS3.ok, true);
    assert.equal(p1SinkS3.state.lastShot?.result, "sunk");
    assert.equal(p1SinkS3.state.lastShot?.sunkShipId, "s3");
    assert.equal(p1SinkS3.state.phase, "PLAYING");
    assert.equal(p1SinkS3.state.currentTurn, "p2");
  });

  it("hides un-sunk enemy ships in getPlayerView and reveals sunk ships or full board when finished", () => {
    let state = setupPlayingState();

    // During PLACING/PLAYING before any sink, neither player view leaks enemy ships
    const initialP1View = getPlayerView(state, "p1");
    assert.deepEqual(initialP1View.enemyBoard.revealedShips, []);
    assert.equal(initialP1View.opponent.shipsRemaining, 3);
    // Serialize check: P2's ship coordinates at (3,1)/(0,5)/(5,0) must not appear in revealedShips
    assert.equal(JSON.stringify(initialP1View.enemyBoard).includes('"s1"'), false);

    // p1 hits (3,1) and (3,2) of s1 (length 3), still NOT sunk
    state = (applyAction(state, "p1", { type: "fire", x: 3, y: 1 }, 3001) as { ok: true; state: GameState }).state;
    state = (applyAction(state, "p2", { type: "fire", x: 3, y: 3 }, 3002) as { ok: true; state: GameState }).state;
    state = (applyAction(state, "p1", { type: "fire", x: 3, y: 2 }, 3003) as { ok: true; state: GameState }).state;
    state = (applyAction(state, "p2", { type: "fire", x: 3, y: 4 }, 3004) as { ok: true; state: GameState }).state;

    const partialHitView = getPlayerView(state, "p1");
    assert.deepEqual(partialHitView.enemyBoard.revealedShips, []);
    assert.equal(partialHitView.opponent.shipsRemaining, 3);
    assert.equal(JSON.stringify(partialHitView.enemyBoard).includes('"s1"'), false);

    // p1 sinks s1 at (3,3) -> now s1 is revealed, s2 & s3 stay hidden
    state = (applyAction(state, "p1", { type: "fire", x: 3, y: 3 }, 3005) as { ok: true; state: GameState }).state;
    const afterSinkView = getPlayerView(state, "p1");
    assert.equal(afterSinkView.enemyBoard.revealedShips.length, 1);
    assert.equal(afterSinkView.enemyBoard.revealedShips[0]?.id, "s1");
    assert.equal(afterSinkView.opponent.shipsRemaining, 2);

    // Finish remaining p2 ships: s2=(0,5),(1,5) and s3=(5,0),(5,1)
    const p1Targets = [
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
    ];
    let p2MissIdx = 0;
    const p2MissTargets = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
    ];

    for (let i = 0; i < p1Targets.length; i += 1) {
      const p2Turn = applyAction(
        state,
        "p2",
        { type: "fire", ...p2MissTargets[p2MissIdx]! },
        3010 + i * 2,
      );
      assert.equal(p2Turn.ok, true);
      state = p2Turn.state;
      p2MissIdx += 1;

      const p1Turn = applyAction(
        state,
        "p1",
        { type: "fire", ...p1Targets[i]! },
        3011 + i * 2,
      );
      assert.equal(p1Turn.ok, true);
      state = p1Turn.state;
    }

    assert.equal(state.phase, "FINISHED");
    assert.equal(state.winner, "p1");
    assert.equal(state.currentTurn, null);

    // After finish, BOTH players see all opponent ships for post-game review
    const finishedP1View = getPlayerView(state, "p1");
    const finishedP2View = getPlayerView(state, "p2");
    assert.equal(finishedP1View.enemyBoard.revealedShips.length, 3);
    assert.equal(finishedP2View.enemyBoard.revealedShips.length, 3);
    assert.deepStrictEqual(finishedP2View.enemyBoard.revealedShips, P1_SHIPS);

    // Firing after finish is rejected
    const lateFire = applyAction(state, "p2", { type: "fire", x: 0, y: 0 }, 4000);
    assert.equal(lateFire.ok, false);
  });

  it("requires both players to vote for rematch and rotates startingPlayer across rounds", () => {
    let state = setupPlayingState();

    // Fast-forward p1 sinking all p2 ships
    const p1Targets = [
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
    ];
    const p2MissTargets = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ];

    for (let i = 0; i < p1Targets.length; i += 1) {
      state = (
        applyAction(state, "p1", { type: "fire", ...p1Targets[i]! }, 4000 + i * 2) as {
          ok: true;
          state: GameState;
        }
      ).state;
      if (state.phase === "FINISHED") {
        break;
      }
      state = (
        applyAction(
          state,
          "p2",
          { type: "fire", ...p2MissTargets[i]! },
          4001 + i * 2,
        ) as { ok: true; state: GameState }
      ).state;
    }

    assert.equal(state.phase, "FINISHED");

    // First vote keeps FINISHED
    const vote1 = applyAction(state, "p1", { type: "rematch" }, 5000);
    assert.equal(vote1.ok, true);
    assert.equal(vote1.state.phase, "FINISHED");
    assert.equal(vote1.state.rematchVotes.p1, true);
    assert.equal(vote1.state.rematchVotes.p2, false);

    // Second vote resets to PLACING and rotates startingPlayer to p2
    const vote2 = applyAction(vote1.state, "p2", { type: "rematch" }, 5001);
    assert.equal(vote2.ok, true);
    const round2 = vote2.state;
    assert.equal(round2.phase, "PLACING");
    assert.equal(round2.round, 2);
    assert.equal(round2.startingPlayer, "p2");
    assert.equal(round2.currentTurn, null);
    assert.equal(round2.winner, null);
    assert.equal(round2.lastShot, null);
    assert.deepEqual(round2.rematchVotes, { p1: false, p2: false });
    assert.equal(round2.players.p1.displayName, "Alice");
    assert.equal(round2.players.p2.displayName, "Bob");
    assert.deepEqual(round2.players.p1.ships, []);
    assert.deepEqual(round2.players.p2.ships, []);
    assert.deepEqual(round2.players.p1.shotsFired, []);
    assert.deepEqual(round2.players.p2.shotsFired, []);
    assert.equal(round2.players.p1.ready, false);
    assert.equal(round2.players.p2.ready, false);

    // Place ships in round 2 -> p2 starts
    const r2p1 = (
      applyAction(round2, "p1", { type: "place_ships", ships: P1_SHIPS }, 5002) as {
        ok: true;
        state: GameState;
      }
    ).state;
    let r2State = (
      applyAction(r2p1, "p2", { type: "place_ships", ships: P2_SHIPS }, 5003) as {
        ok: true;
        state: GameState;
      }
    ).state;
    assert.equal(r2State.phase, "PLAYING");
    assert.equal(r2State.currentTurn, "p2");

    // Finish round 2 with p2 winning and verify rematch rotates startingPlayer back to p1
    const p2Targets = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ];
    const p1MissTargets = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 0, y: 4 },
      { x: 2, y: 0 },
    ];

    for (let i = 0; i < p2Targets.length; i += 1) {
      r2State = (
        applyAction(r2State, "p2", { type: "fire", ...p2Targets[i]! }, 6000 + i * 2) as {
          ok: true;
          state: GameState;
        }
      ).state;
      if (r2State.phase === "FINISHED") {
        break;
      }
      r2State = (
        applyAction(
          r2State,
          "p1",
          { type: "fire", ...p1MissTargets[i]! },
          6001 + i * 2,
        ) as { ok: true; state: GameState }
      ).state;
    }

    assert.equal(r2State.phase, "FINISHED");
    assert.equal(r2State.winner, "p2");

    const r3Vote1 = (
      applyAction(r2State, "p2", { type: "rematch" }, 7000) as {
        ok: true;
        state: GameState;
      }
    ).state;
    const r3Vote2 = (
      applyAction(r3Vote1, "p1", { type: "rematch" }, 7001) as {
        ok: true;
        state: GameState;
      }
    ).state;
    assert.equal(r3Vote2.phase, "PLACING");
    assert.equal(r3Vote2.round, 3);
    assert.equal(r3Vote2.startingPlayer, "p1");
  });

  it("handles mutual reset_game and cancel_reset across phases while resetting back to Round 1", () => {
    const waitingState = seatPlayer(createInitialState(100), "p1", "Alice", 101);
    assert.equal(
      applyAction(waitingState, "p1", { type: "reset_game" }, 102).ok,
      false,
    );
    assert.equal(
      applyAction(waitingState, "p1", { type: "cancel_reset" }, 103).ok,
      false,
    );

    // Place ships in PLACING -> P1 places, P2 still placing -> mutual reset resets P1 ready state
    let placingState = seatPlayer(waitingState, "p2", "Bob", 104);
    placingState = (
      applyAction(placingState, "p1", { type: "place_ships", ships: P1_SHIPS }, 105) as {
        ok: true;
        state: GameState;
      }
    ).state;
    const placingVote1 = applyAction(placingState, "p1", { type: "reset_game" }, 106);
    assert.equal(placingVote1.ok, true);
    assert.equal(getPlayerView(placingVote1.state, "p1").self.resetVoted, true);
    assert.equal(getPlayerView(placingVote1.state, "p2").opponent.resetVoted, true);

    const placingReset = applyAction(
      placingVote1.state,
      "p2",
      { type: "reset_game" },
      107,
    );
    assert.equal(placingReset.ok, true);
    assert.equal(placingReset.state.phase, "PLACING");
    assert.equal(placingReset.state.round, 1);
    assert.equal(placingReset.state.players.p1.ready, false);
    assert.deepEqual(placingReset.state.players.p1.ships, []);

    // Advance into PLAYING (simulate Round 2 starter p2 mid-game reset)
    let playingState = setupPlayingState();
    playingState = {
      ...playingState,
      round: 2,
      startingPlayer: "p2",
      currentTurn: "p2",
    };
    playingState = (
      applyAction(playingState, "p2", { type: "fire", x: 0, y: 0 }, 2000) as {
        ok: true;
        state: GameState;
      }
    ).state;

    // Single reset vote keeps PLAYING, cancel_reset clears vote
    const vote1 = applyAction(playingState, "p1", { type: "reset_game" }, 2001);
    assert.equal(vote1.ok, true);
    assert.equal(vote1.state.phase, "PLAYING");
    assert.deepEqual(vote1.state.resetVotes, { p1: true, p2: false });

    const cancelled = applyAction(vote1.state, "p2", { type: "cancel_reset" }, 2002);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.state.phase, "PLAYING");
    assert.deepEqual(cancelled.state.resetVotes, { p1: false, p2: false });
    assert.equal(cancelled.state.round, 2);

    // Mutual confirmation resets back to Round 1 PLACING with p1 starter & preserved names
    const voteAgain = (
      applyAction(cancelled.state, "p1", { type: "reset_game" }, 2003) as {
        ok: true;
        state: GameState;
      }
    ).state;
    const vote2 = applyAction(voteAgain, "p2", { type: "reset_game" }, 2004);
    assert.equal(vote2.ok, true);
    assert.equal(vote2.state.phase, "PLACING");
    assert.equal(vote2.state.round, 1);
    assert.equal(vote2.state.startingPlayer, "p1");
    assert.equal(vote2.state.currentTurn, null);
    assert.equal(vote2.state.winner, null);
    assert.equal(vote2.state.lastShot, null);
    assert.deepEqual(vote2.state.resetVotes, { p1: false, p2: false });
    assert.deepEqual(vote2.state.rematchVotes, { p1: false, p2: false });
    assert.equal(vote2.state.players.p1.displayName, "Alice");
    assert.equal(vote2.state.players.p2.displayName, "Bob");
    assert.deepEqual(vote2.state.players.p1.ships, []);
    assert.deepEqual(vote2.state.players.p2.ships, []);
    assert.deepEqual(vote2.state.players.p1.shotsFired, []);
    assert.deepEqual(vote2.state.players.p2.shotsFired, []);

    // Rejected in FINISHED
    let finishedState = setupPlayingState();
    const p1WinTargets = [
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
    ];
    const p2MissTargets = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ];
    for (let i = 0; i < p1WinTargets.length; i += 1) {
      finishedState = (
        applyAction(
          finishedState,
          "p1",
          { type: "fire", ...p1WinTargets[i]! },
          3000 + i * 2,
        ) as {
          ok: true;
          state: GameState;
        }
      ).state;
      if (finishedState.phase === "FINISHED") {
        break;
      }
      finishedState = (
        applyAction(
          finishedState,
          "p2",
          { type: "fire", ...p2MissTargets[i]! },
          3001 + i * 2,
        ) as {
          ok: true;
          state: GameState;
        }
      ).state;
    }
    assert.equal(finishedState.phase, "FINISHED");
    assert.equal(
      applyAction(finishedState, "p1", { type: "reset_game" }, 4000).ok,
      false,
    );
    assert.equal(
      applyAction(finishedState, "p1", { type: "cancel_reset" }, 4001).ok,
      false,
    );
  });

  it("releaseSeat frees the leaver's seat, abandons the match, and lets a new player re-seat", () => {
    let state = setupPlayingState();
    const fired = applyAction(state, "p1", { type: "fire", x: 3, y: 1 }, 5000);
    assert.equal(fired.ok, true);
    state = fired.state;
    state.round = 3;
    state.startingPlayer = "p2";
    state.resetVotes.p2 = true;

    const released = releaseSeat(state, "p1", 6000);
    assert.equal(released.phase, "WAITING");
    assert.equal(released.round, 1);
    assert.equal(released.startingPlayer, "p1");
    assert.equal(released.currentTurn, null);
    assert.equal(released.winner, null);
    assert.equal(released.lastShot, null);
    assert.deepEqual(released.resetVotes, { p1: false, p2: false });
    assert.deepEqual(released.rematchVotes, { p1: false, p2: false });
    assert.equal(released.players.p1.displayName, null);
    assert.deepEqual(released.players.p1.ships, []);
    assert.equal(released.players.p2.displayName, "Bob");
    assert.deepEqual(released.players.p2.ships, []);
    assert.equal(released.players.p2.ready, false);
    assert.deepEqual(released.players.p2.shotsFired, []);
    assert.equal(released.updatedAt, 6000);
    // Input state untouched (pure function)
    assert.equal(state.phase, "PLAYING");
    assert.equal(state.players.p1.displayName, "Alice");

    const reseated = seatPlayer(released, "p1", "Joe", 7000);
    assert.equal(reseated.phase, "PLACING");
    assert.equal(reseated.players.p1.displayName, "Joe");
    assert.deepEqual(JSON.parse(JSON.stringify(reseated)), reseated);
  });

  it("resolveSeat, stampMissingDisconnects, and getSeatExpiresInMs implement lazy 120s seat grace", () => {
    const baseNow = 1_000_000;

    // 1. Name reclaim works even when offline past grace
    const expiredSeats: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice", disconnectedAt: 1000 },
      p2: { normalizedName: "bob", displayName: "Bob", disconnectedAt: null },
    };
    assert.deepEqual(
      resolveSeat(expiredSeats, { p1: false, p2: true }, "alice", 1000 + SEAT_RECLAIM_GRACE_MS + 60_000),
      { kind: "reclaim", playerId: "p1" },
    );

    // 2. Empty seat preferred over takeover of an expired seat
    const oneEmptyOneExpired: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice", disconnectedAt: 1000 },
      p2: null,
    };
    assert.deepEqual(
      resolveSeat(oneEmptyOneExpired, { p1: false, p2: false }, "charlie", 1000 + SEAT_RECLAIM_GRACE_MS + 1000),
      { kind: "empty", playerId: "p2" },
    );

    // 3. Offline grace boundary: 119_999ms -> full, 120_000ms -> takeover with previous
    const p1OfflineSeats: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice", disconnectedAt: baseNow },
      p2: { normalizedName: "bob", displayName: "Bob", disconnectedAt: null },
    };
    assert.deepEqual(
      resolveSeat(p1OfflineSeats, { p1: false, p2: true }, "joe", baseNow + 119_999),
      { kind: "full" },
    );
    assert.deepEqual(
      resolveSeat(p1OfflineSeats, { p1: false, p2: true }, "joe", baseNow + 120_000),
      {
        kind: "takeover",
        playerId: "p1",
        previous: { normalizedName: "alice", displayName: "Alice", disconnectedAt: baseNow },
      },
    );

    // 4. Online seat with an old disconnectedAt is never taken over
    assert.deepEqual(
      resolveSeat(p1OfflineSeats, { p1: true, p2: true }, "joe", baseNow + 500_000),
      { kind: "full" },
    );

    // 5. Both expired -> smallest disconnectedAt wins (tie -> p1)
    const bothExpired: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice", disconnectedAt: baseNow + 5000 },
      p2: { normalizedName: "bob", displayName: "Bob", disconnectedAt: baseNow + 1000 },
    };
    assert.deepEqual(
      resolveSeat(bothExpired, { p1: false, p2: false }, "joe", baseNow + 5000 + SEAT_RECLAIM_GRACE_MS),
      {
        kind: "takeover",
        playerId: "p2",
        previous: { normalizedName: "bob", displayName: "Bob", disconnectedAt: baseNow + 1000 },
      },
    );
    const tiedExpired: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice", disconnectedAt: baseNow },
      p2: { normalizedName: "bob", displayName: "Bob", disconnectedAt: baseNow },
    };
    const tiedRes = resolveSeat(tiedExpired, { p1: false, p2: false }, "joe", baseNow + SEAT_RECLAIM_GRACE_MS);
    assert.equal(tiedRes.kind, "takeover");
    if (tiedRes.kind === "takeover") {
      assert.equal(tiedRes.playerId, "p1");
    }

    // 6. stampMissingDisconnects stamps offline missing timestamps & clears stale online ones
    const legacySeats: SeatsMap = {
      p1: { normalizedName: "alice", displayName: "Alice" },
      p2: { normalizedName: "bob", displayName: "Bob", disconnectedAt: baseNow - 500 },
    };
    const stamped = stampMissingDisconnects(legacySeats, { p1: false, p2: true }, baseNow);
    assert.equal(stamped.changed, true);
    assert.equal(stamped.seats.p1?.disconnectedAt, baseNow);
    assert.equal(stamped.seats.p2?.disconnectedAt, null);
    assert.equal(
      stampMissingDisconnects(stamped.seats, { p1: false, p2: true }, baseNow + 1000).changed,
      false,
    );

    // 7. getSeatExpiresInMs returns null when empty/online and clamped remaining ms when offline
    assert.equal(getSeatExpiresInMs(null, false, baseNow), null);
    assert.equal(getSeatExpiresInMs(p1OfflineSeats.p1, true, baseNow + 5000), null);
    assert.equal(getSeatExpiresInMs({ normalizedName: "a", displayName: "A" }, false, baseNow), null);
    assert.equal(getSeatExpiresInMs(p1OfflineSeats.p1, false, baseNow + 45_000), 75_000);
    assert.equal(getSeatExpiresInMs(p1OfflineSeats.p1, false, baseNow + 150_000), 0);
  });
});
