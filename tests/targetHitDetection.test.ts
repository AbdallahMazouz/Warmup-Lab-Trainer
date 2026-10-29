// =====================================================================
// tests/targetHitDetection.test.ts — Segmented Target Models & Hit Detection
// =====================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager, type TargetRenderer } from '../src/targetManager';
import { Renderer } from '../src/renderer';
import {
  TARGET_HEAD_RADIUS,
  TARGET_TORSO_RADIUS,
  TARGET_TORSO_HEIGHT,
  TARGET_TORSO_OFFSET_Y,
  HEAD_LEVEL_Y,
} from '../src/constants';
import type { ScenarioConfig } from '../src/types';

describe('Segmented Target Models and Hit Detection', () => {
  let targetManager: TargetManager;
  let mockRenderer: TargetRenderer;

  const baseConfig: ScenarioConfig = {
    id: 'test-scenario',
    name: 'Test Scenario',
    category: 'flick',
    description: 'Unit testing scenario',
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

  beforeEach(() => {
    mockRenderer = {
      addTarget: vi.fn(),
      updateTargetPosition: vi.fn(),
      removeTarget: vi.fn(),
      clearTargets: vi.fn(),
      flashTarget: vi.fn(),
    };
    targetManager = new TargetManager(mockRenderer);
  });

  it('spawns targets with typed segmented hit regions and notifies renderer', () => {
    const target = targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    expect(target).toBeDefined();
    expect(target.alive).toBe(true);
    expect(target.dimensions.headRadius).toBeCloseTo(TARGET_HEAD_RADIUS);
    expect(target.dimensions.torsoRadius).toBeCloseTo(TARGET_TORSO_RADIUS);
    expect(target.dimensions.torsoHeight).toBeCloseTo(TARGET_TORSO_HEIGHT);
    expect(target.dimensions.torsoOffsetY).toBeCloseTo(TARGET_TORSO_OFFSET_Y);

    expect(mockRenderer.addTarget).toHaveBeenCalledWith(
      target.id,
      target.position,
      target.radius,
      target.dimensions
    );
  });

  it('registers a headshot when a ray hits the head region', () => {
    // Target head centered at (0, HEAD_LEVEL_Y, -10)
    const target = targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Shoot directly at head center from player eye position
    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    const hit = targetManager.checkHit(ray);

    expect(hit.hit).toBe(true);
    expect(hit.headshot).toBe(true);
    expect(hit.bodyPart).toBe('head');
    expect(hit.targetId).toBe(target.id);
    expect(hit.accuracyScore).toBeCloseTo(1.0, 2);
    // Distance to head sphere entry: 10 - headRadius
    expect(hit.distanceMetres).toBeCloseTo(10 - TARGET_HEAD_RADIUS, 2);
  });

  it('registers a body shot when a ray hits the torso region', () => {
    // Target position is head level (0, HEAD_LEVEL_Y, -10)
    // Torso center is at (0, HEAD_LEVEL_Y + TARGET_TORSO_OFFSET_Y, -10)
    const torsoY = HEAD_LEVEL_Y + TARGET_TORSO_OFFSET_Y;
    const target = targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Shoot directly at torso center
    const ray = new THREE.Ray(
      new THREE.Vector3(0, torsoY, 0),
      new THREE.Vector3(0, 0, -1)
    );

    const hit = targetManager.checkHit(ray);

    expect(hit.hit).toBe(true);
    expect(hit.headshot).toBe(false);
    expect(hit.bodyPart).toBe('torso');
    expect(hit.targetId).toBe(target.id);
    expect(hit.accuracyScore).toBeCloseTo(1.0, 2);
    // Distance to torso cylinder entry: 10 - torsoRadius
    expect(hit.distanceMetres).toBeCloseTo(10 - TARGET_TORSO_RADIUS, 2);
  });

  it('registers a miss when a ray misses the entire dummy', () => {
    targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Ray 1: Above the head
    const rayAbove = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y + TARGET_HEAD_RADIUS + 0.3, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(targetManager.checkHit(rayAbove).hit).toBe(false);

    // Ray 2: Below the torso
    const bottomOfTorso = HEAD_LEVEL_Y + TARGET_TORSO_OFFSET_Y - TARGET_TORSO_HEIGHT / 2;
    const rayBelow = new THREE.Ray(
      new THREE.Vector3(0, bottomOfTorso - 0.2, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(targetManager.checkHit(rayBelow).hit).toBe(false);

    // Ray 3: Wide to the right
    const raySide = new THREE.Ray(
      new THREE.Vector3(TARGET_TORSO_RADIUS + 0.5, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(targetManager.checkHit(raySide).hit).toBe(false);

    // Ray 4: Opposite direction (pointing backward)
    const rayBack = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, 1)
    );
    expect(targetManager.checkHit(rayBack).hit).toBe(false);
  });

  it('prioritizes the nearer target when multiple targets overlap along a ray', () => {
    // Nearer target at -5m
    const nearTarget = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -5)
    );
    // Farther target at -12m
    const farTarget = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -12)
    );

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    const hit = targetManager.checkHit(ray);

    expect(hit.hit).toBe(true);
    expect(hit.targetId).toBe(nearTarget.id);
    expect(hit.distanceMetres).toBeCloseTo(5 - TARGET_HEAD_RADIUS, 2);
    expect(hit.targetId).not.toBe(farTarget.id);
  });

  it('prioritizes nearer body parts when a ray intersects both head and torso', () => {
    // Target at (0, HEAD_LEVEL_Y, -10)
    targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Angled shot downward from player height (y=2.0) through head towards torso
    const origin = new THREE.Vector3(0, 2.0, 0);
    const headTarget = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
    const dir = new THREE.Vector3().subVectors(headTarget, origin).normalize();
    const rayDown = new THREE.Ray(origin, dir);

    const hit = targetManager.checkHit(rayDown);
    expect(hit.hit).toBe(true);
    // The ray hits the head first before entering torso
    expect(hit.headshot).toBe(true);
    expect(hit.bodyPart).toBe('head');
  });

  it('ensures repeated shots cannot score the same target hit twice', () => {
    const target = targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    // Shot 1 hits target
    const hit1 = targetManager.checkHit(ray);
    expect(hit1.hit).toBe(true);
    expect(hit1.targetId).toBe(target.id);

    // Target is removed upon hit (simulating engine lifecycle)
    targetManager.removeTarget(hit1.targetId);
    expect(targetManager.getActiveCount()).toBe(0);

    // Shot 2 along the identical ray must now miss
    const hit2 = targetManager.checkHit(ray);
    expect(hit2.hit).toBe(false);
    expect(hit2.targetId).toBe('');
  });

  it('scores subsequent overlapping targets when the front target is removed', () => {
    const frontTarget = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -6)
    );
    const backTarget = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -14)
    );

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    // First shot hits front target
    const hit1 = targetManager.checkHit(ray);
    expect(hit1.hit).toBe(true);
    expect(hit1.targetId).toBe(frontTarget.id);

    // Remove front target
    targetManager.removeTarget(frontTarget.id);

    // Second shot now hits the back target
    const hit2 = targetManager.checkHit(ray);
    expect(hit2.hit).toBe(true);
    expect(hit2.targetId).toBe(backTarget.id);
  });

  it('updates tracking accurately for head, torso, and misses', () => {
    const target = targetManager.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    const torsoY = HEAD_LEVEL_Y + TARGET_TORSO_OFFSET_Y;

    // Ray hovering on head
    const rayHead = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const trackHead = targetManager.checkTracking(rayHead);
    expect(trackHead.isOnTarget).toBe(true);
    expect(trackHead.targetId).toBe(target.id);
    expect(trackHead.accuracy).toBeCloseTo(1.0, 2);
    expect(trackHead.bodyPart).toBe('head');

    // Ray hovering on torso
    const rayTorso = new THREE.Ray(
      new THREE.Vector3(0, torsoY, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const trackTorso = targetManager.checkTracking(rayTorso);
    expect(trackTorso.isOnTarget).toBe(true);
    expect(trackTorso.targetId).toBe(target.id);
    expect(trackTorso.accuracy).toBeCloseTo(1.0, 2);
    expect(trackTorso.bodyPart).toBe('torso');

    // Ray hovering outside
    const rayMiss = new THREE.Ray(
      new THREE.Vector3(1.0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const trackMiss = targetManager.checkTracking(rayMiss);
    expect(trackMiss.isOnTarget).toBe(false);
    expect(trackMiss.accuracy).toBe(0);
  });

  it('supports independently tunable hit region dimensions', () => {
    // Custom target with enlarged head radius (0.35m) and custom torso offset
    const custom = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -10),
      'static',
      0,
      {
        headRadius: 0.35,
        torsoRadius: 0.12,
        torsoHeight: 0.40,
        torsoOffsetY: -0.50,
      }
    );

    expect(custom.dimensions.headRadius).toBe(0.35);
    expect(custom.dimensions.torsoRadius).toBe(0.12);
    expect(custom.dimensions.torsoHeight).toBe(0.40);
    expect(custom.dimensions.torsoOffsetY).toBe(-0.50);

    // Aim 0.25m to the side of head center:
    // With standard radius (0.13m) this would be a miss,
    // but with enlarged radius (0.35m) this registers as a headshot!
    const rayOffset = new THREE.Ray(
      new THREE.Vector3(0.25, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    const hit = targetManager.checkHit(rayOffset);
    expect(hit.hit).toBe(true);
    expect(hit.headshot).toBe(true);
    expect(hit.bodyPart).toBe('head');
  });

  it('updates target movement patterns and keeps hit detection synchronized', () => {
    const target = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -10),
      'strafe'
    );
    const initialX = target.position.x;

    // Advance time by 0.2 seconds
    targetManager.update(0.2);

    expect(target.position.x).not.toBe(initialX);
    expect(mockRenderer.updateTargetPosition).toHaveBeenCalledWith(
      target.id,
      target.position
    );

    // Ray aimed at new position registers a hit
    const rayAtNewPos = new THREE.Ray(
      new THREE.Vector3(target.position.x, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const hit = targetManager.checkHit(rayAtNewPos);
    expect(hit.hit).toBe(true);
    expect(hit.headshot).toBe(true);
  });

  it('expires targets past their lifetimeSec', () => {
    const target = targetManager.spawnTarget(
      baseConfig,
      new THREE.Vector3(0, HEAD_LEVEL_Y, -10),
      'static',
      0.5 // 0.5s lifetime
    );

    expect(targetManager.getActiveCount()).toBe(1);

    // Update with time delta after expiration
    targetManager.update(0.1, target.spawnTime + 600);

    expect(targetManager.getActiveCount()).toBe(0);
    expect(mockRenderer.removeTarget).toHaveBeenCalledWith(target.id);
  });
});

describe('Renderer Segmented Visuals and Resource Lifecycle', () => {
  let mockCanvas: HTMLCanvasElement;
  let renderer: Renderer;

  beforeEach(() => {
    mockCanvas = document.createElement('canvas');
    const mockWebGLRenderer = {
      shadowMap: { enabled: false, type: 0 },
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(mockCanvas, 103, mockWebGLRenderer);
  });

  it('constructs segmented visual models with distinct head, torso, and shoulder meshes', () => {
    renderer.addTarget('test_dummy', new THREE.Vector3(0, HEAD_LEVEL_Y, -10), 0.22);

    const visual = renderer.getTargetVisual('test_dummy');
    expect(visual).toBeDefined();
    expect(visual?.group).toBeInstanceOf(THREE.Group);
    expect(visual?.group.position.y).toBeCloseTo(HEAD_LEVEL_Y);

    // Distinct head mesh
    expect(visual?.headMesh).toBeInstanceOf(THREE.Mesh);
    expect(visual?.headMesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(visual?.headMesh.position.y).toBe(0); // at head level

    // Distinct torso mesh
    expect(visual?.torsoMesh).toBeInstanceOf(THREE.Mesh);
    expect(visual?.torsoMesh.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(visual?.torsoMesh.position.y).toBeCloseTo(TARGET_TORSO_OFFSET_Y);

    // Shoulder accent geometry
    expect(visual?.shoulderMesh).toBeInstanceOf(THREE.Mesh);
    expect(visual?.shoulderMesh?.geometry).toBeInstanceOf(THREE.BoxGeometry);

    // Typed body part mappings
    const headPart = renderer.getBodyPart('test_dummy', 'head');
    expect(headPart).toBeDefined();
    expect(headPart?.type).toBe('head');
    expect(headPart?.targetId).toBe('test_dummy');
    expect(headPart?.mesh).toBe(visual?.headMesh);

    const torsoPart = renderer.getBodyPart('test_dummy', 'torso');
    expect(torsoPart).toBeDefined();
    expect(torsoPart?.type).toBe('torso');
    expect(torsoPart?.targetId).toBe('test_dummy');
    expect(torsoPart?.mesh).toBe(visual?.torsoMesh);
  });

  it('disposes target geometries and materials on removal without disposing shared resources', () => {
    renderer.addTarget('dummy_1', new THREE.Vector3(0, HEAD_LEVEL_Y, -10), 0.22);
    const visual = renderer.getTargetVisual('dummy_1')!;

    const headGeoSpy = vi.spyOn(visual.headMesh.geometry, 'dispose');
    const torsoGeoSpy = vi.spyOn(visual.torsoMesh.geometry, 'dispose');
    const shoulderGeoSpy = vi.spyOn(visual.shoulderMesh!.geometry, 'dispose');
    const headMatSpy = vi.spyOn(visual.headMesh.material as THREE.Material, 'dispose');
    const torsoMatSpy = vi.spyOn(visual.torsoMesh.material as THREE.Material, 'dispose');

    renderer.removeTarget('dummy_1');

    expect(headGeoSpy).toHaveBeenCalled();
    expect(torsoGeoSpy).toHaveBeenCalled();
    expect(shoulderGeoSpy).toHaveBeenCalled();
    expect(headMatSpy).toHaveBeenCalled();
    expect(torsoMatSpy).toHaveBeenCalled();
    expect(renderer.getTargetVisual('dummy_1')).toBeUndefined();

    // Verify shared materials remain healthy and can spawn subsequent targets
    renderer.addTarget('dummy_2', new THREE.Vector3(2, HEAD_LEVEL_Y, -10), 0.22);
    const visual2 = renderer.getTargetVisual('dummy_2');
    expect(visual2).toBeDefined();
    expect(visual2?.headMesh.material).toBeDefined();
  });

  it('flashes all target meshes upon hit and restores material on timer expiry', () => {
    renderer.addTarget('dummy_flash', new THREE.Vector3(0, HEAD_LEVEL_Y, -10), 0.22);
    const visual = renderer.getTargetVisual('dummy_flash')!;

    renderer.flashTarget('dummy_flash');
    const headMat = visual.headMesh.material as THREE.MeshPhongMaterial;
    // Hit material color is COL_TARGET_HIT (0x00ff88)
    expect(headMat.color.getHex()).toBe(0x00ff88);

    // Call render with advance time past flash duration (180ms)
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 300);
    renderer.render();

    // Material restored to COL_TARGET_IDLE (0xff4655)
    expect(headMat.color.getHex()).toBe(0xff4655);
    nowSpy.mockRestore();
  });
});

