// Comprehensive Automated Test Suite for Server Authority and Game Mechanics
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/gameRoom.js';
import { RoomManager } from '../src/roomManager.js';
import { ROOM_STATUS, SCORING_CONFIG, PLAYER_CONFIG } from '../../shared/constants.js';

// Mock Socket.IO instance for headless testing
function createMockIO() {
  const emittedEvents = [];
  return {
    to: (roomCode) => ({
      emit: (event, payload) => {
        emittedEvents.push({ roomCode, event, payload });
      },
    }),
    emittedEvents,
  };
}

test('1. Room creation and joining', () => {
  const io = createMockIO();
  const manager = new RoomManager(io);

  // Create room
  const createRes = manager.createRoom('socket-1', 'Alice');
  assert.equal(createRes.success, true);
  assert.equal(typeof createRes.code, 'string');
  assert.equal(createRes.code.length, 5);

  const room = manager.rooms.get(createRes.code);
  assert.ok(room);
  assert.equal(room.players.size, 1);
  assert.equal(room.hostSocketId, 'socket-1');

  // Join room
  const joinRes = manager.joinRoom('socket-2', createRes.code, 'Bob');
  assert.equal(joinRes.success, true);
  assert.equal(room.players.size, 2);

  const bob = room.players.get('socket-2');
  assert.equal(bob.name, 'Bob');
});

test('2. Invalid room codes rejection', () => {
  const io = createMockIO();
  const manager = new RoomManager(io);

  const result = manager.joinRoom('socket-1', 'INVALID', 'Charlie');
  assert.equal(result.success, false);
  assert.match(result.reason, /not found/i);
});

test('3. Room capacity enforcement (max 8 players)', () => {
  const io = createMockIO();
  const manager = new RoomManager(io);

  const createRes = manager.createRoom('host', 'Player 0');
  const code = createRes.code;

  for (let i = 1; i < 8; i++) {
    const res = manager.joinRoom(`socket-${i}`, code, `Player ${i}`);
    assert.equal(res.success, true);
  }

  const room = manager.rooms.get(code);
  assert.equal(room.players.size, 8);

  // 9th player must be rejected
  const overflowRes = manager.joinRoom('socket-9', code, 'Player 9');
  assert.equal(overflowRes.success, false);
  assert.match(overflowRes.reason, /full/i);
});

test('4. Initial flag assignment and starting bonus', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'host-1', io);
  room.addPlayer('host-1', 'Alice');
  room.addPlayer('guest-1', 'Bob');

  room.startMatch();

  assert.equal(room.status, ROOM_STATUS.PLAYING);
  assert.ok(room.flagHolderId === 'host-1' || room.flagHolderId === 'guest-1');

  const holder = room.players.get(room.flagHolderId);
  const nonHolderId = room.flagHolderId === 'host-1' ? 'guest-1' : 'host-1';
  const nonHolder = room.players.get(nonHolderId);

  // Initial holder receives starting bonus (+30)
  assert.equal(holder.score, SCORING_CONFIG.STARTING_BONUS);
  assert.equal(nonHolder.score, 0);
});

test('5. Valid flag transfer and pass bonus', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  // Force p1 as holder for deterministic test
  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.score = 30;
  p2.score = 0;

  // Position p1 and p2 overlapping
  p1.x = 500;
  p1.y = 500;
  p2.x = 510;
  p2.y = 500; // Distance = 10, less than 2 * 24 (48)

  room.updateCollisionsAndTransfers();

  // Flag should transfer to p2 immediately
  assert.equal(room.flagHolderId, 'p2');
  // Passer p1 receives pass bonus (+5)
  assert.equal(p1.score, 35);
});

test('6. Immediate transfer after a new contact (Zero cooldown)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.addPlayer('p3', 'Charlie');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  const p3 = room.players.get('p3');

  // Contact p1 and p2
  p1.x = 400; p1.y = 400;
  p2.x = 410; p2.y = 400;
  p3.x = 800; p3.y = 800;
  room.updateCollisionsAndTransfers();
  assert.equal(room.flagHolderId, 'p2');

  // Now p2 immediately touches p3 with ZERO cooldown
  p2.x = 800; p2.y = 810;
  room.updateCollisionsAndTransfers();
  assert.equal(room.flagHolderId, 'p3');
});

test('7. No duplicate transfer while continuous contact remains unchanged', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.score = 30;
  p2.score = 0;

  p1.x = 500; p1.y = 500;
  p2.x = 510; p2.y = 500;

  // First collision tick: transfers to p2
  room.updateCollisionsAndTransfers();
  assert.equal(room.flagHolderId, 'p2');
  assert.equal(p1.score, 35);

  // Subsequent collision ticks while still overlapping: MUST NOT bounce back or farm bonuses!
  for (let tick = 0; tick < 10; tick++) {
    room.updateCollisionsAndTransfers();
    assert.equal(room.flagHolderId, 'p2', `Tick ${tick}: Flag should stay with p2 during continuous contact`);
    assert.equal(p1.score, 35, `Tick ${tick}: Passer score should not duplicate`);
    assert.equal(p2.score, 0, `Tick ${tick}: Receiver score should not change from pass bonus`);
  }
});

test('8. Immediate transfer after players separate and touch again', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');

  // 1. Initial touch: p1 -> p2
  p1.x = 500; p1.y = 500;
  p2.x = 510; p2.y = 500;
  room.updateCollisionsAndTransfers();
  assert.equal(room.flagHolderId, 'p2');

  // 2. Separate players (distance > 48)
  p2.x = 600; p2.y = 500;
  room.updateCollisionsAndTransfers();
  assert.equal(room.activeContacts.size, 0, 'Contacts should clear upon separation');

  // 3. Re-touch immediately: p2 touches p1 -> instant transfer back to p1!
  p2.x = 510; p2.y = 500;
  room.updateCollisionsAndTransfers();
  assert.equal(room.flagHolderId, 'p1', 'Flag must transfer immediately upon re-touching with zero cooldown');
});

test('9. Simultaneous contact handling (no duplicate flags)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.addPlayer('p3', 'Charlie');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  const p3 = room.players.get('p3');

  // All 3 players positioned touching at the same point
  p1.x = 500; p1.y = 500;
  p2.x = 510; p2.y = 500;
  p3.x = 500; p3.y = 510;

  room.updateCollisionsAndTransfers();

  // Flag must be held by exactly ONE player, never null or duplicate
  assert.ok(room.flagHolderId === 'p2' || room.flagHolderId === 'p3');
  assert.notEqual(room.flagHolderId, null);
});

test('10. Scoring over time (holder -2/s, non-holder +1/s)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.score = 100;
  p2.score = 100;

  // Simulate 1 second dt
  room.updateScoring(1.0);

  // Holder p1 should lose 2 points (100 - 2 = 98)
  assert.equal(Math.round(p1.score), 98);
  // Non-holder p2 should gain 1 point (100 + 1 = 101)
  assert.equal(Math.round(p2.score), 101);
});

test('11. 5-second continuous hold bonus (+8 points)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  p1.score = 0;

  // Simulate 4.9 seconds of holding (no bonus yet)
  room.updateScoring(4.9);
  // Holder has lost 4.9 * 2 = 9.8 points
  assert.equal(p1.score < 0, true);
  const scoreBeforeBonus = p1.score;

  // Simulate next 0.2 seconds (total 5.1s -> bonus awarded!)
  room.updateScoring(0.2);
  // Score should have gained +8 points (minus 0.2*2 = 0.4s deduction)
  const expected = scoreBeforeBonus + 8 - (0.2 * 2);
  assert.equal(Math.abs(p1.score - expected) < 0.01, true);

  // If lost before 5 seconds, timer resets
  room.setFlagHolder('p2', 'pass');
  assert.equal(room.uninterruptedHoldTime, 0);
});

test('12. End-of-round penalty applied exactly once (-40 points)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  p1.score = 50;

  // Force timer to 0 and end match
  room.timeRemaining = 0;
  room.endMatch();

  assert.equal(room.status, ROOM_STATUS.ENDED);
  // p1 was holding when match ended: 50 - 40 = 10
  assert.equal(p1.score, 10);
  assert.equal(room.finalPenaltyApplied, true);

  // Calling endMatch again must not re-apply penalty
  room.endMatch();
  assert.equal(p1.score, 10);
});

test('13. Round reset and Rematch', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'host', io);
  room.addPlayer('host', 'Alice');
  room.addPlayer('guest', 'Bob');
  room.startMatch();

  room.endMatch();
  assert.equal(room.status, ROOM_STATUS.ENDED);

  // Host triggers return to lobby
  const returnRes = room.handleReturnToLobby('host');
  assert.equal(returnRes.success, true);
  assert.equal(room.status, ROOM_STATUS.LOBBY);
  assert.equal(room.flagHolderId, null);
  assert.equal(room.timeRemaining, SCORING_CONFIG.ROUND_DURATION || 90);
});

test('14. Disconnecting player handling', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.addPlayer('p3', 'Charlie');
  room.startMatch();

  room.setFlagHolder('p2', 'test');
  assert.equal(room.flagHolderId, 'p2');

  // p2 disconnects
  room.removePlayer('p2');

  assert.equal(room.players.size, 2);
  assert.equal(room.players.has('p2'), false);
  // Flag must be re-assigned to either p1 or p3 without crashing
  assert.ok(room.flagHolderId === 'p1' || room.flagHolderId === 'p3');
});

test('15. Anti-exploit: client input cannot forge scores or flag ownership', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p2 = room.players.get('p2');
  p2.score = 0;

  // Attacker tries to send malicious input payload with forged score & flag
  room.handlePlayerInput('p2', {
    x: 0,
    y: 0,
    score: 999999,
    flagHolderId: 'p2',
    bonus: 5000,
  });

  // Server state must remain untainted
  assert.equal(p2.score, 0);
  assert.equal(room.flagHolderId, 'p1');
});
