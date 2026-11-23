import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Renderer } from '../src/renderer';

describe('Phase 4 — Three.js Resource Lifecycle & Cleanup', () => {
  it('disposes all owned resources including matFriend, shared geometries, and arena elements', () => {
    const canvas = document.createElement('canvas');
    const mockDispose = vi.fn();
    const mockWebGLRenderer = {
      domElement: canvas,
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      clear: vi.fn(),
      dispose: mockDispose,
    } as unknown as THREE.WebGLRenderer;

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);

    // Spy on disposable items
    const headGeoSpy = vi.spyOn(renderer.sharedHeadGeo, 'dispose');
    const torsoGeoSpy = vi.spyOn(renderer.sharedTorsoGeo, 'dispose');
    const shoulderGeoSpy = vi.spyOn(renderer.sharedShoulderGeo, 'dispose');
    const matIdleSpy = vi.spyOn((renderer as unknown as { matIdle: THREE.Material }).matIdle, 'dispose');
    const matHitSpy = vi.spyOn((renderer as unknown as { matHit: THREE.Material }).matHit, 'dispose');
    const matFriendSpy = vi.spyOn((renderer as unknown as { matFriend: THREE.Material }).matFriend, 'dispose');

    // Create a target
    renderer.addTarget('target-1', new THREE.Vector3(0, 1.5, -10), 0.22, 'sphere', 'standard');
    expect(renderer.getTargetVisual('target-1')).toBeDefined();

    // Dispose
    renderer.dispose();

    expect(headGeoSpy).toHaveBeenCalled();
    expect(torsoGeoSpy).toHaveBeenCalled();
    expect(shoulderGeoSpy).toHaveBeenCalled();
    expect(matIdleSpy).toHaveBeenCalled();
    expect(matHitSpy).toHaveBeenCalled();
    expect(matFriendSpy).toHaveBeenCalled();
    expect(mockDispose).toHaveBeenCalled();
    expect(renderer.getTargetVisual('target-1')).toBeUndefined();

    // Repeated dispose should not throw
    expect(() => {
      renderer.dispose();
    }).not.toThrow();
  });
});
