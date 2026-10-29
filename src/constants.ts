// =====================================================================
// constants.ts — Global game constants
// =====================================================================

export const GAME_VERSION = '1.0.0';

// Rendering
export const FOV_DEFAULT = 103;
export const FOV_MIN = 60;
export const FOV_MAX = 120;
export const NEAR_PLANE = 0.05;
export const FAR_PLANE  = 500;

// Player
export const PLAYER_HEIGHT  = 1.7;
export const PLAYER_SPEED   = 5.0;  // m/s
export const PLAYER_SPRINT  = 8.0;
export const GRAVITY        = -18.0;
export const JUMP_FORCE     = 7.0;

// Mouse
export const SENS_DEFAULT   = 0.12;   // deg/pixel
export const SENS_MIN       = 0.01;
export const SENS_MAX       = 2.0;

// Targets
export const TARGET_SIZE_DEFAULT    = 0.22; // sphere radius metres
export const TARGET_SIZE_MICRO      = 0.10;
export const TARGET_SIZE_LARGE      = 0.40;
export const TARGET_HIT_FLASH_MS    = 180;
export const TARGET_SPAWN_DIST_MIN  = 4.0;
export const TARGET_SPAWN_DIST_MAX  = 18.0;
export const HEAD_LEVEL_Y           = PLAYER_HEIGHT - 0.12; // approx head

// Segmented target dimensions (baseline for 1.0 scale)
export const TARGET_HEAD_RADIUS     = 0.13; // head sphere radius (metres)
export const TARGET_TORSO_RADIUS    = 0.18; // torso cylinder radius (metres)
export const TARGET_TORSO_HEIGHT    = 0.50; // torso cylinder height (metres)
export const TARGET_TORSO_OFFSET_Y  = -0.38; // torso center Y relative to head (metres)

// Colours
export const COL_TARGET_IDLE   = 0xff4655;
export const COL_TARGET_HIT    = 0x00ff88;
export const COL_TARGET_WARN   = 0xffa020;
export const COL_ARENA_FLOOR   = 0x1a1a28;
export const COL_ARENA_WALL    = 0x101018;
export const COL_ARENA_CEIL    = 0x0f0f1a;
export const COL_GRID          = 0x2a2a45;
export const COL_AMBIENT       = 0x303050;
export const COL_FOG           = 0x080810;

// Scoring
export const SCORE_HIT         = 100;
export const SCORE_HEADSHOT    = 50;   // bonus
export const SCORE_MISS        = -25;
export const SCORE_SPEED_MAX   = 300;  // bonus for sub-200ms
export const SCORE_SPEED_DECAY = 0.4;  // points lost per ms

// Flash
export const FLASH_DEFAULT_INTENSITY = 0.85;
export const FLASH_DEFAULT_DURATION  = 1800;  // ms full-white

// Scenario durations (seconds)
export const DURATION_SHORT  = 30;
export const DURATION_MEDIUM = 60;
export const DURATION_LONG   = 120;

// LocalStorage keys
export const LS_SETTINGS    = 'vwt_settings_v2';
export const LS_SESSIONS    = 'vwt_sessions_v2';
export const LS_PERSONAL_BESTS = 'vwt_pbs_v2';
export const LS_ROUTINES    = 'vwt_routines_v2';

// Category IDs
export const CAT_FLICK     = 'flick';
export const CAT_TRACKING  = 'tracking';
export const CAT_TACTICAL  = 'tactical';
export const CAT_FLASH     = 'flash';
export const CAT_REACTION  = 'reaction';
export const CAT_MOVEMENT  = 'movement';
export const CAT_HYBRID    = 'hybrid';
