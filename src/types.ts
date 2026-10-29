// =====================================================================
// types.ts — Shared TypeScript interfaces and types
// =====================================================================

export type CategoryId =
  | 'flick' | 'tracking' | 'tactical'
  | 'flash' | 'reaction' | 'movement' | 'hybrid';

export type DifficultyId = 'beginner' | 'intermediate' | 'advanced' | 'pro';

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
}

export type MovementPattern =
  | 'static'
  | 'strafe'
  | 'jiggle'
  | 'wander'
  | 'peek'
  | 'vertical'
  | 'variable';

export type BodyPartType = 'head' | 'torso';

export interface HitRegionDimensions {
  headRadius: number;
  torsoRadius: number;
  torsoHeight: number;
  torsoOffsetY: number;
  headOffsetY?: number;
}

export interface HitResult {
  hit: boolean;
  headshot: boolean;
  bodyPart?: BodyPartType;
  targetId: string;
  distanceMetres: number;
  reactionMs: number;
  accuracyScore: number; // 0-1, 1 = dead center
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
}

export interface PersonalBest {
  scenarioId: string;
  difficulty?: DifficultyId;
  score: number;
  accuracy: number;
  avgReactionMs: number;
  timestamp: number;
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
}

export interface ScenarioTrendResult {
  hasEnoughData: boolean;
  scenarioId: string;
  difficulty?: DifficultyId;
  sampleCount: number;
  latest?: SessionResult;
  previous?: SessionResult;
  scoreDelta?: number;
  accuracyDelta?: number;
  headshotDelta?: number;
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
}

export type PageId =
  | 'home' | 'scenarios' | 'plans' | 'stats' | 'settings';
