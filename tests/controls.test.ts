import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Controls } from '../src/controls';

describe('Phase 6 — Controls Unit & Lifecycle Tests', () => {
  let camera: THREE.PerspectiveCamera;
  let domElement: HTMLElement;
  let controls: Controls;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(103, 16 / 9, 0.05, 500);
    domElement = document.createElement('canvas');
    document.body.appendChild(domElement);
    controls = new Controls(camera, domElement);
  });

  afterEach(() => {
    controls.dispose();
    if (domElement.parentNode) {
      domElement.parentNode.removeChild(domElement);
    }
  });

  function createMouseMoveEvent(movementX: number, movementY: number): MouseEvent {
    const event = new MouseEvent('mousemove');
    Object.defineProperty(event, 'movementX', { value: movementX });
    Object.defineProperty(event, 'movementY', { value: movementY });
    return event;
  }

  it('updates yaw and pitch on mouse movement when locked', () => {
    controls.isLocked = true;
    controls.sensitivity = 0.5;

    const initialYaw = controls.yawObject.rotation.y;
    const initialPitch = controls.pitchObject.rotation.x;

    const moveEvent = createMouseMoveEvent(50, -30);
    document.dispatchEvent(moveEvent);

    expect(controls.yawObject.rotation.y).not.toBe(initialYaw);
    expect(controls.pitchObject.rotation.x).not.toBe(initialPitch);
    // Mouse moved right -> yaw decreases in Three.js coordinates
    expect(controls.yawObject.rotation.y).toBeLessThan(initialYaw);
  });

  it('clamps pitch between -89 and +89 degrees to prevent gimbal lock/inversion', () => {
    controls.isLocked = true;
    controls.sensitivity = 2.0;

    const maxPitch = (Math.PI / 2) - 0.01;

    // Simulate extreme mouse upward motion
    for (let i = 0; i < 50; i++) {
      document.dispatchEvent(createMouseMoveEvent(0, -100));
    }
    expect(controls.pitchObject.rotation.x).toBeLessThanOrEqual(maxPitch);

    // Simulate extreme mouse downward motion
    for (let i = 0; i < 50; i++) {
      document.dispatchEvent(createMouseMoveEvent(0, 100));
    }
    expect(controls.pitchObject.rotation.x).toBeGreaterThanOrEqual(-maxPitch);
  });

  it('respects invertY setting during mouse movement', () => {
    controls.isLocked = true;
    controls.sensitivity = 0.5;

    // Normal mode: movementY > 0 tilts pitch down (negative)
    controls.invertY = false;
    controls.pitchObject.rotation.x = 0;
    document.dispatchEvent(createMouseMoveEvent(0, 20));
    const normalPitch = controls.pitchObject.rotation.x;

    // Invert mode: movementY > 0 tilts pitch up (positive)
    controls.invertY = true;
    controls.pitchObject.rotation.x = 0;
    document.dispatchEvent(createMouseMoveEvent(0, 20));
    const invertedPitch = controls.pitchObject.rotation.x;

    expect(normalPitch).toBeLessThan(0);
    expect(invertedPitch).toBeGreaterThan(0);
    expect(Math.abs(normalPitch + invertedPitch)).toBeLessThan(1e-6);
  });

  it('triggers onShoot callback only on left click when locked', () => {
    const shootSpy = vi.fn();
    controls.onShoot = shootSpy;

    // Click while unlocked does not trigger shoot
    controls.isLocked = false;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(shootSpy).not.toHaveBeenCalled();

    // Left click while locked triggers shoot
    controls.isLocked = true;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(shootSpy).toHaveBeenCalledTimes(1);

    // Right click while locked does not trigger shoot
    document.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(shootSpy).toHaveBeenCalledTimes(1);
  });

  it('updates movement flags and velocity on WASD key events when locked', () => {
    controls.isLocked = true;

    // Press KeyW
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(controls.moveForward).toBe(true);
    expect(controls.getActiveKeys().w).toBe(true);

    // Update with delta
    controls.update(0.016, true);
    expect(controls.velocity.z).toBeLessThan(0); // Forward moves along -Z

    // Release KeyW
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(controls.moveForward).toBe(false);
    expect(controls.getActiveKeys().w).toBe(false);

    // Press KeyD (strafe right)
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(controls.moveRight).toBe(true);
    controls.update(0.016, true);
    expect(controls.velocity.x).toBeGreaterThan(0); // Right moves along +X

    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    expect(controls.moveRight).toBe(false);
  });

  it('normalizes diagonal direction vector so diagonal movement is clamped to max speed', () => {
    controls.isLocked = true;

    // Move forward and right simultaneously
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));

    controls.update(0.016, true);

    // Direction vector must be normalized to length 1
    const dirLength = Math.sqrt(
      controls.direction.x * controls.direction.x +
      controls.direction.z * controls.direction.z
    );
    expect(dirLength).toBeCloseTo(1.0, 4);
    expect(controls.direction.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(controls.direction.z).toBeCloseTo(Math.SQRT1_2, 4);

    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
  });

  it('evaluates counter-strafe deadzone and velocity state transitions', () => {
    controls.isLocked = true;

    // Initially stationary -> counter-strafed is true
    expect(controls.getSpeed()).toBe(0);
    expect(controls.isCounterStrafed()).toBe(true);

    // Accelerate
    controls.velocity.x = 2.5;
    expect(controls.getSpeed()).toBe(2.5);
    expect(controls.isCounterStrafed()).toBe(false); // Moving above 0.6 threshold

    // Decelerate into deadzone (< 0.6 m/s)
    controls.velocity.x = 0.4;
    expect(controls.getSpeed()).toBeCloseTo(0.4, 2);
    expect(controls.isCounterStrafed()).toBe(true);
  });

  it('resets all active key states when window loses focus (blur event)', () => {
    controls.isLocked = true;

    // Hold all keys
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));

    expect(controls.moveForward).toBe(true);
    expect(controls.moveLeft).toBe(true);
    expect(controls.moveBackward).toBe(true);
    expect(controls.moveRight).toBe(true);

    // Simulate window blur
    window.dispatchEvent(new Event('blur'));

    expect(controls.moveForward).toBe(false);
    expect(controls.moveLeft).toBe(false);
    expect(controls.moveBackward).toBe(false);
    expect(controls.moveRight).toBe(false);
    const active = controls.getActiveKeys();
    expect(active.w).toBe(false);
    expect(active.a).toBe(false);
    expect(active.s).toBe(false);
    expect(active.d).toBe(false);
  });

  it('cleans up event listeners cleanly on dispose', () => {
    controls.dispose();
    controls.isLocked = true;
    const initialYaw = controls.yawObject.rotation.y;

    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 50, movementY: 50 }));
    expect(controls.yawObject.rotation.y).toBe(initialYaw);
  });
});
