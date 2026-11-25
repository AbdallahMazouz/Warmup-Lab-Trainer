// =====================================================================
// tests/botIntelligence.test.ts — Unit & Integration Tests for Bot Intelligence
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager } from '../src/targetManager';
import {
  ARENA_COVER_BOXES,
  updateTacticalStrafe,
  updateCoverPeek,
  type TacticalStrafeState,
  type CoverPeekState,
  type MobilityState,
  type SmoothSteeringState,
} from '../src/movementControllers';
import { applyDifficultyPreset, DIFFICULTY_PRESETS, getScenarioById } from '../src/scenarios';
import { HEAD_LEVEL_Y } from '../src/constants';
import type { ScenarioConfig } from '../src/types';

function createMockRenderer() {
  return {
    addTarget: vi.fn(),
    updateTargetPosition: vi.fn(),
    removeTarget: vi.fn(),
    clearTargets: vi.fn(),
  };
}

function advanceTime(tm: TargetManager, durationSec: number, stepSec = 0.05, playerPos = new THREE.Vector3(0, 1.7, 0)) {
  const steps = Math.round(durationSec / stepSec);
  for (let i = 0; i < steps; i++) {
    tm.update(stepSec, performance.now(), playerPos);
  }
}

describe('Phase 1: Difficulty-Scaled Retaliation', () => {
  const skirmishBaseConfig: ScenarioConfig = {
    id: 'tactical-skirmish',
    name: 'Tactical Skirmish',
    category: 'speed',
    description: 'Duel against retaliating bots',
    skill: 'clicking',
    difficulty: 'intermediate',
    durationSec: 60,
    targetCount: 1,
    targetSizeMultiplier: 1.0,
    targetSpeedMultiplier: 1.0,
    directionChangeMultiplier: 1.0,
    target: {
      hp: 100,
      retaliatory: true,
      retaliateDelayMs: 850,
      retaliationPenalty: 250,
      retaliateRepeat: true,
      retaliateBurstIntervalMs: 600,
    },
  };

  it('scales retaliateDelayMs across all 4 difficulty presets', () => {
    const beginner = applyDifficultyPreset(skirmishBaseConfig, 'beginner');
    const intermediate = applyDifficultyPreset(skirmishBaseConfig, 'intermediate');
    const advanced = applyDifficultyPreset(skirmishBaseConfig, 'advanced');
    const pro = applyDifficultyPreset(skirmishBaseConfig, 'pro');

    expect(beginner.target?.retaliateDelayMs).toBe(Math.round(850 * 1.35)); // 1148
    expect(intermediate.target?.retaliateDelayMs).toBe(Math.round(850 * 1.0)); // 850
    expect(advanced.target?.retaliateDelayMs).toBe(Math.round(850 * 0.70)); // 595
    expect(pro.target?.retaliateDelayMs).toBe(Math.round(850 * 0.50)); // 425
  });

  it('supports repeated burst retaliation when in continuous line-of-sight', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const retaliateSpy = vi.fn();
    tm.onTargetRetaliate = retaliateSpy;

    const spawned = tm.spawnTarget(skirmishBaseConfig, new THREE.Vector3(0, 1.7, -10));
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    spawned.retaliateDelayMs = 800;
    spawned.retaliateRepeat = true;
    spawned.retaliateBurstIntervalMs = 500;

    // Simulate 0.7s (700ms) - should not retaliate yet
    advanceTime(tm, 0.7);
    expect(retaliateSpy).not.toHaveBeenCalled();
    expect(spawned.hasRetaliated).toBe(false);

    // Simulate another 0.1s (total 800ms) - first retaliation burst triggers
    advanceTime(tm, 0.1);
    expect(retaliateSpy).toHaveBeenCalledTimes(1);
    expect(spawned.hasRetaliated).toBe(true);
    // timeVisibleMs should be reset to delay - burstInterval = 800 - 500 = 300ms
    expect(spawned.timeVisibleMs).toBeCloseTo(300, 1);

    // Simulate 0.3s (300ms) - total since burst is 600ms (accumulated 300+300=600 < 800)
    advanceTime(tm, 0.3);
    expect(retaliateSpy).toHaveBeenCalledTimes(1);

    // Simulate another 0.2s (accumulated 600+200=800 >= 800) - second burst triggers!
    advanceTime(tm, 0.2);
    expect(retaliateSpy).toHaveBeenCalledTimes(2);
  });

  it('resets threat accumulation and hasRetaliated when line of sight is broken', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const retaliateSpy = vi.fn();
    tm.onTargetRetaliate = retaliateSpy;

    const spawned = tm.spawnTarget(skirmishBaseConfig, new THREE.Vector3(0, 1.7, -10));
    if (!spawned) return;

    // Accumulate threat for 500ms
    advanceTime(tm, 0.5);
    expect(spawned.timeVisibleMs).toBeCloseTo(500, 1);

    // Break line of sight: place bot directly behind front-left cover box (-8, 1, -8) from player (0, 1.7, 0)
    spawned.origin.set(-12, 1, -12);
    spawned.position.set(-12, 1, -12);
    advanceTime(tm, 0.1);

    expect(spawned.timeVisibleMs).toBe(0);
    expect(spawned.hasRetaliated).toBe(false);
  });

  it('immediately halts retaliation when target is eliminated', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const retaliateSpy = vi.fn();
    tm.onTargetRetaliate = retaliateSpy;

    const spawned = tm.spawnTarget(skirmishBaseConfig, new THREE.Vector3(0, 1.7, -10));
    if (!spawned) return;

    advanceTime(tm, 0.6);
    expect(spawned.timeVisibleMs).toBeCloseTo(600, 1);

    // Eliminate target
    tm.removeTarget(spawned.id);
    expect(spawned.alive).toBe(false);

    // Further updates must not trigger retaliation
    advanceTime(tm, 0.5);
    expect(retaliateSpy).not.toHaveBeenCalled();
  });

  it('calculates getHighestThreatProgress accurately during initial and repeat cycles', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const spawned = tm.spawnTarget(skirmishBaseConfig, new THREE.Vector3(0, 1.7, -10));
    if (!spawned) return;

    spawned.retaliateDelayMs = 1000;
    spawned.retaliateRepeat = true;
    spawned.retaliateBurstIntervalMs = 500;

    // 0ms -> 0 progress
    expect(tm.getHighestThreatProgress()).toBe(0);

    // 500ms -> 0.5 progress
    advanceTime(tm, 0.5);
    expect(tm.getHighestThreatProgress()).toBeCloseTo(0.5, 2);

    // Trigger first burst at 1000ms
    advanceTime(tm, 0.5);
    // Now hasRetaliated is true, timeVisibleMs is 1000 - 500 = 500ms (base is 500ms)
    // Repeat cycle progress: (500 - 500) / 500 = 0
    expect(tm.getHighestThreatProgress()).toBeCloseTo(0, 2);

    // Advance 250ms into repeat cycle -> (750 - 500) / 500 = 0.5 progress
    advanceTime(tm, 0.25);
    expect(tm.getHighestThreatProgress()).toBeCloseTo(0.5, 2);
  });
});

describe('Phase 2: Human-Like Strafing', () => {
  function makeStrafeState(): TacticalStrafeState {
    return {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 0,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'deadstop',
      stateTimer: 0,
      minStrafeDuration: 0.35,
      maxStrafeDuration: 0.75,
      deadstopDuration: 0.20,
      minX: -5.0,
      maxX: 5.0,
    };
  }

  it('reverses direction on standard roll (>= 0.25)', () => {
    const state = makeStrafeState();
    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);

    // Mock RNG returning 0.50 (>= 0.25 -> standard reversal)
    const rng = () => 0.50;
    updateTacticalStrafe(state, pos, 0.016, rng);

    expect(state.state).toBe('accelerating');
    expect(state.direction).toBe(-1); // Reversed from 1 to -1
  });

  it('feints and preserves direction on low roll (< 0.25)', () => {
    const state = makeStrafeState();
    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);

    // Mock RNG returning 0.10 (< 0.25 -> feint / double tap)
    const rng = () => 0.10;
    updateTacticalStrafe(state, pos, 0.016, rng);

    expect(state.state).toBe('accelerating');
    expect(state.direction).toBe(1); // Maintained direction 1
  });

  it('prevents feinting towards boundaries when near minX or maxX', () => {
    const state = makeStrafeState();
    // Near minX (-5.0 + 0.8 = -4.2)
    const posNearMin = new THREE.Vector3(-4.5, HEAD_LEVEL_Y, -10);
    state.direction = -1; // Heading left towards minX

    // Even with low roll (feint), must force direction = 1
    updateTacticalStrafe(state, posNearMin, 0.016, () => 0.05);
    expect(state.direction).toBe(1);

    // Near maxX (5.0 - 0.8 = 4.2)
    state.state = 'deadstop';
    state.stateTimer = 0;
    state.direction = 1; // Heading right towards maxX
    const posNearMax = new THREE.Vector3(4.5, HEAD_LEVEL_Y, -10);

    // Even with low roll (feint), must force direction = -1
    updateTacticalStrafe(state, posNearMax, 0.016, () => 0.05);
    expect(state.direction).toBe(-1);
  });
});

describe('Phase 3: Reactive Bot Behavior (Near-Miss)', () => {
  const baseConfig: ScenarioConfig = {
    id: 'test-reactive',
    name: 'Test Reactive Scenario',
    category: 'speed',
    description: 'Testing reactive near-miss evasion',
    skill: 'clicking',
    difficulty: 'intermediate',
    durationSec: 60,
    targetCount: 1,
    targetSizeMultiplier: 1.0,
    targetSpeedMultiplier: 1.0,
    directionChangeMultiplier: 1.0,
    target: {
      shape: 'humanoid',
      modelType: 'humanoid',
    },
  };

  it('triggers direction cut and stopping for tactical strafer upon near-miss', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const spawned = tm.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    if (!spawned) return;

    spawned.controllerState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 3.5,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'cruising',
      stateTimer: 0.5,
      minStrafeDuration: 0.35,
      maxStrafeDuration: 0.75,
      deadstopDuration: 0.20,
      minX: -5.0,
      maxX: 5.0,
    };

    // Shoot ray passing 0.3m to the right of target center (within 0.65m threshold)
    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.3, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    tm.handleNearMiss(ray, 1000);

    const cs = spawned.controllerState as TacticalStrafeState;
    expect(cs.state).toBe('stopping');
    expect(cs.direction).toBe(-1); // Inverted direction
    expect(spawned.lastReactionTime).toBe(1000);
  });

  it('triggers emergency retreat for exposed cover peeker upon near-miss', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const spawned = tm.spawnTarget(baseConfig, new THREE.Vector3(-7.5, HEAD_LEVEL_Y, -8.5));
    if (!spawned) return;

    spawned.controllerState = {
      type: 'cover_peek',
      mode: 'jiggle',
      boxId: 'front_left',
      side: 'right',
      state: 'exposed_duel',
      stateTimer: 0.5,
      peekProgress: 1.0,
      hiddenX: -8.0,
      exposedX: -7.5,
      anchorY: HEAD_LEVEL_Y,
      anchorZ: -8.5,
      emergeSpeed: 4.5,
      retreatSpeed: 5.0,
      exposedDuelDuration: 0.5,
      hiddenDuration: 0.3,
    };

    // Shot grazes 0.25m from peeker
    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(-7.25, HEAD_LEVEL_Y, -8.5).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    tm.handleNearMiss(ray, 2000);

    const cs = spawned.controllerState as CoverPeekState;
    expect(cs.state).toBe('retreating');
    expect(cs.stateTimer).toBe(0);
    expect(spawned.lastReactionTime).toBe(2000);
  });

  it('triggers immediate jump ascent for crouching mobility bot upon near-miss', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const spawned = tm.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    if (!spawned) return;

    spawned.controllerState = {
      type: 'mobility',
      vy: 0,
      vx: 0,
      gravity: -18.0,
      jumpImpulse: 7.5,
      groundY: HEAD_LEVEL_Y,
      maxJumpY: HEAD_LEVEL_Y + 2.2,
      state: 'ground_crouch',
      stateTimer: 0.4,
      strafeDir: 1,
      driftSpeed: 1.5,
    };

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.2, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    tm.handleNearMiss(ray, 3000);

    const cs = spawned.controllerState as MobilityState;
    expect(cs.state).toBe('ascending');
    expect(cs.vy).toBe(7.5);
    expect(spawned.lastReactionTime).toBe(3000);
  });

  it('ignores near-miss when target is a sphere shape', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const sphereConfig: ScenarioConfig = {
      ...baseConfig,
      target: { shape: 'sphere' },
    };
    const spawned = tm.spawnTarget(sphereConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    if (!spawned) return;

    spawned.controllerState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 3.5,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'cruising',
      stateTimer: 0.5,
      minStrafeDuration: 0.35,
      maxStrafeDuration: 0.75,
      deadstopDuration: 0.20,
      minX: -5.0,
      maxX: 5.0,
    };

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.2, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    tm.handleNearMiss(ray, 4000);
    const cs = spawned.controllerState as TacticalStrafeState;
    expect(cs.state).toBe('cruising'); // Unchanged
    expect(spawned.lastReactionTime).toBeUndefined();
  });

  it('enforces 450ms reaction cooldown to prevent rapid multi-evasion', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const spawned = tm.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    if (!spawned) return;

    spawned.controllerState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 3.5,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'cruising',
      stateTimer: 0.5,
      minStrafeDuration: 0.35,
      maxStrafeDuration: 0.75,
      deadstopDuration: 0.20,
      minX: -5.0,
      maxX: 5.0,
    };

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.2, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    // First miss triggers evasion at t = 1000ms
    tm.handleNearMiss(ray, 1000);
    expect(spawned.lastReactionTime).toBe(1000);

    // Put bot into cruising again to see if rapid second shot triggers it
    (spawned.controllerState as TacticalStrafeState).state = 'cruising';
    (spawned.controllerState as TacticalStrafeState).direction = -1;

    // Second miss at t = 1200ms (only 200ms elapsed < 450ms cooldown)
    tm.handleNearMiss(ray, 1200);
    expect((spawned.controllerState as TacticalStrafeState).state).toBe('cruising');
    expect((spawned.controllerState as TacticalStrafeState).direction).toBe(-1); // Not changed
    expect(spawned.lastReactionTime).toBe(1000);
  });
});

describe('Phase 4: Dynamic Tactical Peeking', () => {
  function makePeekState(): CoverPeekState {
    const box = ARENA_COVER_BOXES[0]; // front_left (-8, 1, -8)
    return {
      type: 'cover_peek',
      mode: 'jiggle',
      boxId: box.id,
      side: 'right',
      state: 'retreating',
      stateTimer: 0,
      peekProgress: 0.05,
      hiddenX: box.center.x,
      exposedX: -7.0,
      anchorY: HEAD_LEVEL_Y,
      anchorZ: -8.5,
      emergeSpeed: 4.5,
      retreatSpeed: 5.0,
      exposedDuelDuration: 0.45,
      hiddenDuration: 0.3,
    };
  }

  it('varies displacement and duel timing across consecutive cycles based on roll', () => {
    const pos = new THREE.Vector3(-7.5, HEAD_LEVEL_Y, -8.5);

    // 1. Shoulder bait roll (< 0.25)
    const state1 = makePeekState();
    updateCoverPeek(state1, pos, 0.02, () => 0.15); // peekProgress drops below 0 -> hidden
    expect(state1.state).toBe('hidden');
    expect(state1.exposedDuelDuration).toBe(0.22);
    expect(pos.x).toBe(state1.hiddenX); // Cleanly hidden

    // 2. Wide swing roll (0.25 to 0.45)
    const state2 = makePeekState();
    updateCoverPeek(state2, pos, 0.02, () => 0.35);
    expect(state2.state).toBe('hidden');
    expect(state2.exposedDuelDuration).toBe(0.60);
    expect(pos.x).toBe(state2.hiddenX);

    // 3. Standard peek roll (>= 0.45)
    const state3 = makePeekState();
    updateCoverPeek(state3, pos, 0.02, () => 0.75);
    expect(state3.state).toBe('hidden');
    expect(state3.exposedDuelDuration).toBe(0.45);
    expect(pos.x).toBe(state3.hiddenX);
  });

  it('wideswing mode preserves aggressive displacement range without downgrading to shoulder jiggle', () => {
    const box = ARENA_COVER_BOXES[0];
    const state: CoverPeekState = {
      type: 'cover_peek',
      mode: 'wideswing',
      boxId: box.id,
      side: 'right',
      state: 'retreating',
      stateTimer: 0,
      peekProgress: 0.05,
      hiddenX: box.center.x,
      exposedX: -6.0,
      anchorY: HEAD_LEVEL_Y,
      anchorZ: -8.5,
      emergeSpeed: 4.5,
      retreatSpeed: 5.0,
      exposedDuelDuration: 0.65,
      hiddenDuration: 0.8,
    };
    const pos = new THREE.Vector3(-6.0, HEAD_LEVEL_Y, -8.5);

    // Roll low (0.05) - in normal mode this would be shoulder bait (0.35m),
    // but in wideswing mode it must stay in the 1.6m - 2.2m displacement range
    updateCoverPeek(state, pos, 0.02, () => 0.05);
    expect(state.state).toBe('hidden');
    expect(state.exposedDuelDuration).toBeGreaterThanOrEqual(0.5);
    expect(pos.x).toBe(state.hiddenX);
  });
});
