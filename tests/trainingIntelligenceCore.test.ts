import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store';
import {
  isEligibleForReactionMetric,
  calculateRoutineReactionSummary,
} from '../src/analytics';
import {
  evaluateSkillDimensions,
  generateRecommendation,
  COLD_START_MIN_SESSIONS,
  DIMENSION_MIN_SAMPLES,
} from '../src/recommendations';
import { getScenarioById, SCENARIOS } from '../src/scenarios';
import type { SessionResult } from '../src/types';

function createDummySession(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    id: `session_${Math.random()}`,
    scenarioId: 'flick-static',
    scenarioName: 'Static Flicks',
    category: 'flick',
    difficulty: 'intermediate',
    timestamp: Date.now(),
    durationSec: 60,
    score: 1000,
    hits: 20,
    misses: 5,
    headshots: 10,
    shotsFired: 25,
    accuracy: 80.0,
    headshotPct: 50.0,
    avgReactionMs: 220,
    medianReactionMs: 220,
    bestReactionMs: 190,
    targetsPerSecond: 0.33,
    ...overrides,
  };
}

describe('Stage 1.A — Personal-Best Isolation & Legacy Compatibility', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('difficulty-specific PB query never returns a PB from another difficulty', () => {
    // Record Beginner PB
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      difficulty: 'beginner',
      score: 1500,
      accuracy: 95.0,
    }));

    // Pro query must return null because no Pro session has been recorded yet
    expect(store.getPB('flick-static', 'pro')).toBeNull();

    // Intermediate query must return null
    expect(store.getPB('flick-static', 'intermediate')).toBeNull();

    // Beginner query returns the beginner PB
    const beginnerPB = store.getPB('flick-static', 'beginner');
    expect(beginnerPB).not.toBeNull();
    expect(beginnerPB?.score).toBe(1500);

    // Global PB (omitted difficulty) returns the session score
    const globalPB = store.getPB('flick-static');
    expect(globalPB).not.toBeNull();
    expect(globalPB?.score).toBe(1500);
  });

  it('preserves distinct records across difficulties without cross-contamination', () => {
    // Beginner: 1500
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      difficulty: 'beginner',
      score: 1500,
    }));

    // Advanced: 1100
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      difficulty: 'advanced',
      score: 1100,
    }));

    // Pro: 800
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      difficulty: 'pro',
      score: 800,
    }));

    expect(store.getPB('flick-static', 'beginner')?.score).toBe(1500);
    expect(store.getPB('flick-static', 'advanced')?.score).toBe(1100);
    expect(store.getPB('flick-static', 'pro')?.score).toBe(800);
    expect(store.getPB('flick-static', 'intermediate')).toBeNull();

    // Global PB is highest overall
    expect(store.getPB('flick-static')?.score).toBe(1500);
  });

  it('handles legacy and malformed PB records without difficulty safely', () => {
    // Simulate legacy storage with unkeyed scenario record
    localStorage.setItem(
      'vwt_pbs_v2',
      JSON.stringify({
        'flick-static': {
          scenarioId: 'flick-static',
          score: 1200,
          accuracy: 85,
          avgReactionMs: 230,
          timestamp: 1234567,
        },
      })
    );

    const legacyStore = new Store();
    // Global query finds it
    expect(legacyStore.getPB('flick-static')?.score).toBe(1200);

    // Difficulty-specific query must not leak the legacy unkeyed record
    expect(legacyStore.getPB('flick-static', 'pro')).toBeNull();
    expect(legacyStore.getPB('flick-static', 'beginner')).toBeNull();

    // Querying with empty or invalid scenarioId returns null
    expect(legacyStore.getPB('')).toBeNull();
  });
});

describe('Stage 1.B — Valid Metric Aggregation (Tracking Exclusion)', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('tracking drills do not contaminate overallAccuracy or overallHeadshotPercentage', () => {
    // Session 1: Flick drill, 10 hits / 10 shots = 100% acc, 10 headshots = 100% HS
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      category: 'flick',
      hits: 10,
      misses: 0,
      headshots: 10,
      shotsFired: 10,
      accuracy: 100.0,
      headshotPct: 100.0,
    }));

    // Session 2: Tracking drill where player fired 1 shot and missed, or 0 shots
    store.addSession(createDummySession({
      scenarioId: 'track-smooth',
      category: 'tracking',
      hits: 0,
      misses: 10,
      headshots: 0,
      shotsFired: 10,
      accuracy: 0.0,
      timeOnTarget: 85.0,
    }));

    // Shooting accuracy must still be 100%, unaffected by tracking misses
    expect(store.overallAccuracy()).toBe(100.0);
    expect(store.overallHeadshotPercentage()).toBe(100.0);

    // Aggregate stats expose both shooting accuracy and all-drill totals
    const agg = store.getAggregateStats();
    expect(agg.overallAccuracy).toBe(100.0);
    expect(agg.overallHeadshotPct).toBe(100.0);
    expect(agg.totalHits).toBe(10);
    expect(agg.totalShots).toBe(20); // 10 flick + 10 tracking
    expect(agg.shootingDrillsCount).toBe(1);
    expect(agg.trackingDrillsCount).toBe(1);
  });

  it('guards zero-denominator cases cleanly', () => {
    // Empty store
    expect(store.overallAccuracy()).toBe(0);
    expect(store.overallHeadshotPercentage()).toBe(0);
    const agg = store.getAggregateStats();
    expect(agg.overallAccuracy).toBe(0);
    expect(agg.overallHeadshotPct).toBe(0);
    expect(agg.totalShots).toBe(0);
  });
});

describe('Stage 1.C — Reaction Time Validity & Multi-Target Exclusion', () => {
  it('identifies single-target reaction drills as eligible', () => {
    const staticFlicks = getScenarioById('flick-static');
    const visualReaction = getScenarioById('reaction-visual');
    const jigglePeek = getScenarioById('tactical-jiggle');
    const reactiveFlicks = getScenarioById('flick-reactive');

    expect(isEligibleForReactionMetric(staticFlicks)).toBe(true);
    expect(isEligibleForReactionMetric(visualReaction)).toBe(true);
    expect(isEligibleForReactionMetric(jigglePeek)).toBe(true);
    expect(isEligibleForReactionMetric(reactiveFlicks)).toBe(true);
  });

  it('marks multi-target drills strictly ineligible for single-target reaction measurement', () => {
    const multiFlicks = getScenarioById('flick-multi'); // targetCount: 3
    const angleClear = getScenarioById('tactical-angle-clear'); // targetCount: 2
    const headLevel = getScenarioById('tactical-headlevel'); // targetCount: 2
    const clutch = getScenarioById('hybrid-clutch'); // targetCount: 3
    const flashDelayed = getScenarioById('flash-delayed'); // targetCount: 2

    expect(isEligibleForReactionMetric(multiFlicks)).toBe(false);
    expect(isEligibleForReactionMetric(angleClear)).toBe(false);
    expect(isEligibleForReactionMetric(headLevel)).toBe(false);
    expect(isEligibleForReactionMetric(clutch)).toBe(false);
    expect(isEligibleForReactionMetric(flashDelayed)).toBe(false);
  });

  it('marks tracking drills ineligible for reaction measurement', () => {
    const smoothTrack = getScenarioById('track-smooth');
    const strafeTrack = getScenarioById('track-strafe');

    expect(isEligibleForReactionMetric(smoothTrack)).toBe(false);
    expect(isEligibleForReactionMetric(strafeTrack)).toBe(false);
  });

  it('handles missing and undefined metadata safely', () => {
    expect(isEligibleForReactionMetric(undefined)).toBe(false);
    expect(isEligibleForReactionMetric({})).toBe(false);
    expect(isEligibleForReactionMetric({ meaningfulReactionTime: false, targetCount: 1 })).toBe(false);
  });
});

describe('Stage 1.D — Routine Reaction Aggregation with Unequal Sample Counts', () => {
  it('weights drill averages by valid hit counts on eligible drills', () => {
    // Drill 1 (eligible single-target): 50 hits with fast 200ms avg
    const drill1 = createDummySession({
      scenarioId: 'flick-static',
      hits: 50,
      avgReactionMs: 200,
    });

    // Drill 2 (eligible single-target): 5 hits with slow 300ms avg
    const drill2 = createDummySession({
      scenarioId: 'reaction-visual',
      hits: 5,
      avgReactionMs: 300,
    });

    // True weighted average: (50*200 + 5*300) / 55 = 11500 / 55 = 209ms
    // Unweighted average would be 250ms (distorted)
    const summary = calculateRoutineReactionSummary([drill1, drill2]);
    expect(summary.weightedAvgReactionMs).toBe(209);
    expect(summary.eligibleHitsCount).toBe(55);
    expect(summary.eligibleDrillsCount).toBe(2);
  });

  it('excludes multi-target and tracking drills from routine reaction calculation', () => {
    // Eligible drill: 30 hits at 210ms
    const eligibleDrill = createDummySession({
      scenarioId: 'flick-static',
      hits: 30,
      avgReactionMs: 210,
    });

    // Multi-target drill (targetCount 2): 40 hits at 480ms (misleading sequential latency)
    const multiTargetDrill = createDummySession({
      scenarioId: 'tactical-angle-clear',
      hits: 40,
      avgReactionMs: 480,
    });

    // Tracking drill: 0 hits, avgReactionMs 0
    const trackingDrill = createDummySession({
      scenarioId: 'track-smooth',
      hits: 0,
      avgReactionMs: 0,
    });

    const summary = calculateRoutineReactionSummary([eligibleDrill, multiTargetDrill, trackingDrill]);
    expect(summary.weightedAvgReactionMs).toBe(210);
    expect(summary.eligibleHitsCount).toBe(30);
    expect(summary.eligibleDrillsCount).toBe(1);
  });

  it('handles empty results and zero-hit cases gracefully', () => {
    expect(calculateRoutineReactionSummary([]).weightedAvgReactionMs).toBe(0);
    expect(calculateRoutineReactionSummary([]).eligibleHitsCount).toBe(0);

    const zeroHits = createDummySession({
      scenarioId: 'flick-static',
      hits: 0,
      avgReactionMs: 0,
    });
    expect(calculateRoutineReactionSummary([zeroHits]).weightedAvgReactionMs).toBe(0);
  });
});

describe('Stage 2 — Recommendation Engine', () => {
  it('returns cold-start recommendation when fewer than 3 sessions exist', () => {
    // 0 sessions
    const rec0 = generateRecommendation([]);
    expect(rec0.isColdStart).toBe(true);
    expect(rec0.recommendationType).toBe('routine');
    expect(rec0.recommendedRoutineId).toBe('routine-5m');
    expect(rec0.confidence).toBe(0);
    expect(rec0.primaryDimension).toBeNull();

    // 2 sessions
    const rec2 = generateRecommendation([
      createDummySession({ scenarioId: 'flick-static' }),
      createDummySession({ scenarioId: 'track-smooth' }),
    ]);
    expect(rec2.isColdStart).toBe(true);
    expect(rec2.recommendedRoutineId).toBe('routine-5m');
  });

  it('does not label dimensions with no data or single sample as weaknesses', () => {
    // Player played 3 sessions of tracking only
    const sessions = [
      createDummySession({
        scenarioId: 'track-smooth',
        category: 'tracking',
        timeOnTarget: 40.0, // weak tracking
      }),
      createDummySession({
        scenarioId: 'track-strafe',
        category: 'tracking',
        timeOnTarget: 45.0,
      }),
      createDummySession({
        scenarioId: 'track-reactive',
        category: 'tracking',
        timeOnTarget: 42.0,
      }),
    ];

    const evals = evaluateSkillDimensions(sessions);
    const flickDim = evals.find((e) => e.dimensionId === 'flick_accuracy')!;
    const reactionDim = evals.find((e) => e.dimensionId === 'reaction_time')!;
    const steadyDim = evals.find((e) => e.dimensionId === 'steady_aim_discipline')!;
    const trackingDim = evals.find((e) => e.dimensionId === 'smooth_tracking')!;

    // Dimensions with 0 samples must NOT be deficits
    expect(flickDim.sampleCount).toBe(0);
    expect(flickDim.isDeficit).toBe(false);
    expect(reactionDim.sampleCount).toBe(0);
    expect(reactionDim.isDeficit).toBe(false);
    expect(steadyDim.sampleCount).toBe(0);
    expect(steadyDim.isDeficit).toBe(false);

    // Tracking has 3 samples and is below benchmark (65) -> is deficit!
    expect(trackingDim.sampleCount).toBe(3);
    expect(trackingDim.isDeficit).toBe(true);
  });

  it('requires at least 2 samples per dimension before establishing a weakness', () => {
    // 1 poor flick session, 2 good tracking sessions -> total sessions = 3
    const sessions = [
      createDummySession({
        scenarioId: 'flick-static',
        category: 'flick',
        accuracy: 20.0, // very poor, but only 1 sample!
      }),
      createDummySession({
        scenarioId: 'track-smooth',
        category: 'tracking',
        timeOnTarget: 80.0,
      }),
      createDummySession({
        scenarioId: 'track-strafe',
        category: 'tracking',
        timeOnTarget: 85.0,
      }),
    ];

    const evals = evaluateSkillDimensions(sessions);
    const flickDim = evals.find((e) => e.dimensionId === 'flick_accuracy')!;
    // With 1 sample, it must NOT be marked as an established deficit
    expect(flickDim.sampleCount).toBe(1);
    expect(flickDim.isDeficit).toBe(false);
  });

  it('identifies genuine weakness and recommends an eligible drill with anti-circularity', () => {
    // Player has poor steady-aim (movement inaccuracy)
    // Most recent session was tactical-counter-strafe
    const sessions = [
      createDummySession({
        scenarioId: 'tactical-counter-strafe',
        category: 'tactical',
        shotsMoving: 15,
        shotsStationary: 5, // 25% stationary ratio
      }),
      createDummySession({
        scenarioId: 'tactical-firstshot',
        category: 'tactical',
        shotsMoving: 14,
        shotsStationary: 6, // 30% stationary ratio
      }),
      createDummySession({
        scenarioId: 'flick-static',
        category: 'flick',
        accuracy: 85.0,
      }),
    ];

    const rec = generateRecommendation(sessions, 'advanced');
    expect(rec.isColdStart).toBe(false);
    expect(rec.recommendationType).toBe('drill');
    expect(rec.primaryDimension).toBe('steady_aim_discipline');

    // Anti-circularity: most recent drill was tactical-counter-strafe, so engine recommends tactical-firstshot!
    expect(rec.recommendedScenarioId).toBe('tactical-firstshot');
    expect(rec.evidence).toContain('Stationary shot ratio');
    expect(rec.rationale).toBeDefined();

    // Verify recommended drill exists in SCENARIOS
    const exists = SCENARIOS.some((s) => s.id === rec.recommendedScenarioId);
    expect(exists).toBe(true);
  });

  it('applies recency weighting so recent performance influences score more than old performance', () => {
    // 3 flick sessions:
    // Session 0 (newest): 90% accuracy
    // Session 1: 50% accuracy
    // Session 2 (oldest): 40% accuracy
    const sessions = [
      createDummySession({ scenarioId: 'flick-static', accuracy: 90 }),
      createDummySession({ scenarioId: 'flick-static', accuracy: 50 }),
      createDummySession({ scenarioId: 'flick-static', accuracy: 40 }),
    ];

    const evals = evaluateSkillDimensions(sessions);
    const flick = evals.find((e) => e.dimensionId === 'flick_accuracy')!;

    // Unweighted arithmetic mean would be (90+50+40)/3 = 60.0
    // Recency weighted: 90*1.0 + 50*0.86 + 40*0.74 > 60
    expect(flick.score).toBeGreaterThan(60);
    expect(flick.sampleCount).toBe(3);
    expect(flick.eligibleSessionIds.length).toBe(3);
  });

  it('is completely deterministic for identical inputs', () => {
    const sessions = [
      createDummySession({ scenarioId: 'flick-static', accuracy: 55 }),
      createDummySession({ scenarioId: 'flick-micro', accuracy: 50 }),
      createDummySession({ scenarioId: 'flick-wide', accuracy: 60 }),
    ];

    const rec1 = generateRecommendation(sessions);
    const rec2 = generateRecommendation(sessions);

    expect(rec1.recommendedScenarioId).toBe(rec2.recommendedScenarioId);
    expect(rec1.primaryDimension).toBe(rec2.primaryDimension);
    expect(rec1.confidence).toBe(rec2.confidence);
    expect(rec1.title).toBe(rec2.title);
  });

  it('handles corrupted, null, and malformed session items without throwing', () => {
    const corruptedSessions: any[] = [
      null,
      undefined,
      {},
      { scenarioId: '' },
      { scenarioId: 'flick-static', accuracy: NaN },
      { scenarioId: 'flick-static', accuracy: -10 },
      createDummySession({ scenarioId: 'flick-static', accuracy: 80 }),
    ];

    expect(() => evaluateSkillDimensions(corruptedSessions)).not.toThrow();
    expect(() => generateRecommendation(corruptedSessions)).not.toThrow();
  });
});
