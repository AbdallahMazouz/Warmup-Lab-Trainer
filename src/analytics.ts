// =====================================================================
// analytics.ts — Centralized Session Analytics & Metric Calculations
// =====================================================================

import type { SessionResult } from './types';
import { getScenarioById } from './scenarios';

export interface SessionMetricsInput {
  score: number;
  hits: number;
  misses: number;
  headshots: number;
  reactions: number[];
  durationSec: number;
  shotsMoving?: number;
  shotsStationary?: number;
  totalTrackingTicks?: number;
  onTargetTrackingTicks?: number;
  totalFlashes?: number;
  flashAvoidCount?: number;
}

export interface CalculatedSessionMetrics {
  score: number;
  hits: number;
  misses: number;
  headshots: number;
  bodyHits: number;
  shotsFired: number;
  accuracy: number;           // 0-100 (%)
  headshotPct: number;        // 0-100 (%)
  avgReactionMs: number;
  medianReactionMs: number;
  bestReactionMs: number;
  targetsPerSecond: number;
  targetsPerMinute: number;
  shotsMoving: number;
  shotsStationary: number;
  timeOnTarget?: number;      // 0-100 (%)
  flashAvoidRate?: number;    // 0-100 (%)
}

/**
 * Calculates overall shooting accuracy as a percentage (0-100).
 * Guaranteed to return a finite number between 0 and 100, never NaN or Infinity.
 */
export function calculateAccuracy(hits: number, shotsFired: number): number {
  if (!Number.isFinite(hits) || !Number.isFinite(shotsFired) || shotsFired <= 0 || hits <= 0) {
    return 0;
  }
  const acc = (hits / shotsFired) * 100;
  return Number(Math.min(100, Math.max(0, acc)).toFixed(1));
}

/**
 * Calculates headshot percentage relative to successful hits (0-100).
 * Guaranteed to return a finite number between 0 and 100, never NaN or Infinity.
 */
export function calculateHeadshotPercentage(headshots: number, hits: number): number {
  if (!Number.isFinite(headshots) || !Number.isFinite(hits) || hits <= 0 || headshots <= 0) {
    return 0;
  }
  const pct = (headshots / hits) * 100;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(1));
}

/**
 * Computes average, median, and best reaction times from an array of millisecond values.
 * Handles empty arrays, single values, even and odd lengths cleanly.
 */
export function calculateReactionMetrics(reactions: number[]): {
  avgReactionMs: number;
  medianReactionMs: number;
  bestReactionMs: number;
} {
  const valid = reactions.filter(r => typeof r === 'number' && Number.isFinite(r) && r > 0);
  if (valid.length === 0) {
    return { avgReactionMs: 0, medianReactionMs: 0, bestReactionMs: 0 };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = Math.round(sum / sorted.length);

  const mid = Math.floor(sorted.length / 2);
  let median: number;
  if (sorted.length % 2 === 0) {
    median = Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  } else {
    median = Math.round(sorted[mid]);
  }

  const best = Math.round(sorted[0]);

  return {
    avgReactionMs: avg,
    medianReactionMs: median,
    bestReactionMs: best,
  };
}

/**
 * Calculates target hit rate per second and per minute.
 */
export function calculateTargetRates(hits: number, durationSec: number): {
  perSecond: number;
  perMinute: number;
} {
  if (!Number.isFinite(hits) || !Number.isFinite(durationSec) || durationSec <= 0 || hits <= 0) {
    return { perSecond: 0, perMinute: 0 };
  }
  const perSecond = Number((hits / durationSec).toFixed(2));
  const perMinute = Number(((hits / durationSec) * 60).toFixed(1));
  return { perSecond, perMinute };
}

/**
 * Centralized calculation of all end-of-session performance metrics.
 * Ensures data integrity across Engine, UI, and Store.
 */
export function calculateSessionMetrics(input: SessionMetricsInput): CalculatedSessionMetrics {
  const hits = Math.max(0, Math.floor(Number.isFinite(input.hits) ? input.hits : 0));
  const misses = Math.max(0, Math.floor(Number.isFinite(input.misses) ? input.misses : 0));
  const headshots = Math.min(hits, Math.max(0, Math.floor(Number.isFinite(input.headshots) ? input.headshots : 0)));
  const bodyHits = hits - headshots;
  const shotsFired = hits + misses;

  const durationSec = Math.max(0, Number.isFinite(input.durationSec) ? input.durationSec : 0);
  const score = Math.max(0, Math.floor(Number.isFinite(input.score) ? input.score : 0));

  const accuracy = calculateAccuracy(hits, shotsFired);
  const headshotPct = calculateHeadshotPercentage(headshots, hits);
  const { avgReactionMs, medianReactionMs, bestReactionMs } = calculateReactionMetrics(input.reactions || []);
  const { perSecond, perMinute } = calculateTargetRates(hits, durationSec);

  const shotsMoving = Math.max(0, Math.floor(Number.isFinite(input.shotsMoving) ? input.shotsMoving! : 0));
  const shotsStationary = Math.max(0, Math.floor(Number.isFinite(input.shotsStationary) ? input.shotsStationary! : 0));

  let timeOnTarget: number | undefined;
  if (input.totalTrackingTicks && input.totalTrackingTicks > 0) {
    const onTarget = input.onTargetTrackingTicks || 0;
    timeOnTarget = Number(((onTarget / input.totalTrackingTicks) * 100).toFixed(1));
  }

  let flashAvoidRate: number | undefined;
  if (input.totalFlashes && input.totalFlashes > 0) {
    const avoided = input.flashAvoidCount || 0;
    flashAvoidRate = Number(((avoided / input.totalFlashes) * 100).toFixed(1));
  }

  return {
    score,
    hits,
    misses,
    headshots,
    bodyHits,
    shotsFired,
    accuracy,
    headshotPct,
    avgReactionMs,
    medianReactionMs,
    bestReactionMs,
    targetsPerSecond: perSecond,
    targetsPerMinute: perMinute,
    shotsMoving,
    shotsStationary,
    timeOnTarget,
    flashAvoidRate,
  };
}

/**
 * Determines whether a scenario is eligible for valid single-target reaction measurement.
 * Multi-target scenarios and tracking scenarios are strictly excluded to avoid acquisition latency distortion.
 */
export function isEligibleForReactionMetric(scenario: {
  meaningfulReactionTime?: boolean;
  targetCount?: number;
} | undefined): boolean {
  if (!scenario) return false;
  return Boolean(scenario.meaningfulReactionTime && (scenario.targetCount === 1 || scenario.targetCount === undefined));
}

/**
 * Calculates routine-level reaction time from completed drills.
 * Weights drill averages by the number of hits (valid sample count) on eligible drills,
 * preventing low-hit drills from skewing the routine average.
 * Note: Raw per-shot reaction samples are not persisted in historical session records;
 * this represents a hit-weighted aggregate of drill averages rather than an exact pooled per-shot average.
 * Multi-target and tracking drills are strictly excluded.
 */
export function calculateRoutineReactionSummary(results: SessionResult[]): {
  weightedAvgReactionMs: number;
  eligibleHitsCount: number;
  eligibleDrillsCount: number;
} {
  if (!Array.isArray(results) || results.length === 0) {
    return { weightedAvgReactionMs: 0, eligibleHitsCount: 0, eligibleDrillsCount: 0 };
  }

  let totalWeightedReaction = 0;
  let totalEligibleHits = 0;
  let eligibleDrillsCount = 0;

  for (const r of results) {
    if (!r || !r.scenarioId) continue;
    const sc = getScenarioById(r.scenarioId);
    if (!isEligibleForReactionMetric(sc)) continue;

    const hits = typeof r.hits === 'number' && Number.isFinite(r.hits) ? Math.max(0, r.hits) : 0;
    const avgMs = typeof r.avgReactionMs === 'number' && Number.isFinite(r.avgReactionMs) ? r.avgReactionMs : 0;

    if (hits > 0 && avgMs > 0) {
      totalWeightedReaction += avgMs * hits;
      totalEligibleHits += hits;
      eligibleDrillsCount++;
    }
  }

  const weightedAvg = totalEligibleHits > 0
    ? Math.round(totalWeightedReaction / totalEligibleHits)
    : 0;

  return {
    weightedAvgReactionMs: weightedAvg,
    eligibleHitsCount: totalEligibleHits,
    eligibleDrillsCount,
  };
}
