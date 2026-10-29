// =====================================================================
// renderer.ts — Three.js scene, lighting, arena geometry
// =====================================================================

import * as THREE from 'three';
import {
  COL_TARGET_IDLE, COL_TARGET_HIT,
  COL_ARENA_FLOOR, COL_ARENA_WALL, COL_ARENA_CEIL,
  COL_AMBIENT, COL_FOG,
  TARGET_HIT_FLASH_MS,
  NEAR_PLANE, FAR_PLANE,
  TARGET_SIZE_DEFAULT,
  TARGET_HEAD_RADIUS,
  TARGET_TORSO_RADIUS,
  TARGET_TORSO_HEIGHT,
  TARGET_TORSO_OFFSET_Y,
} from './constants';
import type { BodyPartType, HitRegionDimensions } from './types';

export interface TargetBodyPart {
  type: BodyPartType;
  targetId: string;
  mesh: THREE.Mesh;
}

export interface TargetVisual {
  id: string;
  group: THREE.Group;
  parts: Map<BodyPartType, TargetBodyPart>;
  headMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  shoulderMesh?: THREE.Mesh;
  allMeshes: THREE.Mesh[];
}

export class Renderer {
  scene:    THREE.Scene;
  camera:   THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;

  private targetVisuals = new Map<string, TargetVisual>();
  private hitTimers     = new Map<string, number>();
  private matIdle:  THREE.MeshPhongMaterial;
  private matHit:   THREE.MeshPhongMaterial;
  private arenaMeshes: THREE.Object3D[] = [];
  private arenaDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(canvas: HTMLCanvasElement, fov: number, customRenderer?: THREE.WebGLRenderer) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COL_FOG);
    this.scene.fog = new THREE.Fog(COL_FOG, 30, FAR_PLANE);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      fov, (canvas.width || 800) / (canvas.height || 600), NEAR_PLANE, FAR_PLANE,
    );

    // WebGL renderer
    this.renderer = customRenderer ?? new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 2));
    this.renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
    if (this.renderer.shadowMap) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Materials
    this.matIdle = new THREE.MeshPhongMaterial({
      color: COL_TARGET_IDLE,
      emissive: COL_TARGET_IDLE,
      emissiveIntensity: 0.35,
      shininess: 60,
    });
    this.matHit = new THREE.MeshPhongMaterial({
      color: COL_TARGET_HIT,
      emissive: COL_TARGET_HIT,
      emissiveIntensity: 0.9,
    });

    this.buildArena();
    this.buildLighting();
  }

  // ── Arena ──────────────────────────────────────────────────────────
  private buildArena(): void {
    const W = 40, H = 8, D = 40;
    const floorGeo  = new THREE.PlaneGeometry(W, D, 20, 20);
    const wallGeo   = new THREE.PlaneGeometry(W, H);
    const ceilGeo   = new THREE.PlaneGeometry(W, D);

    const matFloor = new THREE.MeshPhongMaterial({ color: COL_ARENA_FLOOR, shininess: 20 });
    const matWall  = new THREE.MeshPhongMaterial({ color: COL_ARENA_WALL, side: THREE.DoubleSide });
    const matCeil  = new THREE.MeshPhongMaterial({ color: COL_ARENA_CEIL });

    this.arenaDisposables.push(floorGeo, wallGeo, ceilGeo, matFloor, matWall, matCeil);

    // Floor
    const floor = new THREE.Mesh(floorGeo, matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.arenaMeshes.push(floor);

    // Ceiling
    const ceil = new THREE.Mesh(ceilGeo, matCeil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    this.scene.add(ceil);
    this.arenaMeshes.push(ceil);

    // Walls
    const wallPositions: [number, number, number, number][] = [
      [0,  H/2, -D/2, 0],
      [0,  H/2,  D/2, Math.PI],
      [-W/2, H/2, 0,  Math.PI/2],
      [ W/2, H/2, 0, -Math.PI/2],
    ];
    for (const [x, y, z, ry] of wallPositions) {
      const m = new THREE.Mesh(wallGeo, matWall);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.scene.add(m);
      this.arenaMeshes.push(m);
    }

    // Grid helper (subtle)
    const grid = new THREE.GridHelper(W, 20, 0x2a2a45, 0x2a2a45);
    (grid.material as THREE.Material).opacity = 0.3;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);
    this.arenaMeshes.push(grid);
    this.arenaDisposables.push(grid.geometry, grid.material as THREE.Material);

    // Cover boxes (for tactical scenarios)
    this.addCoverBox(-8, 0, -8,  2, 2, 0.4, 0x1e1e30);
    this.addCoverBox( 8, 0, -8,  2, 2, 0.4, 0x1e1e30);
    this.addCoverBox(-6, 0, -14, 0.4, 2, 3,  0x181828);
    this.addCoverBox( 6, 0, -14, 0.4, 2, 3,  0x181828);
  }

  private addCoverBox(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    color: number,
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshPhongMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.arenaMeshes.push(mesh);
    this.arenaDisposables.push(geo, mat);
  }

  // ── Lighting ────────────────────────────────────────────────────────
  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(COL_AMBIENT, 0.7);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(8, 14, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far  = 60;
    dirLight.shadow.camera.left = dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.camera.right = dirLight.shadow.camera.top  =  20;
    this.scene.add(dirLight);

    // Accent fill from below
    const fillLight = new THREE.PointLight(0x2a2060, 0.4, 30);
    fillLight.position.set(0, -1, 0);
    this.scene.add(fillLight);
  }

  // ── Target management ────────────────────────────────────────────────
  addTarget(
    id: string,
    position: THREE.Vector3,
    radius: number,
    dimensions?: HitRegionDimensions
  ): void {
    const scale = radius / TARGET_SIZE_DEFAULT;
    const headRadius = dimensions?.headRadius ?? TARGET_HEAD_RADIUS * scale;
    const torsoRadius = dimensions?.torsoRadius ?? TARGET_TORSO_RADIUS * scale;
    const torsoHeight = dimensions?.torsoHeight ?? TARGET_TORSO_HEIGHT * scale;
    const torsoOffsetY = dimensions?.torsoOffsetY ?? TARGET_TORSO_OFFSET_Y * scale;
    const headOffsetY = dimensions?.headOffsetY ?? 0;

    const group = new THREE.Group();
    group.position.copy(position);

    // Head mesh: Sphere centered at head level
    const headGeo = new THREE.SphereGeometry(headRadius, 20, 16);
    const headMesh = new THREE.Mesh(headGeo, this.matIdle.clone());
    headMesh.position.set(0, headOffsetY, 0);
    headMesh.castShadow = true;
    group.add(headMesh);

    // Torso mesh: Tapered cylinder representing athletic dummy upper body
    const torsoGeo = new THREE.CylinderGeometry(
      torsoRadius * 1.15,
      torsoRadius * 0.85,
      torsoHeight,
      20
    );
    const torsoMesh = new THREE.Mesh(torsoGeo, this.matIdle.clone());
    torsoMesh.position.set(0, torsoOffsetY, 0);
    torsoMesh.castShadow = true;
    group.add(torsoMesh);

    // Shoulder accent: Horizontal geometry connecting torso and head
    const shoulderGeo = new THREE.BoxGeometry(
      torsoRadius * 2.2,
      0.06 * scale,
      torsoRadius * 1.2
    );
    const shoulderMesh = new THREE.Mesh(shoulderGeo, this.matIdle.clone());
    shoulderMesh.position.set(0, torsoOffsetY + torsoHeight / 2 - 0.03 * scale, 0);
    shoulderMesh.castShadow = true;
    group.add(shoulderMesh);

    // Typed body part mappings
    const parts = new Map<BodyPartType, TargetBodyPart>();
    parts.set('head', { type: 'head', targetId: id, mesh: headMesh });
    parts.set('torso', { type: 'torso', targetId: id, mesh: torsoMesh });

    const visual: TargetVisual = {
      id,
      group,
      parts,
      headMesh,
      torsoMesh,
      shoulderMesh,
      allMeshes: [headMesh, torsoMesh, shoulderMesh],
    };

    this.scene.add(group);
    this.targetVisuals.set(id, visual);
  }

  updateTargetPosition(id: string, position: THREE.Vector3): void {
    const visual = this.targetVisuals.get(id);
    if (visual) {
      visual.group.position.copy(position);
    }
  }

  flashTarget(id: string): void {
    const visual = this.targetVisuals.get(id);
    if (!visual) return;
    for (const mesh of visual.allMeshes) {
      (mesh.material as THREE.MeshPhongMaterial).copy(this.matHit);
    }
    this.hitTimers.set(id, performance.now() + TARGET_HIT_FLASH_MS);
  }

  removeTarget(id: string): void {
    const visual = this.targetVisuals.get(id);
    if (visual) {
      this.scene.remove(visual.group);
      for (const mesh of visual.allMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      this.targetVisuals.delete(id);
      this.hitTimers.delete(id);
    }
  }

  clearTargets(): void {
    for (const id of [...this.targetVisuals.keys()]) this.removeTarget(id);
  }

  getTargetVisual(id: string): TargetVisual | undefined {
    return this.targetVisuals.get(id);
  }

  getBodyPart(targetId: string, partType: BodyPartType): TargetBodyPart | undefined {
    return this.targetVisuals.get(targetId)?.parts.get(partType);
  }

  // ── Resize ──────────────────────────────────────────────────────────
  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  updateFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // ── Render loop ─────────────────────────────────────────────────────
  render(): void {
    const now = performance.now();

    // Restore hit material after flash timer
    for (const [id, expiry] of this.hitTimers) {
      if (now >= expiry) {
        const visual = this.targetVisuals.get(id);
        if (visual) {
          for (const mesh of visual.allMeshes) {
            (mesh.material as THREE.MeshPhongMaterial).copy(this.matIdle);
          }
        }
        this.hitTimers.delete(id);
      }
    }

    // Subtle target pulse
    for (const visual of this.targetVisuals.values()) {
      if (!this.hitTimers.has(visual.id)) {
        const intensity = 0.25 + 0.15 * Math.sin(now * 0.004);
        for (const mesh of visual.allMeshes) {
          (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = intensity;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  getTargetPosition(id: string): THREE.Vector3 | undefined {
    return this.targetVisuals.get(id)?.group.position.clone();
  }

  dispose(): void {
    this.clearTargets();
    this.matIdle.dispose();
    this.matHit.dispose();
    for (const d of this.arenaDisposables) {
      d.dispose();
    }
    this.arenaDisposables = [];
    for (const m of this.arenaMeshes) {
      this.scene.remove(m);
    }
    this.arenaMeshes = [];
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }
  }
}
