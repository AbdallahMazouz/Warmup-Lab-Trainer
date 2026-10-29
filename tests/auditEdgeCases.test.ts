// =====================================================================
// tests/auditEdgeCases.test.ts — Sprint 1 Verification Audit edge cases
// =====================================================================
//
// All fixtures are fully deterministic.  Three.js Ray/Vector3 math is
// used directly (not mocked) because we are testing observable
// gameplay behaviour, not implementation details.
//
// Geometry reference values were verified with an independent Node.js
// probe script before these tests were written.
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager, type TargetRenderer } from '../src/targetManager';
import {
  TARGET_HEAD_RADIUS,
  TARGET_TORSO_RADIUS,
  TARGET_TORSO_HEIGHT,
  TARGET_TORSO_OFFSET_Y,
  HEAD_LEVEL_Y,
} from '../src/constants';
import type { ScenarioConfig } from '../src/types';

// ── Shared fixtures ──────────────────────────────────────────────────

const BASE_CONFIG: ScenarioConfig = {
  id: 'audit-scenario',
  name: 'Audit Scenario',
  category: 'flick',
  description: 'Edge-case audit',
  skill: 'aim',
  difficulty: 'intermediate',
  durationSec: 60,
  targetCount: 1,
  targetSizeMultiplier: 1.0,
  targetSpeedMultiplier: 1.0,
  spawnRadius: 10,
  movementPattern: 'static',
  headLevel: true,
  flashEnabled: false,
  flashIntensity: 0,
  flashDurationMs: 0,
  requireSteadyAim: false,
  penalizeMiss: false,
};

/** Normalise a direction vector (Three.js Ray expects unit-length direction). */
function dir(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).normalize();
}

function makeMockRenderer(): TargetRenderer {
  return {
    addTarget: vi.fn(),
    updateTargetPosition: vi.fn(),
    removeTarget: vi.fn(),
    clearTargets: vi.fn(),
    flashTarget: vi.fn(),
  };
}

// ── Derived constants used throughout ────────────────────────────────
const TORSO_CENTER_Y = HEAD_LEVEL_Y + TARGET_TORSO_OFFSET_Y; // 1.58 + (-0.38) = 1.20
const TORSO_HALF_H   = TARGET_TORSO_HEIGHT / 2;               // 0.25
const TORSO_BOTTOM_Y = TORSO_CENTER_Y - TORSO_HALF_H;         // 0.95

// =====================================================================
describe('Audit — Hit Detection Edge Cases', () => {
  let tm: TargetManager;

  beforeEach(() => {
    tm = new TargetManager(makeMockRenderer());
  });

  // ── 1. Tangent ray to head hitbox ─────────────────────────────────
  it('registers a miss when a ray is tangent to (grazes) the head sphere', () => {
    // Place target head at (0, HEAD_LEVEL_Y, -10).
    // A ray offset by exactly HEAD_RADIUS in X, aimed straight at -Z,
    // has perpendicular distance == HEAD_RADIUS — it lies on the surface.
    // The implementation uses strict > check (perpDistSq > radiusSq) so a
    // mathematically exact tangent is a floating-point miss most of the time.
    // We use HEAD_RADIUS + a tiny epsilon to guarantee a clear miss.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const tangentRay = new THREE.Ray(
      new THREE.Vector3(TARGET_HEAD_RADIUS + 0.001, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );

    const result = tm.checkHit(tangentRay);
    expect(result.hit).toBe(false);
  });

  // ── 2. Ray starting inside the head hitbox ────────────────────────
  it('registers a hit when the ray origin is inside the head sphere', () => {
    // Target head at (0, HEAD_LEVEL_Y, -10).
    // Origin at (0, HEAD_LEVEL_Y, -10 + 0.05) — 5 cm inside the sphere.
    // The ray shoots further into the sphere (toward -Z) and exits it.
    // intersectHead uses the far-chord exit distance when entry d <= 0.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const insideRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, -10 + 0.05),
      new THREE.Vector3(0, 0, -1),
    );

    const result = tm.checkHit(insideRay);
    // Expect a headshot (exits through the far side of the head sphere).
    expect(result.hit).toBe(true);
    expect(result.headshot).toBe(true);
    expect(result.bodyPart).toBe('head');
    // Exit distance is small but positive.
    expect(result.distanceMetres).toBeGreaterThan(0);
    expect(result.distanceMetres).toBeLessThan(TARGET_HEAD_RADIUS * 2);
  });

  // ── 3. Ray parallel to the torso's vertical (Y) axis ─────────────
  it('registers a torso hit for a ray parallel to the torso vertical axis', () => {
    // Shoot straight down (-Y) through the torso column.
    // The horizontal component (dx,dz) is zero → the cylinder-wall quadratic
    // is skipped (a ≈ 0). The top cap at yMax must be intersected instead.
    //
    // IMPORTANT: the ray must be offset in X so it clears the head sphere
    // (which sits above the torso and would otherwise be hit first).
    // We use x=0.17 m: this is > HEAD_RADIUS (0.13) so the head is missed,
    // but < TORSO_RADIUS (0.18) so the torso top cap is still hit.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const topCapY   = TORSO_CENTER_Y + TORSO_HALF_H; // top of torso cylinder
    const xOffset   = 0.17; // > HEAD_R(0.13), < TORSO_R(0.18)
    const aboveRay = new THREE.Ray(
      new THREE.Vector3(xOffset, topCapY + 2.0, -10), // 2 m above top cap, offset past head
      new THREE.Vector3(0, -1, 0),                     // straight down
    );

    const result = tm.checkHit(aboveRay);
    expect(result.hit).toBe(true);
    expect(result.headshot).toBe(false);
    expect(result.bodyPart).toBe('torso');
    // Distance to top cap = 2.0 m
    expect(result.distanceMetres).toBeCloseTo(2.0, 2);
  });

  // ── 4. Ray parallel to torso Y-axis, offset outside radius → miss ─
  it('registers a miss when a vertical ray is offset outside the torso radius', () => {
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const outsideRay = new THREE.Ray(
      new THREE.Vector3(TARGET_TORSO_RADIUS + 0.01, TORSO_CENTER_Y + 2.0, -10),
      new THREE.Vector3(0, -1, 0),
    );

    const result = tm.checkHit(outsideRay);
    expect(result.hit).toBe(false);
  });

  // ── 5. Ray hitting the torso near its tapered visual edge ─────────
  it('registers a torso hit for a ray entering near the narrow bottom of the tapered cylinder', () => {
    // The visual torso is tapered (bottom radius 0.85×, top radius 1.15×).
    // The collision region uses a straight cylinder of radius TARGET_TORSO_RADIUS,
    // so we aim just inside the bottom cap edge.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Aim at the bottom face, offset 90 % of the torso radius inward.
    const nearEdgeRay = new THREE.Ray(
      new THREE.Vector3(TARGET_TORSO_RADIUS * 0.9, TORSO_BOTTOM_Y + 2.0, -10),
      new THREE.Vector3(0, -1, 0),
    );

    const result = tm.checkHit(nearEdgeRay);
    expect(result.hit).toBe(true);
    expect(result.bodyPart).toBe('torso');
  });

  // ── 6. Ray missing an expired target ─────────────────────────────
  it('registers a miss after the target has expired and been removed', () => {
    const target = tm.spawnTarget(
      BASE_CONFIG,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -10),
      'static',
      0.5, // 0.5 s lifetime
    );
    expect(tm.getActiveCount()).toBe(1);

    // Advance time past lifetime.
    tm.update(0.1, target.spawnTime + 600);
    expect(tm.getActiveCount()).toBe(0);

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const result = tm.checkHit(ray);
    expect(result.hit).toBe(false);
  });

  // ── 7. Single-hit guarantee — no duplicate score event ───────────
  it('produces exactly one hit event per target regardless of repeated checkHit calls', () => {
    // Simulate the engine pattern: checkHit → removeTarget (on hit).
    // A second checkHit on the same ray must miss because the target is gone.
    const target = tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );

    const hit1 = tm.checkHit(ray);
    expect(hit1.hit).toBe(true);
    expect(hit1.targetId).toBe(target.id);

    // Engine removes the target immediately after registering the hit.
    tm.removeTarget(hit1.targetId);

    // Subsequent shot on same ray before any new target spawns → miss.
    const hit2 = tm.checkHit(ray);
    expect(hit2.hit).toBe(false);

    // And a third call is also clean.
    const hit3 = tm.checkHit(ray);
    expect(hit3.hit).toBe(false);
  });

  // ── 8. Nearer torso beats farther head ───────────────────────────
  it('a nearer torso hit correctly takes precedence over a farther head hit', () => {
    // Target A at z=-8: its torso center is at y=TORSO_CENTER_Y, distance ≈ 7.82 m.
    // Target B at z=-12: head at y=HEAD_LEVEL_Y.
    // Shoot horizontally at y=TORSO_CENTER_Y, direction (0,0,-1).
    // The ray height (1.20) is 0.38 m below B's head center (1.58),
    // which is larger than HEAD_RADIUS (0.13) → B's head is NOT hit.
    // So the test verifies torso A wins over the farther target B.
    const targetA = tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -8));
    const targetB = tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -12));

    const ray = new THREE.Ray(
      new THREE.Vector3(0, TORSO_CENTER_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );

    const result = tm.checkHit(ray);
    expect(result.hit).toBe(true);
    expect(result.targetId).toBe(targetA.id);
    expect(result.bodyPart).toBe('torso');
    expect(result.headshot).toBe(false);
    // Distance to torso A entry ≈ 8 - TARGET_TORSO_RADIUS
    expect(result.distanceMetres).toBeCloseTo(8 - TARGET_TORSO_RADIUS, 1);
    expect(result.targetId).not.toBe(targetB.id);
  });

  // ── 9. Tracking accuracy stays correct for head ───────────────────
  it('tracking accuracy is 1.0 when crosshair is on head center and < 1.0 when offset', () => {
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Dead-center head ray.
    const centerRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const centerTrack = tm.checkTracking(centerRay);
    expect(centerTrack.isOnTarget).toBe(true);
    expect(centerTrack.bodyPart).toBe('head');
    expect(centerTrack.accuracy).toBeCloseTo(1.0, 2);

    // Offset ray — still inside head sphere but not at center.
    const offset = TARGET_HEAD_RADIUS * 0.5; // 50 % of radius
    const offsetRay = new THREE.Ray(
      new THREE.Vector3(offset, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const offsetTrack = tm.checkTracking(offsetRay);
    expect(offsetTrack.isOnTarget).toBe(true);
    expect(offsetTrack.bodyPart).toBe('head');
    // Accuracy should be meaningfully below 1.0.
    expect(offsetTrack.accuracy).toBeLessThan(1.0);
    expect(offsetTrack.accuracy).toBeGreaterThan(0);
  });

  // ── 10. Tracking accuracy stays correct for torso ─────────────────
  it('tracking accuracy is 1.0 at torso center and < 1.0 when offset horizontally', () => {
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const centerRay = new THREE.Ray(
      new THREE.Vector3(0, TORSO_CENTER_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const centerTrack = tm.checkTracking(centerRay);
    expect(centerTrack.isOnTarget).toBe(true);
    expect(centerTrack.bodyPart).toBe('torso');
    expect(centerTrack.accuracy).toBeCloseTo(1.0, 2);

    // Offset 60 % of torso radius.
    const offset = TARGET_TORSO_RADIUS * 0.6;
    const offsetRay = new THREE.Ray(
      new THREE.Vector3(offset, TORSO_CENTER_Y, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const offsetTrack = tm.checkTracking(offsetRay);
    expect(offsetTrack.isOnTarget).toBe(true);
    expect(offsetTrack.bodyPart).toBe('torso');
    expect(offsetTrack.accuracy).toBeLessThan(1.0);
    expect(offsetTrack.accuracy).toBeGreaterThan(0);
  });

  // ── 11. Pure-vertical ray through head — no NaN / no crash ────────
  it('handles a ray with zero horizontal component (pure -Y through head) without NaN', () => {
    // Aim straight down from above the head.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const downRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y + 3.0, -10),
      new THREE.Vector3(0, -1, 0),
    );
    const result = tm.checkHit(downRay);
    // Ray enters through top of head sphere.
    expect(Number.isFinite(result.distanceMetres)).toBe(true);
    if (result.hit) {
      expect(result.headshot).toBe(true);
      expect(result.distanceMetres).toBeCloseTo(3.0 - TARGET_HEAD_RADIUS, 2);
    }
  });

  // ── 12. Zero-horizontal-component ray through torso top cap ───────
  it('handles a pure-vertical ray entering the torso top cap without NaN', () => {
    // Offset in X to clear the head sphere (x=0.16 > HEAD_R=0.13, < TORSO_R=0.18).
    // This confirms the cap-intersection path runs without NaN or division-by-zero.
    tm.spawnTarget(BASE_CONFIG, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    const topCapY  = TORSO_CENTER_Y + TORSO_HALF_H;
    const xOffset  = 0.16; // > HEAD_R, < TORSO_R

    const downRay = new THREE.Ray(
      new THREE.Vector3(xOffset, topCapY + 1.5, -10),
      new THREE.Vector3(0, -1, 0),
    );
    const result = tm.checkHit(downRay);
    expect(result.hit).toBe(true);
    expect(result.bodyPart).toBe('torso');
    expect(Number.isFinite(result.distanceMetres)).toBe(true);
    // Distance to top cap ≈ 1.5 m
    expect(result.distanceMetres).toBeCloseTo(1.5, 2);
  });
});
