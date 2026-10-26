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

    // Twist: Secret Golden Flag Surge state (holding flag gains points)
    this.surgeSchedule = [];
    this.isFlagSurgeActive = false;

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
    if (!name || typeof name !== 'string') return '';
    return name.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
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

    // If returning or joining a finished room, cleanly reset state to lobby
    if (this.status === ROOM_STATUS.ENDED) {
      this.stopSimulation();
      this.resetMatchState();
      this.status = ROOM_STATUS.LOBBY;
    }

    this.pruneDisconnectedPlayers();

    if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
      return { success: false, reason: 'A valid nickname is required.' };
    }

    const username = this.sanitizeUsername(rawName);
    if (!username) {
      return { success: false, reason: 'A valid nickname is required.' };
    }

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
      score: this.scoringConfig.STARTING_SCORE ?? 20,
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
    if (!player) return null;

    const leavingName = player.name;
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

    // Notify remaining players in room about the player who left
    this.emitToRoom(EVENTS.SERVER.PLAYER_LEFT, {
      socketId,
      name: leavingName,
      remainingPlayers: this.players.size,
      leftAlone: this.players.size === 1,
    });

    // If only 1 player remains during active match or countdown, trigger GAME OVER because everyone else left
    if (this.players.size === 1 &&
       (this.status === ROOM_STATUS.PLAYING || this.status === ROOM_STATUS.COUNTDOWN)) {
      this.endMatch('all_players_left');
      this.emitToRoom(EVENTS.SERVER.LEFT_ALONE, {
        message: 'Everyone has left the room!',
      });
    } else if (this.players.size === 1 && this.status === ROOM_STATUS.ENDED) {
      this.resetMatchState();
      this.status = ROOM_STATUS.LOBBY;
      this.broadcastRoomState();
    } else if (this.players.size < this.matchConfig.MIN_PLAYERS &&
       (this.status === ROOM_STATUS.PLAYING || this.status === ROOM_STATUS.COUNTDOWN)) {
      this.stopSimulation();
      this.status = ROOM_STATUS.LOBBY;
      this.broadcastRoomState();
    }

    return { leavingName, remainingCount: this.players.size };
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

    // Perform flag toss to decide initial holder ONLY when exactly 2 players.
    // When there are more than 2 players, toss is skipped and initial holder is chosen directly.
    if (this.players.size === 2) {
      this.performToss();
    } else {
      const playerIds = Array.from(this.players.keys());
      if (playerIds.length > 0) {
        this.pendingTossWinnerId = playerIds[Math.floor(Math.random() * playerIds.length)];
      }
    }

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
      player.score = this.scoringConfig.STARTING_SCORE ?? 0;
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
    this.surgeSchedule = [];
    this.isFlagSurgeActive = false;

    for (const player of this.players.values()) {
      player.score = this.scoringConfig.STARTING_SCORE ?? 0;
    }

    for (const stats of this.stats.values()) {
      stats.passesMade = 0;
      stats.timeHeld = 0;
    }
  }

  /**
   * Performs an authoritative flag toss to select the initial flag holder.
   * Only active in 2-player matches (skipped if > 2 players).
   */
  performToss() {
    if (this.players.size !== 2) return null;

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
   * Schedules randomized surprise Golden Flag Gain surges.
   * Crucial rule twist: Holding the flag GAINS points (+3 pts/s).
   * Secret duration is determined authoritatively by server and NEVER revealed to players!
   * Duration can be 4-14 seconds, or even last until match end.
   */
  scheduleSurges() {
    const duration = this.matchConfig.ROUND_DURATION;
    this.surgeSchedule = [];
    this.isFlagSurgeActive = false;

    const count = Math.max(1, Math.min(3, Math.floor(duration / 40)));
    const margin = 8;
    const usableTime = Math.max(10, duration - margin * 2);
    const step = usableTime / count;

    for (let i = 0; i < count; i++) {
      const segStart = duration - margin - i * step;
      const startTime = Math.round(segStart - Math.random() * (step * 0.6));

      // Random duration: 4s to 12s, or until the end if close to zero!
      let surgeDuration;
      const canLastUntilEnd = startTime <= 16 && Math.random() < 0.35;
      if (canLastUntilEnd) {
        surgeDuration = startTime; // Lasts right until the final whistle
      } else {
        surgeDuration = Math.min(startTime - 2, Math.floor(Math.random() * 9) + 4);
      }

      if (startTime > 3 && surgeDuration >= 3) {
        this.surgeSchedule.push({
          startTime,
          duration: surgeDuration,
          started: false,
          ended: false,
        });
      }
    }

    this.surgeSchedule.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Begins the official match.
   */
  startMatch() {
    this.status = ROOM_STATUS.PLAYING;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.lastTickTime = Date.now();

    // Reset all players to base starting score (0)
    for (const player of this.players.values()) {
      player.score = this.scoringConfig.STARTING_SCORE ?? 0;
    }

    // Use toss winner if determined during countdown, or fallback to random
    const initialHolderId = (this.pendingTossWinnerId && this.players.has(this.pendingTossWinnerId))
      ? this.pendingTossWinnerId
      : Array.from(this.players.keys())[0];

    this.pendingTossWinnerId = null;

    if (initialHolderId) {
      this.setFlagHolder(initialHolderId, 'round_start');
      const initialHolder = this.players.get(initialHolderId);
      if (initialHolder && this.scoringConfig.STARTING_BONUS) {
        initialHolder.score += this.scoringConfig.STARTING_BONUS;
      }
    }

    // Authoritatively schedule dynamic scoring phases and secret surges
    this.scheduleScoringPhases();
    this.scheduleSurges();

    const initialHolder = this.players.get(this.flagHolderId);
    this.emitToRoom(EVENTS.SERVER.GAME_STARTED, {
      flagHolderId: this.flagHolderId,
      startingBonus: this.scoringConfig.STARTING_BONUS || 0,
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

    // 2. Check and Update Dynamic Scoring Phases & Secret Gaining Surges
    this.updateScoringPhases();
    this.updateSurges();

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
   * Authoritative secret surge ticker:
   * Activates Golden Flag Gain periods of unknown duration!
   * Holding the flag GAINS points instead of losing them.
   */
  updateSurges() {
    for (const surge of this.surgeSchedule) {
      // Trigger surge start (secret duration - no time sent to players!)
      if (this.timeRemaining <= surge.startTime && !surge.started) {
        surge.started = true;
        this.isFlagSurgeActive = true;
        this.emitToRoom(EVENTS.SERVER.FLAG_SURGE_STARTED, {
          isGaining: true,
          pointsPerSec: this.scoringConfig.SURGE_HOLDER_POINTS_PER_SEC || 3,
        });
      }

      // Trigger surge end
      if (this.timeRemaining <= (surge.startTime - surge.duration) && surge.started && !surge.ended) {
        surge.ended = true;
        this.isFlagSurgeActive = false;
        this.emitToRoom(EVENTS.SERVER.FLAG_SURGE_ENDED, {
          isGaining: false,
        });
      }
    }
  }

  /**
   * Central Scoring update tick.
   * - Normal: Flag holder loses points (-2 pts/sec), non-holders gain points (+1 pt/sec)
   * - Golden Surge: Flag holder GAINS points (+3 pts/sec), non-holders LOSE points (-1 pt/sec)!
   */
  updateScoring(dt) {
    let holderRate;
    let nonHolderRate;

    if (this.isFlagSurgeActive) {
      // Golden surge twist: holding flag GAINS points (+3 pts/s), opponents LOSE points (-3 pts/sec)!
      holderRate = this.scoringConfig.SURGE_HOLDER_POINTS_PER_SEC ?? 3;
      nonHolderRate = this.scoringConfig.SURGE_NON_HOLDER_POINTS_PER_SEC ?? -3;
    } else {
      // Normal: holding flag loses points, non-holders gain points
      holderRate = this.scoringConfig.HOLDER_POINTS_PER_SEC ?? -2;
      nonHolderRate = this.scoringConfig.NON_HOLDER_POINTS_PER_SEC ?? 1;

      if (this.activePhase?.holderMultiplier) {
        holderRate *= this.activePhase.holderMultiplier;
      }
      if (this.activePhase?.nonHolderMultiplier) {
        nonHolderRate *= this.activePhase.nonHolderMultiplier;
      }
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
          newY = springTriggered.y - PLAYER_CONFIG.RADIUS - 4;
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
      if (!springTriggered && player.vy >= 0 && newY >= floorY) {
        newY = floorY;
        player.vy = 0;
        groundedThisFrame = true;
      }

      // Check if player is standing on a spring pad (for walking detection)
      // This catches the case when walking horizontally onto a spring on the ground or platforms
      if (groundedThisFrame && player.springCooldown <= 0 && !springTriggered) {
        for (const spring of SPRINGS) {
          const springLeft = spring.x - PLAYER_CONFIG.RADIUS * 0.8;
          const springRight = spring.x + spring.width + PLAYER_CONFIG.RADIUS * 0.8;
          const springTop = spring.y;
          const springBottom = spring.y + spring.height;
          const playerFeet = newY + PLAYER_CONFIG.RADIUS;

          // Only trigger if player's horizontal center is over the spring
          // and feet are within the spring's vertical landing bounds
          if (newX >= springLeft && newX <= springRight &&
              playerFeet >= springTop - 10 && playerFeet <= springBottom + 16) {
            player.vy = spring.impulse;
            newY = spring.y - PLAYER_CONFIG.RADIUS - 4;
            groundedThisFrame = false;
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

      player.x = newX;
      player.y = newY;
      player.isGrounded = groundedThisFrame;
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
   * Match ends when countdown timer hits 0 or all other players leave.
   */
  endMatch(reason = null) {
    this.status = ROOM_STATUS.ENDED;
    this.stopSimulation();
    this.activePhase = null;
    this.phaseSchedule = [];
    this.isFlagSurgeActive = false;
    this.surgeSchedule = [];

    // End penalty is completely removed per user rules (0 penalty)

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
      finalPenalty: 0,
      reason,
      message: reason === 'all_players_left' ? 'Everyone has left the room!' : null,
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
   * Cleans up disconnected or invalid socket entries from the active room.
   */
  pruneDisconnectedPlayers() {
    if (!this.io?.sockets?.sockets) return;
    const staleIds = [];
    for (const socketId of this.players.keys()) {
      const s = this.io.sockets.sockets.get(socketId);
      if (!s || !s.connected) {
        staleIds.push(socketId);
      }
    }
    for (const sid of staleIds) {
      this.removePlayer(sid);
    }
  }

  /**
   * Return to lobby request from host or players after match.
   */
  handleReturnToLobby(socketId) {
    this.pruneDisconnectedPlayers();
    if (this.players.size > 1 && socketId !== this.hostSocketId && this.status !== ROOM_STATUS.ENDED) {
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
      return { success: false, reason: 'Only the room host can change game speed.' };
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
      sg: this.isFlagSurgeActive ? 1 : 0,
      p: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        colorHex: p.color?.hex,
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
