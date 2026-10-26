// Comprehensive Automated Test Suite for Server Authority and Game Mechanics
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/gameRoom.js';
import { RoomManager } from '../src/roomManager.js';
import {
  ARENA,
  ROOM_STATUS,
  SCORING_CONFIG,
  PLAYER_CONFIG,
  PHYSICS_CONFIG,
  PLATFORMS,
  SPRINGS,
  PHASE_CONFIG,
  EVENTS,
} from '../../shared/constants.js';
import {
  checkPlatformLanding,
  checkSpringPadCollision,
  resolveBoundaryCollision,
} from '../src/physics.js';

// Mock Socket.IO instance for headless testing
function createMockIO() {
  const emittedEvents = [];
  return {
    to: (roomCode) => ({
      emit: (event, payload) => {
        emittedEvents.push({ roomCode, event, payload, data: payload });
      },
    }),
    emittedEvents,
  };
}

// Allow test suite to exit cleanly without waiting for 120s timer intervals
const origStartSimulation = GameRoom.prototype.startSimulation;
GameRoom.prototype.startSimulation = function () {
  origStartSimulation.call(this);
  if (this.loopInterval?.unref) {
    this.loopInterval.unref();
  }
};

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

test('4. Initial flag assignment and 20-point starting lead for flag holder', () => {
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

  // Character with flag starts with 20 points lead, other players start with 0
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

test('11. Removal of 5-second hold bonus (no hold bonus awarded)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  p1.score = 50;

  // Simulate 10 seconds of uninterrupted holding
  room.updateScoring(10.0);

  // Holder should strictly lose 10s * 2 pts/s = 20 pts (50 - 20 = 30)
  // No +8 hold bonus should ever be awarded!
  assert.equal(Math.round(p1.score), 30);
  assert.equal(room.uninterruptedHoldTime, undefined);
});

test('12. End-of-round penalty is removed (0 penalty)', () => {
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
  // Penalty is removed: p1 score remains 50
  assert.equal(p1.score, 50);

  // Calling endMatch again must not change score
  room.endMatch();
  assert.equal(p1.score, 50);
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

test('16. Speed adjustment panel controls and server authority', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'host-1', io);
  room.addPlayer('host-1', 'Alice');
  room.addPlayer('guest-1', 'Bob');

  const initialSpeed = room.baseSpeed;
  assert.equal(initialSpeed, 440);

  // Non-host attempts to change speed in multi-player room -> rejected
  const guestRes = room.handleSpeedChange('guest-1', { delta: 40 });
  assert.equal(guestRes.success, false);
  assert.match(guestRes.reason, /host/i);
  assert.equal(room.baseSpeed, initialSpeed);

  // Host increases speed by +40 px/s
  const hostIncRes = room.handleSpeedChange('host-1', { delta: 40 });
  assert.equal(hostIncRes.success, true);
  assert.equal(room.baseSpeed, 480);

  // Host sets speed preset multiplier (1.6x)
  const hostMultRes = room.handleSpeedChange('host-1', { multiplier: 1.6 });
  assert.equal(hostMultRes.success, true);
  assert.equal(room.speedMultiplier, 1.6);
  assert.equal(room.effectiveSpeed, Math.round(440 * 1.6));

  // Host decreases speed by -100 px/s (704 -> 604)
  const hostDecRes = room.handleSpeedChange('host-1', { delta: -100 });
  assert.equal(hostDecRes.success, true);
  assert.equal(room.baseSpeed, 604);
  assert.equal(room.speedMultiplier, Math.round((604 / 440) * 100) / 100);
});

test('17. Authoritative flag toss selects initial flag holder and awards 20-point starting lead', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'host-1', io);
  room.addPlayer('host-1', 'Alice');
  room.addPlayer('guest-1', 'Bob');

  // Trigger performToss
  const toss = room.performToss();
  assert.ok(toss);
  assert.ok(['host-1', 'guest-1'].includes(toss.winnerId));
  assert.ok(['Alice', 'Bob'].includes(toss.winnerName));
  assert.equal(toss.startingBonus, 20);
  assert.equal(toss.candidates.length, 2);

  // Check event emitted to room
  const tossEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.FLAG_TOSS);
  assert.ok(tossEvent);
  assert.equal(tossEvent.payload.winnerId, toss.winnerId);

  // Start match - toss winner must receive flag and 20-point lead
  room.startMatch();
  assert.equal(room.flagHolderId, toss.winnerId);
  const winnerPlayer = room.players.get(toss.winnerId);
  assert.equal(winnerPlayer.score, 20);

  const nonWinnerId = toss.winnerId === 'host-1' ? 'guest-1' : 'host-1';
  const nonWinner = room.players.get(nonWinnerId);
  assert.equal(nonWinner.score, 0);
});

test('18. Speed adjustment rejection during active gameplay (strict pre-game only)', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'host-1', io);
  room.addPlayer('host-1', 'Alice');
  room.addPlayer('guest-1', 'Bob');

  // Start match -> status becomes PLAYING
  room.startMatch();
  assert.equal(room.status, ROOM_STATUS.PLAYING);

  // Host attempts to change speed while match is active
  const midMatchRes = room.handleSpeedChange('host-1', { delta: 40 });
  assert.equal(midMatchRes.success, false);
  assert.match(midMatchRes.reason, /lobby/i);

  // Match ends -> status becomes ENDED
  room.endMatch();
  assert.equal(room.status, ROOM_STATUS.ENDED);

  // Now settings can be adjusted again
  const postMatchRes = room.handleSpeedChange('host-1', { delta: 40 });
  assert.equal(postMatchRes.success, true);
});

test('19. Swept one-way platform collision and landing', () => {
  const plat = { id: 'test_plat', x: 200, y: 600, width: 300, height: 20 };

  // 1. Player falls through platform top surface (landing)
  // prevFeet = 590 + 24 = 614 (above platTop + 8? No, platTop is 600, feet was at 598 -> prevY = 574)
  const prevY = 574; // prevFeet = 574 + 24 = 598 (above 600)
  const newY = 604;  // newFeet = 604 + 24 = 628 (crossed through 600)
  const landed = checkPlatformLanding(prevY, newY, 350, 24, plat);
  assert.equal(landed, true, 'Player falling from above should land on platform');

  // 2. Player jumping up through platform from below (should NOT collide - one-way)
  const jumpPrevY = 620; // prevFeet = 644 (beneath platform)
  const jumpNewY = 580;  // newFeet = 604
  const upwardCollision = checkPlatformLanding(jumpPrevY, jumpNewY, 350, 24, plat);
  assert.equal(upwardCollision, false, 'Player moving upward should pass through one-way platform');

  // 3. Player outside horizontal platform bounds
  const outsideX = 550; // plat is 200 to 500
  const outsideLanded = checkPlatformLanding(prevY, newY, outsideX, 24, plat);
  assert.equal(outsideLanded, false, 'Player outside horizontal bounds should not land');
});

test('20. Gravity, jumping, and grounded state requirement', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  const p1 = room.players.get('p1');
  p1.x = 400;
  p1.y = 500;
  p1.vy = 0;
  p1.isGrounded = false;

  // Mid-air jump attempt: cannot jump while airborne
  p1.jumpRequested = true;
  room.updatePlayerMovement(0.016);
  assert.notEqual(p1.vy, PHYSICS_CONFIG.JUMP_VELOCITY, 'Cannot jump when not grounded');
  assert.ok(p1.vy > 0, 'Gravity should accelerate player downward');

  // Put player on ground floor
  p1.y = 940 - PLAYER_CONFIG.RADIUS;
  p1.vy = 0;
  p1.isGrounded = true;
  p1.jumpRequested = true;

  // Update movement: jump impulse applied
  room.updatePlayerMovement(0.016);
  assert.equal(p1.isGrounded, false, 'Jumping should unground player');
  assert.ok(p1.vy < 0, 'Vertical velocity should be negative (upward impulse)');
});

test('21. Spring pad impulse and anti-bounce cooldown', () => {
  const spring = SPRINGS[0]; // Ground Left spring
  assert.ok(spring);

  // 1. Downward landing on spring pad
  const prevY = spring.y - PLAYER_CONFIG.RADIUS - 4;
  const newY = spring.y - PLAYER_CONFIG.RADIUS + 4;
  const hitSpring = checkSpringPadCollision(prevY, newY, spring.x + 10, PLAYER_CONFIG.RADIUS, [spring]);
  assert.equal(hitSpring?.id, spring.id);

  // 1b. Walking horizontally on the ground floor across spring pad
  const floorY = ARENA.GROUND_Y - PLAYER_CONFIG.RADIUS;
  const walkHitSpring = checkSpringPadCollision(floorY, floorY, spring.x + 10, PLAYER_CONFIG.RADIUS, [spring]);
  assert.equal(walkHitSpring?.id, spring.id, 'Walking horizontally onto ground spring must trigger it');

  // 2. Integration in room simulation - walking on ground across spring
  const ioWalk = createMockIO();
  const roomWalk = new GameRoom('ROOM_WALK', 'p1', ioWalk);
  roomWalk.addPlayer('p1', 'Alice');
  roomWalk.addPlayer('p2', 'Bob');
  roomWalk.startMatch();

  const pWalk = roomWalk.players.get('p1');
  pWalk.x = spring.x + 10;
  pWalk.y = floorY;
  pWalk.vy = 0;
  pWalk.isGrounded = true;
  pWalk.springCooldown = 0;

  roomWalk.updatePlayerMovement(0.016);
  assert.ok(pWalk.vy < -800, 'Walking across bottom spring must launch player upward');
  assert.equal(pWalk.isGrounded, false, 'Player launched by walking on spring must become ungrounded');
  assert.ok(pWalk.y < floorY, 'Player must be lifted above floor surface after spring trigger');

  // 3. Integration in room simulation - falling downward on spring pad
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  const p1 = room.players.get('p1');
  p1.x = spring.x + spring.width / 2;
  p1.y = spring.y - PLAYER_CONFIG.RADIUS - 2;
  p1.vy = 200; // Falling downward
  p1.springCooldown = 0;

  room.updatePlayerMovement(0.016);

  // Player launched by spring pad
  assert.ok(p1.vy < -800, 'Player should be launched upward by spring impulse');
  assert.ok(p1.springCooldown > 0, 'Spring cooldown must be set to prevent spam');

  // Verify SPRING_TRIGGERED event was emitted
  const springEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.SPRING_TRIGGERED);
  assert.ok(springEvent);
  assert.equal(springEvent.payload.springId, spring.id);
});

test('22. Authoritative scoring phase scheduler generation', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');

  room.startMatch();

  // Match duration is 120s: should schedule 2 or 3 dynamic phases
  assert.ok(room.phaseSchedule.length >= 2, 'Should schedule at least 2 scoring phases');

  for (let i = 0; i < room.phaseSchedule.length; i++) {
    const phase = room.phaseSchedule[i];
    assert.ok(phase.type);
    assert.ok(phase.startTime > 0 && phase.startTime < 120);
    assert.equal(phase.duration, PHASE_CONFIG.PHASE_DURATION);
    assert.equal(phase.warningTime, phase.startTime + PHASE_CONFIG.WARNING_DURATION);
  }
});

test('23. 5s Advance warning and scoring phase multipliers', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  const doublePassType = PHASE_CONFIG.TYPES.find(t => t.id === 'DOUBLE_PASS');
  assert.ok(doublePassType);

  // Set deterministic phase: startTime = 60s, duration = 12s, warningTime = 65s
  room.phaseSchedule = [{
    startTime: 60,
    duration: 12,
    warningTime: 65,
    type: doublePassType,
    warningEmitted: false,
    started: false,
    ended: false,
  }];

  // 1. timeRemaining = 65.0s -> 5-second warning broadcast
  room.timeRemaining = 65.0;
  room.updateScoringPhases();

  const warningEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.PHASE_WARNING);
  assert.ok(warningEvent, '5-second warning must be broadcast');
  assert.equal(warningEvent.payload.phaseId, 'DOUBLE_PASS');

  // 2. timeRemaining = 60.0s -> phase starts
  room.timeRemaining = 60.0;
  room.updateScoringPhases();

  const startEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.PHASE_STARTED);
  assert.ok(startEvent, 'Phase start event must be broadcast');
  assert.equal(room.activePhase?.id, 'DOUBLE_PASS');

  // 3. In Double Pass phase: pass bonus should be +10 instead of +5
  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.score = 50;
  p2.score = 50;

  p1.x = 500; p1.y = 500;
  p2.x = 510; p2.y = 500;
  room.updateCollisionsAndTransfers();

  assert.equal(room.flagHolderId, 'p2');
  assert.equal(p1.score, 60, 'Passer must receive +10 in Double Pass phase (5 * 2.0)');

  // 4. timeRemaining = 47.9s (startTime 60 - duration 12 = 48) -> phase ends
  room.timeRemaining = 47.9;
  room.updateScoringPhases();
  assert.equal(room.activePhase, null, 'Active phase should end cleanly');
  const endEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.PHASE_ENDED);
  assert.ok(endEvent, 'Phase ended event must be broadcast');
});

test('24. Scoring phase cleanup on match completion and reset', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  // Set active phase
  room.activePhase = { id: 'flag_frenzy' };

  // Match ends
  room.endMatch();
  assert.equal(room.activePhase, null, 'Active phase must be cleared on match end');
  assert.equal(room.phaseSchedule.length, 0, 'Scheduled phases must be cleared on match end');

  // Return to lobby
  room.handleReturnToLobby('p1');
  assert.equal(room.status, ROOM_STATUS.LOBBY);
  assert.equal(room.activePhase, null);
  assert.equal(room.phaseSchedule.length, 0);
});

test('25. Player left broadcast notification to remaining players', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.addPlayer('p3', 'Charlie');

  // p3 leaves
  const res = room.removePlayer('p3');
  assert.equal(res.leavingName, 'Charlie');
  assert.equal(res.remainingCount, 2);

  const leftEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.PLAYER_LEFT && e.payload.name === 'Charlie');
  assert.ok(leftEvent, 'Must emit PLAYER_LEFT event when player leaves');
  assert.equal(leftEvent.payload.remainingPlayers, 2);
  assert.equal(leftEvent.payload.leftAlone, false);
});

test('26. Player left alone ends active match with GAME OVER and left_alone event', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();
  assert.equal(room.status, ROOM_STATUS.PLAYING);

  // Bob leaves while match is running, leaving Alice alone
  room.removePlayer('p2');

  assert.equal(room.players.size, 1);
  assert.equal(room.status, ROOM_STATUS.ENDED, 'Match must end when player is left alone');

  const leftEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.PLAYER_LEFT && e.payload.name === 'Bob');
  assert.ok(leftEvent);
  assert.equal(leftEvent.payload.leftAlone, true);
  assert.equal(leftEvent.payload.remainingPlayers, 1);

  const gameEndedEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.GAME_ENDED);
  assert.ok(gameEndedEvent);
  assert.equal(gameEndedEvent.payload.reason, 'all_players_left');
  assert.equal(gameEndedEvent.payload.message, 'Everyone has left the room!');

  const aloneEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.LEFT_ALONE);
  assert.ok(aloneEvent);
  assert.equal(aloneEvent.payload.message, 'Everyone has left the room!');
});

test('27. Snapshot broadcast contains authoritative player names and colors for client avatars and HUD', () => {
  const io = createMockIO();
  const room = new GameRoom('SNAP1', 'p1', io);
  room.addPlayer('p1', 'AliceMaster');
  room.addPlayer('p2', 'BobRunner');

  room.broadcastSnapshot();

  const snapEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.GAME_SNAPSHOT);
  assert.ok(snapEvent, 'GAME_SNAPSHOT event must be emitted');
  assert.equal(snapEvent.payload.p.length, 2);

  const p1Snap = snapEvent.payload.p.find(p => p.id === 'p1');
  const p2Snap = snapEvent.payload.p.find(p => p.id === 'p2');

  assert.ok(p1Snap);
  assert.equal(p1Snap.name, 'AliceMaster');
  assert.ok(typeof p1Snap.colorHex === 'number');

  assert.ok(p2Snap);
  assert.equal(p2Snap.name, 'BobRunner');
  assert.ok(typeof p2Snap.colorHex === 'number');
});

test('28. Room creation leaves prior room cleanly', () => {
  const io = createMockIO();
  const manager = new RoomManager(io);

  // Player creates first room
  const res1 = manager.createRoom('socket-p1', 'Alice');
  assert.equal(res1.success, true);
  const code1 = res1.code;
  assert.equal(manager.playerRoomMap.get('socket-p1'), code1);
  assert.ok(manager.rooms.has(code1));

  // Player creates second room without manually leaving
  const res2 = manager.createRoom('socket-p1', 'Alice');
  assert.equal(res2.success, true);
  const code2 = res2.code;
  assert.notEqual(code1, code2);
  assert.equal(manager.playerRoomMap.get('socket-p1'), code2);
  assert.ok(manager.rooms.has(code2));

  // Old room should be removed since p1 was the only player
  assert.equal(manager.rooms.has(code1), false, 'Empty previous room should be cleaned up');
});

test('29. Secret Golden Flag Surge twist: holder GAINS +3/s while opponents LOSE -3/s', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM1', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.startMatch();

  room.setFlagHolder('p1', 'test');
  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.score = 20;
  p2.score = 20;

  // Normal scoring: 1 second dt -> holder loses 2 pts (-2), non-holder gains 1 pt (+1)
  room.updateScoring(1.0);
  assert.equal(Math.round(p1.score), 18);
  assert.equal(Math.round(p2.score), 21);

  // Activate Golden Flag Surge
  room.isFlagSurgeActive = true;
  // 1 second dt during surge -> holder GAINS +3 pts/s (18 + 3 = 21)
  // Opponent (non-holder) LOSES -3 pts/s (21 - 3 = 18)
  room.updateScoring(1.0);
  assert.equal(Math.round(p1.score), 21);
  assert.equal(Math.round(p2.score), 18);

  // Deactivate surge -> normal scoring resumes (holder -2 pts/s, non-holder +1 pt/s)
  room.isFlagSurgeActive = false;
  room.updateScoring(1.0);
  assert.equal(Math.round(p1.score), 19);
  assert.equal(Math.round(p2.score), 19);
});

test('30. Toss only triggers for exactly 2 players and is skipped when > 2 players', () => {
  const io = createMockIO();
  const room = new GameRoom('ROOM3', 'p1', io);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.addPlayer('p3', 'Charlie');

  // With 3 players, direct performToss returns null
  assert.equal(room.performToss(), null, 'Toss should return null when player count is not 2');

  // Start countdown with 3 players
  io.emittedEvents = [];
  const startRes = room.startCountdown('p1');
  assert.equal(startRes.success, true);

  // FLAG_TOSS should NOT be emitted
  const tossEvent = io.emittedEvents.find(e => e.event === EVENTS.SERVER.FLAG_TOSS);
  assert.equal(tossEvent, undefined, 'Flag toss event should not be emitted with > 2 players');

  // Pending initial holder was still selected
  assert.ok(room.pendingTossWinnerId);
  assert.ok(['p1', 'p2', 'p3'].includes(room.pendingTossWinnerId));

  // When match begins, selected holder gets flag and 20 lead, others get 0
  room.startMatch();
  assert.ok(room.flagHolderId);
  const holder = room.players.get(room.flagHolderId);
  assert.equal(holder.score, 20);
  for (const [id, player] of room.players.entries()) {
    if (id !== room.flagHolderId) {
      assert.equal(player.score, 0);
    }
  }

  // Now create a 2-player room to verify toss DOES run
  const io2 = createMockIO();
  const room2 = new GameRoom('ROOM2', 'p1', io2);
  room2.addPlayer('p1', 'Alice');
  room2.addPlayer('p2', 'Bob');

  const startRes2 = room2.startCountdown('p1');
  assert.equal(startRes2.success, true);
  const tossEvent2 = io2.emittedEvents.find(e => e.event === EVENTS.SERVER.FLAG_TOSS);
  assert.ok(tossEvent2, 'Flag toss event should be emitted for exactly 2 players');
  assert.ok(['p1', 'p2'].includes(tossEvent2.payload.winnerId));
});

test('31. Matchmaking rejection when player name is empty or missing', () => {
  const io = createMockIO();
  const manager = new RoomManager(io);

  // Attempt to create room without a name
  const emptyCreate1 = manager.createRoom('socket-1', '');
  assert.equal(emptyCreate1.success, false);
  assert.match(emptyCreate1.reason, /nickname/i);

  const emptyCreate2 = manager.createRoom('socket-2', '   ');
  assert.equal(emptyCreate2.success, false);
  assert.match(emptyCreate2.reason, /nickname/i);

  const nullCreate = manager.createRoom('socket-3', null);
  assert.equal(nullCreate.success, false);
  assert.match(nullCreate.reason, /nickname/i);

  // Create valid room
  const validCreate = manager.createRoom('socket-host', 'HostAlice');
  assert.equal(validCreate.success, true);
  const code = validCreate.code;

  // Attempt to join room without a name
  const emptyJoin1 = manager.joinRoom('socket-guest1', code, '');
  assert.equal(emptyJoin1.success, false);
  assert.match(emptyJoin1.reason, /nickname/i);

  const emptyJoin2 = manager.joinRoom('socket-guest2', code, '   ');
  assert.equal(emptyJoin2.success, false);
  assert.match(emptyJoin2.reason, /nickname/i);

  // Valid join
  const validJoin = manager.joinRoom('socket-guest3', code, 'GuestBob');
  assert.equal(validJoin.success, true);
});




