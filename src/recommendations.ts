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
  const targetDifficulty: DifficultyId = preferredDifficulty || 'intermediate';

  // 1. Cold Start: If total valid sessions < COLD_START_MIN_SESSIONS
  if (validSessions.length < COLD_START_MIN_SESSIONS) {
    const routine = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m') || TRAINING_ROUTINES[0];
    return {
      isColdStart: true,
      recommendationType: 'routine',
      recommendedRoutineId: routine.id,
      recommendedRoutineName: routine.name,
      targetDifficulty,
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

  // 2. Identify candidate deficit dimensions
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
      return {
        isColdStart: false,
        recommendationType: 'drill',
        recommendedScenarioId: selectedScenario.id,
        recommendedScenarioName: selectedScenario.name,
        targetDifficulty,
        primaryDimension: primaryDeficit.dimensionId,
        dimensionName: primaryDeficit.name,
        confidence: primaryDeficit.confidence,
        title: `Focus Drill: ${selectedScenario.name}`,
        rationale: config.rationale,
        evidence: primaryDeficit.evidenceSummary,
        benchmarkTarget: config.benchmarkTarget,
        dimensionEvaluations: evaluations,
      };
    }
  }

  // 3. Fallback when no deficit exists (player is performing well across all measured dimensions)
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

  // 4. General fallback (data exists but insufficient samples per individual dimension)
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
