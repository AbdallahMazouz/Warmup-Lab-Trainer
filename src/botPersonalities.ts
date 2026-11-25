// =====================================================================
// botPersonalities.ts — Declarative Bot Personalities & Behavior Variety
// =====================================================================

import type { BotPersonalityId, MovementPattern, DifficultyId } from './types';

export const VALID_BOT_PERSONALITIES: BotPersonalityId[] = [
  'strafe_specialist',
  'tactical_peeker',
  'evasive_bot',
  'duelist',
];

export interface BotPersonalityProfile {
  id: BotPersonalityId;
  name: string;
  description: string;
  strafeRhythm?: {
    shortBurstDuration: [number, number];
    longSweepDuration: [number, number];
    deadstopDuration: number;
    feintChance: number;
  };
  peekDistribution?: {
    shoulderBaitChance: number;
    wideSwingChance: number;
    standardPeekChance: number;
    shoulderDisplacement: number;
    wideDisplacement: number;
    standardDisplacement: number;
    shoulderDuelDuration: number;
    wideDuelDuration: number;
    standardDuelDuration: number;
  };
  mobility?: {
    jumpImpulse: number;
    gravity: number;
    maxJumpY: number;
    driftSpeed: number;
  };
  evasionBehavior: 'counter_cut' | 'emergency_retreat' | 'jump_ascent' | 'micro_reposition';
  evasionCooldownMs: number;
  isRetaliatoryDefault: boolean;
  retaliateBurstIntervalMs: number;
}

export const BOT_PERSONALITY_PROFILES: Record<BotPersonalityId, BotPersonalityProfile> = {
  strafe_specialist: {
    id: 'strafe_specialist',
    name: 'Strafe Specialist',
    description: 'Master of A-D-A-D counter-strafing, deceptive micro-jukes, and directional feints.',
    strafeRhythm: {
      shortBurstDuration: [0.18, 0.28],
      longSweepDuration: [0.55, 0.85],
      deadstopDuration: 0.16,
      feintChance: 0.35,
    },
    evasionBehavior: 'counter_cut',
    evasionCooldownMs: 400,
    isRetaliatoryDefault: false,
    retaliateBurstIntervalMs: 600,
  },
  tactical_peeker: {
    id: 'tactical_peeker',
    name: 'Tactical Peeker',
    description: 'Methodical angle-holder utilizing shoulder baits, wide swings, and disciplined cover tucks.',
    peekDistribution: {
      shoulderBaitChance: 0.35,
      wideSwingChance: 0.25,
      standardPeekChance: 0.40,
      shoulderDisplacement: 0.32,
      wideDisplacement: 1.95,
      standardDisplacement: 0.85,
      shoulderDuelDuration: 0.20,
      wideDuelDuration: 0.65,
      standardDuelDuration: 0.45,
    },
    evasionBehavior: 'emergency_retreat',
    evasionCooldownMs: 450,
    isRetaliatoryDefault: false,
    retaliateBurstIntervalMs: 600,
  },
  evasive_bot: {
    id: 'evasive_bot',
    name: 'Evasive Bot',
    description: 'High-mobility aerial target using crouch compressions, explosive jumps, and horizontal drift.',
    mobility: {
      jumpImpulse: 8.2,
      gravity: -18.0,
      maxJumpY: 2.2,
      driftSpeed: 1.8,
    },
    evasionBehavior: 'jump_ascent',
    evasionCooldownMs: 320,
    isRetaliatoryDefault: false,
    retaliateBurstIntervalMs: 600,
  },
  duelist: {
    id: 'duelist',
    name: 'Duelist',
    description: 'Aggressive combatant holding angles, delivering sustained return-fire, and punishing hesitation.',
    strafeRhythm: {
      shortBurstDuration: [0.30, 0.45],
      longSweepDuration: [0.60, 0.90],
      deadstopDuration: 0.20,
      feintChance: 0.20,
    },
    evasionBehavior: 'micro_reposition',
    evasionCooldownMs: 450,
    isRetaliatoryDefault: true,
    retaliateBurstIntervalMs: 500,
  },
};

/**
 * Resolves personality either from explicit configuration or by auto-deriving from scenario characteristics.
 * Ensures 100% backward compatibility for all 39 built-in scenarios and legacy custom scenarios.
 */
export function resolveBotPersonality(
  explicitPersonality?: BotPersonalityId,
  scenarioId?: string,
  pattern?: MovementPattern,
  retaliatory?: boolean
): BotPersonalityId | undefined {
  if (explicitPersonality && VALID_BOT_PERSONALITIES.includes(explicitPersonality)) {
    return explicitPersonality;
  }

  const sId = (scenarioId || '').toLowerCase();

  if (retaliatory || sId.includes('skirmish')) {
    return 'duelist';
  }
  if (sId.includes('peek') || sId.includes('jiggle') || sId.includes('wideswing') || pattern === 'peek' || pattern === 'jiggle' || pattern === 'wideswing') {
    return 'tactical_peeker';
  }
  if (pattern === 'vertical' || sId.includes('vertical') || sId.includes('mobility')) {
    return 'evasive_bot';
  }
  if (pattern === 'strafe' || sId.includes('strafe')) {
    return 'strafe_specialist';
  }

  return undefined;
}

/**
 * Obtains personality profile scaled dynamically by difficulty tier.
 */
export function getPersonalityProfile(
  personalityId: BotPersonalityId,
  difficulty: DifficultyId = 'intermediate'
): BotPersonalityProfile {
  const base = BOT_PERSONALITY_PROFILES[personalityId];
  if (!base) return BOT_PERSONALITY_PROFILES.strafe_specialist;

  // Clone so modifications don't mutate the base profile
  const profile: BotPersonalityProfile = {
    ...base,
    strafeRhythm: base.strafeRhythm ? { ...base.strafeRhythm } : undefined,
    peekDistribution: base.peekDistribution ? { ...base.peekDistribution } : undefined,
    mobility: base.mobility ? { ...base.mobility } : undefined,
  };

  // Difficulty scaling adjustments
  if (difficulty === 'pro') {
    if (profile.strafeRhythm) {
      profile.strafeRhythm.deadstopDuration = Math.max(0.12, profile.strafeRhythm.deadstopDuration * 0.75);
      profile.strafeRhythm.feintChance = Math.min(0.50, profile.strafeRhythm.feintChance + 0.10);
    }
    if (profile.peekDistribution) {
      profile.peekDistribution.shoulderBaitChance = Math.min(0.50, profile.peekDistribution.shoulderBaitChance + 0.10);
      profile.peekDistribution.shoulderDuelDuration *= 0.85;
    }
    profile.evasionCooldownMs = Math.max(250, profile.evasionCooldownMs * 0.75);
  } else if (difficulty === 'advanced') {
    if (profile.strafeRhythm) {
      profile.strafeRhythm.deadstopDuration = Math.max(0.14, profile.strafeRhythm.deadstopDuration * 0.88);
      profile.strafeRhythm.feintChance = Math.min(0.45, profile.strafeRhythm.feintChance + 0.05);
    }
    profile.evasionCooldownMs = Math.max(280, profile.evasionCooldownMs * 0.88);
  } else if (difficulty === 'beginner') {
    if (profile.strafeRhythm) {
      profile.strafeRhythm.deadstopDuration *= 1.3;
      profile.strafeRhythm.feintChance = Math.max(0.15, profile.strafeRhythm.feintChance - 0.10);
    }
    if (profile.peekDistribution) {
      profile.peekDistribution.shoulderBaitChance = Math.max(0.15, profile.peekDistribution.shoulderBaitChance - 0.10);
      profile.peekDistribution.standardPeekChance = Math.min(0.70, profile.peekDistribution.standardPeekChance + 0.10);
    }
    profile.evasionCooldownMs *= 1.25;
  }

  return profile;
}
