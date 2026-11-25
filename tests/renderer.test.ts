import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Renderer } from '../src/renderer';
import {
  NEAR_PLANE,
  FAR_PLANE,
  COL_FOG,
  COL_AMBIENT,
  TARGET_HEAD_RADIUS,
  TARGET_TORSO_RADIUS,
  TARGET_TORSO_HEIGHT,
  TARGET_LEGS_RADIUS,
  TARGET_LEGS_HEIGHT,
} from '../src/constants';

describe('Phase 6 — Renderer Unit, Scene Architecture & Mesh Lifecycle Tests', () => {
  let canvas: HTMLCanvasElement;
  let mockRenderer: THREE.WebGLRenderer;
  let renderer: Renderer;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    Object.defineProperty(canvas, 'clientWidth', { value: 1920 });
    Object.defineProperty(canvas, 'clientHeight', { value: 1080 });

    mockRenderer = {
      domElement: canvas,
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(canvas, 103, mockRenderer);
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('initializes Three.js scene, camera, arena geometry and lights with esport specifications', () => {
    // Camera FOV and clipping planes
    expect(renderer.camera.fov).toBe(103);
    expect(renderer.camera.near).toBe(NEAR_PLANE);
    expect(renderer.camera.far).toBe(FAR_PLANE);
    expect(renderer.camera.aspect).toBeCloseTo(1920 / 1080, 4);

    // Scene fog & background
    expect(renderer.scene.background).toBeInstanceOf(THREE.Color);
    expect((renderer.scene.background as THREE.Color).getHex()).toBe(COL_FOG);
    expect(renderer.scene.fog).toBeInstanceOf(THREE.Fog);

    // Renderer calls
    expect(mockRenderer.setSize).toHaveBeenCalledWith(1920, 1080, false);

    // Scene children should include floor, ceiling, 4 walls, grid, ambient light, directional light, point light
    const lights = renderer.scene.children.filter(c => c instanceof THREE.Light);
    expect(lights.length).toBeGreaterThanOrEqual(3);
    const ambient = lights.find(l => l instanceof THREE.AmbientLight);
    expect(ambient).toBeDefined();
    expect((ambient as THREE.AmbientLight).color.getHex()).toBe(COL_AMBIENT);

    const dirLight = lights.find(l => l instanceof THREE.DirectionalLight);
    expect(dirLight).toBeDefined();
    expect(dirLight?.castShadow).toBe(true);

    const meshes = renderer.scene.children.filter(c => c instanceof THREE.Mesh);
    expect(meshes.length).toBeGreaterThanOrEqual(6); // floor + ceiling + 4 walls + cover boxes
  });

  it('creates and tracks sphere targets with normalized unit geometry', () => {
    const pos = new THREE.Vector3(0, 1.5, -10);
    renderer.addTarget('sphere-1', pos, 0.3, { shape: 'sphere' }, 'standard');

    const visual = renderer.getTargetVisual('sphere-1');
    expect(visual).toBeDefined();
    expect(visual!.id).toBe('sphere-1');
    expect(visual!.group.position.x).toBe(0);
    expect(visual!.group.position.y).toBe(1.5);
    expect(visual!.group.position.z).toBe(-10);

    // Sphere has headMesh only
    expect(visual!.headMesh).toBeDefined();
    expect(visual!.headMesh.geometry).toBe(renderer.sharedHeadGeo);
    expect(visual!.parts.has('head')).toBe(true);
    expect(visual!.parts.has('torso')).toBe(false);
    expect(visual!.parts.has('legs')).toBe(false);
    expect(visual!.allMeshes.length).toBe(1);

    // Position query returns accurate vector
    const queriedPos = renderer.getTargetPosition('sphere-1');
    expect(queriedPos).toBeDefined();
    expect(queriedPos?.equals(pos)).toBe(true);
  });

  it('creates and tracks humanoid targets with head, torso, shoulders, and legs body parts', () => {
    const pos = new THREE.Vector3(2, 0.5, -8);
    renderer.addTarget('humanoid-1', pos, 0.3, {
      shape: 'humanoid',
      headRadius: TARGET_HEAD_RADIUS,
      torsoRadius: TARGET_TORSO_RADIUS,
      torsoHeight: TARGET_TORSO_HEIGHT,
      legsRadius: TARGET_LEGS_RADIUS,
      legsHeight: TARGET_LEGS_HEIGHT,
      legsOffsetY: -0.4,
    }, 'standard');

    const visual = renderer.getTargetVisual('humanoid-1');
    expect(visual).toBeDefined();
    expect(visual!.parts.has('head')).toBe(true);
    expect(visual!.parts.has('torso')).toBe(true);
    expect(visual!.parts.has('legs')).toBe(true);

    // Meshes: head, torso, shoulder accent, legs
    expect(visual!.headMesh).toBeDefined();
    expect(visual!.torsoMesh).toBeDefined();
    expect(visual!.shoulderMesh).toBeDefined();
    expect(visual!.legsMesh).toBeDefined();
    expect(visual!.allMeshes.length).toBe(4);

    // Body parts mapping
    const headPart = renderer.getBodyPart('humanoid-1', 'head');
    const torsoPart = renderer.getBodyPart('humanoid-1', 'torso');
    const legsPart = renderer.getBodyPart('humanoid-1', 'legs');

    expect(headPart?.mesh).toBe(visual!.headMesh);
    expect(torsoPart?.mesh).toBe(visual!.torsoMesh);
    expect(legsPart?.mesh).toBe(visual!.legsMesh);
  });

  it('updates position, applies hit flash material, and restores material after flash duration', () => {
    const pos = new THREE.Vector3(0, 1.5, -5);
    renderer.addTarget('target-hit-test', pos, 0.25, { shape: 'sphere' }, 'standard');

    // Update position
    const newPos = new THREE.Vector3(1, 2, -7);
    renderer.updateTargetPosition('target-hit-test', newPos);
    expect(renderer.getTargetPosition('target-hit-test')?.equals(newPos)).toBe(true);

    // Flash target
    const visual = renderer.getTargetVisual('target-hit-test')!;
    const headMat = visual.headMesh.material as THREE.MeshPhongMaterial;
    const initialEmissive = headMat.emissive.getHex();

    renderer.flashTarget('target-hit-test');

    // Render loop triggers material update & restore
    renderer.render();
    expect(mockRenderer.render).toHaveBeenCalledWith(renderer.scene, renderer.camera);
  });

  it('removes target cleanly and removes from scene hierarchy', () => {
    renderer.addTarget('t1', new THREE.Vector3(0, 1, -5), 0.2, { shape: 'sphere' });
    renderer.addTarget('t2', new THREE.Vector3(1, 1, -5), 0.2, { shape: 'sphere' });

    expect(renderer.getTargetVisual('t1')).toBeDefined();
    expect(renderer.getTargetVisual('t2')).toBeDefined();

    renderer.removeTarget('t1');
    expect(renderer.getTargetVisual('t1')).toBeUndefined();
    expect(renderer.getTargetVisual('t2')).toBeDefined();

    renderer.clearTargets();
    expect(renderer.getTargetVisual('t2')).toBeUndefined();
  });

  it('resizes viewport and updates camera aspect and FOV projection matrix', () => {
    const projSpy = vi.spyOn(renderer.camera, 'updateProjectionMatrix');

    renderer.resize(2560, 1440);
    expect(renderer.camera.aspect).toBeCloseTo(2560 / 1440, 4);
    expect(mockRenderer.setSize).toHaveBeenCalledWith(2560, 1440, false);
    expect(projSpy).toHaveBeenCalled();

    renderer.updateFov(90);
    expect(renderer.camera.fov).toBe(90);
    expect(projSpy).toHaveBeenCalledTimes(2);
  });
});
