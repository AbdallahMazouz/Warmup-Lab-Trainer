// =====================================================================
// vandal.ts — Vandal-style low-poly first-person rifle viewmodel
//
// Architecture notes (future-compatibility):
//   • VandalViewModel is self-contained; adding other weapons later means
//     creating a sibling file (e.g. operator.ts) following the same shape.
//   • No generic WeaponManager abstraction is built here — that would be
//     premature. The Engine keeps a direct VandalViewModel reference.
//   • The viewmodel renders on a dedicated orthographic-style camera that
//     is drawn after the main scene, so the rifle always appears in front
//     of the world without z-fighting or FOV dependency.
// =====================================================================

import * as THREE from 'three';

// ── Tuneable constants ───────────────────────────────────────────────

/** Milliseconds the firing kick animation takes to reach peak. */
const RECOIL_RISE_MS   = 35;
/** Milliseconds the recoil recovery (spring-back) takes. */
const RECOIL_FALL_MS   = 130;
/** Maximum vertical recoil kick (Three.js units in viewmodel space). */
const RECOIL_KICK_Y    = 0.018;
/** Maximum backward kick (Z-axis towards camera). */
const RECOIL_KICK_Z    = 0.022;
/** Muzzle flash visible duration in milliseconds. */
const FLASH_DURATION_MS = 55;
/** Muzzle flash scale. */
const FLASH_SCALE       = 1.0;

// ── Colours ─────────────────────────────────────────────────────────
const COL_BODY      = 0x1c1c22;   // near-black gunmetal
const COL_RECEIVER  = 0x2a2a32;   // slightly lighter receiver
const COL_DETAIL    = 0x3a3a44;   // rail / grip details
const COL_BARREL    = 0x141418;   // very dark barrel
const COL_MUZZLE_A  = 0xffcc44;   // muzzle flash hot centre
const COL_MUZZLE_B  = 0xff6600;   // muzzle flash outer ring

// ── Materials (shared among all instances of the same colour) ────────
function mat(color: number, metalness = 0.7, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

// ── Geometry helpers ─────────────────────────────────────────────────
function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

// =====================================================================
export class VandalViewModel {
  /** Dedicated scene for the viewmodel — rendered after the main scene. */
  readonly vmScene: THREE.Scene;
  /** Orthographic-style perspective camera for the viewmodel layer. */
  readonly vmCamera: THREE.PerspectiveCamera;

  private group: THREE.Group;         // root of the entire weapon model
  private muzzleFlashGroup: THREE.Group;
  private muzzleFlashMeshes: THREE.Mesh[];

  // Recoil state
  private recoilPhase: 'idle' | 'rise' | 'fall' = 'idle';
  private recoilElapsed = 0;
  private recoilOrigin  = new THREE.Vector3();   // base position of group
  private recoilBasePos = new THREE.Vector3();   // target rest position
  private flashExpiry   = 0;

  // All disposable resources
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor() {
    // ── Viewmodel scene & camera ─────────────────────────────────────
    this.vmScene  = new THREE.Scene();
    // Narrow FOV for the viewmodel so geometry looks natural in lower-right.
    this.vmCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.vmCamera.position.set(0, 0, 0);

    // ── Lighting for viewmodel ───────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 2, 1.5);
    const fill = new THREE.DirectionalLight(0x4466aa, 0.4);
    fill.position.set(-1, -0.5, 1);
    this.vmScene.add(ambient, key, fill);

    // ── Build weapon group ───────────────────────────────────────────
    this.group = new THREE.Group();
    this.vmScene.add(this.group);

    const mBody    = mat(COL_BODY,     0.82, 0.35);
    const mRecv    = mat(COL_RECEIVER, 0.75, 0.40);
    const mDetail  = mat(COL_DETAIL,   0.60, 0.55);
    const mBarrel  = mat(COL_BARREL,   0.90, 0.25);

    this.disposables.push(mBody, mRecv, mDetail, mBarrel);

    // ── Receiver (central body) ──────────────────────────────────────
    const receiverGeo = box(0.038, 0.030, 0.28);
    const receiver    = new THREE.Mesh(receiverGeo, mRecv);
    receiver.position.set(0, 0, -0.10);
    this.group.add(receiver);
    this.disposables.push(receiverGeo);

    // ── Magazine housing ─────────────────────────────────────────────
    const magGeo = box(0.028, 0.055, 0.048);
    const mag    = new THREE.Mesh(magGeo, mBody);
    mag.position.set(0, -0.038, -0.06);
    mag.rotation.x = 0.18; // slight forward tilt
    this.group.add(mag);
    this.disposables.push(magGeo);

    // ── Grip ─────────────────────────────────────────────────────────
    const gripGeo = box(0.024, 0.058, 0.036);
    const grip    = new THREE.Mesh(gripGeo, mDetail);
    grip.position.set(0, -0.048, 0.062);
    grip.rotation.x = -0.22;
    this.group.add(grip);
    this.disposables.push(gripGeo);

    // ── Stock ─────────────────────────────────────────────────────────
    const stockGeo = box(0.026, 0.022, 0.10);
    const stock    = new THREE.Mesh(stockGeo, mBody);
    stock.position.set(0, -0.004, 0.155);
    this.group.add(stock);
    this.disposables.push(stockGeo);

    // Stock cheek-rest bump
    const cheekGeo = box(0.024, 0.014, 0.042);
    const cheek    = new THREE.Mesh(cheekGeo, mBody);
    cheek.position.set(0, 0.008, 0.14);
    this.group.add(cheek);
    this.disposables.push(cheekGeo);

    // ── Upper rail (Picatinny-style flat top) ─────────────────────────
    const railGeo = box(0.034, 0.008, 0.24);
    const rail    = new THREE.Mesh(railGeo, mDetail);
    rail.position.set(0, 0.019, -0.06);
    this.group.add(rail);
    this.disposables.push(railGeo);

    // ── Handguard (around barrel, slotted) ───────────────────────────
    const hgGeo = box(0.030, 0.026, 0.13);
    const hg    = new THREE.Mesh(hgGeo, mDetail);
    hg.position.set(0, 0, -0.20);
    this.group.add(hg);
    this.disposables.push(hgGeo);

    // Handguard cutout accent strips (top and side)
    for (let i = 0; i < 3; i++) {
      const slotGeo = box(0.004, 0.012, 0.018);
      const slot    = new THREE.Mesh(slotGeo, mBody);
      slot.position.set(0.018, -0.002, -0.165 - i * 0.028);
      this.group.add(slot);
      this.disposables.push(slotGeo);
    }

    // ── Barrel ───────────────────────────────────────────────────────
    const barrelGeo = new THREE.CylinderGeometry(0.006, 0.007, 0.18, 8);
    const barrel    = new THREE.Mesh(barrelGeo, mBarrel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.004, -0.345);
    this.group.add(barrel);
    this.disposables.push(barrelGeo);

    // Muzzle compensator (short hex-ish block at barrel end)
    const compGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.022, 6);
    const comp    = new THREE.Mesh(compGeo, mBarrel);
    comp.rotation.x = Math.PI / 2;
    comp.position.set(0, 0.004, -0.442);
    this.group.add(comp);
    this.disposables.push(compGeo);

    // ── Charging handle nub ──────────────────────────────────────────
    const chGeo = box(0.008, 0.008, 0.018);
    const ch    = new THREE.Mesh(chGeo, mDetail);
    ch.position.set(0.025, 0.006, -0.01);
    this.group.add(ch);
    this.disposables.push(chGeo);

    // ── Muzzle flash (hidden until fired) ────────────────────────────
    this.muzzleFlashGroup  = new THREE.Group();
    this.muzzleFlashMeshes = [];

    // Centre disc
    const fdGeo = new THREE.PlaneGeometry(0.06, 0.06);
    const fdMat = new THREE.MeshBasicMaterial({
      color: COL_MUZZLE_A,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fd = new THREE.Mesh(fdGeo, fdMat);
    this.muzzleFlashGroup.add(fd);
    this.muzzleFlashMeshes.push(fd);
    this.disposables.push(fdGeo, fdMat);

    // Outer halo (rotated 45°)
    const fhGeo = new THREE.PlaneGeometry(0.09, 0.09);
    const fhMat = new THREE.MeshBasicMaterial({
      color: COL_MUZZLE_B,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fh = new THREE.Mesh(fhGeo, fhMat);
    fh.rotation.z = Math.PI / 4;
    this.muzzleFlashGroup.add(fh);
    this.muzzleFlashMeshes.push(fh);
    this.disposables.push(fhGeo, fhMat);

    // Place flash group at muzzle tip
    this.muzzleFlashGroup.position.set(0, 0.004, -0.455);
    this.muzzleFlashGroup.rotation.y = Math.PI / 2; // face camera
    this.muzzleFlashGroup.visible = false;
    this.muzzleFlashGroup.scale.setScalar(FLASH_SCALE);
    this.vmScene.add(this.muzzleFlashGroup);

    // ── Position entire weapon group in lower-right of viewmodel cam ─
    // Positive X = right, negative Y = down, negative Z = into scene.
    const REST_POS = new THREE.Vector3(0.16, -0.12, -0.40);
    this.group.position.copy(REST_POS);
    this.recoilBasePos.copy(REST_POS);
    this.recoilOrigin.copy(REST_POS);

    // Slight downward tilt for natural hold angle
    this.group.rotation.x =  0.06;
    this.group.rotation.y = -0.04;
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Call once per frame from the engine update loop.
   * @param deltaMs Frame time in milliseconds.
   * @param nowMs   Current performance.now() value.
   */
  update(deltaMs: number, nowMs: number): void {
    this.tickRecoil(deltaMs);
    this.tickMuzzleFlash(nowMs);
  }

  /**
   * Trigger firing animation and muzzle flash.  Call once per shot.
   * @param nowMs performance.now() at shot time.
   */
  fire(nowMs: number): void {
    // Reset and start recoil rise phase.
    this.recoilPhase   = 'rise';
    this.recoilElapsed = 0;

    // Show muzzle flash
    this.muzzleFlashGroup.visible = true;
    this.muzzleFlashGroup.scale.setScalar(FLASH_SCALE * (0.85 + Math.random() * 0.30));
    this.muzzleFlashGroup.rotation.z = Math.random() * Math.PI; // random roll each shot
    this.flashExpiry = nowMs + FLASH_DURATION_MS;
  }

  /**
   * Render the viewmodel into the given WebGLRenderer using a viewport
   * in the lower-right corner of the canvas.  Must be called AFTER the
   * main scene render so the viewmodel always appears on top.
   */
  render(renderer: THREE.WebGLRenderer): void {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    // Viewmodel occupies the lower-right 38% × 32% of the screen.
    const vpW = Math.round(w * 0.38);
    const vpH = Math.round(h * 0.32);
    const vpX = w - vpW;
    const vpY = 0;

    this.vmCamera.aspect = vpW / vpH;
    this.vmCamera.updateProjectionMatrix();

    // Sync flash group to always face the viewmodel camera.
    this.muzzleFlashGroup.lookAt(this.vmCamera.position);

    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setViewport(vpX, vpY, vpW, vpH);
    renderer.setScissor(vpX, vpY, vpW, vpH);
    renderer.setScissorTest(true);
    renderer.render(this.vmScene, this.vmCamera);
    renderer.setScissorTest(false);
    // Restore full viewport for subsequent renders.
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;
  }

  /**
   * Release all Three.js resources.  Call when the weapon is no longer needed.
   */
  dispose(): void {
    for (const res of this.disposables) {
      res.dispose();
    }
    this.disposables.length = 0;
  }

  // ── Private animation helpers ────────────────────────────────────────

  private tickRecoil(deltaMs: number): void {
    if (this.recoilPhase === 'idle') return;

    this.recoilElapsed += deltaMs;

    if (this.recoilPhase === 'rise') {
      const t = Math.min(this.recoilElapsed / RECOIL_RISE_MS, 1);
      const ease = Math.sin(t * Math.PI / 2); // ease-in
      this.group.position.y = this.recoilBasePos.y + ease * RECOIL_KICK_Y;
      this.group.position.z = this.recoilBasePos.z - ease * RECOIL_KICK_Z;
      if (t >= 1) {
        this.recoilPhase   = 'fall';
        this.recoilElapsed = 0;
      }
    } else if (this.recoilPhase === 'fall') {
      const t = Math.min(this.recoilElapsed / RECOIL_FALL_MS, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic (spring feel)
      this.group.position.y = this.recoilBasePos.y + RECOIL_KICK_Y * (1 - ease);
      this.group.position.z = this.recoilBasePos.z - RECOIL_KICK_Z * (1 - ease);
      if (t >= 1) {
        this.group.position.copy(this.recoilBasePos);
        this.recoilPhase = 'idle';
      }
    }
  }

  private tickMuzzleFlash(nowMs: number): void {
    if (this.muzzleFlashGroup.visible && nowMs >= this.flashExpiry) {
      this.muzzleFlashGroup.visible = false;
    }
  }
}
