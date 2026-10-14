// Authoritative Game Room: manages state, simulation tick, scoring, and flag transfers
import {
  ROOM_STATUS,
  ARENA,
  SPAWN_POINTS,
  PLAYER_CONFIG,
  SCORING_CONFIG,
  MATCH_CONFIG,
  EVENTS,
} from '../../shared/constants.js';
import {
  resolveAllObstacles,
  checkCircleOverlap,
  resolvePlayerCollisions,
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

    this.status = ROOM_STATUS.LOBBY;
    this.players = new Map(); // socketId -> Player
    this.colorIndex = 0;

    // Match runtime state
    this.flagHolderId = null;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.countdownRemaining = this.matchConfig.COUNTDOWN_DURATION;
    this.uninterruptedHoldTime = 0;
    this.activeContacts = new Set(); // Stores contact pairs "idA:idB" to prevent continuous overlap spam
    this.finalPenaltyApplied = false;

    // Simulation loop handles
    this.loopInterval = null;
    this.lastTickTime = null;
    this.countdownInterval = null;

    // Statistics for results
    this.stats = new Map(); // socketId -> { passesMade: 0, timeHeld: 0, holdBonuses: 0 }
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
      inputY: 0,
      score: 0,
      speedBoostTimer: 0,
      isConnected: true,
    };

    this.players.set(socketId, player);
    this.stats.set(socketId, { passesMade: 0, timeHeld: 0, holdBonuses: 0 });

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

    // Clean up contact pairs involving this player
    for (const key of this.activeContacts) {
      if (key.includes(socketId)) {
        this.activeContacts.delete(key);
      }
    }

    // If host left, elect new host
    if (this.hostSocketId === socketId && this.players.size > 0) {
      const nextHost = this.players.keys().next().value;
      this.hostSocketId = nextHost;
    }

    // If flag holder left during active play, assign flag to another player
    if (this.status === ROOM_STATUS.PLAYING && this.flagHolderId === socketId) {
      this.flagHolderId = null;
      this.uninterruptedHoldTime = 0;
      if (this.players.size > 0) {
        const remainingIds = Array.from(this.players.keys());
        const randomNewHolder = remainingIds[Math.floor(Math.random() * remainingIds.length)];
        this.setFlagHolder(randomNewHolder, 'disconnect_reassign');
      } else {
        this.endMatch();
      }
    }

    // If fewer than 2 players remain during playing/countdown, return to lobby
    if (this.players.size < this.matchConfig.MIN_PLAYERS &&
       (this.status === ROOM_STATUS.PLAYING || this.status === ROOM_STATUS.COUNTDOWN)) {
      this.stopSimulation();
      this.status = ROOM_STATUS.LOBBY;
      this.broadcastRoomState();
    }
  }

  /**
   * Sets client movement input.
   */
  handlePlayerInput(socketId, input) {
    const player = this.players.get(socketId);
    if (!player || this.status !== ROOM_STATUS.PLAYING) return;

    let ix = Number(input.x) || 0;
    let iy = Number(input.y) || 0;

    // Normalize diagonal input on the server so client cannot spoof super-speed
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }

    player.inputX = ix;
    player.inputY = iy;
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

    // Reset spawn positions
    let idx = 0;
    for (const player of this.players.values()) {
      const spawn = SPAWN_POINTS[idx % SPAWN_POINTS.length];
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.inputX = 0;
      player.inputY = 0;
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
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.uninterruptedHoldTime = 0;
    this.activeContacts.clear();
    this.finalPenaltyApplied = false;

    for (const [id, stats] of this.stats.entries()) {
      stats.passesMade = 0;
      stats.timeHeld = 0;
      stats.holdBonuses = 0;
    }
  }

  /**
   * Begins the official match.
   */
  startMatch() {
    this.status = ROOM_STATUS.PLAYING;
    this.timeRemaining = this.matchConfig.ROUND_DURATION;
    this.lastTickTime = Date.now();

    // Random initial flag holder
    const playerIds = Array.from(this.players.keys());
    const initialHolderId = playerIds[Math.floor(Math.random() * playerIds.length)];

    this.setFlagHolder(initialHolderId, 'initial_start');

    // Award starting bonus (+30 points) to the initial holder
    const initialHolder = this.players.get(initialHolderId);
    if (initialHolder) {
      initialHolder.score += this.scoringConfig.STARTING_BONUS;
    }

    this.emitToRoom(EVENTS.SERVER.GAME_STARTED, {
      flagHolderId: this.flagHolderId,
      startingBonus: this.scoringConfig.STARTING_BONUS,
      timeRemaining: this.timeRemaining,
    });

    this.startSimulation();
  }

  /**
   * Starts the authoritative physics and scoring loop.
   */
  startSimulation() {
    this.stopSimulation();
    const tickMs = 1000 / this.matchConfig.TICK_RATE;
    this.lastTickTime = Date.now();

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
    const dt = Math.min((now - this.lastTickTime) / 1000, 0.1); // clamp dt to prevent giant physics jumps
    this.lastTickTime = now;

    // 1. Update Match Timer
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endMatch();
      return;
    }

    // 2. Update Continuous Scoring and Hold Timer
    this.updateScoring(dt);

    // 3. Update Player Positions with Physics & Obstacle Collisions
    this.updatePlayerMovement(dt);

    // 4. Resolve Player-to-Player Collisions & Flag Transfers
    this.updateCollisionsAndTransfers();

    // 5. Broadcast Snapshot
    this.broadcastSnapshot();
  }

  /**
   * Central Scoring update tick.
   * - Flag holder: -2 pts/sec
   * - Non-holders: +1 pt/sec
   * - 5-sec continuous hold bonus: +8 pts
   */
  updateScoring(dt) {
    for (const [id, player] of this.players.entries()) {
      if (id === this.flagHolderId) {
        // Holder loses points
        player.score += this.scoringConfig.HOLDER_POINTS_PER_SEC * dt;

        // Track stats
        const stat = this.stats.get(id);
        if (stat) stat.timeHeld += dt;

        // Uninterrupted hold bonus tracking
        this.uninterruptedHoldTime += dt;
        if (this.uninterruptedHoldTime >= this.scoringConfig.HOLD_BONUS_INTERVAL) {
          // Award hold bonus!
          player.score += this.scoringConfig.HOLD_BONUS_POINTS;
          if (stat) stat.holdBonuses++;

          // Reset uninterrupted timer to count the next 5-second interval
          this.uninterruptedHoldTime -= this.scoringConfig.HOLD_BONUS_INTERVAL;

          this.emitToRoom(EVENTS.SERVER.HOLD_BONUS_AWARDED, {
            playerId: id,
            bonus: this.scoringConfig.HOLD_BONUS_POINTS,
            newScore: Math.round(player.score),
          });
        }
      } else {
        // Non-holders gain points
        player.score += this.scoringConfig.NON_HOLDER_POINTS_PER_SEC * dt;
      }
    }
  }

  /**
   * Updates player movement, speed boosts, and wall/obstacle collisions.
   */
  updatePlayerMovement(dt) {
    for (const player of this.players.values()) {
      // Handle speed boost countdown
      let speed = PLAYER_CONFIG.BASE_SPEED;
      if (player.speedBoostTimer > 0) {
        player.speedBoostTimer -= dt;
        speed = PLAYER_CONFIG.PASS_BOOST_SPEED;
      }

      // Calculate target velocity
      player.vx = player.inputX * speed;
      player.vy = player.inputY * speed;

      // New candidate position
      const newX = player.x + player.vx * dt;
      const newY = player.y + player.vy * dt;

      // Authoritative collision resolution against arena bounds and obstacles
      const resolved = resolveAllObstacles(newX, newY, PLAYER_CONFIG.RADIUS);
      player.x = resolved.x;
      player.y = resolved.y;
    }

    // Soft player-to-player collision resolution so players don't penetrate
    resolvePlayerCollisions(Object.fromEntries(this.players), PLAYER_CONFIG.RADIUS);
  }

  /**
   * Core Flag Transfer & Contact Resolution.
   *
   * Rules enforced:
   * - Single flag in the match.
   * - ZERO cooldown: fresh contact transfers IMMEDIATELY.
   * - Active contact pair tracking: a single continuous contact does not spam duplicate transfers.
   * - Instant re-transfer on separation and re-touching.
   * - Transfer to a 3rd player while touching 1st player works immediately.
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
          // Stable pair key: order IDs alphabetically
          const pairKey = p1.id < p2.id ? `${p1.id}:${p2.id}` : `${p2.id}:${p1.id}`;
          currentFrameContacts.add(pairKey);

          // Check if either player is the flag holder
          const p1IsHolder = p1.id === this.flagHolderId;
          const p2IsHolder = p2.id === this.flagHolderId;

          if (p1IsHolder || p2IsHolder) {
            const holder = p1IsHolder ? p1 : p2;
            const target = p1IsHolder ? p2 : p1;

            // If this contact pair was NOT already active in the previous tick:
            // This is a FRESH contact -> Transfer flag IMMEDIATELY!
            if (!this.activeContacts.has(pairKey)) {
              this.executeFlagTransfer(holder, target, pairKey);
            }
          }
        }
      }
    }

    // Update active contacts set: pairs that separated are removed, re-arming fresh contact!
    this.activeContacts = currentFrameContacts;
  }

  /**
   * Executes an immediate, authoritative flag transfer.
   */
  executeFlagTransfer(passer, receiver, pairKey) {
    const previousHolderId = passer.id;
    const newHolderId = receiver.id;

    // 1. Award pass bonus to passer
    passer.score += this.scoringConfig.PASS_BONUS;
    const passerStat = this.stats.get(passer.id);
    if (passerStat) passerStat.passesMade++;

    // 2. Passer speed burst to escape (if active-play incentive enabled)
    if (this.scoringConfig.SPEED_BOOST_ON_PASS) {
      passer.speedBoostTimer = PLAYER_CONFIG.PASS_BOOST_DURATION;
    }

    // 3. Reset uninterrupted hold timer
    this.uninterruptedHoldTime = 0;

    // 4. Update flag ownership
    this.setFlagHolder(newHolderId, 'pass');

    // 5. Mark contact pair as active so continuous overlap does not re-transfer back
    this.activeContacts.add(pairKey);

    // 6. Broadcast event immediately for snappy client sound/particle effects
    this.emitToRoom(EVENTS.SERVER.FLAG_TRANSFERRED, {
      fromId: previousHolderId,
      toId: newHolderId,
      passBonus: this.scoringConfig.PASS_BONUS,
      passerScore: Math.round(passer.score),
      x: (passer.x + receiver.x) / 2,
      y: (passer.y + receiver.y) / 2,
    });
  }

  /**
   * Sets the authoritative flag holder.
   */
  setFlagHolder(socketId, reason = 'unknown') {
    this.flagHolderId = socketId;
    this.uninterruptedHoldTime = 0;
  }

  /**
   * Match ends when countdown timer hits 0.
   */
  endMatch() {
    this.status = ROOM_STATUS.ENDED;
    this.stopSimulation();

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
          holdBonuses: stat.holdBonuses || 0,
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

  // --- NETWORKING BROADCASTS ---

  /**
   * Broadcasts the light, high-frequency game snapshot (30 Hz).
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
      flagHolderId: this.flagHolderId,
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
