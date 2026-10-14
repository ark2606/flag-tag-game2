// Authoritative Game Room: manages state, simulation tick, scoring, platform physics, and flag transfers
import {
  ROOM_STATUS,
  ARENA,
  PLATFORMS,
  SPRINGS,
  SPAWN_POINTS,
  PLAYER_CONFIG,
  PHYSICS_CONFIG,
  SCORING_CONFIG,
  PHASE_CONFIG,
  MATCH_CONFIG,
  EVENTS,
} from '../../shared/constants.js';
import {
  checkPlatformLanding,
  checkSpringPadCollision,
  checkCircleOverlap,
} from './physics.js';

export class GameRoom {
  /**
   * @param {string} code 5-character room code
   * @param {string} hostSocketId
   * @param {object} io Socket.IO server instance
   * @param {object} customConfig Optional custom scoring / match overrides
   */
  constructor(code, hostSocketId, io, customConfig = {}) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.io = io;

    this.scoringConfig = { ...SCORING_CONFIG, ...(customConfig.scoring || {}) };
    this.matchConfig = { ...MATCH_CONFIG, ...(customConfig.match || {}) };
    this.playerConfig = { ...PLAYER_CONFIG, ...(customConfig.player || {}) };

    this.baseSpeed = this.playerConfig.BASE_SPEED;
    this.speedMultiplier = 1.0;

    this.status = ROOM_STATUS.LOBBY;
    this.players = new Map(); // socketId -> Player
    this.colorIndex = 0;

    // Match runtime state
    this.flagHolderId = null;
    this.pendingTossWinnerId = null;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.countdownRemaining = this.matchConfig.COUNTDOWN_DURATION;
    this.activeContacts = new Set(); // Stores contact pairs "idA:idB" to prevent continuous overlap spam
    this.finalPenaltyApplied = false;

    // Dynamic scoring phase state
    this.phaseSchedule = [];
    this.activePhase = null;

    // Simulation loop handles
    this.loopInterval = null;
    this.lastTickTime = null;
    this.countdownInterval = null;

    // Statistics for results
    this.stats = new Map(); // socketId -> { passesMade: 0, timeHeld: 0 }
  }

  get effectiveSpeed() {
    return this.baseSpeed;
  }

  // --- ROOM MANAGEMENT ---

  /**
   * Sanitizes usernames to avoid HTML injection and length overflow.
   */
  sanitizeUsername(name) {
    if (!name || typeof name !== 'string') return 'Player';
    const clean = name.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
    return clean.length > 0 ? clean : 'Player';
  }

  /**
   * Adds a player to the room.
   */
  addPlayer(socketId, rawName) {
    if (this.players.size >= this.matchConfig.MAX_PLAYERS) {
      return { success: false, reason: 'Room is full (max 8 players).' };
    }

    if (this.status !== ROOM_STATUS.LOBBY && this.status !== ROOM_STATUS.ENDED) {
      return { success: false, reason: 'Match is currently in progress.' };
    }

    const username = this.sanitizeUsername(rawName);
    const color = PLAYER_CONFIG.COLORS[this.colorIndex % PLAYER_CONFIG.COLORS.length];
    this.colorIndex++;

    const spawn = SPAWN_POINTS[this.players.size % SPAWN_POINTS.length];

    const player = {
      id: socketId,
      name: username,
      color: color,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      inputX: 0,
      jumpRequested: false,
      dropDown: false,
      isGrounded: true,
      springCooldown: 0,
      score: 0,
      speedBoostTimer: 0,
      isConnected: true,
    };

    this.players.set(socketId, player);
    this.stats.set(socketId, { passesMade: 0, timeHeld: 0 });

    return { success: true, player };
  }

  /**
   * Removes a player from the room.
   */
  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    this.players.delete(socketId);
    this.stats.delete(socketId);

    // If flag holder left, transfer flag to another random player
    if (this.flagHolderId === socketId) {
      this.flagHolderId = null;
      const remainingIds = Array.from(this.players.keys());
      if (remainingIds.length > 0 && this.status === ROOM_STATUS.PLAYING) {
        const nextHolderId = remainingIds[Math.floor(Math.random() * remainingIds.length)];
        this.setFlagHolder(nextHolderId, 'holder_left');
        const nextHolder = this.players.get(nextHolderId);
        this.emitToRoom(EVENTS.SERVER.FLAG_TRANSFERRED, {
          fromId: null,
          toId: nextHolderId,
          passBonus: 0,
          passerScore: 0,
          x: nextHolder ? nextHolder.x : ARENA.WIDTH / 2,
          y: nextHolder ? nextHolder.y : ARENA.HEIGHT / 2,
        });
      }
    }

    // Host migration
    if (socketId === this.hostSocketId) {
      const nextHost = this.players.keys().next().value;
      if (nextHost) {
        this.hostSocketId = nextHost;
      }
    }

    // If not enough players remain, abort to lobby
    if (this.players.size < this.matchConfig.MIN_PLAYERS &&
       (this.status === ROOM_STATUS.PLAYING || this.status === ROOM_STATUS.COUNTDOWN)) {
      this.stopSimulation();
      this.status = ROOM_STATUS.LOBBY;
      this.broadcastRoomState();
    }
  }

  /**
   * Sets client movement input (horizontal, jump, and platform drop).
   */
  handlePlayerInput(socketId, input = {}) {
    const player = this.players.get(socketId);
    if (!player || this.status !== ROOM_STATUS.PLAYING) return;

    let ix = Number(input.x) || 0;
    // Clamp horizontal input
    player.inputX = Math.max(-1, Math.min(1, ix));

    // Jump requested via explicit boolean or negative Y input
    player.jumpRequested = Boolean(input.jump || (Number(input.y) < -0.5));

    // Drop-down requested via explicit boolean or positive Y input
    player.dropDown = Boolean(input.dropDown || (Number(input.y) > 0.5));
  }

  // --- MATCH LIFECYCLE ---

  /**
   * Host requests to start the game.
   */
  startCountdown(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId) {
      return { success: false, reason: 'Only the host can start the match.' };
    }
    if (this.players.size < this.matchConfig.MIN_PLAYERS) {
      return { success: false, reason: `Need at least ${this.matchConfig.MIN_PLAYERS} players to start.` };
    }
    if (this.status !== ROOM_STATUS.LOBBY && this.status !== ROOM_STATUS.ENDED) {
      return { success: false, reason: 'Match is already running.' };
    }

    this.resetMatchState();
    this.status = ROOM_STATUS.COUNTDOWN;
    this.countdownRemaining = this.matchConfig.COUNTDOWN_DURATION;

    // Perform flag toss to decide initial holder
    this.performToss();

    // Reset spawn positions
    let idx = 0;
    for (const player of this.players.values()) {
      const spawn = SPAWN_POINTS[idx % SPAWN_POINTS.length];
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.inputX = 0;
      player.jumpRequested = false;
      player.dropDown = false;
      player.isGrounded = true;
      player.springCooldown = 0;
      player.score = 0;
      player.speedBoostTimer = 0;
      idx++;
    }

    this.broadcastRoomState();

    if (this.countdownInterval) clearInterval(this.countdownInterval);

    this.countdownInterval = setInterval(() => {
      this.countdownRemaining--;
      if (this.countdownRemaining > 0) {
        this.emitToRoom(EVENTS.SERVER.COUNTDOWN_TICK, { count: this.countdownRemaining });
      } else {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        this.startMatch();
      }
    }, 1000);

    return { success: true };
  }

  /**
   * Resets scores, timers, and flag tracking for a fresh round.
   */
  resetMatchState() {
    this.flagHolderId = null;
    this.pendingTossWinnerId = null;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.activeContacts.clear();
    this.finalPenaltyApplied = false;
    this.phaseSchedule = [];
    this.activePhase = null;

    for (const stats of this.stats.values()) {
      stats.passesMade = 0;
      stats.timeHeld = 0;
    }
  }

  /**
   * Performs an authoritative flag toss to select the initial flag holder.
   */
  performToss() {
    const playerIds = Array.from(this.players.keys());
    if (playerIds.length === 0) return null;

    const winnerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    this.pendingTossWinnerId = winnerId;
    const winner = this.players.get(winnerId);

    const candidates = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));

    const tossData = {
      candidates,
      winnerId,
      winnerName: winner ? winner.name : 'Player',
      winnerColor: winner?.color?.css || '#f59e0b',
      startingBonus: this.scoringConfig.STARTING_BONUS,
    };

    this.emitToRoom(EVENTS.SERVER.FLAG_TOSS, tossData);
    return tossData;
  }

  /**
   * Schedules randomized scoring phases across the round duration.
   */
  scheduleScoringPhases() {
    const duration = this.matchConfig.ROUND_DURATION;
    const phaseDuration = PHASE_CONFIG.PHASE_DURATION;
    const warningDuration = PHASE_CONFIG.WARNING_DURATION;
    const minInterval = PHASE_CONFIG.MIN_INTERVAL;

    this.phaseSchedule = [];
    this.activePhase = null;

    // Schedule 2 to 3 phases within the round, leaving margins at the start and end
    const numPhases = Math.min(3, Math.max(2, Math.floor(duration / 40)));
    const earliestStart = duration - 15;
    const latestStart = 20;
    const usableSpan = earliestStart - latestStart;
    const segmentSpan = usableSpan / numPhases;

    for (let i = 0; i < numPhases; i++) {
      const segStart = earliestStart - i * segmentSpan;
      const segEnd = segStart - segmentSpan + minInterval;

      // Random start time within segment
      const offset = Math.random() * Math.max(2, (segStart - segEnd) * 0.5);
      const startTime = Math.round(segStart - offset);

      // Random phase type
      const type = PHASE_CONFIG.TYPES[Math.floor(Math.random() * PHASE_CONFIG.TYPES.length)];

      this.phaseSchedule.push({
        startTime,
        duration: phaseDuration,
        warningTime: startTime + warningDuration,
        type,
        warningEmitted: false,
        started: false,
        ended: false,
      });
    }

    // Sort by startTime descending (as timeRemaining counts down)
    this.phaseSchedule.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Begins the official match.
   */
  startMatch() {
    this.status = ROOM_STATUS.PLAYING;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.lastTickTime = Date.now();

    // Use toss winner if determined during countdown, or fallback to random
    const initialHolderId = (this.pendingTossWinnerId && this.players.has(this.pendingTossWinnerId))
      ? this.pendingTossWinnerId
      : Array.from(this.players.keys())[0];

    this.pendingTossWinnerId = null;

    if (initialHolderId) {
      this.setFlagHolder(initialHolderId, 'round_start');
      const initialHolder = this.players.get(initialHolderId);
      if (initialHolder) {
        initialHolder.score += this.scoringConfig.STARTING_BONUS;
      }
    }

    // Authoritatively schedule dynamic scoring phases
    this.scheduleScoringPhases();

    const initialHolder = this.players.get(this.flagHolderId);
    this.emitToRoom(EVENTS.SERVER.GAME_STARTED, {
      flagHolderId: this.flagHolderId,
      startingBonus: this.scoringConfig.STARTING_BONUS,
      tossWinnerName: initialHolder?.name || 'Player',
      effectiveSpeed: this.effectiveSpeed,
    });

    this.startSimulation();
    this.broadcastRoomState();
  }

  /**
   * Starts the 30 Hz simulation loop.
   */
  startSimulation() {
    this.stopSimulation();
    const tickMs = 1000 / MATCH_CONFIG.TICK_RATE;

    this.loopInterval = setInterval(() => {
      this.tick();
    }, tickMs);
  }

  /**
   * Stops the simulation loop.
   */
  stopSimulation() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  /**
   * Master simulation tick.
   */
  tick() {
    if (this.status !== ROOM_STATUS.PLAYING) return;

    const now = Date.now();
    const dt = Math.min((now - this.lastTickTime) / 1000, 0.05); // clamp dt to 50ms max to prevent tunneling
    this.lastTickTime = now;

    // 1. Update Match Timer
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endMatch();
      return;
    }

    // 2. Check and Update Dynamic Scoring Phases
    this.updateScoringPhases();

    // 3. Update Continuous Scoring
    this.updateScoring(dt);

    // 4. Update Player Positions with Platform Gravity, Jumping & Springs
    this.updatePlayerMovement(dt);

    // 5. Resolve Player-to-Player Collisions & Flag Transfers
    this.updateCollisionsAndTransfers();

    // 6. Broadcast Snapshot
    this.broadcastSnapshot();
  }

  /**
   * Checks phase schedule and broadcasts warnings, start, and end events.
   */
  updateScoringPhases() {
    for (const phase of this.phaseSchedule) {
      // 5-second advance warning
      if (this.timeRemaining <= phase.warningTime && !phase.warningEmitted) {
        phase.warningEmitted = true;
        this.emitToRoom(EVENTS.SERVER.PHASE_WARNING, {
          phaseId: phase.type.id,
          name: phase.type.name,
          description: phase.type.description,
          countdown: 5,
        });
      }

      // Phase activation
      if (this.timeRemaining <= phase.startTime && !phase.started) {
        phase.started = true;
        this.activePhase = phase.type;
        this.emitToRoom(EVENTS.SERVER.PHASE_STARTED, {
          phaseId: phase.type.id,
          name: phase.type.name,
          description: phase.type.description,
          duration: phase.duration,
        });
      }

      // Phase termination
      if (this.timeRemaining <= (phase.startTime - phase.duration) && phase.started && !phase.ended) {
        phase.ended = true;
        if (this.activePhase?.id === phase.type.id) {
          this.activePhase = null;
        }
        this.emitToRoom(EVENTS.SERVER.PHASE_ENDED, {
          phaseId: phase.type.id,
        });
      }
    }
  }

  /**
   * Central Scoring update tick.
   * - Flag holder: -2 pts/sec (multiplied during Flag Frenzy)
   * - Non-holders: +1 pt/sec (multiplied during Double Survival)
   * (Fixed 5-sec hold bonus removed in favor of dynamic scoring phases)
   */
  updateScoring(dt) {
    let holderRate = this.scoringConfig.HOLDER_POINTS_PER_SEC;
    let nonHolderRate = this.scoringConfig.NON_HOLDER_POINTS_PER_SEC;

    if (this.activePhase?.holderMultiplier) {
      holderRate *= this.activePhase.holderMultiplier;
    }
    if (this.activePhase?.nonHolderMultiplier) {
      nonHolderRate *= this.activePhase.nonHolderMultiplier;
    }

    for (const [id, player] of this.players.entries()) {
      if (id === this.flagHolderId) {
        player.score += holderRate * dt;
        const stat = this.stats.get(id);
        if (stat) stat.timeHeld += dt;
      } else {
        player.score += nonHolderRate * dt;
      }
    }
  }

  /**
   * Updates player vertical physics (gravity, jumping, spring pads, platform landing) and horizontal movement.
   */
  updatePlayerMovement(dt) {
    const currentBaseSpeed = this.baseSpeed;
    const boostRatio = this.playerConfig.PASS_BOOST_SPEED / this.playerConfig.BASE_SPEED;
    const currentBoostSpeed = Math.round(currentBaseSpeed * boostRatio);

    for (const player of this.players.values()) {
      // Cooldown decrement for spring launchers
      if (player.springCooldown > 0) {
        player.springCooldown -= dt;
      }

      // 1. Horizontal movement
      let speed = currentBaseSpeed;
      if (player.speedBoostTimer > 0) {
        player.speedBoostTimer -= dt;
        speed = currentBoostSpeed;
      }
      player.vx = player.inputX * speed;

      // 2. Gravitational acceleration
      player.vy = Math.min(PHYSICS_CONFIG.TERMINAL_VELOCITY, player.vy + PHYSICS_CONFIG.GRAVITY * dt);

      // 3. Jump execution (allowed only when grounded)
      if (player.jumpRequested && player.isGrounded) {
        player.vy = PHYSICS_CONFIG.JUMP_VELOCITY;
        player.isGrounded = false;
        player.jumpRequested = false;
      }

      // Swept coordinates
      const prevX = player.x;
      const prevY = player.y;
      let newX = prevX + player.vx * dt;
      let newY = prevY + player.vy * dt;

      // 4. Spring Pad / Tyre Launcher Collision Check (launches player upward)
      let springTriggered = null;
      if (player.springCooldown <= 0) {
        springTriggered = checkSpringPadCollision(prevY, newY, newX, PLAYER_CONFIG.RADIUS, SPRINGS);
        if (springTriggered) {
          player.vy = springTriggered.impulse;
          player.isGrounded = false;
          player.springCooldown = PHYSICS_CONFIG.COOLDOWN_AFTER_BOUNCE;
          this.emitToRoom(EVENTS.SERVER.SPRING_TRIGGERED, {
            springId: springTriggered.id,
            playerId: player.id,
            impulse: springTriggered.impulse,
          });
        }
      }

      let groundedThisFrame = false;

      // 5. One-Way Platform Landing (only when falling downward and not dropping down)
      if (!springTriggered && player.vy >= 0 && !player.dropDown) {
        for (const plat of PLATFORMS) {
          if (checkPlatformLanding(prevY, newY, newX, PLAYER_CONFIG.RADIUS, plat)) {
            newY = plat.y - PLAYER_CONFIG.RADIUS;
            player.vy = 0;
            groundedThisFrame = true;
            break;
          }
        }
      }

      // 6. Arena Boundary Clamping (Walls, Ceiling, Ground Floor)
      const minX = ARENA.WALL_THICKNESS + PLAYER_CONFIG.RADIUS;
      const maxX = ARENA.WIDTH - ARENA.WALL_THICKNESS - PLAYER_CONFIG.RADIUS;
      newX = Math.max(minX, Math.min(maxX, newX));

      const ceilingY = ARENA.WALL_THICKNESS + PLAYER_CONFIG.RADIUS;
      if (newY <= ceilingY) {
        newY = ceilingY;
        if (player.vy < 0) player.vy = 0;
      }

      const floorY = ARENA.GROUND_Y - PLAYER_CONFIG.RADIUS;
      if (newY >= floorY) {
        newY = floorY;
        player.vy = 0;
        groundedThisFrame = true;
      }

      player.x = newX;
      player.y = newY;
      player.isGrounded = groundedThisFrame;

      // Check if player is standing on a spring pad (for walking detection)
      // This catches the case when walking horizontally onto a spring
      if (groundedThisFrame && player.springCooldown <= 0 && !springTriggered) {
        for (const spring of SPRINGS) {
          const springCenterX = spring.x + spring.width / 2;
          const springLeft = spring.x - PLAYER_CONFIG.RADIUS;
          const springRight = spring.x + spring.width + PLAYER_CONFIG.RADIUS;
          const springTop = spring.y;
          const springBottom = spring.y + spring.height;
          const playerFeet = newY + PLAYER_CONFIG.RADIUS;

          // Check if player's center X is over the spring horizontally
          // and feet are near/touching the spring surface
          if (newX >= springLeft && newX <= springRight &&
              playerFeet >= springTop - 5 && playerFeet <= springBottom + 10) {
            player.vy = spring.impulse;
            player.isGrounded = false;
            player.springCooldown = PHYSICS_CONFIG.COOLDOWN_AFTER_BOUNCE;
            this.emitToRoom(EVENTS.SERVER.SPRING_TRIGGERED, {
              springId: spring.id,
              playerId: player.id,
              impulse: spring.impulse,
            });
            break;
          }
        }
      }
    }

    // Players pass through each other like ghosts - no collision blocking
  }

  /**
   * Core Flag Transfer & Contact Resolution.
   */
  updateCollisionsAndTransfers() {
    const playerList = Array.from(this.players.values());
    const currentFrameContacts = new Set();

    for (let i = 0; i < playerList.length; i++) {
      for (let j = i + 1; j < playerList.length; j++) {
        const p1 = playerList[i];
        const p2 = playerList[j];

        const isTouching = checkCircleOverlap(
          p1,
          p2,
          PLAYER_CONFIG.RADIUS,
          PLAYER_CONFIG.RADIUS
        );

        if (isTouching) {
          const pairKey = p1.id < p2.id ? `${p1.id}:${p2.id}` : `${p2.id}:${p1.id}`;
          currentFrameContacts.add(pairKey);

          const p1IsHolder = p1.id === this.flagHolderId;
          const p2IsHolder = p2.id === this.flagHolderId;

          if (p1IsHolder || p2IsHolder) {
            const holder = p1IsHolder ? p1 : p2;
            const target = p1IsHolder ? p2 : p1;

            // Only transfer on NEW contact (first touch), never during continuous contact
            const isNewContact = !this.activeContacts.has(pairKey);

            if (isNewContact) {
              this.executeFlagTransfer(holder, target, pairKey);
            }
          }
        }
      }
    }

    this.activeContacts = currentFrameContacts;
  }

  /**
   * Executes an immediate, authoritative flag transfer.
   */
  executeFlagTransfer(passer, receiver, pairKey) {
    const previousHolderId = passer.id;
    const newHolderId = receiver.id;

    // 1. Award pass bonus (with active scoring phase multiplier if present)
    let passBonus = this.scoringConfig.PASS_BONUS;
    if (this.activePhase?.passBonusMultiplier) {
      passBonus = Math.round(passBonus * this.activePhase.passBonusMultiplier);
    }

    passer.score += passBonus;
    const passerStat = this.stats.get(passer.id);
    if (passerStat) passerStat.passesMade++;

    // 2. Passer speed burst to escape
    if (this.scoringConfig.SPEED_BOOST_ON_PASS) {
      passer.speedBoostTimer = PLAYER_CONFIG.PASS_BOOST_DURATION;
    }

    // 3. Update flag ownership
    this.setFlagHolder(newHolderId, 'pass');

    // 4. Mark contact pair as active
    if (pairKey) this.activeContacts.add(pairKey);

    // 5. Broadcast event
    this.emitToRoom(EVENTS.SERVER.FLAG_TRANSFERRED, {
      fromId: previousHolderId,
      toId: newHolderId,
      passBonus,
      passerScore: Math.round(passer.score),
      x: (passer.x + receiver.x) / 2,
      y: (passer.y + receiver.y) / 2,
    });
  }

  /**
   * Sets the authoritative flag holder.
   */
  setFlagHolder(socketId) {
    this.flagHolderId = socketId;
  }

  /**
   * Match ends when countdown timer hits 0.
   */
  endMatch() {
    this.status = ROOM_STATUS.ENDED;
    this.stopSimulation();
    this.activePhase = null;
    this.phaseSchedule = [];

    // Apply end-of-round penalty to the final flag holder exactly once (-40 points)
    if (!this.finalPenaltyApplied && this.flagHolderId) {
      const finalHolder = this.players.get(this.flagHolderId);
      if (finalHolder) {
        finalHolder.score += this.scoringConfig.FINAL_HOLDER_PENALTY;
      }
      this.finalPenaltyApplied = true;
    }

    // Compute rankings
    const rankings = Array.from(this.players.values())
      .map(p => {
        const stat = this.stats.get(p.id) || {};
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          finalScore: Math.round(p.score),
          passesMade: stat.passesMade || 0,
          timeHeld: Math.round(stat.timeHeld || 0),
          wasFinalHolder: p.id === this.flagHolderId,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    const winner = rankings.length > 0 ? rankings[0] : null;

    this.emitToRoom(EVENTS.SERVER.GAME_ENDED, {
      rankings,
      winner,
      finalHolderId: this.flagHolderId,
      finalPenalty: this.scoringConfig.FINAL_HOLDER_PENALTY,
    });

    this.broadcastRoomState();
  }

  /**
   * Rematch request from host.
   */
  handleRematch(socketId) {
    if (socketId !== this.hostSocketId) {
      return { success: false, reason: 'Only the host can initiate a rematch.' };
    }
    return this.startCountdown(socketId);
  }

  /**
   * Return to lobby request from host.
   */
  handleReturnToLobby(socketId) {
    if (socketId !== this.hostSocketId) {
      return { success: false, reason: 'Only the host can return everyone to the lobby.' };
    }
    this.stopSimulation();
    this.resetMatchState();
    this.status = ROOM_STATUS.LOBBY;
    this.broadcastRoomState();
    return { success: true };
  }

  /**
   * Updates room speed from host or client request.
   * REJECTS changes if match is currently active (only available in lobby or after round).
   */
  handleSpeedChange(socketId, data = {}) {
    // 1. Strict status check: Settings must ONLY be changeable in the lobby or after match
    if (this.status !== ROOM_STATUS.LOBBY && this.status !== ROOM_STATUS.ENDED) {
      return {
        success: false,
        reason: 'Game settings can only be changed before the round starts in the lobby.',
      };
    }

    // 2. Only host can change speed when multiple players are in the room
    if (this.players.size > 1 && socketId !== this.hostSocketId) {
      return { success: false, reason: 'Only the room host (👑) can change game speed.' };
    }

    let newSpeed = this.baseSpeed;
    let newMult = this.speedMultiplier;

    if (typeof data.delta === 'number') {
      newSpeed = Math.max(200, Math.min(900, Math.round(newSpeed + data.delta)));
      newMult = Math.round((newSpeed / this.playerConfig.BASE_SPEED) * 100) / 100;
    } else if (typeof data.speed === 'number') {
      newSpeed = Math.max(200, Math.min(900, Math.round(data.speed)));
      newMult = Math.round((newSpeed / this.playerConfig.BASE_SPEED) * 100) / 100;
    } else if (typeof data.multiplier === 'number') {
      newMult = Math.max(0.5, Math.min(2.5, Math.round(data.multiplier * 100) / 100));
      newSpeed = Math.round(this.playerConfig.BASE_SPEED * newMult);
    }

    this.baseSpeed = newSpeed;
    this.speedMultiplier = newMult;

    const effectiveSpeed = this.baseSpeed;
    const changer = this.players.get(socketId);

    const payload = {
      baseSpeed: this.baseSpeed,
      speedMultiplier: this.speedMultiplier,
      effectiveSpeed,
      changedBy: changer ? changer.name : 'Host',
    };

    this.emitToRoom(EVENTS.SERVER.SPEED_UPDATED, payload);
    return { success: true, ...payload };
  }

  // --- NETWORKING BROADCASTS ---

  /**
   * Broadcasts the light, high-frequency game snapshot (30 Hz).
   * Includes grounded state and vertical velocity for client platform rendering.
   */
  broadcastSnapshot() {
    const snapshot = {
      t: Math.round(this.timeRemaining * 10) / 10,
      f: this.flagHolderId,
      p: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        g: p.isGrounded,
        s: Math.round(p.score),
        b: p.speedBoostTimer > 0,
      })),
    };

    this.emitToRoom(EVENTS.SERVER.GAME_SNAPSHOT, snapshot);
  }

  /**
   * Emits room state to all members (lobby, player list, host, status).
   */
  broadcastRoomState() {
    const state = this.getRoomState();
    this.emitToRoom(EVENTS.SERVER.ROOM_STATE, state);
  }

  getRoomState() {
    return {
      code: this.code,
      hostId: this.hostSocketId,
      status: this.status,
      timeRemaining: Math.round(this.timeRemaining),
      roundDuration: this.matchConfig.ROUND_DURATION,
      baseSpeed: this.baseSpeed,
      speedMultiplier: this.speedMultiplier,
      effectiveSpeed: this.baseSpeed,
      flagHolderId: this.flagHolderId,
      activePhase: this.activePhase,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: Math.round(p.score),
        isHost: p.id === this.hostSocketId,
      })),
    };
  }

  emitToRoom(event, data) {
    if (this.io) {
      this.io.to(this.code).emit(event, data);
    }
  }
}
