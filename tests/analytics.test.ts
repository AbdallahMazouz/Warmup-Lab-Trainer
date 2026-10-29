// =====================================================================
// tests/analytics.test.ts — Unit Tests for Sprint 2B: Training Analytics & Progress Tracking
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  calculateAccuracy,
  calculateHeadshotPercentage,
  calculateReactionMetrics,
  calculateTargetRates,
  calculateSessionMetrics,
} from '../src/analytics';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { TargetManager } from '../src/targetManager';
import { HEAD_LEVEL_Y } from '../src/constants';
import type { SessionResult, ScenarioConfig } from '../src/types';

describe('Analytics Calculations (Core Math & Edge Cases)', () => {
  it('calculates accuracy correctly for normal shots', () => {
    expect(calculateAccuracy(50, 100)).toBe(50.0);
    expect(calculateAccuracy(1, 3)).toBe(33.3);
    expect(calculateAccuracy(24, 25)).toBe(96.0);
  });

  it('handles zero-shot and zero-hit cases without returning NaN or Infinity', () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
    expect(calculateAccuracy(0, 50)).toBe(0);
    expect(calculateAccuracy(-5, 0)).toBe(0);
    expect(calculateAccuracy(0, -10)).toBe(0);
    expect(calculateAccuracy(NaN, 50)).toBe(0);
    expect(calculateAccuracy(50, NaN)).toBe(0);
    expect(calculateAccuracy(Infinity, 50)).toBe(0);
  });

  it('calculates headshot percentage correctly relative to hits', () => {
    expect(calculateHeadshotPercentage(25, 50)).toBe(50.0);
    expect(calculateHeadshotPercentage(10, 10)).toBe(100.0);
    expect(calculateHeadshotPercentage(1, 3)).toBe(33.3);
  });

  it('handles zero-hit cases for headshot percentage without returning NaN or Infinity', () => {
    expect(calculateHeadshotPercentage(0, 0)).toBe(0);
    expect(calculateHeadshotPercentage(5, 0)).toBe(0);
    expect(calculateHeadshotPercentage(-2, 10)).toBe(0);
    expect(calculateHeadshotPercentage(NaN, 10)).toBe(0);
    expect(calculateHeadshotPercentage(10, NaN)).toBe(0);
  });

  it('calculates average, median, and best reaction times for odd, even, and single lists', () => {
    // Single reaction
    const single = calculateReactionMetrics([250]);
    expect(single.avgReactionMs).toBe(250);
    expect(single.medianReactionMs).toBe(250);
    expect(single.bestReactionMs).toBe(250);

    // Odd count: [180, 200, 250, 300, 400] -> median is 250, avg is 266, best is 180
    const odd = calculateReactionMetrics([300, 180, 250, 400, 200]);
    expect(odd.bestReactionMs).toBe(180);
    expect(odd.medianReactionMs).toBe(250);
    expect(odd.avgReactionMs).toBe(266);

    // Even count: [150, 200, 300, 350] -> median is (200+300)/2 = 250, avg is 250, best is 150
    const even = calculateReactionMetrics([350, 150, 300, 200]);
    expect(even.bestReactionMs).toBe(150);
    expect(even.medianReactionMs).toBe(250);
    expect(even.avgReactionMs).toBe(250);
  });

  it('handles empty or invalid reaction time lists gracefully', () => {
    const empty = calculateReactionMetrics([]);
    expect(empty.avgReactionMs).toBe(0);
    expect(empty.medianReactionMs).toBe(0);
    expect(empty.bestReactionMs).toBe(0);

    const invalid = calculateReactionMetrics([-10, NaN, 0, Infinity]);
    expect(invalid.avgReactionMs).toBe(0);
    expect(invalid.medianReactionMs).toBe(0);
    expect(invalid.bestReactionMs).toBe(0);
  });

  it('calculates targets per second and targets per minute accurately', () => {
    const rates = calculateTargetRates(30, 60);
    expect(rates.perSecond).toBe(0.5);
    expect(rates.perMinute).toBe(30.0);

    const fast = calculateTargetRates(45, 30);
    expect(fast.perSecond).toBe(1.5);
    expect(fast.perMinute).toBe(90.0);

    const zero = calculateTargetRates(0, 60);
    expect(zero.perSecond).toBe(0);
    expect(zero.perMinute).toBe(0);

    const zeroDur = calculateTargetRates(10, 0);
    expect(zeroDur.perSecond).toBe(0);
    expect(zeroDur.perMinute).toBe(0);
  });

  it('calculateSessionMetrics centralizes calculations into a complete verified summary', () => {
    const summary = calculateSessionMetrics({
      score: 1250,
      hits: 40,
      misses: 10,
      headshots: 15,
      reactions: [180, 210, 240, 290],
      durationSec: 60,
      shotsMoving: 5,
      shotsStationary: 45,
    });

    expect(summary.shotsFired).toBe(50);
    expect(summary.hits).toBe(40);
    expect(summary.misses).toBe(10);
    expect(summary.headshots).toBe(15);
    expect(summary.bodyHits).toBe(25);
    expect(summary.accuracy).toBe(80.0);
    expect(summary.headshotPct).toBe(37.5);
    expect(summary.bestReactionMs).toBe(180);
    expect(summary.avgReactionMs).toBe(230);
    expect(summary.medianReactionMs).toBe(225);
    expect(summary.targetsPerSecond).toBe(0.67);
    expect(summary.targetsPerMinute).toBe(40.0);
    expect(summary.shotsMoving).toBe(5);
    expect(summary.shotsStationary).toBe(45);
  });
});

describe('Store Persistence, Sanitization & PB Isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('limits session history to a maximum of 50 sessions', () => {
    const store = new Store();
    for (let i = 1; i <= 65; i++) {
      store.addSession({
        id: `sess_${i}`,
        scenarioId: 'flick-static',
        scenarioName: 'Static Flicks',
        category: 'flick',
        difficulty: 'intermediate',
        timestamp: Date.now() + i,
        durationSec: 60,
        score: 100 + i,
        hits: 10,
        misses: 2,
        headshots: 5,
        accuracy: 83.3,
        avgReactionMs: 200,
        medianReactionMs: 195,
        bestReactionMs: 180,
        targetsPerSecond: 0.17,
      });
    }

    expect(store.totalSessions()).toBe(50);
    // Most recent session (id: sess_65) must be first
    const recent = store.getRecentSessions(1);
    expect(recent[0].id).toBe('sess_65');
  });

  it('prevents saving duplicate sessions with the same id', () => {
    const store = new Store();
    const session: SessionResult = {
      id: 'unique_session_123',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 500,
      hits: 10,
      misses: 2,
      headshots: 5,
      accuracy: 83.3,
      avgReactionMs: 200,
      medianReactionMs: 195,
      bestReactionMs: 180,
      targetsPerSecond: 0.17,
    };

    const res1 = store.addSession(session);
    expect(res1.isPB).toBe(true);
    expect(store.totalSessions()).toBe(1);

    // Attempt to add duplicate
    const res2 = store.addSession(session);
    expect(res2.isPB).toBe(false);
    expect(store.totalSessions()).toBe(1);
  });

  it('recovers safely from malformed or corrupted localStorage data', () => {
    // 1. Corrupted JSON string
    localStorage.setItem('vwt_sessions_v2', '{ corrupted json ...');
    localStorage.setItem('vwt_pbs_v2', 'not even json');
    const store1 = new Store();
    expect(store1.totalSessions()).toBe(0);
    expect(store1.getAllPBs()).toEqual({});

    // 2. Array containing nulls, invalid objects, and NaN fields
    const malformed = [
      null,
      123,
      { scenarioId: '' }, // empty scenarioId
      {
        id: 'bad_session',
        scenarioId: 'flick-static',
        score: NaN,
        accuracy: Infinity,
        durationSec: 'invalid',
        hits: null,
      },
      {
        id: 'valid_session',
        scenarioId: 'flick-static',
        score: 800,
        hits: 20,
        misses: 5,
        headshots: 8,
        accuracy: 80,
        avgReactionMs: 220,
      },
    ];
    localStorage.setItem('vwt_sessions_v2', JSON.stringify(malformed));

    const store2 = new Store();
    // Only valid_session and sanitized bad_session should load; nulls/empty rejected
    expect(store2.totalSessions()).toBe(2);
    const valid = store2.getSessions('flick-static');
    expect(valid.length).toBe(2);
    expect(Number.isFinite(valid[0].score)).toBe(true);
    expect(Number.isFinite(valid[1].score)).toBe(true);
  });

  it('compares personal bests strictly like-for-like matching scenarioId only', () => {
    const store = new Store();

    // Session 1 in 'flick-static' with score 1000
    store.addSession({
      id: 'sess_flick_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
      durationSec: 60,
      score: 1000,
      hits: 20,
      misses: 0,
      headshots: 10,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.33,
    });

    // Session 2 in different scenario 'tactical-angle-clear' with score 800
    // Should be PB for tactical-angle-clear, and NOT affect flick-static
    const resTac = store.addSession({
      id: 'sess_tac_1',
      scenarioId: 'tactical-angle-clear',
      scenarioName: 'Angle Clearing',
      category: 'tactical',
      difficulty: 'advanced',
      timestamp: 2000,
      durationSec: 60,
      score: 800,
      hits: 15,
      misses: 2,
      headshots: 8,
      accuracy: 88.2,
      avgReactionMs: 240,
      medianReactionMs: 235,
      bestReactionMs: 190,
      targetsPerSecond: 0.25,
    });
    expect(resTac.isPB).toBe(true);

    // Verify PBs are isolated
    expect(store.getPB('flick-static')?.score).toBe(1000);
    expect(store.getPB('tactical-angle-clear')?.score).toBe(800);

    // Lower score in flick-static (900) should NOT be PB
    const resLower = store.addSession({
      id: 'sess_flick_2',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 3000,
      durationSec: 60,
      score: 900,
      hits: 18,
      misses: 2,
      headshots: 9,
      accuracy: 90,
      avgReactionMs: 210,
      medianReactionMs: 205,
      bestReactionMs: 190,
      targetsPerSecond: 0.3,
    });
    expect(resLower.isPB).toBe(false);
    expect(store.getPB('flick-static')?.score).toBe(1000);
  });
});

describe('Monotonic Target Timestamps & Reaction Time Isolation', () => {
  it('records target spawnTime using monotonic clock and computes reactionMs upon hit', () => {
    const tm = new TargetManager();
    const config: ScenarioConfig = {
      id: 'flick-static',
      name: 'Static Flicks',
      category: 'flick',
      description: 'Test',
      skill: 'aim',
      difficulty: 'intermediate',
      durationSec: 30,
      targetCount: 1,
      targetSizeMultiplier: 1,
      targetSpeedMultiplier: 1,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
    };

    const t0 = performance.now();
    const target = tm.spawnTarget(config, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    expect(target.spawnTime).toBeGreaterThanOrEqual(t0 - 1);

    // Ray shooting at head
    const ray = new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1));
    const hit = tm.checkHit(ray);

    expect(hit.hit).toBe(true);
    expect(hit.reactionMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(hit.reactionMs)).toBe(true);
  });

  it('does not measure reaction time for expired targets that were never hit', () => {
    const tm = new TargetManager();
    const config: ScenarioConfig = {
      id: 'flick-static',
      name: 'Static Flicks',
      category: 'flick',
      description: 'Test',
      skill: 'aim',
      difficulty: 'intermediate',
      durationSec: 30,
      targetCount: 1,
      targetSizeMultiplier: 1,
      targetSpeedMultiplier: 1,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
    };

    const target = tm.spawnTarget(config, new THREE.Vector3(0, HEAD_LEVEL_Y, -10), 'static', 0.2);
    expect(tm.getActiveCount()).toBe(1);

    // Advance time past expiration
    tm.update(0.1, target.spawnTime + 300);
    expect(tm.getActiveCount()).toBe(0);

    // A shot at the expired target position produces a miss (reactionMs = 0, hit = false)
    const ray = new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1));
    const hit = tm.checkHit(ray);
    expect(hit.hit).toBe(false);
    expect(hit.reactionMs).toBe(0);
  });
});

describe('Session Lifecycle, Clean Resets & Metric Leak Prevention', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;

  const testConfig: ScenarioConfig = {
    id: 'flick-static',
    name: 'Static Flicks',
    category: 'flick',
    description: 'Test',
    skill: 'aim',
    difficulty: 'intermediate',
    durationSec: 30,
    targetCount: 1,
    targetSizeMultiplier: 1,
    targetSpeedMultiplier: 1,
    spawnRadius: 10,
    movementPattern: 'static',
    headLevel: true,
    flashEnabled: false,
    flashIntensity: 0,
    flashDurationMs: 0,
    requireSteadyAim: false,
    penalizeMiss: true,
  };

  beforeEach(() => {
    localStorage.clear();
    canvas = document.createElement('canvas');
    const mockWebGLRenderer = {
      domElement: { width: 800, height: 600 },
      shadowMap: { enabled: false, type: 0 },
      autoClear: true,
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
  });

  afterEach(() => {
    if (controls) controls.dispose();
  });

  it('cleanly resets all session counters so metrics never leak to consecutive runs', () => {
    // Run Session 1
    engine.startScenario(testConfig);
    // Align ray to miss
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(10, 10, 0), new THREE.Vector3(0, 0, -1))
    );
    // Shoot 3 misses
    controls.onShoot!();
    controls.onShoot!();
    controls.onShoot!();

    // Premature stop / exit
    engine.stopScenario();

    // Start Session 2
    engine.startScenario(testConfig);

    // Verify HUD on tick starts from zero
    let hudState: any;
    engine.callbacks.onTick = (hud) => { hudState = hud; };
    engine.update();

    expect(hudState.hits).toBe(0);
    expect(hudState.misses).toBe(0);
    expect(hudState.score).toBe(0);
    expect(hudState.accuracy).toBe(0);
    expect(hudState.headshots).toBe(0);
    expect(hudState.shotsFired).toBe(0);
  });

  it('prematurely cancelled sessions are not saved to Store', () => {
    engine.startScenario(testConfig);

    // Fire 2 shots
    controls.onShoot!();
    controls.onShoot!();

    // Player presses ESC / exits early
    engine.stopScenario();

    // Store must have 0 saved sessions
    expect(store.totalSessions()).toBe(0);
  });

  it('completed session is saved exactly once even if completeScenario is triggered', () => {
    let completedResult: SessionResult | null = null;
    engine.callbacks.onScenarioComplete = (res) => {
      completedResult = res;
    };

    engine.startScenario({
      ...testConfig,
      durationSec: 1, // 1 second duration
    });

    // Score 1 hit
    engine.targets.clear();
    engine.targets.spawnTarget(testConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1))
    );
    controls.onShoot!();

    // Force time to expire
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 2000);
    engine.update(); // triggers completeScenario()
    engine.update(); // second tick should not double-save

    expect(completedResult).not.toBeNull();
    expect(store.totalSessions()).toBe(1);
    expect(store.getRecentSessions(1)[0].hits).toBe(1);
  });

  it('tracks stationary vs moving shots accurately during session', () => {
    engine.startScenario(testConfig);

    // 1. Stationary shot: isCounterStrafed() returns true
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(true);
    controls.onShoot!();

    // 2. Moving shot: isCounterStrafed() returns false
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(false);
    controls.onShoot!();

    // Verify through HUD tick
    let hud: any;
    engine.callbacks.onTick = (h) => { hud = h; };
    engine.update();

    expect(hud.shotsFired).toBe(2);
  });
});
