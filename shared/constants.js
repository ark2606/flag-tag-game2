// Shared game constants, arena definitions, scoring rules, and network events

export const ARENA = {
  WIDTH: 1600,
  HEIGHT: 1000,
  WALL_THICKNESS: 24,
  BOUNDS_COLOR: 0x1e293b,
  FLOOR_COLOR: 0x0f172a,
  GRID_COLOR: 0x1e293b,
};

// Strategic rectangular obstacles distributed across the arena
// Coordinates are top-left x, y, width, height
export const OBSTACLES = [
  // Center structure: creates a circular chase loop around the middle
  { id: 'c_top', x: 680, y: 380, width: 240, height: 40 },
  { id: 'c_bot', x: 680, y: 580, width: 240, height: 40 },
  { id: 'c_mid_left', x: 620, y: 460, width: 40, height: 80 },
  { id: 'c_mid_right', x: 940, y: 460, width: 40, height: 80 },

  // Top-Left quadrant
  { id: 'tl_h', x: 200, y: 220, width: 220, height: 40 },
  { id: 'tl_v', x: 380, y: 260, width: 40, height: 160 },

  // Top-Right quadrant
  { id: 'tr_h', x: 1180, y: 220, width: 220, height: 40 },
  { id: 'tr_v', x: 1180, y: 260, width: 40, height: 160 },

  // Bottom-Left quadrant
  { id: 'bl_h', x: 200, y: 740, width: 220, height: 40 },
  { id: 'bl_v', x: 380, y: 580, width: 40, height: 160 },

  // Bottom-Right quadrant
  { id: 'br_h', x: 1180, y: 740, width: 220, height: 40 },
  { id: 'br_v', x: 1180, y: 580, width: 40, height: 160 },

  // Flanking pillars in upper and lower lanes
  { id: 'p_top_mid', x: 760, y: 150, width: 80, height: 80 },
  { id: 'p_bot_mid', x: 760, y: 770, width: 80, height: 80 },

  // Far side cover obstacles
  { id: 'side_left', x: 120, y: 460, width: 50, height: 120 },
  { id: 'side_right', x: 1430, y: 460, width: 50, height: 120 },
];

// Balanced spawn locations for up to 8 players, well-separated
export const SPAWN_POINTS = [
  { x: 140, y: 140 },
  { x: 1460, y: 860 },
  { x: 1460, y: 140 },
  { x: 140, y: 860 },
  { x: 800, y: 100 },
  { x: 800, y: 900 },
  { x: 120, y: 500 },
  { x: 1480, y: 500 },
];

export const PLAYER_CONFIG = {
  RADIUS: 24,
  BASE_SPEED: 320, // pixels per second
  PASS_BOOST_SPEED: 390, // brief boost speed when successfully passing flag
  PASS_BOOST_DURATION: 0.45, // seconds
  COLORS: [
    { name: 'Cyan', hex: 0x06b6d4, css: '#06b6d4' },
    { name: 'Amber', hex: 0xf59e0b, css: '#f59e0b' },
    { name: 'Emerald', hex: 0x10b981, css: '#10b981' },
    { name: 'Fuchsia', hex: 0xd946ef, css: '#d946ef' },
    { name: 'Rose', hex: 0xf43f5e, css: '#f43f5e' },
    { name: 'Indigo', hex: 0x6366f1, css: '#6366f1' },
    { name: 'Lime', hex: 0x84cc16, css: '#84cc16' },
    { name: 'Sky', hex: 0x38bdf8, css: '#38bdf8' },
  ],
};

// Central configurable scoring rules
export const SCORING_CONFIG = {
  STARTING_BONUS: 30,             // +30 to initial flag holder
  HOLDER_POINTS_PER_SEC: -2,      // -2 points/sec for flag holder
  NON_HOLDER_POINTS_PER_SEC: 1,   // +1 point/sec for every non-holder
  HOLD_BONUS_INTERVAL: 5.0,       // 5 seconds continuous hold
  HOLD_BONUS_POINTS: 8,           // +8 bonus points
  PASS_BONUS: 5,                  // +5 points to the player who passed it
  FINAL_HOLDER_PENALTY: -40,      // -40 points to player holding at match end

  // Active play incentives
  SPEED_BOOST_ON_PASS: true,      // small speed boost upon successful pass
  INACTIVITY_DETECTION: false,    // can flag AFK if desired
};

export const MATCH_CONFIG = {
  ROUND_DURATION: 90,             // default 90 seconds
  COUNTDOWN_DURATION: 3,          // 3 second start countdown
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  TICK_RATE: 30,                  // server simulation rate (30 Hz)
  SNAPSHOT_RATE: 20,              // client sync rate (20 Hz)
};

export const ROOM_STATUS = {
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  ENDED: 'ENDED',
};

export const EVENTS = {
  CLIENT: {
    CREATE_ROOM: 'room:create',
    JOIN_ROOM: 'room:join',
    LEAVE_ROOM: 'room:leave',
    START_GAME: 'game:start',
    REMATCH: 'game:rematch',
    RETURN_LOBBY: 'game:return_lobby',
    PLAYER_INPUT: 'player:input',
    PING: 'net:ping',
  },
  SERVER: {
    ROOM_CREATED: 'room:created',
    ROOM_JOINED: 'room:joined',
    ROOM_STATE: 'room:state',
    ROOM_ERROR: 'room:error',
    COUNTDOWN_TICK: 'game:countdown',
    GAME_STARTED: 'game:started',
    GAME_SNAPSHOT: 'game:snapshot',
    FLAG_TRANSFERRED: 'game:flag_transferred',
    HOLD_BONUS_AWARDED: 'game:hold_bonus',
    GAME_ENDED: 'game:ended',
    PONG: 'net:pong',
  },
};
