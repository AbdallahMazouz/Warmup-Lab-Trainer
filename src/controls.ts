// =====================================================================
// controls.ts — First-Person Camera, Pointer Lock & Movement
// =====================================================================

import * as THREE from 'three';
import {
  PLAYER_HEIGHT,
  PLAYER_SPEED,
  GRAVITY,
  JUMP_FORCE,
} from './constants';

export class Controls {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;

  // Rotation Euler & Quaternions
  yawObject = new THREE.Object3D();
  pitchObject = new THREE.Object3D();

  // Settings
  sensitivity = 0.12;
  invertY = false;

  // State
  isLocked = false;
  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  canJump = false;

  velocity = new THREE.Vector3();
  direction = new THREE.Vector3();

  // Callbacks
  onLockChange?: (locked: boolean) => void;
  onShoot?: () => void;

  private _onMouseMove = this.onMouseMove.bind(this);
  private _onPointerLockChange = this.onPointerLockChange.bind(this);
  private _onPointerLockError = this.onPointerLockError.bind(this);
  private _onKeyDown = this.onKeyDown.bind(this);
  private _onKeyUp = this.onKeyUp.bind(this);
  private _onMouseDown = this.onMouseDown.bind(this);
  private _onBlur = this.resetKeys.bind(this);
  private _cachedRay = new THREE.Ray();
  private _lockPending = false;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Hierarchy: scene -> yawObject (X, Z pos & Y rot) -> pitchObject (X rot) -> camera
    this.pitchObject.add(this.camera);
    this.yawObject.position.y = PLAYER_HEIGHT;
    this.yawObject.add(this.pitchObject);

    this.initEvents();
  }

  private initEvents(): void {
    document.addEventListener('mousemove', this._onMouseMove, false);
    document.addEventListener('pointerlockchange', this._onPointerLockChange, false);
    document.addEventListener('pointerlockerror', this._onPointerLockError, false);
    document.addEventListener('keydown', this._onKeyDown, false);
    document.addEventListener('keyup', this._onKeyUp, false);
    document.addEventListener('mousedown', this._onMouseDown, false);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._onBlur, false);
    }
  }

  dispose(): void {
    document.removeEventListener('mousemove', this._onMouseMove, false);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange, false);
    document.removeEventListener('pointerlockerror', this._onPointerLockError, false);
    document.removeEventListener('keydown', this._onKeyDown, false);
    document.removeEventListener('keyup', this._onKeyUp, false);
    document.removeEventListener('mousedown', this._onMouseDown, false);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._onBlur, false);
    }
  }

  lock(): void {
    if (this.domElement.requestPointerLock) {
      this._lockPending = true;
      try {
        const p = this.domElement.requestPointerLock();
        if (p && typeof (p as any).catch === 'function') {
          (p as any).catch(() => {
            this.handleLockFailure();
          });
        }
      } catch {
        this.handleLockFailure();
      }
    } else {
      this.handleLockFailure();
    }
  }

  unlock(): void {
    this._lockPending = false;
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  private onPointerLockError(): void {
    this.handleLockFailure();
  }

  private handleLockFailure(): void {
    if (!this._lockPending && !this.isLocked) {
      return;
    }
    this._lockPending = false;
    this.isLocked = false;
    this.resetKeys();
    if (this.onLockChange) {
      this.onLockChange(false);
    }
  }

  private onPointerLockChange(): void {
    this._lockPending = false;
    const isNowLocked = document.pointerLockElement === this.domElement;
    this.isLocked = isNowLocked;
    if (this.onLockChange) {
      this.onLockChange(this.isLocked);
    }
    if (!this.isLocked) {
      this.resetKeys();
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isLocked) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    // Valorant sensitivity: 0.12 deg/pixel approximation
    // deg to rad factor: Math.PI / 180 * factor
    const factor = (this.sensitivity * 0.07) * (Math.PI / 180);

    this.yawObject.rotation.y -= movementX * factor;

    const yMult = this.invertY ? -1 : 1;
    this.pitchObject.rotation.x -= movementY * factor * yMult;

    // Clamp pitch between -89° and +89°
    const maxPitch = (Math.PI / 2) - 0.01;
    this.pitchObject.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.pitchObject.rotation.x));
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.isLocked) return;
    if (event.button === 0) { // Left click
      if (this.onShoot) {
        this.onShoot();
      }
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.isLocked) return;
    if (event.repeat) return;

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = true;
        break;
      case 'Space':
        if (this.canJump) {
          this.velocity.y = JUMP_FORCE;
          this.canJump = false;
        }
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveForward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveBackward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveLeft = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveRight = false;
        break;
    }
  }

  // Counter-strafing and movement update
  update(delta: number, movementEnabled = true): void {
    if (!this.isLocked) return;

    const dt = Math.min(delta, 0.1);

    if (movementEnabled) {
      // Counter-strafing friction model
      // Friction decelerates fast when key released or counter-key pressed
      const friction = 14.0;
      this.velocity.x -= this.velocity.x * friction * dt;
      this.velocity.z -= this.velocity.z * friction * dt;

      // Gravity
      this.velocity.y += GRAVITY * dt;

      this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
      this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
      this.direction.normalize();

      if (this.moveForward || this.moveBackward) {
        this.velocity.z -= this.direction.z * PLAYER_SPEED * 8.0 * dt;
      }
      if (this.moveLeft || this.moveRight) {
        this.velocity.x += this.direction.x * PLAYER_SPEED * 8.0 * dt;
      }

      // Translate along yaw
      this.yawObject.translateX(this.velocity.x * dt);
      this.yawObject.translateZ(this.velocity.z * dt);
      this.yawObject.position.y += this.velocity.y * dt;

      // Ground plane collision
      if (this.yawObject.position.y < PLAYER_HEIGHT) {
        this.velocity.y = 0;
        this.yawObject.position.y = PLAYER_HEIGHT;
        this.canJump = true;
      }

      // Constrain inside arena boundaries
      const arenaRadius = 18;
      this.yawObject.position.x = Math.max(-arenaRadius, Math.min(arenaRadius, this.yawObject.position.x));
      this.yawObject.position.z = Math.max(-arenaRadius, Math.min(arenaRadius, this.yawObject.position.z));
    } else {
      // Stationary training position
      this.yawObject.position.set(0, PLAYER_HEIGHT, 0);
      this.velocity.set(0, 0, 0);
    }
  }

  reset(position = new THREE.Vector3(0, PLAYER_HEIGHT, 0), yaw = 0, pitch = 0): void {
    this.yawObject.position.copy(position);
    this.yawObject.rotation.set(0, yaw, 0);
    this.pitchObject.rotation.set(pitch, 0, 0);
    this.velocity.set(0, 0, 0);
  }

  resetKeys(): void {
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
  }

  getRay(): THREE.Ray {
    this.camera.getWorldPosition(this._cachedRay.origin);
    this.camera.getWorldDirection(this._cachedRay.direction);
    return this._cachedRay;
  }

  isCounterStrafed(): boolean {
    // Current horizontal velocity magnitude
    const hSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    return hSpeed < 0.6; // Valorant dead-zone threshold for accurate first-shot
  }
}
