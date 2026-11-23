import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TargetManager } from '../src/targetManager';
import { Controls } from '../src/controls';
import { resolveScenarioConfig } from '../src/scenarioConfig';
import { getScenarioById } from '../src/scenarios';
import type { ScenarioConfig } from '../src/types';

describe('Phase 1: Retaliatory Bot Mechanics & Counter-Strafe HUD', () => {
  let mockRenderer: any;

  beforeEach(() => {
    mockRenderer = {
      addTarget: vi.fn(),
      updateTargetPosition: vi.fn(),
      removeTarget: vi.fn(),
      clearTargets: vi.fn(),
      flashTarget: vi.fn(),
    };
  });

  it('resolves tactical-skirmish scenario with retaliatory bot properties', () => {
    const skirmish = getScenarioById('tactical-skirmish');
    expect(skirmish).toBeDefined();
    expect(skirmish?.category).toBe('tactical');

    const resolved = resolveScenarioConfig(skirmish!);
    expect(resolved.target.retaliatory).toBe(true);
    expect(resolved.target.retaliateDelayMs).toBe(850);
    expect(resolved.target.retaliationPenalty).toBe(250);
    expect(resolved.weapon.requireCounterStrafe).toBe(true);
  });

  it('accumulates visible time and triggers retaliation when delay is reached', () => {
    const tm = new TargetManager(mockRenderer);
    const onRetaliate = vi.fn();
    tm.onTargetRetaliate = onRetaliate;

    const mockConfig: ScenarioConfig = {
      id: 'test-retaliate',
      name: 'Test Retaliate',
      category: 'tactical',
      description: 'Test',
      skill: 'Testing',
      difficulty: 'intermediate',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 0,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
      meaningfulReactionTime: true,
      meaningfulTracking: false,
      allowInRoutines: true,
      target: {
        retaliatory: true,
        retaliateDelayMs: 500,
        retaliationPenalty: 200,
      },
    };

    const target = tm.spawnTarget(mockConfig, new THREE.Vector3(0, 1.7, -10));
    expect(target.retaliatory).toBe(true);
    expect(target.hasRetaliated).toBe(false);
    expect(target.timeVisibleMs).toBe(0);

    // Initial threat progress should be 0
    expect(tm.getHighestThreatProgress()).toBe(0);

    // Update with 2x 100ms delta (200ms total, not yet retaliating at 500ms threshold)
    tm.update(0.1, performance.now() + 100);
    tm.update(0.1, performance.now() + 200);
    expect(target.timeVisibleMs).toBeCloseTo(200, 0);
    expect(target.hasRetaliated).toBe(false);
    expect(onRetaliate).not.toHaveBeenCalled();
    expect(tm.getHighestThreatProgress()).toBeCloseTo(0.4, 1);

    // Update with 4x 100ms delta (total 600ms > 500ms retaliateDelayMs)
    tm.update(0.1, performance.now() + 300);
    tm.update(0.1, performance.now() + 400);
    tm.update(0.1, performance.now() + 500);
    tm.update(0.1, performance.now() + 600);
    expect(target.hasRetaliated).toBe(true);
    expect(onRetaliate).toHaveBeenCalledTimes(1);
    expect(onRetaliate).toHaveBeenCalledWith(target);

    // Subsequent updates should not trigger retaliation again
    tm.update(0.1, performance.now() + 700);
    expect(onRetaliate).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate threat time when target is covered', () => {
    const tm = new TargetManager(mockRenderer);
    const onRetaliate = vi.fn();
    tm.onTargetRetaliate = onRetaliate;

    const mockConfig: ScenarioConfig = {
      id: 'test-cover',
      name: 'Test Cover',
      category: 'tactical',
      description: 'Test',
      skill: 'Testing',
      difficulty: 'intermediate',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 0,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
      meaningfulReactionTime: true,
      meaningfulTracking: false,
      allowInRoutines: true,
      target: {
        retaliatory: true,
        retaliateDelayMs: 400,
      },
    };

    const target = tm.spawnTarget(mockConfig, new THREE.Vector3(0, 1.7, -10));
    target.isCovered = true; // Hidden behind obstacle

    tm.update(0.5, performance.now() + 500);
    expect(target.timeVisibleMs).toBe(0);
    expect(target.hasRetaliated).toBe(false);
    expect(onRetaliate).not.toHaveBeenCalled();
    expect(tm.getHighestThreatProgress()).toBe(0);
  });

  it('controls correctly tracks horizontal speed, dead-zone accuracy, and active keys', () => {
    const camera = new THREE.PerspectiveCamera();
    const dom = document.createElement('div');
    const controls = new Controls(camera, dom);

    // Initially stationary
    expect(controls.getSpeed()).toBe(0);
    expect(controls.isCounterStrafed()).toBe(true);
    expect(controls.getActiveKeys()).toEqual({ w: false, a: false, s: false, d: false });

    // Simulate key presses
    controls.moveLeft = true;
    controls.moveForward = true;
    expect(controls.getActiveKeys()).toEqual({ w: true, a: true, s: false, d: false });

    // Set velocity in dead-zone (< 0.6 m/s)
    controls.velocity.set(0.3, 0, 0.4);
    const speed = Math.sqrt(0.3 * 0.3 + 0.4 * 0.4); // 0.5 m/s
    expect(controls.getSpeed()).toBeCloseTo(speed, 5);
    expect(controls.isCounterStrafed()).toBe(true);

    // Set velocity above dead-zone (>= 0.6 m/s)
    controls.velocity.set(1.5, 0, 1.0);
    expect(controls.getSpeed()).toBeGreaterThan(0.6);
    expect(controls.isCounterStrafed()).toBe(false);

    controls.dispose();
  });

  it('line-of-sight is blocked by ARENA_COVER_BOXES obstacles', () => {
    const tm = new TargetManager(mockRenderer);
    const onRetaliate = vi.fn();
    tm.onTargetRetaliate = onRetaliate;

    const mockConfig: ScenarioConfig = {
      id: 'test-los',
      name: 'Test LOS',
      category: 'tactical',
      description: 'Test',
      skill: 'Testing',
      difficulty: 'intermediate',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 0,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
      meaningfulReactionTime: true,
      meaningfulTracking: false,
      allowInRoutines: true,
      target: {
        retaliatory: true,
        retaliateDelayMs: 500,
      },
    };

    // Front-left barrier is at center (-8, 1, -8), min (-9, 0, -8.2), max (-7, 2, -7.8)
    // Ray from (0, 1.7, 0) passing through center of barrier (-8, 1.7, -8) reaches (-10, 1.7, -10)
    const playerPos = new THREE.Vector3(0, 1.7, 0);
    const occludedTarget = tm.spawnTarget(mockConfig, new THREE.Vector3(-10, 1.7, -10));

    expect(tm.hasLineOfSight(occludedTarget, playerPos)).toBe(false);

    // Update ticks - threat progress must remain 0 while occluded
    tm.update(0.1, performance.now() + 100, playerPos);
    tm.update(0.1, performance.now() + 200, playerPos);
    expect(occludedTarget.timeVisibleMs).toBe(0);
    expect(tm.getHighestThreatProgress(playerPos)).toBe(0);
    expect(onRetaliate).not.toHaveBeenCalled();

    // Now move target out from behind cover (e.g. to (0, 1.7, -10), direct open view)
    occludedTarget.origin.set(0, 1.7, -10);
    occludedTarget.position.set(0, 1.7, -10);
    expect(tm.hasLineOfSight(occludedTarget, playerPos)).toBe(true);

    // Update ticks - now accumulates threat
    tm.update(0.1, performance.now() + 300, playerPos);
    expect(occludedTarget.timeVisibleMs).toBeCloseTo(100, 0);
    expect(tm.getHighestThreatProgress(playerPos)).toBeGreaterThan(0);
  });

  it('retaliation cannot trigger when bot is shielded or outside arena walls', () => {
    const tm = new TargetManager(mockRenderer);
    const onRetaliate = vi.fn();
    tm.onTargetRetaliate = onRetaliate;

    const mockConfig: ScenarioConfig = {
      id: 'test-shield',
      name: 'Test Shield',
      category: 'tactical',
      description: 'Test',
      skill: 'Testing',
      difficulty: 'intermediate',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 0,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: false,
      meaningfulReactionTime: true,
      meaningfulTracking: false,
      allowInRoutines: true,
      target: {
        retaliatory: true,
        retaliateDelayMs: 300,
        shielded: true,
      },
    };

    const playerPos = new THREE.Vector3(0, 1.7, 0);
    const shieldedTarget = tm.spawnTarget(mockConfig, new THREE.Vector3(0, 1.7, -5));
    expect(shieldedTarget.shielded).toBe(true);
    expect(tm.hasLineOfSight(shieldedTarget, playerPos)).toBe(false);

    // Run 500ms of updates (> 300ms delay)
    for (let i = 0; i < 5; i++) {
      tm.update(0.1, performance.now() + i * 100, playerPos);
    }
    expect(shieldedTarget.hasRetaliated).toBe(false);
    expect(shieldedTarget.timeVisibleMs).toBe(0);
    expect(onRetaliate).not.toHaveBeenCalled();

    // Now test target outside arena walls (|z| > 20 or |x| > 20)
    shieldedTarget.shielded = false;
    shieldedTarget.position.set(0, 1.7, -25); // Behind back wall at z = -20
    expect(tm.hasLineOfSight(shieldedTarget, playerPos)).toBe(false);

    tm.update(0.1, performance.now() + 600, playerPos);
    expect(shieldedTarget.hasRetaliated).toBe(false);
    expect(onRetaliate).not.toHaveBeenCalled();
  });
});
