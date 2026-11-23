// =====================================================================
// main.ts — Application Entry Point & Game Loop
// =====================================================================

import './style.css';
import { Renderer } from './renderer';
import { Controls } from './controls';
import { AudioManager } from './audio';
import { SettingsManager } from './settings';
import { Store } from './store';
import { Engine } from './engine';
import { UIManager } from './ui';

async function init(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const appContainer = document.getElementById('app') as HTMLElement;

  if (!canvas || !appContainer) {
    console.error('Core DOM containers not found');
    return;
  }

  // 1. Core modules
  const settings = new SettingsManager();
  const store = new Store();
  await store.init();
  const audio = new AudioManager();

  // 2. 3D Renderer & Camera
  const renderer = new Renderer(canvas, settings.get('fov'));

  // 3. First-Person Controls & Pointer Lock
  const controls = new Controls(renderer.camera, canvas);
  renderer.scene.add(controls.yawObject);

  // 4. Game Engine
  const engine = new Engine(renderer, controls, audio, settings, store);

  // 5. User Interface Manager
  const ui = new UIManager(engine, appContainer, canvas);

  // Expose on window for runtime diagnostics & testing
  (window as any).engine = engine;
  (window as any).ui = ui;
  (window as any).store = store;

  // 6. Main requestAnimationFrame Loop
  function animate(): void {
    requestAnimationFrame(animate);
    engine.update();
  }

  requestAnimationFrame(animate);

  console.log('WarmupLab initialized successfully.');
}

// Ensure DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
