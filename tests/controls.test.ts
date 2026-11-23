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

  it('cleans up event listeners cleanly on dispose', () => {
    controls.dispose();
    controls.isLocked = true;
    const initialYaw = controls.yawObject.rotation.y;

    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 50, movementY: 50 }));
    expect(controls.yawObject.rotation.y).toBe(initialYaw);
  });
});
