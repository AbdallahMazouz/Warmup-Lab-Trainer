// =====================================================================
// types.ts — Shared TypeScript interfaces and types
// =====================================================================

export type CategoryId =
  | 'flick' | 'tracking' | 'tactical'
  | 'flash' | 'reaction' | 'movement' | 'hybrid'
  | 'switching' | 'precision' | 'decision'
  | 'aimlab' | 'kovaaks';

export type DifficultyId = 'beginner' | 'intermediate' | 'advanced' | 'pro';

export type SpawnerMode =
  | 'random_area'
  | 'grid'
  | 'fixed_points'
  | 'random_arc'
  | 'peek'
  | 'respawn_on_kill'
  | 'sequential'
  | 'wave';

export interface SpawnerConfig {
  mode: SpawnerMode;
  spawnMode?: SpawnerMode;
  maxAlive: number;
  initialTargetCount?: number;
  respawnOnKill?: boolean;
  respawnDelayMs?: number;
  spawnIntervalMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  targetLifetimeSec?: number;
  targetLifetimeMs?: number;
  fixedPoints?: Vec3[];
  gridDimensions?: { rows: number; cols: number; spacingX: number; spacingY: number };
  arcDegrees?: number;
  waveSize?: number;
  spawnRadius?: number;
}

export type TargetKind = 'standard' | 'enemy' | 'friend';

export interface TargetConfig {
  hp?: number;
  multiShot?: boolean;   // if true: requires multiple hits to eliminate (spray-control dummy pattern)
  shape?: 'humanoid' | 'sphere';
  hitboxes?: {
    head: number;
    body: number;
    legs: number;
  };
  headshotOnly?: boolean;
  kind?: TargetKind;
  isFriendOrFoe?: boolean;
  fakePeekChance?: number;
  peekDurationSec?: number;
  sizeMultiplier?: number;
  retaliatory?: boolean;
  retaliateDelayMs?: number;
  retaliationPenalty?: number;
  shielded?: boolean;
}

export type WeaponPresetId = 'vandal' | 'phantom' | 'sheriff' | 'operator';

export interface WeaponConfig {
  preset: WeaponPresetId;
  requireCounterStrafe?: boolean;
  unlimitedAmmo?: boolean;
  enforceFireRate?: boolean;
}

export interface InteractionConfig {
  mode: 'click' | 'track';
  oneShotPerPeek?: boolean;
  oneShotPerTarget?: boolean;
  penalizeEarlyShot?: boolean;
  trackDps?: number;
}

export interface ScoringConfig {
  baseHitScore?: number;
  headshotBonus?: number;
  missPenalty?: number;
  speedBonusMax?: number;
  speedDecay?: number;
  earlyShotPenalty?: number;
  fakePeekShotPenalty?: number;
  friendlyFirePenalty?: number;
  missedEnemyPenalty?: number;
  counterStrafeBonus?: number;
  movingShotPenalty?: number;
  legShotPenalty?: number;
}

export interface EndConditionConfig {
  type: 'time' | 'target_count' | 'waves';
  targetCount?: number;
  waves?: number;
}

export interface EnvironmentConfig {
  type: 'arena' | 'corridor' | 'corner' | 'wide_open';
  customPlayerPos?: Vec3;
  customCover?: boolean;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  category: CategoryId;
  description: string;
  skill: string;
  difficulty: DifficultyId;
  durationSec: number;
  targetCount: number;
  targetSizeMultiplier: number;
  targetSpeedMultiplier: number;
  spawnRadius: number;
  movementPattern: MovementPattern;
  headLevel: boolean;
  flashEnabled: boolean;
  flashIntensity: number;
  flashDurationMs: number;
  requireSteadyAim: boolean;
  penalizeMiss: boolean;
  directionChangeMultiplier?: number;
  targetLifetimeSec?: number;
  meaningfulReactionTime: boolean;
  meaningfulTracking: boolean;
  allowInRoutines: boolean;
  supportedDifficulties?: DifficultyId[];
  configVersion?: number;

  // Modular engine configuration
  environment?: EnvironmentConfig;
  weapon?: WeaponConfig;
  spawner?: SpawnerConfig;
  target?: TargetConfig;
  interaction?: InteractionConfig;
  scoring?: ScoringConfig;
  end?: EndConditionConfig;
}

export type MovementPattern =
  | 'static'
  | 'strafe'
  | 'jiggle'
  | 'wander'
  | 'peek'
  | 'vertical'
  | 'variable'
  | 'mobility'
  | 'wideswing';

export type BodyPartType = 'head' | 'torso' | 'legs';

export interface HitRegionDimensions {
  shape?: 'humanoid' | 'sphere';
  headRadius: number;
  torsoRadius: number;
  torsoHeight: number;
  torsoOffsetY: number;
  headOffsetY?: number;
  legsRadius?: number;
  legsHeight?: number;
  legsOffsetY?: number;
}

export interface HitResult {
  hit: boolean;
  headshot: boolean;
  bodyPart?: BodyPartType;
  targetId: string;
  distanceMetres: number;
  reactionMs: number;
  accuracyScore: number; // 0-1, 1 = dead center
  damage?: number;
  killed?: boolean;
}

export interface SessionResult {
  id: string;
  scenarioId: string;
  scenarioName: string;
  category: CategoryId;
  difficulty: DifficultyId;
  timestamp: number;
  durationSec: number;
  score: number;
  hits: number;
  misses: number;
  headshots: number;
  bodyHits?: number;
  legHits?: number;
  shotsFired?: number;
  accuracy: number;           // 0-100 (%)
  headshotPct?: number;       // 0-100 (%)
  avgReactionMs: number;
  medianReactionMs: number;
  bestReactionMs: number;
  targetsPerSecond: number;
  targetsPerMinute?: number;
  shotsMoving?: number;
  shotsStationary?: number;
  timeOnTarget?: number;      // for tracking (0-100)
  flashAvoidRate?: number;    // for flash scenarios (0-100)
  friendlyFireCount?: number;
  missedEnemiesCount?: number;
  earlyShotsCount?: number;
  fakePeekShotsCount?: number;
  sprayAccuracy?: number;
  first10Accuracy?: number;
  decisionAccuracy?: number;
  overkillShots?: number;
  counterStrafeAccuracy?: number;
  timesShotByBot?: number;
  damageDealt?: number;
  damageTaken?: number;
  accuracyVsRetaliationPct?: number;
  counterStrafeEfficiencyPct?: number;
  eliminations?: number;
  configVersion?: number;
}

export interface PersonalBest {
  scenarioId: string;
  difficulty?: DifficultyId;
  score: number;
  accuracy: number;
  avgReactionMs: number;
  timestamp: number;
  configVersion?: number;
}

export interface TrainingRoutine {
  id: string;
  name: string;
  durationLabel: string;
  totalDurationSec: number;
  activeDurationSec: number;
  transitionDurationSec: number;
  totalElapsedSec: number;
  description: string;
  scenarioIds: string[];
}

export interface PlaylistEntry {
  id: string;
  scenarioId: string;
  durationSec: number;
  restIntervalSec?: number;
  configOverrides?: Partial<ScenarioConfig>;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  defaultRestIntervalSec: number;
  entries: PlaylistEntry[];
  createdAt?: number;
  updatedAt?: number;
  isBuiltin?: boolean;
}

export interface PlaylistValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RoutineSummary {
  id: string;
  routineId: string;
  routineName: string;
  difficulty: DifficultyId;
  timestamp: number;
  totalDurationSec: number;
  activeDurationSec?: number;
  totalElapsedSec?: number;
  transitionSec?: number;
  pausedSec?: number;
  retriesCount?: number;
  drillsCompleted: number;
  totalDrills: number;
  totalScore: number;
  overallAccuracy: number;
  totalHits: number;
  totalHeadshots: number;
  totalShotsFired: number;
  avgReactionMs?: number;
  isPlaylist?: boolean;
  completionRate?: number;
  skippedDrills?: number;
  drillResults?: Array<{
    scenarioId: string;
    scenarioName: string;
    score: number;
    accuracy: number;
    durationSec: number;
    hits?: number;
    headshots?: number;
  }>;
}

export interface ScenarioTrendResult {
  hasEnoughData: boolean;
  scenarioId: string;
  difficulty?: DifficultyId;
  configVersion?: number;
  sampleCount: number;
  latest?: SessionResult;
  previous?: SessionResult;
  scoreDelta?: number;
  accuracyDelta?: number | null;
  headshotDelta?: number | null;
  reactionDelta?: number | null;
  meaningfulReactionTime: boolean;
  recentScores: number[];
}

export interface BestScenarioMetric {
  scenarioId: string;
  scenarioName: string;
  category: CategoryId;
  bestScore: number;
  bestAccuracy: number;
  playCount: number;
  avgScore?: number;
}

export interface AggregateStats {
  totalDrills: number;
  totalRoutines: number;
  totalTimePlayedSec: number;
  overallAccuracy: number;
  overallHeadshotPct: number;
  totalHits: number;
  totalShots: number;
  totalHeadshots: number;
  shootingDrillsCount?: number;
  trackingDrillsCount?: number;
}

export interface HistoryExportEnvelope {
  version: 'vwt-history-v1';
  exportedAt: number;
  totalSessions: number;
  sessions: SessionResult[];
}

export interface WarmupLabScenarioV1 {
  $schema?: string;
  format: 'warmuplab-scenario';
  version: 1;
  id: string;
  name: string;
  description: string;
  author?: string;
  category: CategoryId;
  tags?: string[];
  difficulty: DifficultyId;
  durationSec: number;
  spawner: {
    mode: SpawnerMode;
    maxAlive: number;
    initialTargetCount?: number;
    respawnOnKill?: boolean;
    respawnDelayMs?: number;
    targetLifetimeSec?: number;
    spawnRadius?: number;
    fixedPoints?: Array<{ x: number; y: number; z: number }>;
    gridDimensions?: { rows: number; cols: number; spacingX: number; spacingY: number };
    arcDegrees?: number;
    waveSize?: number;
  };
  target: {
    shape: 'humanoid' | 'sphere';
    hp?: number;
    multiShot?: boolean;
    sizeMultiplier?: number;
    movementPattern: MovementPattern;
    speedMultiplier?: number;
    directionChangeMultiplier?: number;
    headLevel?: boolean;
    headshotOnly?: boolean;
    isFriendOrFoe?: boolean;
    fakePeekChance?: number;
    retaliatory?: boolean;
    retaliateDelayMs?: number;
    retaliationPenalty?: number;
    shielded?: boolean;
  };
  weapon?: {
    preset: WeaponPresetId;
    requireCounterStrafe?: boolean;
    unlimitedAmmo?: boolean;
    enforceFireRate?: boolean;
  };
  environment?: {
    type: 'arena' | 'corridor' | 'corner' | 'wide_open';
    customCover?: boolean;
    customPlayerPos?: { x: number; y: number; z: number };
  };
  interaction?: {
    mode: 'click' | 'track';
    oneShotPerPeek?: boolean;
    oneShotPerTarget?: boolean;
    trackDps?: number;
  };
  scoring?: {
    baseHitScore?: number;
    headshotBonus?: number;
    missPenalty?: number;
    speedBonusMax?: number;
    speedDecay?: number;
    counterStrafeBonus?: number;
    friendlyFirePenalty?: number;
    missedEnemyPenalty?: number;
    fakePeekShotPenalty?: number;
    movingShotPenalty?: number;
    legShotPenalty?: number;
  };
  endCondition?: {
    type: 'time' | 'target_count' | 'waves';
    targetCount?: number;
    waves?: number;
  };
  feedback?: {
    flashEnabled?: boolean;
    flashIntensity?: number;
    meaningfulReactionTime?: boolean;
    meaningfulTracking?: boolean;
  };
  metadata: {
    createdAt: number;
    updatedAt: number;
    configVersion: number;
    isCustom: true;
  };
}

export interface WarmupLabBackupV3 {
  format: 'warmuplab-backup';
  version: 3;
  exportedAt: string;
  clientVersion: string;
  data: {
    sessions: SessionResult[];
    personalBests: PersonalBest[];
    routineSummaries: RoutineSummary[];
    playlists: Playlist[];
    settings?: Settings;
  };
}

export interface WarmupLabBackupV4 {
  format: 'warmuplab-backup';
  version: 4;
  exportedAt: string;
  clientVersion: string;
  data: {
    sessions: SessionResult[];
    personalBests: PersonalBest[];
    routineSummaries: RoutineSummary[];
    playlists: Playlist[];
    customScenarios: WarmupLabScenarioV1[];
    settings?: Settings;
  };
}

export interface BackupImportResult {
  success: boolean;
  sessionsImported: number;
  pbsImported: number;
  routinesImported: number;
  playlistsImported: number;
  customScenariosImported?: number;
  settingsImported: boolean;
  errors: string[];
}

export interface ImportHistoryResult {
  success: boolean;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  totalBefore: number;
  totalAfter: number;
  retainedCount?: number;
  excludedByCapCount?: number;
  error?: string;
}

export interface FilterSessionsOptions {
  category?: string;
  difficulty?: DifficultyId | 'all';
  scenarioId?: string;
  sortBy?: 'date_desc' | 'date_asc' | 'score_desc' | 'score_asc' | 'accuracy_desc';
  page?: number;
  pageSize?: number;
}

export interface FilteredSessionsResult {
  sessions: SessionResult[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

// ── Training Intelligence & Recommendation Types ──────────────────────
export type SkillDimensionId =
  | 'flick_accuracy'
  | 'reaction_time'
  | 'headshot_discipline'
  | 'smooth_tracking'
  | 'steady_aim_discipline';

export interface SkillDimensionEvaluation {
  dimensionId: SkillDimensionId;
  name: string;
  description: string;
  score: number;              // 0-100 normalized score
  confidence: number;         // 0.0 to 1.0 based on sample size
  sampleCount: number;        // number of eligible sessions evaluated
  benchmark: number;          // reference target score (e.g. 70)
  isDeficit: boolean;         // score < benchmark and sampleCount >= minSamples
  evidenceSummary: string;    // human-readable measured values
  eligibleSessionIds: string[]; // traceable session IDs
}

export interface RecommendationResult {
  isColdStart: boolean;
  recommendationType: 'drill' | 'routine';
  recommendedScenarioId?: string;
  recommendedScenarioName?: string;
  recommendedRoutineId?: string;
  recommendedRoutineName?: string;
  targetDifficulty: DifficultyId;
  primaryDimension: SkillDimensionId | null;
  dimensionName?: string;
  confidence: number;         // 0.0 to 1.0
  title: string;
  rationale: string;
  evidence: string;
  benchmarkTarget: string;
  dimensionEvaluations: SkillDimensionEvaluation[];
}

export type { SoundProfileId } from './soundProfiles';

export type TargetTeam = 'enemy' | 'friendly' | 'neutral';

export interface SpawnEventPayload {
  targetId: string;
  position: Vec3;
  kind: TargetKind;
  hp?: number;
  maxHp?: number;
}

export interface HitEventPayload {
  targetId: string;
  hitZone: BodyPartType;
  damage: number;
  remainingHp: number;
  headshot: boolean;
  score: number;
  reactionMs: number;
  accuracyScore: number;
}

export interface HeadshotEventPayload extends HitEventPayload {
  headshot: true;
}

export interface KillEventPayload {
  targetId: string;
  hitZone: BodyPartType;
  headshot: boolean;
  position?: Vec3;
  streak: number;
  score: number;
  reactionMs: number;
}

export type MissReason =
  | 'aim_miss'
  | 'early_shot'
  | 'fake_peek'
  | 'friendly_fire'
  | 'movement_inaccurate'
  | 'headshot_only_violation'
  | 'retaliation_hit';

export interface MissEventPayload {
  reason: MissReason;
  penalty: number;
}

export interface EngineHUDState {
  timeRemaining: number;
  totalDuration: number;
  score: number;
  hits: number;
  misses: number;
  accuracy: number;
  headshots: number;
  fps: number;
  isTracking: boolean;
  isPaused?: boolean;
  shotsFired?: number;
  headshotPct?: number;
  playerSpeed?: number;
  isStationary?: boolean;
  activeKeys?: { w: boolean; a: boolean; s: boolean; d: boolean };
  threatProgress?: number;
}

export interface FlashEventPayload {
  intensity: number;
  durationMs: number;
}

export interface ScenarioCompleteEventPayload {
  result: SessionResult;
  isPB: boolean;
}

export interface RetaliationHitEventPayload {
  targetId: string;
  penalty: number;
}

export interface GameplayEventMap {
  onSpawn: SpawnEventPayload;
  onHit: HitEventPayload;
  onHeadshot: HeadshotEventPayload;
  onKill: KillEventPayload;
  onMiss: MissEventPayload;
  onTick: EngineHUDState;
  onFlash: FlashEventPayload;
  onScenarioComplete: ScenarioCompleteEventPayload;
  onMovementInaccurate: void;
  onRetaliationHit: RetaliationHitEventPayload;
}

export interface KillEvent {
  targetId: string;
  headshot: boolean;
  position?: { x: number; y: number; z: number };
  streak: number;
}

export interface Settings {
  sensitivity: number;
  fov: number;
  crosshairColor: string;
  crosshairSize: number;
  crosshairGap: number;
  crosshairThickness: number;
  crosshairDot: boolean;
  volume: number;
  sfxVolume: number;
  audioMuted: boolean;
  soundProfile: import('./soundProfiles').SoundProfileId;
  killStreakAudioEnabled: boolean;
  flashIntensity: number;
  reducedEffects: boolean;
  highContrast: boolean;
  showFps: boolean;
  showHitNumbers: boolean;
  invertY: boolean;
}

export interface Vec3 { x: number; y: number; z: number; }

export interface TargetState {
  id: string;
  position: Vec3;
  radius: number;
  velocity: Vec3;
  alive: boolean;
  spawnTime: number;
  pattern: MovementPattern;
  patternPhase: number;
  patternOrigin: Vec3;
  patternRange: number;
  patternSpeed: number;
  dimensions?: HitRegionDimensions;
  hp?: number;
  maxHp?: number;
  kind?: TargetKind;
  isFakePeek?: boolean;
}

export type PageId =
  | 'home' | 'scenarios' | 'plans' | 'stats' | 'settings' | 'creator';
