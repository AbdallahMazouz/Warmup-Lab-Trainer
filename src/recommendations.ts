// =====================================================================
// recommendations.ts — Conservative Training Intelligence & Recommendations
// =====================================================================

import type {
  SessionResult,
  DifficultyId,
  ScenarioConfig,
  SkillDimensionId,
  SkillDimensionEvaluation,
  RecommendationResult,
} from './types';
import { TRAINING_ROUTINES, getScenarioById } from './scenarios';
import { isEligibleForReactionMetric } from './analytics';

export const COLD_START_MIN_SESSIONS = 3;
export const DIMENSION_MIN_SAMPLES = 2;
export const RECENCY_DECAY = 0.15; // Exponential decay per session index

export interface DimensionConfig {
  id: SkillDimensionId;
  name: string;
  description: string;
  benchmark: number;
  eligibleScenarioIds: string[];
  filterSession: (session: SessionResult, scenario?: ScenarioConfig) => boolean;
  extractValue: (session: SessionResult) => number;
  normalizeScore: (weightedVal: number) => number;
  formatEvidence: (weightedVal: number, sampleCount: number, benchmark: number) => string;
  rationale: string;
  benchmarkTarget: string;
}

export const DIMENSION_CONFIGS: Record<SkillDimensionId, DimensionConfig> = {
  flick_accuracy: {
    id: 'flick_accuracy',
    name: 'Flick Accuracy',
    description: 'Precision and click timing during single and multi-target flicks.',
    benchmark: 70.0,
    eligibleScenarioIds: [
      'flick-static',
      'flick-micro',
      'flick-wide',
      'flick-multi',
      'flick-precision',
      'flick-reactive',
    ],
    filterSession: (session, sc) => {
      return (sc?.category === 'flick' || session.category === 'flick') &&
        typeof session.accuracy === 'number' &&
        Number.isFinite(session.accuracy) &&
        (session.shotsFired ?? (session.hits + session.misses)) > 0;
    },
    extractValue: (session) => session.accuracy,
    normalizeScore: (val) => Math.max(0, Math.min(100, Math.round(val))),
    formatEvidence: (val, count, bench) =>
      `Recent flick accuracy averaged ${val.toFixed(1)}% across ${count} session(s) (target benchmark: >= ${bench.toFixed(1)}%).`,
    rationale: 'Improving flick accuracy ensures reliable target acquisition before triggering your first shot.',
    benchmarkTarget: 'Achieve >= 70.0% accuracy on flick scenarios.',
  },

  reaction_time: {
    id: 'reaction_time',
    name: 'Reaction Speed',
    description: 'Single-target visual stimulus response latency.',
    benchmark: 60.0, // approx <= 244ms
    eligibleScenarioIds: [
      'reaction-visual',
      'flick-reactive',
      'tactical-jiggle',
      'flick-static',
      'reaction-peripheral',
    ],
    filterSession: (session, sc) => {
      // Must be single-target scenario with meaningfulReactionTime to prevent multi-target queuing distortion
      if (!isEligibleForReactionMetric(sc)) return false;
      return typeof session.avgReactionMs === 'number' &&
        Number.isFinite(session.avgReactionMs) &&
        session.avgReactionMs > 0 &&
        session.hits > 0;
    },
    extractValue: (session) => session.avgReactionMs,
    normalizeScore: (avgMs) => {
      // 160ms = 100, 350ms = 0
      const score = 100 - ((avgMs - 160) / (350 - 160)) * 100;
      return Math.max(0, Math.min(100, Math.round(score)));
    },
    formatEvidence: (avgMs, count) =>
      `Average single-target reaction latency is ${Math.round(avgMs)}ms across ${count} session(s) (target benchmark: <= 244ms).`,
    rationale: 'Faster initial visual reaction gives you the critical timing advantage in peek duels.',
    benchmarkTarget: 'Achieve average reaction time <= 244ms on single-target drills.',
  },

  headshot_discipline: {
    id: 'headshot_discipline',
    name: 'Headshot Discipline',
    description: 'Crosshair placement and headshot rate on head-level targets.',
    benchmark: 65.0, // approx >= 45.5% headshot rate
    eligibleScenarioIds: [
      'tactical-headlevel',
      'tactical-angle-clear',
      'tactical-wideswing',
      'flick-micro',
    ],
    filterSession: (session, sc) => {
      // Head-level drills with actual hits; exclude pure center visual reaction tests
      const isHeadLevel = sc?.headLevel ?? false;
      const isNotReactionCategory = (sc?.category ?? session.category) !== 'reaction';
      const hasHits = session.hits >= 3;
      return isHeadLevel && isNotReactionCategory && hasHits;
    },
    extractValue: (session) => {
      if (typeof session.headshotPct === 'number' && Number.isFinite(session.headshotPct)) {
        return session.headshotPct;
      }
      return session.hits > 0 ? (session.headshots / session.hits) * 100 : 0;
    },
    normalizeScore: (hsPct) => {
      // 70% HS = 100
      const score = (hsPct / 70) * 100;
      return Math.max(0, Math.min(100, Math.round(score)));
    },
    formatEvidence: (hsPct, count) =>
      `Headshot rate averaged ${hsPct.toFixed(1)}% across ${count} head-level session(s) (target benchmark: >= 45.5%).`,
    rationale: 'Maintaining strict head-level crosshair discipline maximizes one-tap lethality with the Vandal.',
    benchmarkTarget: 'Achieve >= 45.5% headshot percentage on head-level scenarios.',
  },

  smooth_tracking: {
    id: 'smooth_tracking',
    name: 'Tracking Smoothness',
    description: 'Crosshair uptime and continuity while tracking moving targets.',
    benchmark: 65.0,
    eligibleScenarioIds: [
      'track-smooth',
      'track-strafe',
      'track-reactive',
      'track-vertical',
    ],
    filterSession: (session, sc) => {
      return (sc?.category === 'tracking' || session.category === 'tracking') &&
        typeof session.timeOnTarget === 'number' &&
        Number.isFinite(session.timeOnTarget) &&
        session.timeOnTarget >= 0;
    },
    extractValue: (session) => session.timeOnTarget!,
    normalizeScore: (tot) => Math.max(0, Math.min(100, Math.round(tot))),
    formatEvidence: (tot, count, bench) =>
      `Tracking uptime averaged ${tot.toFixed(1)}% across ${count} tracking session(s) (target benchmark: >= ${bench.toFixed(1)}%).`,
    rationale: 'Smooth mouse tracking prevents over-correction when enemies strafe or use mobility skills.',
    benchmarkTarget: 'Achieve >= 65.0% time on target in tracking drills.',
  },

  steady_aim_discipline: {
    id: 'steady_aim_discipline',
    name: 'Steady Aim & Movement Discipline',
    description: 'Dead-zone stopping and firing only when stationary.',
    benchmark: 75.0,
    eligibleScenarioIds: [
      'tactical-counter-strafe',
      'tactical-firstshot',
    ],
    filterSession: (session, sc) => {
      const moving = session.shotsMoving ?? 0;
      const stationary = session.shotsStationary ?? 0;
      const hasMovementSamples = (moving + stationary) >= 4;
      const isSteadyAimDrill = sc?.requireSteadyAim || sc?.id === 'tactical-counter-strafe';
      return isSteadyAimDrill && hasMovementSamples;
    },
    extractValue: (session) => {
      const moving = session.shotsMoving ?? 0;
      const stationary = session.shotsStationary ?? 0;
      const total = moving + stationary;
      return total > 0 ? (stationary / total) * 100 : 0;
    },
    normalizeScore: (ratio) => Math.max(0, Math.min(100, Math.round(ratio))),
    formatEvidence: (ratio, count, bench) =>
      `Stationary shot ratio was ${ratio.toFixed(1)}% across ${count} tactical movement session(s) (target benchmark: >= ${bench.toFixed(1)}%).`,
    rationale: 'Coming to a complete stop before clicking eliminates movement inaccuracy spread on your first bullet.',
    benchmarkTarget: 'Achieve >= 75.0% stationary shots in tactical movement drills.',
  },
};

/**
 * Evaluates all 5 skill dimensions from historical sessions.
 * Sessions are expected to be ordered newest first (index 0 = most recent).
 * Pure and non-mutating.
 */
export function evaluateSkillDimensions(sessions: SessionResult[]): SkillDimensionEvaluation[] {
  if (!Array.isArray(sessions)) {
    sessions = [];
  }

  // Filter out completely malformed session objects
  const validSessions = sessions.filter(
    (s) => s && typeof s === 'object' && typeof s.scenarioId === 'string' && s.scenarioId.trim() !== ''
  );

  const evaluations: SkillDimensionEvaluation[] = [];

  for (const config of Object.values(DIMENSION_CONFIGS)) {
    const eligibleMatches: { session: SessionResult; value: number }[] = [];

    for (const s of validSessions) {
      const sc = getScenarioById(s.scenarioId);
      if (config.filterSession(s, sc)) {
        const val = config.extractValue(s);
        if (Number.isFinite(val)) {
          eligibleMatches.push({ session: s, value: val });
        }
      }
    }

    const sampleCount = eligibleMatches.length;

    if (sampleCount === 0) {
      evaluations.push({
        dimensionId: config.id,
        name: config.name,
        description: config.description,
        score: 0,
        confidence: 0,
        sampleCount: 0,
        benchmark: config.benchmark,
        isDeficit: false, // Never mark a dimension as deficient if there is no data!
        evidenceSummary: 'No eligible sessions recorded yet for this skill dimension.',
        eligibleSessionIds: [],
      });
      continue;
    }

    // Exponential recency weighting: w_i = e^(-0.15 * i)
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < eligibleMatches.length; i++) {
      const weight = Math.exp(-RECENCY_DECAY * i);
      weightedSum += eligibleMatches[i].value * weight;
      totalWeight += weight;
    }

    const weightedVal = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const score = config.normalizeScore(weightedVal);

    // Confidence scales with sample count up to 4 sessions (1=0.25, 2=0.50, 3=0.75, 4+=1.0)
    const confidence = Number(Math.min(1.0, sampleCount / 4).toFixed(2));

    // Deficit requires at least DIMENSION_MIN_SAMPLES and score < benchmark
    const isDeficit = sampleCount >= DIMENSION_MIN_SAMPLES && score < config.benchmark;

    const evidenceSummary = config.formatEvidence(weightedVal, sampleCount, config.benchmark);
    const eligibleSessionIds = eligibleMatches.map((m) => m.session.id);

    evaluations.push({
      dimensionId: config.id,
      name: config.name,
      description: config.description,
      score,
      confidence,
      sampleCount,
      benchmark: config.benchmark,
      isDeficit,
      evidenceSummary,
      eligibleSessionIds,
    });
  }

  return evaluations;
}

export const DIFFICULTY_TIERS: DifficultyId[] = ['beginner', 'intermediate', 'advanced', 'pro'];

export interface ConsolidationEvaluation {
  shouldConsolidate: boolean;
  targetDifficulty: DifficultyId;
  reason: string;
  evidence: string;
  aggregateMovingRatio?: number;
}

/**
 * Evaluates whether player performance at currentDifficulty warrants consolidation at the tier below.
 * Requires at least 2 sessions at currentDifficulty.
 * Triggered by:
 * 1. Pooled movement-shot ratio > 35.0% across qualifying sessions (with >= 4 movement shots).
 * 2. Systemic deficits across >= 2 skill dimensions.
 * Pure and non-mutating.
 */
export function evaluateConsolidation(
  sessions: SessionResult[],
  currentDifficulty: DifficultyId,
  evaluations: SkillDimensionEvaluation[]
): ConsolidationEvaluation {
  const currentIdx = DIFFICULTY_TIERS.indexOf(currentDifficulty);
  const fallbackTier = currentIdx > 0 ? DIFFICULTY_TIERS[currentIdx - 1] : currentDifficulty;

  const sessionsAtDifficulty = (Array.isArray(sessions) ? sessions : []).filter(
    (s) => s && s.difficulty === currentDifficulty
  );

  // A single session must never independently cause consolidation
  if (sessionsAtDifficulty.length < 2) {
    return {
      shouldConsolidate: false,
      targetDifficulty: currentDifficulty,
      reason: 'At least 2 sessions at current difficulty are required before consolidation can be suggested.',
      evidence: `${sessionsAtDifficulty.length} session(s) recorded at ${currentDifficulty}.`,
    };
  }

  // Pooled movement-shot aggregation across qualifying sessions
  let totalMoving = 0;
  let totalStationary = 0;
  for (const s of sessionsAtDifficulty) {
    totalMoving += typeof s.shotsMoving === 'number' && Number.isFinite(s.shotsMoving) ? s.shotsMoving : 0;
    totalStationary += typeof s.shotsStationary === 'number' && Number.isFinite(s.shotsStationary) ? s.shotsStationary : 0;
  }
  const totalMovementShots = totalMoving + totalStationary;
  const aggregateMovingRatio = totalMovementShots > 0 ? (totalMoving / totalMovementShots) * 100 : 0;

  // Threshold: strictly > 35.0% with at least 4 movement shots
  const highMovingRatio = totalMovementShots >= 4 && aggregateMovingRatio > 35.0;

  // Systemic deficits across >= 2 dimensions
  const deficitCount = evaluations.filter((e) => e.isDeficit).length;
  const hasSystemicDeficit = deficitCount >= 2;

  if (hasSystemicDeficit || highMovingRatio) {
    if (currentDifficulty === 'beginner') {
      return {
        shouldConsolidate: false,
        targetDifficulty: 'beginner',
        reason: 'Already at beginner baseline; consolidate fundamentals at current tier.',
        evidence: 'Beginner tier floor active.',
        aggregateMovingRatio,
      };
    }

    const reason = highMovingRatio
      ? `High aggregate moving-shot ratio (${aggregateMovingRatio.toFixed(1)}% > 35.0%) across ${sessionsAtDifficulty.length} sessions at ${currentDifficulty}.`
      : `Systemic struggle detected across ${deficitCount} skill dimensions at ${currentDifficulty}.`;

    const evidence = highMovingRatio
      ? `Pooled movement shots: ${totalMoving}/${totalMovementShots} moving (${aggregateMovingRatio.toFixed(1)}%).`
      : `${deficitCount} skill dimensions currently in deficit.`;

    return {
      shouldConsolidate: true,
      targetDifficulty: fallbackTier,
      reason,
      evidence,
      aggregateMovingRatio,
    };
  }

  return {
    shouldConsolidate: false,
    targetDifficulty: currentDifficulty,
    reason: 'Performance within expected variance; no consolidation required.',
    evidence: `Moving-shot ratio ${aggregateMovingRatio.toFixed(1)}%, deficits: ${deficitCount}.`,
    aggregateMovingRatio,
  };
}

export interface PromotionEvaluation {
  shouldPromote: boolean;
  targetDifficulty: DifficultyId;
  reason: string;
  evidence: string;
  primaryDimensionId?: SkillDimensionId;
}

/**
 * Evaluates whether player performance at currentDifficulty qualifies for difficulty promotion.
 * Every Sprint 3D promotion gate is strictly preserved:
 * 1. >= 3 eligible sessions at currentDifficulty.
 * 2. Confidence >= 0.75 on candidate dimension.
 * 3. Dimension score >= benchmark + 12 (mastery margin).
 * 4. Shooting throughput >= 15 shots/session where applicable.
 * 5. Tracking uptime >= 75% where applicable.
 * 6. Trend not regressing (trendDelta >= -1.0).
 * 7. No critical deficit (score < 50 with >= 2 samples) in another tested dimension.
 * 8. Reaction-time gating only for eligible single-target sessions.
 * Pure and non-mutating.
 */
export function evaluatePromotion(
  sessions: SessionResult[],
  currentDifficulty: DifficultyId,
  evaluations: SkillDimensionEvaluation[]
): PromotionEvaluation {
  const currentIdx = DIFFICULTY_TIERS.indexOf(currentDifficulty);
  if (currentIdx === -1 || currentIdx >= DIFFICULTY_TIERS.length - 1) {
    return {
      shouldPromote: false,
      targetDifficulty: currentDifficulty,
      reason: 'Already at pro tier or invalid difficulty tier.',
      evidence: 'Maximum difficulty tier reached.',
    };
  }

  const nextTier = DIFFICULTY_TIERS[currentIdx + 1];

  const sessionsAtDifficulty = (Array.isArray(sessions) ? sessions : []).filter(
    (s) => s && s.difficulty === currentDifficulty
  );

  // Gate 1: At least 3 eligible sessions at current difficulty
  if (sessionsAtDifficulty.length < 3) {
    return {
      shouldPromote: false,
      targetDifficulty: currentDifficulty,
      reason: `At least 3 sessions at ${currentDifficulty} required for promotion consideration.`,
      evidence: `${sessionsAtDifficulty.length} session(s) recorded at ${currentDifficulty}.`,
    };
  }

  // Gate 2 & 3: Primary dimension with sampleCount >= 3, confidence >= 0.75, score >= benchmark + 12
  const candidateDimensions = evaluations.filter((e) => {
    return e.sampleCount >= 3 && e.confidence >= 0.75 && e.score >= (e.benchmark + 12);
  });

  if (candidateDimensions.length === 0) {
    return {
      shouldPromote: false,
      targetDifficulty: currentDifficulty,
      reason: 'No tested skill dimension exceeds baseline benchmark by mastery margin (+12 points).',
      evidence: 'Mastery margin requirement not met.',
    };
  }

  // Sort candidate dimensions by margin: (score - benchmark) descending
  candidateDimensions.sort((a, b) => (b.score - b.benchmark) - (a.score - a.benchmark));
  const primaryCandidate = candidateDimensions[0];
  const config = DIMENSION_CONFIGS[primaryCandidate.dimensionId];

  // Matching sessions at current difficulty for this candidate dimension
  const matchingSessions = sessionsAtDifficulty.filter((s) => {
    const sc = getScenarioById(s.scenarioId);
    return config.filterSession(s, sc);
  });

  if (matchingSessions.length < 3) {
    return {
      shouldPromote: false,
      targetDifficulty: currentDifficulty,
      reason: `Insufficient matching sessions (${matchingSessions.length} < 3) on ${primaryCandidate.name}.`,
      evidence: `${matchingSessions.length} matching sessions recorded.`,
    };
  }

  // Gate 4: Shooting throughput >= 15 shots/session where applicable
  if (primaryCandidate.dimensionId !== 'smooth_tracking') {
    const totalShots = matchingSessions.reduce((sum, s) => {
      const shots = typeof s.shotsFired === 'number' && Number.isFinite(s.shotsFired)
        ? s.shotsFired
        : (s.hits + s.misses);
      return sum + shots;
    }, 0);
    const avgShots = totalShots / matchingSessions.length;
    if (avgShots < 15) {
      return {
        shouldPromote: false,
        targetDifficulty: currentDifficulty,
        reason: `Shooting throughput too low (${avgShots.toFixed(1)} < 15 shots/session) on ${primaryCandidate.name}.`,
        evidence: `Average ${avgShots.toFixed(1)} shots/session.`,
      };
    }
  }

  // Gate 5: Tracking uptime >= 75% where applicable
  if (primaryCandidate.dimensionId === 'smooth_tracking') {
    const totalUptime = matchingSessions.reduce((sum, s) => sum + (s.timeOnTarget ?? 0), 0);
    const avgUptime = totalUptime / matchingSessions.length;
    if (avgUptime < 75.0) {
      return {
        shouldPromote: false,
        targetDifficulty: currentDifficulty,
        reason: `Tracking uptime too low (${avgUptime.toFixed(1)}% < 75.0%) for promotion.`,
        evidence: `Average tracking uptime ${avgUptime.toFixed(1)}%.`,
      };
    }
  }

  // Gate 6: Trend must not be regressing (trendDelta >= -1)
  if (matchingSessions.length >= 2) {
    const val0 = config.extractValue(matchingSessions[0]);
    const val1 = config.extractValue(matchingSessions[1]);
    const valDelta = primaryCandidate.dimensionId === 'reaction_time'
      ? (val1 - val0) // positive when latest is faster (val0 < val1)
      : (val0 - val1);

    if (valDelta < -1.0) {
      return {
        shouldPromote: false,
        targetDifficulty: currentDifficulty,
        reason: `Recent performance is regressing on ${primaryCandidate.name} (delta: ${valDelta.toFixed(1)} < -1.0).`,
        evidence: `Form trend delta ${valDelta.toFixed(1)}.`,
      };
    }
  }

  // Gate 7: No critical deficit (score < 50 with >= 2 samples) in another tested dimension
  // Untested dimensions (sampleCount < 2) must not block promotion
  for (const other of evaluations) {
    if (other.dimensionId !== primaryCandidate.dimensionId) {
      if (other.sampleCount >= 2 && other.score < 50) {
        return {
          shouldPromote: false,
          targetDifficulty: currentDifficulty,
          reason: `Critical deficit in ${other.name} (score ${other.score} < 50) blocks difficulty promotion.`,
          evidence: `${other.name} score is ${other.score} with ${other.sampleCount} samples.`,
        };
      }
    }
  }

  // Gate 8: Reaction-time gating: reuse existing DIMENSION_CONFIGS.reaction_time and isEligibleForReactionMetric
  // Reaction time only blocks if eligible single-target reaction sessions have >= 2 samples and score < 60
  const reactionEval = evaluations.find((e) => e.dimensionId === 'reaction_time');
  if (reactionEval && reactionEval.dimensionId !== primaryCandidate.dimensionId) {
    if (reactionEval.sampleCount >= 2 && reactionEval.isDeficit) {
      return {
        shouldPromote: false,
        targetDifficulty: currentDifficulty,
        reason: `Reaction latency deficit (${reactionEval.evidenceSummary}) blocks difficulty promotion.`,
        evidence: reactionEval.evidenceSummary,
      };
    }
  }

  return {
    shouldPromote: true,
    targetDifficulty: nextTier,
    reason: `Consistent mastery on ${primaryCandidate.name} (score ${primaryCandidate.score} >= benchmark +12) qualifies for promotion to ${nextTier}.`,
    evidence: `${primaryCandidate.name} achieved ${primaryCandidate.score}/100 with positive trend across ${matchingSessions.length} sessions.`,
    primaryDimensionId: primaryCandidate.dimensionId,
  };
}

/**
 * Evaluates adaptive progression across promotion, consolidation, or maintaining current difficulty.
 * Pure and non-mutating.
 */
export function evaluateDifficultyProgression(
  sessions: SessionResult[],
  currentDifficulty: DifficultyId,
  evaluations: SkillDimensionEvaluation[]
): {
  targetDifficulty: DifficultyId;
  action: 'promote' | 'consolidate' | 'maintain';
  reason: string;
  evidence: string;
  primaryDimensionId?: SkillDimensionId;
} {
  const consolidation = evaluateConsolidation(sessions, currentDifficulty, evaluations);
  if (consolidation.shouldConsolidate) {
    return {
      targetDifficulty: consolidation.targetDifficulty,
      action: 'consolidate',
      reason: consolidation.reason,
      evidence: consolidation.evidence,
    };
  }

  const promotion = evaluatePromotion(sessions, currentDifficulty, evaluations);
  if (promotion.shouldPromote) {
    return {
      targetDifficulty: promotion.targetDifficulty,
      action: 'promote',
      reason: promotion.reason,
      evidence: promotion.evidence,
      primaryDimensionId: promotion.primaryDimensionId,
    };
  }

  return {
    targetDifficulty: currentDifficulty,
    action: 'maintain',
    reason: 'Current difficulty tier matches evaluated baseline performance.',
    evidence: `${sessions.length} sessions evaluated.`,
  };
}

/**
 * Generates an explainable, deterministic training recommendation based on session history.
 * Pure and non-mutating.
 */
export function generateRecommendation(
  sessions: SessionResult[],
  preferredDifficulty?: DifficultyId
): RecommendationResult {
  const validSessions = Array.isArray(sessions)
    ? sessions.filter(
        (s) => s && typeof s === 'object' && typeof s.scenarioId === 'string' && s.scenarioId.trim() !== ''
      )
    : [];

  const evaluations = evaluateSkillDimensions(validSessions);
  const currentTier: DifficultyId = preferredDifficulty || validSessions[0]?.difficulty || 'intermediate';

  // 1. Cold Start: If total valid sessions < COLD_START_MIN_SESSIONS
  if (validSessions.length < COLD_START_MIN_SESSIONS) {
    const routine = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m') || TRAINING_ROUTINES[0];
    return {
      isColdStart: true,
      recommendationType: 'routine',
      recommendedRoutineId: routine.id,
      recommendedRoutineName: routine.name,
      targetDifficulty: currentTier,
      primaryDimension: null,
      confidence: 0,
      title: 'Diagnostic Baseline Recommended',
      rationale:
        'At least 3 completed training sessions are required before specific skill weaknesses can be reliably identified.',
      evidence: `You currently have ${validSessions.length} recorded session(s). Complete the 5-minute diagnostic warm-up to establish performance baselines across flicks, tracking, and reaction.`,
      benchmarkTarget: 'Complete the Quick 5-Minute Warm-Up Routine.',
      dimensionEvaluations: evaluations,
    };
  }

  // 2. Adaptive Difficulty Progression (Consolidation or Promotion)
  const progression = evaluateDifficultyProgression(validSessions, currentTier, evaluations);
  const targetDifficulty: DifficultyId = progression.targetDifficulty;

  // 3. Identify candidate deficit dimensions
  const deficits = evaluations.filter((e) => e.isDeficit);

  if (deficits.length > 0) {
    // Rank deficits by severity: (benchmark - score) * confidence
    deficits.sort((a, b) => {
      const severityA = (a.benchmark - a.score) * a.confidence;
      const severityB = (b.benchmark - b.score) * b.confidence;
      return severityB - severityA;
    });

    const primaryDeficit = deficits[0];
    const config = DIMENSION_CONFIGS[primaryDeficit.dimensionId];

    // Pick an eligible scenario for this dimension, with anti-circularity
    const mostRecentScenarioId = validSessions[0]?.scenarioId;
    const candidates = config.eligibleScenarioIds
      .map((id) => getScenarioById(id))
      .filter((s): s is ScenarioConfig => s !== undefined);

    // Anti-circularity: prefer scenarios other than the one just played
    let selectedScenario = candidates.find((s) => s.id !== mostRecentScenarioId);
    if (!selectedScenario && candidates.length > 0) {
      selectedScenario = candidates[0];
    }

    if (selectedScenario) {
      const isConsolidating = progression.action === 'consolidate';
      const title = isConsolidating
        ? `Skill Consolidation: ${selectedScenario.name}`
        : `Focus Drill: ${selectedScenario.name}`;
      const rationale = isConsolidating
        ? `${progression.reason} Focus on ${primaryDeficit.name} to rebuild consistency.`
        : config.rationale;
      const evidence = isConsolidating
        ? `${progression.evidence} ${primaryDeficit.evidenceSummary}`
        : primaryDeficit.evidenceSummary;

      return {
        isColdStart: false,
        recommendationType: 'drill',
        recommendedScenarioId: selectedScenario.id,
        recommendedScenarioName: selectedScenario.name,
        targetDifficulty,
        primaryDimension: primaryDeficit.dimensionId,
        dimensionName: primaryDeficit.name,
        confidence: primaryDeficit.confidence,
        title,
        rationale,
        evidence,
        benchmarkTarget: config.benchmarkTarget,
        dimensionEvaluations: evaluations,
      };
    }
  }

  // 4. If Promotion triggered without deficits: recommend drill targeting the promoted skill
  if (progression.action === 'promote' && progression.primaryDimensionId) {
    const config = DIMENSION_CONFIGS[progression.primaryDimensionId];
    const mostRecentScenarioId = validSessions[0]?.scenarioId;
    const candidates = config.eligibleScenarioIds
      .map((id) => getScenarioById(id))
      .filter((s): s is ScenarioConfig => s !== undefined);

    let selectedScenario = candidates.find((s) => s.id !== mostRecentScenarioId);
    if (!selectedScenario && candidates.length > 0) {
      selectedScenario = candidates[0];
    }

    if (selectedScenario) {
      return {
        isColdStart: false,
        recommendationType: 'drill',
        recommendedScenarioId: selectedScenario.id,
        recommendedScenarioName: selectedScenario.name,
        targetDifficulty,
        primaryDimension: progression.primaryDimensionId,
        dimensionName: config.name,
        confidence: 1.0,
        title: `Difficulty Promotion: ${selectedScenario.name}`,
        rationale: progression.reason,
        evidence: progression.evidence,
        benchmarkTarget: config.benchmarkTarget,
        dimensionEvaluations: evaluations,
      };
    }
  }

  // 5. Fallback when no deficit exists (player is performing well across all measured dimensions)
  // Rank dimensions with samples by lowest score to recommend continuous polish
  const dimensionsWithData = evaluations.filter((e) => e.sampleCount >= DIMENSION_MIN_SAMPLES);
  dimensionsWithData.sort((a, b) => a.score - b.score);

  if (dimensionsWithData.length > 0) {
    const lowestDimension = dimensionsWithData[0];
    const config = DIMENSION_CONFIGS[lowestDimension.dimensionId];
    const mostRecentScenarioId = validSessions[0]?.scenarioId;
    const candidates = config.eligibleScenarioIds
      .map((id) => getScenarioById(id))
      .filter((s): s is ScenarioConfig => s !== undefined);

    let selectedScenario = candidates.find((s) => s.id !== mostRecentScenarioId);
    if (!selectedScenario && candidates.length > 0) {
      selectedScenario = candidates[0];
    }

    if (selectedScenario) {
      return {
        isColdStart: false,
        recommendationType: 'drill',
        recommendedScenarioId: selectedScenario.id,
        recommendedScenarioName: selectedScenario.name,
        targetDifficulty,
        primaryDimension: lowestDimension.dimensionId,
        dimensionName: lowestDimension.name,
        confidence: lowestDimension.confidence,
        title: `Maintenance Drill: ${selectedScenario.name}`,
        rationale: `Your performance across all measured skills meets baseline benchmarks. Focus on ${lowestDimension.name} to continue refining high-tier consistency.`,
        evidence: lowestDimension.evidenceSummary,
        benchmarkTarget: config.benchmarkTarget,
        dimensionEvaluations: evaluations,
      };
    }
  }

  // 6. General fallback (data exists but insufficient samples per individual dimension)
  const fallbackScenario = getScenarioById('flick-static')!;
  return {
    isColdStart: false,
    recommendationType: 'drill',
    recommendedScenarioId: fallbackScenario.id,
    recommendedScenarioName: fallbackScenario.name,
    targetDifficulty,
    primaryDimension: null,
    confidence: 0.25,
    title: `Recommended Drill: ${fallbackScenario.name}`,
    rationale: 'Continue establishing drill history across distinct categories to unlock specific weakness detection.',
    evidence: `${validSessions.length} total sessions recorded across scattered categories.`,
    benchmarkTarget: 'Play 2 or more sessions in the same category.',
    dimensionEvaluations: evaluations,
  };
}
