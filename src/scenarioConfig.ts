// =====================================================================
// scenarioConfig.ts — Scenario Configuration Validation & Resolution
// =====================================================================

import type {
  ScenarioConfig,
  SpawnerConfig,
  TargetConfig,
  WeaponConfig,
  InteractionConfig,
  ScoringConfig,
  EndConditionConfig,
  EnvironmentConfig,
  SpawnerMode,
  MovementPattern,
  WarmupLabScenarioV1,
} from './types';
import {
  SCORE_HIT,
  SCORE_HEADSHOT,
  SCORE_MISS,
  SCORE_SPEED_MAX,
  SCORE_SPEED_DECAY,
} from './constants';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ResolvedScenarioConfig extends ScenarioConfig {
  environment: Required<EnvironmentConfig>;
  weapon: Required<WeaponConfig>;
  spawner: Required<SpawnerConfig>;
  target: Required<TargetConfig>;
  interaction: Required<InteractionConfig>;
  scoring: Required<ScoringConfig>;
  end: Required<EndConditionConfig>;
}

const VALID_SPAWNER_MODES: SpawnerMode[] = [
  'random_area',
  'grid',
  'fixed_points',
  'random_arc',
  'peek',
  'respawn_on_kill',
  'sequential',
  'wave',
];

const VALID_WEAPONS = ['vandal', 'phantom', 'sheriff', 'operator'];

export function validateScenarioConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object'] };
  }

  const c = config as Partial<ScenarioConfig>;

  if (typeof c.id !== 'string' || c.id.trim() === '') {
    errors.push('Scenario "id" is required and must be a non-empty string');
  }

  if (typeof c.name !== 'string' || c.name.trim() === '') {
    errors.push('Scenario "name" is required and must be a non-empty string');
  }

  if (typeof c.durationSec !== 'number' || c.durationSec <= 0 || isNaN(c.durationSec)) {
    errors.push('Scenario "durationSec" must be a positive number');
  }

  if (typeof c.targetCount !== 'number' || c.targetCount < 1 || isNaN(c.targetCount)) {
    errors.push('Scenario "targetCount" must be at least 1');
  }

  if (c.spawner) {
    const spawnerMode = c.spawner.spawnMode ?? c.spawner.mode;
    if (!VALID_SPAWNER_MODES.includes(spawnerMode)) {
      errors.push(`Invalid spawner mode: "${spawnerMode}". Supported: ${VALID_SPAWNER_MODES.join(', ')}`);
    }
    if (typeof c.spawner.maxAlive !== 'number' || c.spawner.maxAlive < 1) {
      errors.push('spawner.maxAlive must be at least 1');
    }
  }

  if (c.weapon && c.weapon.preset && !VALID_WEAPONS.includes(c.weapon.preset)) {
    errors.push(`Invalid weapon preset: "${c.weapon.preset}". Supported: ${VALID_WEAPONS.join(', ')}`);
  }

  if (c.target && c.target.hp !== undefined && (typeof c.target.hp !== 'number' || c.target.hp < 0)) {
    errors.push('target.hp must be a non-negative number if specified');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function resolveScenarioConfig(raw: ScenarioConfig): ResolvedScenarioConfig {
  const isTracking = raw.category === 'tracking' || raw.meaningfulTracking;

  // Environment fallback
  const envType = raw.environment?.type ?? (
    raw.id === 'headline'
      ? 'corridor'
      : (raw.id.includes('peek') || raw.id === 'tactical-jiggle' || raw.id === 'tactical-wideswing' || raw.id === 'flash-pop')
        ? 'corner'
        : 'arena'
  );

  const environment: Required<EnvironmentConfig> = {
    type: envType,
    customPlayerPos: raw.environment?.customPlayerPos ?? { x: 0, y: 1.7, z: 0 },
    customCover: raw.environment?.customCover ?? (envType === 'corner'),
  };

  // Weapon fallback
  const weaponPreset = raw.weapon?.preset ?? (
    raw.id === 'operator-flick'
      ? 'operator'
      : raw.id === 'friend-or-foe'
        ? 'sheriff'
        : 'vandal'
  );

  const weapon: Required<WeaponConfig> = {
    preset: weaponPreset,
    requireCounterStrafe: raw.weapon?.requireCounterStrafe ?? raw.requireSteadyAim ?? false,
    unlimitedAmmo: raw.weapon?.unlimitedAmmo ?? (raw.id !== 'spray-control'),
    enforceFireRate: raw.weapon?.enforceFireRate ?? (weaponPreset === 'operator' || raw.id === 'spray-control'),
  };

  // Spawner fallback
  let defaultSpawnerMode: SpawnerMode = 'respawn_on_kill';
  if (raw.spawner?.spawnMode || raw.spawner?.mode) {
    defaultSpawnerMode = raw.spawner.spawnMode ?? raw.spawner.mode;
  } else if (raw.id === 'operator-flick') {
    defaultSpawnerMode = 'random_arc';
  } else if (raw.id === 'spray-control') {
    defaultSpawnerMode = 'fixed_points';
  } else if (raw.movementPattern === 'peek' || raw.id.includes('peek') || raw.id === 'tactical-jiggle') {
    defaultSpawnerMode = 'peek';
  } else if (raw.movementPattern === 'static') {
    defaultSpawnerMode = 'random_area';
  }

  const rawSpawner = raw.spawner;
  const spawnerMode = rawSpawner?.spawnMode ?? rawSpawner?.mode ?? defaultSpawnerMode;
  const maxAlive = rawSpawner?.maxAlive ?? raw.targetCount ?? 1;
  const initialTargetCount = rawSpawner?.initialTargetCount ?? maxAlive;
  const respawnOnKill = rawSpawner?.respawnOnKill ?? (spawnerMode !== 'wave' && spawnerMode !== 'peek');
  const respawnDelayMs = rawSpawner?.respawnDelayMs ?? 0;
  const targetLifetimeSec = rawSpawner?.targetLifetimeSec ?? (rawSpawner?.targetLifetimeMs ? rawSpawner.targetLifetimeMs / 1000 : (raw.targetLifetimeSec ?? 0));
  const targetLifetimeMs = rawSpawner?.targetLifetimeMs ?? (targetLifetimeSec > 0 ? Math.round(targetLifetimeSec * 1000) : 0);

  const spawner: Required<SpawnerConfig> = {
    mode: spawnerMode,
    spawnMode: spawnerMode,
    maxAlive,
    initialTargetCount,
    respawnOnKill,
    respawnDelayMs,
    spawnIntervalMs: rawSpawner?.spawnIntervalMs ?? 0,
    minDelayMs: rawSpawner?.minDelayMs ?? 400,
    maxDelayMs: rawSpawner?.maxDelayMs ?? 1500,
    targetLifetimeSec,
    targetLifetimeMs,
    fixedPoints: rawSpawner?.fixedPoints ?? [{ x: 0, y: 1.7, z: -12 }],
    gridDimensions: rawSpawner?.gridDimensions ?? { rows: 2, cols: 3, spacingX: 2.5, spacingY: 1.2 },
    arcDegrees: rawSpawner?.arcDegrees ?? 120,
    waveSize: rawSpawner?.waveSize ?? (spawnerMode === 'wave' ? maxAlive : 1),
    spawnRadius: rawSpawner?.spawnRadius ?? raw.spawnRadius ?? 10,
  };

  // Target fallback
  const target: Required<TargetConfig> = {
    hp: raw.target?.hp ?? (raw.id === 'spray-control' ? 400 : 100),
    multiShot: raw.target?.multiShot ?? (raw.id === 'spray-control'),
    shape: raw.target?.shape ?? (raw.id.startsWith('aimlab-') || raw.id.startsWith('kovaaks-') ? 'sphere' : 'humanoid'),
    hitboxes: raw.target?.hitboxes ?? {
      head: 4.0,
      body: 1.0,
      legs: 0.85,
    },
    headshotOnly: raw.target?.headshotOnly ?? (raw.id === 'headline'),
    kind: raw.target?.kind ?? 'standard',
    isFriendOrFoe: raw.target?.isFriendOrFoe ?? (raw.id === 'friend-or-foe'),
    fakePeekChance: raw.target?.fakePeekChance ?? (raw.id === 'jiggle-reading' ? 0.5 : 0),
    peekDurationSec: raw.target?.peekDurationSec ?? 0.8,
    sizeMultiplier: raw.target?.sizeMultiplier ?? raw.targetSizeMultiplier ?? 1.0,
    retaliatory: raw.target?.retaliatory ?? (raw.id.includes('skirmish') || raw.id === 'tactical-skirmish'),
    retaliateDelayMs: raw.target?.retaliateDelayMs ?? 850,
    retaliationPenalty: raw.target?.retaliationPenalty ?? 250,
    shielded: raw.target?.shielded ?? false,
  };

  // Interaction fallback
  const interaction: Required<InteractionConfig> = {
    mode: raw.interaction?.mode ?? (isTracking ? 'track' : 'click'),
    oneShotPerPeek: raw.interaction?.oneShotPerPeek ?? (raw.id === 'peek-and-tap'),
    oneShotPerTarget: raw.interaction?.oneShotPerTarget ?? (raw.id === 'operator-flick'),
    penalizeEarlyShot: raw.interaction?.penalizeEarlyShot ?? (raw.id === 'peek-and-tap'),
    trackDps: raw.interaction?.trackDps ?? 35,
  };

  // Scoring fallback
  const scoring: Required<ScoringConfig> = {
    baseHitScore: raw.scoring?.baseHitScore ?? SCORE_HIT,
    headshotBonus: raw.scoring?.headshotBonus ?? SCORE_HEADSHOT,
    missPenalty: raw.scoring?.missPenalty ?? (raw.penalizeMiss ? SCORE_MISS : 0),
    speedBonusMax: raw.scoring?.speedBonusMax ?? SCORE_SPEED_MAX,
    speedDecay: raw.scoring?.speedDecay ?? SCORE_SPEED_DECAY,
    earlyShotPenalty: raw.scoring?.earlyShotPenalty ?? (raw.id === 'peek-and-tap' ? -200 : 0),
    fakePeekShotPenalty: raw.scoring?.fakePeekShotPenalty ?? (raw.id === 'jiggle-reading' ? -250 : 0),
    friendlyFirePenalty: raw.scoring?.friendlyFirePenalty ?? (raw.id === 'friend-or-foe' ? -500 : 0),
    missedEnemyPenalty: raw.scoring?.missedEnemyPenalty ?? (raw.id === 'friend-or-foe' ? -100 : 0),
    counterStrafeBonus: raw.scoring?.counterStrafeBonus ?? (raw.id.includes('counter-strafe') ? 150 : 0),
    movingShotPenalty: raw.scoring?.movingShotPenalty ?? (raw.requireSteadyAim ? -100 : 0),
    legShotPenalty: raw.scoring?.legShotPenalty ?? (raw.id === 'headline' ? -150 : 0),
  };

  // End condition fallback
  const end: Required<EndConditionConfig> = {
    type: raw.end?.type ?? 'time',
    targetCount: raw.end?.targetCount ?? 0,
    waves: raw.end?.waves ?? 0,
  };

  return {
    ...raw,
    environment,
    weapon,
    spawner,
    target,
    interaction,
    scoring,
    end,
  };
}

const VALID_MOVEMENT_PATTERNS: MovementPattern[] = [
  'static',
  'strafe',
  'jiggle',
  'wander',
  'peek',
  'vertical',
  'variable',
  'mobility',
  'wideswing',
];

const VALID_CUSTOM_CATEGORIES: readonly string[] = [
  'flick',
  'tracking',
  'tactical',
  'flash',
  'reaction',
  'movement',
  'hybrid',
  'switching',
  'precision',
  'decision',
  'aimlab',
  'kovaaks',
  'custom',
];

export function validateCustomScenarioJSON(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Scenario payload must be a non-null JSON object'] };
  }

  // Reject prototype pollution
  if (Object.prototype.hasOwnProperty.call(input, '__proto__') || Object.prototype.hasOwnProperty.call(input, 'constructor')) {
    return { valid: false, errors: ['Disallowed property detected in scenario payload'] };
  }

  const s = input as Partial<WarmupLabScenarioV1>;

  if (s.format !== 'warmuplab-scenario') {
    errors.push('Invalid format identifier: must be "warmuplab-scenario"');
  }

  if (s.version !== 1) {
    errors.push(`Unsupported schema version: ${s.version ?? 'undefined'}. Only version 1 is currently supported.`);
  }

  if (typeof s.id !== 'string' || !s.id.trim()) {
    errors.push('Scenario ID is required and must be a non-empty string');
  } else if (!s.id.startsWith('custom_')) {
    errors.push('Custom scenario ID must start with "custom_" prefix');
  } else if (!/^custom_[a-zA-Z0-9_-]{1,64}$/.test(s.id)) {
    errors.push('Custom scenario ID must contain only alphanumeric characters, underscores, or hyphens (max 64 characters)');
  }

  if (s.category !== undefined) {
    if (typeof s.category !== 'string' || !VALID_CUSTOM_CATEGORIES.includes(s.category.toLowerCase())) {
      errors.push(`Invalid scenario category: "${s.category}". Supported: ${VALID_CUSTOM_CATEGORIES.join(', ')}`);
    }
  }

  if (typeof s.name !== 'string' || !s.name.trim()) {
    errors.push('Scenario name is required');
  } else if (s.name.trim().length > 80) {
    errors.push('Scenario name cannot exceed 80 characters');
  }

  if (typeof s.durationSec !== 'number' || !Number.isFinite(s.durationSec) || s.durationSec < 5 || s.durationSec > 600) {
    errors.push('Scenario duration must be a number between 5 and 600 seconds');
  }

  if (s.description !== undefined) {
    if (typeof s.description !== 'string') {
      errors.push('Scenario description must be a string');
    } else if (s.description.length > 500) {
      errors.push('Scenario description cannot exceed 500 characters');
    }
  }

  if (!s.spawner || typeof s.spawner !== 'object') {
    errors.push('Spawner configuration block is required');
  } else {
    if (!VALID_SPAWNER_MODES.includes(s.spawner.mode)) {
      errors.push(`Invalid spawner mode: "${s.spawner.mode}". Supported: ${VALID_SPAWNER_MODES.join(', ')}`);
    }
    if (typeof s.spawner.maxAlive !== 'number' || s.spawner.maxAlive < 1 || s.spawner.maxAlive > 20) {
      errors.push('spawner.maxAlive must be between 1 and 20');
    }
    if (s.spawner.spawnRadius !== undefined && (typeof s.spawner.spawnRadius !== 'number' || s.spawner.spawnRadius < 2 || s.spawner.spawnRadius > 40)) {
      errors.push('spawner.spawnRadius must be between 2 and 40 metres');
    }

    // Mode-specific spawner validations
    if (s.spawner.mode === 'grid') {
      if (!s.spawner.gridDimensions || typeof s.spawner.gridDimensions !== 'object') {
        errors.push('spawner.gridDimensions is required for "grid" mode');
      } else {
        const { rows, cols, spacingX, spacingY } = s.spawner.gridDimensions;
        if (typeof rows !== 'number' || !Number.isFinite(rows) || rows < 1 || rows > 20 || !Number.isInteger(rows)) {
          errors.push('gridDimensions.rows must be an integer between 1 and 20');
        }
        if (typeof cols !== 'number' || !Number.isFinite(cols) || cols < 1 || cols > 20 || !Number.isInteger(cols)) {
          errors.push('gridDimensions.cols must be an integer between 1 and 20');
        }
        if (typeof spacingX !== 'number' || !Number.isFinite(spacingX) || spacingX <= 0 || spacingX > 20) {
          errors.push('gridDimensions.spacingX must be a positive number up to 20');
        }
        if (typeof spacingY !== 'number' || !Number.isFinite(spacingY) || spacingY <= 0 || spacingY > 20) {
          errors.push('gridDimensions.spacingY must be a positive number up to 20');
        }
      }
    } else if (s.spawner.mode === 'fixed_points') {
      if (!Array.isArray(s.spawner.fixedPoints) || s.spawner.fixedPoints.length === 0) {
        errors.push('spawner.fixedPoints must be a non-empty array for "fixed_points" mode');
      } else {
        for (let i = 0; i < s.spawner.fixedPoints.length; i++) {
          const pt = s.spawner.fixedPoints[i];
          if (!pt || typeof pt !== 'object' || typeof pt.x !== 'number' || typeof pt.y !== 'number' || typeof pt.z !== 'number' ||
              !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) {
            errors.push(`spawner.fixedPoints[${i}] must have finite numeric x, y, and z coordinates`);
            break;
          }
        }
      }
    } else if (s.spawner.mode === 'random_arc') {
      if (typeof s.spawner.arcDegrees !== 'number' || !Number.isFinite(s.spawner.arcDegrees) || s.spawner.arcDegrees <= 0 || s.spawner.arcDegrees > 360) {
        errors.push('spawner.arcDegrees must be a number between 1 and 360 for "random_arc" mode');
      }
    }
  }

  if (!s.target || typeof s.target !== 'object') {
    errors.push('Target configuration block is required');
  } else {
    if (s.target.shape && s.target.shape !== 'humanoid' && s.target.shape !== 'sphere') {
      errors.push('target.shape must be "humanoid" or "sphere"');
    }
    if (!VALID_MOVEMENT_PATTERNS.includes(s.target.movementPattern)) {
      errors.push(`Invalid target movementPattern: "${s.target.movementPattern}". Supported: ${VALID_MOVEMENT_PATTERNS.join(', ')}`);
    }
    if (s.target.sizeMultiplier !== undefined && (typeof s.target.sizeMultiplier !== 'number' || s.target.sizeMultiplier < 0.2 || s.target.sizeMultiplier > 3.0)) {
      errors.push('target.sizeMultiplier must be between 0.2 and 3.0');
    }
    if (s.target.speedMultiplier !== undefined && (typeof s.target.speedMultiplier !== 'number' || s.target.speedMultiplier < 0 || s.target.speedMultiplier > 4.0)) {
      errors.push('target.speedMultiplier must be between 0 and 4.0');
    }
  }

  if (s.weapon && s.weapon.preset && !VALID_WEAPONS.includes(s.weapon.preset)) {
    errors.push(`Invalid weapon preset: "${s.weapon.preset}". Supported: ${VALID_WEAPONS.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function convertCustomScenarioToConfig(custom: WarmupLabScenarioV1): ScenarioConfig {
  const isTracking = custom.category === 'tracking' || custom.interaction?.mode === 'track';

  const config: ScenarioConfig = {
    id: custom.id,
    name: custom.name,
    category: custom.category,
    description: custom.description || 'Custom user-created training scenario',
    skill: custom.tags && custom.tags.length > 0 ? custom.tags.join(', ') : 'Custom Aim Drill',
    difficulty: custom.difficulty,
    durationSec: custom.durationSec,
    configVersion: custom.metadata?.configVersion || 1,
    targetCount: custom.spawner.maxAlive,
    targetSizeMultiplier: custom.target.sizeMultiplier ?? 1.0,
    targetSpeedMultiplier: custom.target.speedMultiplier ?? 1.0,
    spawnRadius: custom.spawner.spawnRadius ?? 10,
    movementPattern: custom.target.movementPattern,
    headLevel: custom.target.headLevel ?? true,
    flashEnabled: custom.feedback?.flashEnabled ?? false,
    flashIntensity: custom.feedback?.flashIntensity ?? 0,
    flashDurationMs: 0,
    requireSteadyAim: custom.weapon?.requireCounterStrafe ?? false,
    penalizeMiss: (custom.scoring?.missPenalty ?? 0) < 0,
    directionChangeMultiplier: custom.target.directionChangeMultiplier ?? 1.0,
    targetLifetimeSec: custom.spawner.targetLifetimeSec,
    meaningfulReactionTime: custom.feedback?.meaningfulReactionTime ?? true,
    meaningfulTracking: custom.feedback?.meaningfulTracking ?? isTracking,
    allowInRoutines: true,

    // Modular sub-configs
    spawner: {
      mode: custom.spawner.mode,
      spawnMode: custom.spawner.mode,
      maxAlive: custom.spawner.maxAlive,
      initialTargetCount: custom.spawner.initialTargetCount ?? custom.spawner.maxAlive,
      respawnOnKill: custom.spawner.respawnOnKill ?? true,
      respawnDelayMs: custom.spawner.respawnDelayMs ?? 0,
      targetLifetimeSec: custom.spawner.targetLifetimeSec,
      spawnRadius: custom.spawner.spawnRadius ?? 10,
      fixedPoints: custom.spawner.fixedPoints,
      gridDimensions: custom.spawner.gridDimensions,
      arcDegrees: custom.spawner.arcDegrees,
      waveSize: custom.spawner.waveSize,
    },
    target: {
      shape: custom.target.shape,
      hp: custom.target.hp,
      multiShot: custom.target.multiShot,
      sizeMultiplier: custom.target.sizeMultiplier ?? 1.0,
      headshotOnly: custom.target.headshotOnly,
      isFriendOrFoe: custom.target.isFriendOrFoe,
      fakePeekChance: custom.target.fakePeekChance,
      retaliatory: custom.target.retaliatory,
      retaliateDelayMs: custom.target.retaliateDelayMs,
      retaliationPenalty: custom.target.retaliationPenalty,
      shielded: custom.target.shielded,
    },
    weapon: custom.weapon ? {
      preset: custom.weapon.preset,
      requireCounterStrafe: custom.weapon.requireCounterStrafe,
      unlimitedAmmo: custom.weapon.unlimitedAmmo,
      enforceFireRate: custom.weapon.enforceFireRate,
    } : undefined,
    environment: custom.environment ? {
      type: custom.environment.type,
      customCover: custom.environment.customCover,
      customPlayerPos: custom.environment.customPlayerPos,
    } : undefined,
    interaction: custom.interaction ? {
      mode: custom.interaction.mode,
      oneShotPerPeek: custom.interaction.oneShotPerPeek,
      oneShotPerTarget: custom.interaction.oneShotPerTarget,
      trackDps: custom.interaction.trackDps,
    } : undefined,
    scoring: custom.scoring ? {
      baseHitScore: custom.scoring.baseHitScore,
      headshotBonus: custom.scoring.headshotBonus,
      missPenalty: custom.scoring.missPenalty,
      speedBonusMax: custom.scoring.speedBonusMax,
      speedDecay: custom.scoring.speedDecay,
      counterStrafeBonus: custom.scoring.counterStrafeBonus,
      friendlyFirePenalty: custom.scoring.friendlyFirePenalty,
      missedEnemyPenalty: custom.scoring.missedEnemyPenalty,
      fakePeekShotPenalty: custom.scoring.fakePeekShotPenalty,
      movingShotPenalty: custom.scoring.movingShotPenalty,
      legShotPenalty: custom.scoring.legShotPenalty,
    } : undefined,
    end: custom.endCondition ? {
      type: custom.endCondition.type,
      targetCount: custom.endCondition.targetCount,
      waves: custom.endCondition.waves,
    } : undefined,
  };

  return config;
}

export const STARTER_TEMPLATES = [
  'static_flick',
  'tracking_smooth',
  'tactical_peek',
  'retaliatory_duel',
] as const;
export type StarterTemplateId = typeof STARTER_TEMPLATES[number];

/**
 * Determines whether configuration changes between two scenario versions materially affect scoring fairness.
 *
 * Scoring Fairness Policy:
 * 1. Material Changes (Require PB reset to preserve leaderboards/competitive integrity):
 *    - Duration change: Alters the time available to accumulate points.
 *    - Spawner geometry and density: Changes target density (maxAlive, spawnRadius, respawnDelay, targetLifetime).
 *    - Target kinematics and hitboxes: Alters difficulty (shape, HP, sizeMultiplier, movementPattern, speedMultiplier, headLevel).
 *    - Weapon & mechanics constraints: Changes weapon profile or enforces counter-strafing.
 *    - Scoring weights: Any change to base hit score, headshot bonus, miss penalty, speed bonus, or counter-strafe bonus.
 *
 * 2. Non-Material Changes (Preserve PBs across saves):
 *    - Cosmetic metadata: Scenario name, descriptive text, tags, author name, or timestamps.
 */
export function hasMaterialConfigChanges(
  original: WarmupLabScenarioV1,
  updated: WarmupLabScenarioV1
): boolean {
  if (original.durationSec !== updated.durationSec) return true;
  if (original.category !== updated.category) return true;

  // Spawner parameters
  const s1 = original.spawner;
  const s2 = updated.spawner;
  if (s1.mode !== s2.mode || s1.maxAlive !== s2.maxAlive) return true;
  if ((s1.spawnRadius ?? 10) !== (s2.spawnRadius ?? 10)) return true;
  if ((s1.targetLifetimeSec ?? 0) !== (s2.targetLifetimeSec ?? 0)) return true;
  if ((s1.respawnDelayMs ?? 0) !== (s2.respawnDelayMs ?? 0)) return true;

  // Target kinematics and hitboxes
  const t1 = original.target;
  const t2 = updated.target;
  if (t1.shape !== t2.shape || (t1.hp ?? 100) !== (t2.hp ?? 100)) return true;
  if ((t1.sizeMultiplier ?? 1.0) !== (t2.sizeMultiplier ?? 1.0)) return true;
  if (t1.movementPattern !== t2.movementPattern) return true;
  if ((t1.speedMultiplier ?? 1.0) !== (t2.speedMultiplier ?? 1.0)) return true;
  if (Boolean(t1.headLevel) !== Boolean(t2.headLevel)) return true;
  if ((t1.fakePeekChance ?? 0) !== (t2.fakePeekChance ?? 0)) return true;
  if (Boolean(t1.retaliatory) !== Boolean(t2.retaliatory)) return true;
  if (t1.retaliateDelayMs !== t2.retaliateDelayMs) return true;
  if (t1.retaliationPenalty !== t2.retaliationPenalty) return true;

  // Weapon constraints
  const w1 = original.weapon;
  const w2 = updated.weapon;
  if (w1?.preset !== w2?.preset || Boolean(w1?.requireCounterStrafe) !== Boolean(w2?.requireCounterStrafe)) return true;

  // Scoring calibration
  const sc1 = original.scoring;
  const sc2 = updated.scoring;
  if (sc1?.baseHitScore !== sc2?.baseHitScore) return true;
  if (sc1?.headshotBonus !== sc2?.headshotBonus) return true;
  if (sc1?.missPenalty !== sc2?.missPenalty) return true;
  if (sc1?.speedBonusMax !== sc2?.speedBonusMax) return true;
  if (sc1?.counterStrafeBonus !== sc2?.counterStrafeBonus) return true;

  return false;
}

export function createDefaultCustomScenario(template = 'static_flick'): WarmupLabScenarioV1 {
  const timestamp = Date.now();
  const id = `custom_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;

  if (template === 'tracking_smooth' || template === 'smooth_track') {
    return {
      format: 'warmuplab-scenario',
      version: 1,
      id,
      name: 'Custom Smooth Tracking',
      description: 'Continuous tracking exercise with moving spherical targets.',
      category: 'tracking',
      tags: ['tracking', 'smoothness'],
      difficulty: 'intermediate',
      durationSec: 60,
      spawner: {
        mode: 'respawn_on_kill',
        maxAlive: 1,
        initialTargetCount: 1,
        respawnOnKill: true,
        spawnRadius: 10,
      },
      target: {
        shape: 'sphere',
        sizeMultiplier: 1.0,
        movementPattern: 'strafe',
        speedMultiplier: 1.2,
        directionChangeMultiplier: 1.0,
      },
      weapon: {
        preset: 'vandal',
        unlimitedAmmo: true,
      },
      environment: {
        type: 'arena',
      },
      interaction: {
        mode: 'track',
        trackDps: 35,
      },
      scoring: {
        baseHitScore: 10,
        speedBonusMax: 0,
      },
      endCondition: {
        type: 'time',
      },
      feedback: {
        meaningfulReactionTime: false,
        meaningfulTracking: true,
      },
      metadata: {
        createdAt: timestamp,
        updatedAt: timestamp,
        configVersion: 1,
        isCustom: true,
      },
    };
  }

  if (template === 'tactical_peek') {
    return {
      format: 'warmuplab-scenario',
      version: 1,
      id,
      name: 'Custom Angle Peek Duel',
      description: 'Practice pre-aiming and micro-adjusting against enemies peeking cover.',
      category: 'tactical',
      tags: ['peek', 'counter-strafe', 'headshot'],
      difficulty: 'advanced',
      durationSec: 60,
      spawner: {
        mode: 'peek',
        maxAlive: 1,
        initialTargetCount: 1,
        respawnOnKill: true,
        respawnDelayMs: 400,
        targetLifetimeSec: 1.2,
        spawnRadius: 12,
      },
      target: {
        shape: 'humanoid',
        hp: 100,
        sizeMultiplier: 1.0,
        movementPattern: 'peek',
        speedMultiplier: 1.0,
        headLevel: true,
        fakePeekChance: 0.2,
      },
      weapon: {
        preset: 'vandal',
        requireCounterStrafe: true,
        unlimitedAmmo: true,
      },
      environment: {
        type: 'corner',
        customCover: true,
      },
      interaction: {
        mode: 'click',
        oneShotPerPeek: true,
      },
      scoring: {
        baseHitScore: 100,
        headshotBonus: 50,
        missPenalty: -25,
        speedBonusMax: 300,
        speedDecay: 0.4,
        counterStrafeBonus: 150,
      },
      endCondition: {
        type: 'time',
      },
      feedback: {
        meaningfulReactionTime: true,
        meaningfulTracking: false,
      },
      metadata: {
        createdAt: timestamp,
        updatedAt: timestamp,
        configVersion: 1,
        isCustom: true,
      },
    };
  }

  if (template === 'retaliatory_duel') {
    return {
      format: 'warmuplab-scenario',
      version: 1,
      id,
      name: 'Custom Retaliatory Skirmish',
      description: 'Eliminate tactical bots before their reaction timer expires and they return fire.',
      category: 'tactical',
      tags: ['retaliation', 'skirmish', 'pressure'],
      difficulty: 'advanced',
      durationSec: 60,
      spawner: {
        mode: 'random_area',
        maxAlive: 2,
        initialTargetCount: 2,
        respawnOnKill: true,
        respawnDelayMs: 250,
        spawnRadius: 14,
      },
      target: {
        shape: 'humanoid',
        hp: 100,
        sizeMultiplier: 1.0,
        movementPattern: 'jiggle',
        speedMultiplier: 1.1,
        headLevel: true,
        retaliatory: true,
        retaliateDelayMs: 800,
        retaliationPenalty: 250,
      },
      weapon: {
        preset: 'vandal',
        requireCounterStrafe: true,
        unlimitedAmmo: true,
      },
      environment: {
        type: 'arena',
      },
      interaction: {
        mode: 'click',
      },
      scoring: {
        baseHitScore: 100,
        headshotBonus: 50,
        missPenalty: -25,
        speedBonusMax: 300,
        speedDecay: 0.4,
        counterStrafeBonus: 150,
      },
      endCondition: {
        type: 'time',
      },
      feedback: {
        meaningfulReactionTime: true,
        meaningfulTracking: false,
      },
      metadata: {
        createdAt: timestamp,
        updatedAt: timestamp,
        configVersion: 1,
        isCustom: true,
      },
    };
  }

  // Default: static_flick
  return {
    format: 'warmuplab-scenario',
    version: 1,
    id,
    name: 'Custom Static Flicks',
    description: 'Clean single-target flick practice with custom parameters.',
    category: 'flick',
    tags: ['flick', 'clicking', 'muscle-memory'],
    difficulty: 'intermediate',
    durationSec: 60,
    spawner: {
      mode: 'random_area',
      maxAlive: 1,
      initialTargetCount: 1,
      respawnOnKill: true,
      spawnRadius: 10,
    },
    target: {
      shape: 'sphere',
      sizeMultiplier: 1.0,
      movementPattern: 'static',
      speedMultiplier: 0,
      headLevel: false,
    },
    weapon: {
      preset: 'vandal',
      unlimitedAmmo: true,
    },
    environment: {
      type: 'arena',
    },
    interaction: {
      mode: 'click',
    },
    scoring: {
      baseHitScore: 100,
      headshotBonus: 50,
      missPenalty: -25,
      speedBonusMax: 300,
      speedDecay: 0.4,
    },
    endCondition: {
      type: 'time',
    },
    feedback: {
      meaningfulReactionTime: true,
      meaningfulTracking: false,
    },
    metadata: {
      createdAt: timestamp,
      updatedAt: timestamp,
      configVersion: 1,
      isCustom: true,
    },
  };
}
