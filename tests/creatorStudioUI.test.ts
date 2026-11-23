import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { UIManager, TimingClock } from '../src/ui';
import { createDefaultCustomScenario, convertCustomScenarioToConfig } from '../src/scenarioConfig';
import type { WarmupLabScenarioV1 } from '../src/types';

class MockTimingClock implements TimingClock {
  public currentTime = 1000;
  private timerIdCounter = 1;
  public activeTimeouts = new Map<number, { fn: () => void; dueTime: number }>();
  public activeIntervals = new Map<number, { fn: () => void; intervalMs: number; nextDue: number }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(fn: () => void, ms: number): any {
    const id = this.timerIdCounter++;
    this.activeTimeouts.set(id, { fn, dueTime: this.currentTime + ms });
    return id;
  }

  clearTimeout(id: any): void {
    this.activeTimeouts.delete(id);
  }

  setInterval(fn: () => void, ms: number): any {
    const id = this.timerIdCounter++;
    this.activeIntervals.set(id, { fn, intervalMs: ms, nextDue: this.currentTime + ms });
    return id;
  }

  clearInterval(id: any): void {
    this.activeIntervals.delete(id);
  }

  tick(ms: number): void {
    this.currentTime += ms;
    for (const [id, t] of Array.from(this.activeTimeouts.entries())) {
      if (this.currentTime >= t.dueTime) {
        this.activeTimeouts.delete(id);
        t.fn();
      }
    }
  }

  clearAll(): void {
    this.activeTimeouts.clear();
    this.activeIntervals.clear();
  }
}

describe('Phase 4 — Creator Studio & Custom Scenario UI Integration', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;
  let ui: UIManager;
  let mockClock: MockTimingClock;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.requestPointerLock = vi.fn();
    document.exitPointerLock = vi.fn();
    document.body.appendChild(appContainer);
    document.body.appendChild(canvas);

    const mockWebGLRenderer = {
      domElement: { width: 800, height: 600 },
      shadowMap: { enabled: false, type: 0 },
      autoClear: true,
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
    mockClock = new MockTimingClock();
    ui = new UIManager(engine, appContainer, canvas);
    ui.clock = mockClock;
  });

  afterEach(() => {
    ui.dispose();
    mockClock.clearAll();
    localStorage.clear();
  });

  it('navigates to Creator Studio and mounts all editor sections and buttons', () => {
    ui.navigateTo('creator');

    const heading = appContainer.querySelector('h2');
    expect(heading?.textContent).toContain('Custom Static Flicks');

    expect(appContainer.querySelector('#studio-name')).not.toBeNull();
    expect(appContainer.querySelector('#studio-cat')).not.toBeNull();
    expect(appContainer.querySelector('#studio-diff')).not.toBeNull();
    expect(appContainer.querySelector('#studio-duration')).not.toBeNull();
    expect(appContainer.querySelector('#studio-weapon')).not.toBeNull();
    expect(appContainer.querySelector('#studio-spawn-mode')).not.toBeNull();
    expect(appContainer.querySelector('#studio-max-alive')).not.toBeNull();
    expect(appContainer.querySelector('#studio-target-shape')).not.toBeNull();
    expect(appContainer.querySelector('#studio-movement-pattern')).not.toBeNull();
    expect(appContainer.querySelector('#studio-retaliation')).not.toBeNull();
    expect(appContainer.querySelector('#studio-score-hit')).not.toBeNull();

    // Live inspector and actions
    expect(appContainer.querySelector('#studio-json-preview')).not.toBeNull();
    expect(appContainer.querySelector('#btn-studio-save')).not.toBeNull();
    expect(appContainer.querySelector('#btn-studio-preview')).not.toBeNull();
    expect(appContainer.querySelector('#btn-studio-export')).not.toBeNull();
    expect(appContainer.querySelector('#btn-studio-import')).not.toBeNull();
  });

  it('loads starter templates dynamically into editor form', () => {
    ui.navigateTo('creator');

    const templateSelect = appContainer.querySelector('#studio-template-select') as HTMLSelectElement;
    templateSelect.value = 'retaliatory_duel';

    const loadBtn = appContainer.querySelector('#btn-studio-template-new') as HTMLButtonElement;
    loadBtn.click();

    expect(ui.editingScenario?.name).toBe('Custom Retaliatory Skirmish');
    expect(ui.editingScenario?.target.retaliatory).toBe(true);
    expect(ui.editingScenario?.target.movementPattern).toBe('jiggle');

    const retaliationCheckbox = appContainer.querySelector('#studio-retaliation') as HTMLInputElement;
    expect(retaliationCheckbox.checked).toBe(true);

    const kpiThreat = appContainer.querySelector('#studio-kpi-threat');
    expect(kpiThreat?.textContent).toContain('Return-Fire');
  });

  it('updates live JSON inspector and KPI badges on user form inputs', () => {
    ui.navigateTo('creator');

    const nameInput = appContainer.querySelector('#studio-name') as HTMLInputElement;
    nameInput.value = 'Pro Jiggle Trainer';
    nameInput.dispatchEvent(new Event('input'));

    expect(ui.editingScenario?.name).toBe('Pro Jiggle Trainer');

    const jsonPreview = appContainer.querySelector('#studio-json-preview');
    expect(jsonPreview?.textContent).toContain('Pro Jiggle Trainer');

    const maxAliveInput = appContainer.querySelector('#studio-max-alive') as HTMLInputElement;
    maxAliveInput.value = '3';
    maxAliveInput.dispatchEvent(new Event('input'));

    expect(ui.editingScenario?.spawner.maxAlive).toBe(3);
    const kpiTargets = appContainer.querySelector('#studio-kpi-targets');
    expect(kpiTargets?.textContent).toContain('3 targets');
  });

  it('validates scenario on save and blocks saving when invalid', async () => {
    ui.navigateTo('creator');

    const nameInput = appContainer.querySelector('#studio-name') as HTMLInputElement;
    nameInput.value = ''; // Invalid: empty name
    nameInput.dispatchEvent(new Event('input'));

    const saveBtn = appContainer.querySelector('#btn-studio-save') as HTMLButtonElement;
    await saveBtn.click();

    // Still in creator studio due to error
    expect(ui.studioErrors.length).toBeGreaterThan(0);
    expect(appContainer.innerHTML).toContain('Cannot save custom drill:');
    expect(store.getCustomScenarios().length).toBe(0);
  });

  it('saves valid custom drill, navigates to Scenarios, and shows custom card with actions', async () => {
    ui.navigateTo('creator');

    const nameInput = appContainer.querySelector('#studio-name') as HTMLInputElement;
    nameInput.value = 'Master Reflex 9000';
    nameInput.dispatchEvent(new Event('input'));

    const saveBtn = appContainer.querySelector('#btn-studio-save') as HTMLButtonElement;
    await saveBtn.click();

    // Should redirect to scenarios
    expect(store.getCustomScenarios().length).toBe(1);
    const saved = store.getCustomScenarios()[0];
    expect(saved.name).toBe('Master Reflex 9000');

    // Scenarios grid should display the custom drill card
    const card = appContainer.querySelector(`[data-scen="${saved.id}"]`);
    expect(card).not.toBeNull();
    expect(card?.innerHTML).toContain('CUSTOM DRILL');
    expect(card?.querySelector('[data-edit-custom]')).not.toBeNull();
    expect(card?.querySelector('[data-dup-custom]')).not.toBeNull();
    expect(card?.querySelector('[data-export-custom]')).not.toBeNull();
    expect(card?.querySelector('[data-del-custom]')).not.toBeNull();
  });

  it('supports duplicating and deleting custom drills from Scenarios page', async () => {
    const drill = createDefaultCustomScenario('static_flick');
    drill.name = 'Original Custom Drill';
    await store.saveCustomScenario(drill);

    ui.navigateTo('scenarios');
    expect(store.getCustomScenarios().length).toBe(1);

    // Click Duplicate
    const dupBtn = appContainer.querySelector(`[data-dup-custom="${drill.id}"]`) as HTMLButtonElement;
    await dupBtn.click();

    expect(store.getCustomScenarios().length).toBe(2);
    expect(store.getCustomScenarios().some(s => s.name.includes('(Copy)'))).toBe(true);

    // Click Delete with confirm mock
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const delBtn = appContainer.querySelector(`[data-del-custom="${drill.id}"]`) as HTMLButtonElement;
    await delBtn.click();

    expect(store.getCustomScenarios().length).toBe(1);
  });

  it('exposes custom drills in Playlist Editor available scenarios list', async () => {
    const drill = createDefaultCustomScenario('tracking_smooth');
    drill.name = 'Custom Smooth Strafe';
    await store.saveCustomScenario(drill);

    // Open playlist editor
    ui.navigateTo('plans');
    const createPlaylistBtn = appContainer.querySelector('#btn-create-playlist') as HTMLButtonElement;
    createPlaylistBtn.click();

    // Switch to Custom category filter
    const customFilterBtn = appContainer.querySelector('[data-editor-cat="custom"]') as HTMLButtonElement;
    customFilterBtn.click();

    const addBtn = appContainer.querySelector(`[data-add-scenario-id="${drill.id}"]`);
    expect(addBtn).not.toBeNull();

    // Add drill to playlist
    (addBtn as HTMLButtonElement).click();
    expect(ui.editingPlaylist?.entries.some(e => e.scenarioId === drill.id)).toBe(true);
  });

  it('launches in-studio preview without requiring pre-saving', () => {
    ui.navigateTo('creator');

    const previewBtn = appContainer.querySelector('#btn-studio-preview') as HTMLButtonElement;
    previewBtn.click();

    expect(engine.isRunning).toBe(true);
    expect(canvas.classList.contains('visible')).toBe(true);
  });

  it('mounts Save as New Drill and Update & Reset PB buttons when editing existing drill and executes workflows', async () => {
    const existing = createDefaultCustomScenario('static_flick');
    existing.name = 'Original Custom Drill';
    await store.saveCustomScenario(existing);

    // Set a PB on the existing drill
    store.addSession({
      id: 'sess_orig_test',
      scenarioId: existing.id,
      scenarioName: existing.name,
      category: existing.category,
      difficulty: existing.difficulty,
      configVersion: 1,
      timestamp: Date.now(),
      durationSec: 60,
      score: 1500,
      hits: 15,
      misses: 0,
      headshots: 15,
      bodyHits: 0,
      shotsFired: 15,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 200,
      targetsPerSecond: 0.25,
      shotsMoving: 0,
      shotsStationary: 15,
    });
    expect(store.getPB(existing.id)?.score).toBe(1500);

    // Edit the existing drill in Creator Studio
    ui.editingScenario = JSON.parse(JSON.stringify(existing));
    ui.navigateTo('creator');

    // Verify existing drill buttons are mounted
    expect(appContainer.querySelector('#btn-studio-save-new')).not.toBeNull();
    expect(appContainer.querySelector('#btn-studio-update-reset-pb')).not.toBeNull();

    // 1. Test "Save as New Drill"
    const saveNewBtn = appContainer.querySelector('#btn-studio-save-new') as HTMLButtonElement;
    await saveNewBtn.click();

    expect(store.getCustomScenarios().length).toBe(2);
    expect(store.getCustomScenario(existing.id)?.name).toBe('Original Custom Drill');
    expect(store.getPB(existing.id)?.score).toBe(1500); // Unchanged!

    // 2. Test "Update & Reset PB" on existing drill
    ui.editingScenario = JSON.parse(JSON.stringify(existing));
    ui.navigateTo('creator');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const updateResetBtn = appContainer.querySelector('#btn-studio-update-reset-pb') as HTMLButtonElement;
    await updateResetBtn.click();

    const updated = store.getCustomScenario(existing.id);
    expect(updated?.metadata.configVersion).toBe(2);
    expect(store.getPB(existing.id)).toBeNull(); // Reset!
  });
});
