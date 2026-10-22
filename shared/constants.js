// Shared game constants, arena definitions, scoring rules, and network events

export const ARENA = {
  WIDTH: 1600,
  HEIGHT: 1000,
  WALL_THICKNESS: 24,
  GROUND_Y: 940, // Top of ground platform
  BOUNDS_COLOR: 0x1e293b,
  FLOOR_COLOR: 0x0f172a,
  GRID_COLOR: 0x1e293b,
};

// 2D Side-View Platform Physics Configuration
export const PHYSICS_CONFIG = {
  GRAVITY: 1600,              // px/s² downward acceleration (smooth, responsive arc)
  JUMP_VELOCITY: -860,        // px/s upward jump impulse (reaches up to ~230px, climbs easily)
  SPRING_IMPULSE: -1250,      // px/s high vertical launch from spring pads / tyres
  TERMINAL_VELOCITY: 1000,    // px/s maximum downward fall speed
  HORIZONTAL_SPEED: 440,      // px/s base horizontal movement speed
  DROP_DOWN_SPEED: 450,       // px/s downward velocity when dropping through platform
  COOLDOWN_AFTER_BOUNCE: 0.25,// seconds before spring pad can be re-triggered by same player
  TAG_REACH_RADIUS: 32,       // generous tag distance (32 + 32 = 64px) so touching players always pass
};

// 2D Side-View Platform Layout
// Platforms are defined as: { id, x, y, width, height, type: 'ground' | 'wood' | 'stone' | 'suspension' }
export const PLATFORMS = [
  // 1. Continuous Ground Floor (solid bedrock with neon hazard edge)
  { id: 'ground', x: 24, y: 940, width: 1552, height: 36, type: 'ground' },

  // Ground-to-Low Stepping Ledges (easy climb out of corners)
  { id: 'step_left', x: 30, y: 860, width: 90, height: 18, type: 'stone' },
  { id: 'step_right', x: 1480, y: 860, width: 90, height: 18, type: 'stone' },

  // 2. Lower Tier (y = 780): Left ledge, central suspension bridge, right ledge
  { id: 'low_left', x: 130, y: 780, width: 330, height: 20, type: 'wood' },
  { id: 'low_mid', x: 580, y: 780, width: 440, height: 20, type: 'suspension' },
  { id: 'low_right', x: 1140, y: 780, width: 330, height: 20, type: 'wood' },

  // Low-to-Mid Stepping Perches
  { id: 'step_mid_left', x: 470, y: 690, width: 100, height: 18, type: 'wood' },
  { id: 'step_mid_right', x: 1030, y: 690, width: 100, height: 18, type: 'wood' },

  // 3. Mid Tier (y = 600): Left roost, central island platform, right roost
  { id: 'mid_left', x: 180, y: 600, width: 280, height: 22, type: 'stone' },
  { id: 'mid_center', x: 580, y: 600, width: 440, height: 24, type: 'stone' },
  { id: 'mid_right', x: 1140, y: 600, width: 280, height: 22, type: 'stone' },

  // Mid-to-High Stepping Perches
  { id: 'step_high_left', x: 470, y: 510, width: 100, height: 18, type: 'wood' },
  { id: 'step_high_right', x: 1030, y: 510, width: 100, height: 18, type: 'wood' },

  // 4. High Tier (y = 420): Suspended bridges and watchtower perches
  { id: 'high_left', x: 100, y: 420, width: 350, height: 20, type: 'suspension' },
  { id: 'high_center_left', x: 540, y: 420, width: 220, height: 20, type: 'wood' },
  { id: 'high_center_right', x: 840, y: 420, width: 220, height: 20, type: 'wood' },
  { id: 'high_right', x: 1150, y: 420, width: 350, height: 20, type: 'suspension' },

  // 5. Summit Tier (y = 240): High-risk perch platforms for escape and air passes
  { id: 'summit_left', x: 300, y: 250, width: 240, height: 18, type: 'stone' },
  { id: 'summit_crown', x: 670, y: 230, width: 260, height: 20, type: 'stone' },
  { id: 'summit_right', x: 1060, y: 250, width: 240, height: 18, type: 'stone' },
];

// Backward-compatibility alias
export const OBSTACLES = PLATFORMS;

// Spring pads and tyre launchers (positioned slightly below surfaces for reliable walk-over detection)
export const SPRINGS = [
  { id: 'spring_g_left', x: 250, y: 935, width: 100, height: 20, impulse: -1250, label: 'Ground Left Tyre' },
  { id: 'spring_g_mid', x: 750, y: 935, width: 100, height: 20, impulse: -1250, label: 'Ground Center Tyre' },
  { id: 'spring_g_right', x: 1250, y: 935, width: 100, height: 20, impulse: -1250, label: 'Ground Right Tyre' },
  { id: 'spring_low_left', x: 360, y: 775, width: 90, height: 20, impulse: -1100, label: 'Lower Left Tyre' },
  { id: 'spring_low_right', x: 1150, y: 775, width: 90, height: 20, impulse: -1100, label: 'Lower Right Tyre' },
  { id: 'spring_mid_center', x: 755, y: 595, width: 90, height: 20, impulse: -1150, label: 'Summit Super Launcher' },
];

// Balanced spawn locations positioned directly on platform tops
export const SPAWN_POINTS = [
  { x: 180, y: 740 },
  { x: 1420, y: 740 },
  { x: 300, y: 560 },
  { x: 1300, y: 560 },
  { x: 800, y: 560 },
  { x: 200, y: 380 },
  { x: 1400, y: 380 },
  { x: 800, y: 190 },
];

export const PLAYER_CONFIG = {
  RADIUS: 24,
  BASE_SPEED: 440, // base horizontal speed (pixels per second)
  PASS_BOOST_SPEED: 550, // brief boost speed when successfully passing flag
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

// Speed adjustment configuration & presets (available before match start in lobby)
export const SPEED_CONFIG = {
  MIN_SPEED: 200,
  MAX_SPEED: 900,
  STEP: 40,
  DEFAULT_SPEED: 440,
  PRESETS: [
    { label: '0.8x', mult: 0.8, speed: 350, name: 'Slow' },
    { label: '1.0x', mult: 1.0, speed: 440, name: 'Normal' },
    { label: '1.3x', mult: 1.3, speed: 570, name: 'Fast' },
    { label: '1.6x', mult: 1.6, speed: 700, name: 'Turbo' },
    { label: '2.0x', mult: 2.0, speed: 880, name: 'Sonic' },
  ],
};

// Central configurable scoring rules (without the repetitive 5s hold bonus)
export const SCORING_CONFIG = {
  ROUND_DURATION: 120,            // default 120 seconds (2 mins)
  STARTING_BONUS: 30,             // +30 to initial flag holder
  HOLDER_POINTS_PER_SEC: -2,      // -2 points/sec for flag holder
  NON_HOLDER_POINTS_PER_SEC: 1,   // +1 point/sec for every non-holder
  PASS_BONUS: 5,                  // +5 points to the player who passed it
  FINAL_HOLDER_PENALTY: -40,      // -40 points to player holding at match end
  SPEED_BOOST_ON_PASS: true,      // speed boost upon successful pass
};

// Unpredictable temporary scoring phases scheduled during rounds
export const PHASE_CONFIG = {
  MIN_PHASES: 2,
  MAX_PHASES: 3,
  PHASE_DURATION: 12,             // 12 seconds per phase
  WARNING_DURATION: 5,            // 5-second advance warning before phase starts
  MIN_INTERVAL: 20,               // minimum 20 seconds between consecutive phases
  TYPES: [
    {
      id: 'DOUBLE_PASS',
      name: '⚡ DOUBLE PASS!',
      description: 'Pass bonus doubled (+10 points per pass)!',
      passBonusMultiplier: 2.0,
      holderMultiplier: 1.0,
      nonHolderMultiplier: 1.0,
    },
    {
      id: 'DOUBLE_SURVIVAL',
      name: '🛡️ DOUBLE SURVIVAL!',
      description: 'Non-holders earn +2 points per second!',
      passBonusMultiplier: 1.0,
      holderMultiplier: 1.0,
      nonHolderMultiplier: 2.0,
    },
    {
      id: 'FLAG_FRENZY',
      name: '🔥 FLAG FRENZY!',
      description: 'Holder drains -4/s, but passing grants +15 points!',
      passBonusMultiplier: 3.0,
      holderMultiplier: 2.0,
      nonHolderMultiplier: 1.0,
    },
  ],
};

export const MATCH_CONFIG = {
  ROUND_DURATION: 120,            // default 120 seconds
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
    CHANGE_SPEED: 'room:change_speed',
    CHANGE_SETTINGS: 'room:change_settings',
    TOSS_FLAG: 'game:toss_flag',
    PING: 'net:ping',
  },
  SERVER: {
    ROOM_CREATED: 'room:created',
    ROOM_JOINED: 'room:joined',
    ROOM_STATE: 'room:state',
    ROOM_ERROR: 'room:error',
    PLAYER_LEFT: 'room:player_left',
    LEFT_ALONE: 'room:left_alone',
    COUNTDOWN_TICK: 'game:countdown',
    GAME_STARTED: 'game:started',
    GAME_SNAPSHOT: 'game:snapshot',
    FLAG_TRANSFERRED: 'game:flag_transferred',
    GAME_ENDED: 'game:ended',
    SPEED_UPDATED: 'room:speed_updated',
    FLAG_TOSS: 'game:flag_toss',
    PHASE_WARNING: 'game:phase_warning',
    PHASE_STARTED: 'game:phase_started',
    PHASE_ENDED: 'game:phase_ended',
    SPRING_TRIGGERED: 'game:spring_triggered',
    PONG: 'net:pong',
  },
};
