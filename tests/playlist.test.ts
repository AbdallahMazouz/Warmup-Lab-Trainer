import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  SCENARIOS,
  TRAINING_ROUTINES,
  getScenarioById,
  ROUTINE_TRANSITION_SEC,
} from '../src/scenarios';
import {
  validatePlaylist,
  calculatePlaylistDurations,
  convertRoutineToPlaylist,
  createDefaultPlaylist,
  duplicatePlaylist,
} from '../src/playlist';
import { LS_PLAYLISTS, LS_ROUTINES, LS_SESSIONS, LS_PERSONAL_BESTS, DEFAULT_REST_INTERVAL_SEC } from '../src/constants';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { UIManager, TimingClock } from '../src/ui';
import type { Playlist, PlaylistEntry, SessionResult, DifficultyId } from '../src/types';

// Mock clock for deterministic timing verification
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
    const targetTime = this.currentTime + ms;
    this.currentTime = targetTime;

    // Trigger timeouts
    for (const [id, t] of Array.from(this.activeTimeouts.entries())) {
      if (this.currentTime >= t.dueTime) {
        this.activeTimeouts.delete(id);
        t.fn();
      }
    }

    // Trigger intervals
    for (const [, inv] of Array.from(this.activeIntervals.entries())) {
      while (this.currentTime >= inv.nextDue) {
        inv.nextDue += inv.intervalMs;
        inv.fn();
      }
    }
  }

  clearAll(): void {
    this.activeTimeouts.clear();
    this.activeIntervals.clear();
  }
}

describe('Phase 2 — Playlist Data Model & Validation', () => {
  it('creates a valid default playlist', () => {
    const playlist = createDefaultPlaylist('My Test Playlist');
    expect(playlist.id).toBeDefined();
    expect(playlist.name).toBe('My Test Playlist');
    expect(playlist.entries.length).toBeGreaterThan(0);
    expect(playlist.defaultRestIntervalSec).toBe(DEFAULT_REST_INTERVAL_SEC);

    const validation = validatePlaylist(playlist);
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('rejects invalid or empty playlist models', () => {
    expect(validatePlaylist(null).valid).toBe(false);
    expect(validatePlaylist({}).valid).toBe(false);

    // Empty name
    const emptyName = createDefaultPlaylist('');
    expect(validatePlaylist(emptyName).valid).toBe(false);

    // Name too long (>80)
    const longName = createDefaultPlaylist('a'.repeat(81));
    expect(validatePlaylist(longName).valid).toBe(false);

    // Empty entries
    const noEntries = { ...createDefaultPlaylist('Empty'), entries: [] };
    expect(validatePlaylist(noEntries).valid).toBe(false);

    // Invalid duration
    const badDuration: Playlist = {
      ...createDefaultPlaylist('Bad Dur'),
      entries: [{ id: '1', scenarioId: 'flick-static', durationSec: 2 }],
    };
    expect(validatePlaylist(badDuration).valid).toBe(false);

    // Negative rest
    const badRest: Playlist = {
      ...createDefaultPlaylist('Bad Rest'),
      entries: [{ id: '1', scenarioId: 'flick-static', durationSec: 60, restIntervalSec: -5 }],
    };
    expect(validatePlaylist(badRest).valid).toBe(false);
  });

  it('converts TrainingRoutine to Playlist accurately', () => {
    const r5 = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    const converted = convertRoutineToPlaylist(r5);

    expect(converted.id).toBe('routine-5m');
    expect(converted.name).toBe(r5.name);
    expect(converted.isBuiltin).toBe(true);
    expect(converted.entries.length).toBe(5);
    expect(converted.entries[0].scenarioId).toBe('flick-static');
    expect(converted.entries[0].durationSec).toBe(60);
    expect(converted.entries[0].restIntervalSec).toBe(ROUTINE_TRANSITION_SEC);

    const validation = validatePlaylist(converted);
    expect(validation.valid).toBe(true);
  });
});

describe('Phase 2 — Duration Calculations & Reordering', () => {
  it('calculates active, rest, and total elapsed duration correctly', () => {
    const playlist: Playlist = {
      id: 'test-durations',
      name: 'Duration Test',
      defaultRestIntervalSec: 5,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 30 },
        { id: 'e2', scenarioId: 'flick-micro', durationSec: 45, restIntervalSec: 10 },
        { id: 'e3', scenarioId: 'track-smooth', durationSec: 60 },
      ],
    };

    const durations = calculatePlaylistDurations(playlist);
    // Active: 30 + 45 + 60 = 135s
    expect(durations.activeSec).toBe(135);
    // Rest: transition 1 (uses default 5s), transition 2 (uses override 10s) = 15s
    expect(durations.restSec).toBe(15);
    // Total elapsed: 135 + 15 = 150s
    expect(durations.totalElapsedSec).toBe(150);
  });

  it('single drill playlist has zero rest duration', () => {
    const playlist: Playlist = {
      id: 'single-drill',
      name: 'Single Drill',
      defaultRestIntervalSec: 5,
      entries: [{ id: 'e1', scenarioId: 'flick-static', durationSec: 60 }],
    };

    const durations = calculatePlaylistDurations(playlist);
    expect(durations.activeSec).toBe(60);
    expect(durations.restSec).toBe(0);
    expect(durations.totalElapsedSec).toBe(60);
  });

  it('duplicates playlists with a copy name and independent entries', () => {
    const original = createDefaultPlaylist('Speed Workout');
    const copy = duplicatePlaylist(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Speed Workout (Copy)');
    expect(copy.isBuiltin).toBe(false);
    expect(copy.entries.length).toBe(original.entries.length);

    // Modifying copy entries does not mutate original
    copy.entries[0].durationSec = 15;
    expect(original.entries[0].durationSec).toBe(60);
  });
});

describe('Phase 2 — Persistence & Store Operations', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('saves and retrieves custom playlists from localStorage', () => {
    const playlist = createDefaultPlaylist('Custom Precision');
    playlist.entries = [
      { id: 'e1', scenarioId: 'flick-precision', durationSec: 45 },
      { id: 'e2', scenarioId: 'flick-micro', durationSec: 30 },
    ];

    const saveResult = store.savePlaylist(playlist);
    expect(saveResult.success).toBe(true);

    const retrieved = store.getPlaylistById(playlist.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Custom Precision');
    expect(retrieved?.entries.length).toBe(2);

    // Survives reload via new Store instance
    const reloadedStore = new Store();
    const loadedList = reloadedStore.getPlaylists();
    expect(loadedList.length).toBe(1);
    expect(loadedList[0].id).toBe(playlist.id);
    expect(loadedList[0].entries[0].durationSec).toBe(45);
  });

  it('duplicates custom and built-in playlists via store', () => {
    // Duplicate built-in routine
    const dupPreset = store.duplicatePlaylist('routine-5m');
    expect(dupPreset).toBeDefined();
    expect(dupPreset?.name).toBe('Quick 5-Minute Warm-Up (Copy)');
    expect(dupPreset?.isBuiltin).toBe(false);

    const customPlaylists = store.getPlaylists();
    expect(customPlaylists.some(p => p.id === dupPreset?.id)).toBe(true);
  });

  it('deletes custom playlists safely and prevents deletion of presets', () => {
    const p1 = createDefaultPlaylist('Playlist to Delete');
    store.savePlaylist(p1);
    expect(store.getPlaylists().length).toBe(1);

    // Cannot delete built-in preset
    const deletePreset = store.deletePlaylist('routine-5m');
    expect(deletePreset).toBe(false);

    // Can delete custom playlist
    const deleteCustom = store.deletePlaylist(p1.id);
    expect(deleteCustom).toBe(true);
    expect(store.getPlaylists().length).toBe(0);
  });

  it('safely handles corrupted localStorage data', () => {
    localStorage.setItem(LS_PLAYLISTS, 'invalid-json{{{');
    const safeStore = new Store();
    expect(safeStore.getPlaylists()).toEqual([]);

    localStorage.setItem(LS_PLAYLISTS, JSON.stringify([{ invalid: 'entry' }]));
    const safeStore2 = new Store();
    expect(safeStore2.getPlaylists()).toEqual([]);
  });

  it('preserves existing RoutineSummary and session history without collision', () => {
    const summary = {
      id: 'summary-1',
      routineId: 'routine-5m',
      routineName: 'Quick 5-Minute Warm-Up',
      difficulty: 'intermediate' as DifficultyId,
      timestamp: Date.now(),
      totalDurationSec: 300,
      drillsCompleted: 5,
      totalDrills: 5,
      totalScore: 5000,
      overallAccuracy: 85,
      totalHits: 50,
      totalHeadshots: 30,
      totalShotsFired: 60,
    };

    store.addRoutineSummary(summary);
    expect(store.getRoutineSummaries().length).toBe(1);

    // Adding playlist does not mutate or clear routine summaries
    store.savePlaylist(createDefaultPlaylist('Test'));
    expect(store.getRoutineSummaries().length).toBe(1);
    expect(store.getPlaylists().length).toBe(1);
  });
});

describe('Phase 2 — Sequencer & Playback Engine', () => {
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
    ui = new UIManager(engine, appContainer, canvas);

    mockClock = new MockTimingClock();
    ui.clock = mockClock;
  });

  afterEach(() => {
    ui.exitToMenu();
    controls.dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('launches playlist with custom drill duration and tracks progress', () => {
    const playlist: Playlist = {
      id: 'custom-seq-1',
      name: 'Custom Quick Flicks',
      defaultRestIntervalSec: 5,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 30 },
        { id: 'e2', scenarioId: 'track-smooth', durationSec: 45 },
      ],
    };

    ui.startPlaylist(playlist, 'advanced');

    expect(ui.activeRoutine).toBeDefined();
    expect(ui.activeRoutine?.id).toBe('custom-seq-1');
    expect(ui.activeRoutine?.currentIndex).toBe(0);
    expect(ui.activeRoutine?.isCustomPlaylist).toBe(true);

    // Active drill has configured duration 30s
    expect(engine.isRunning).toBe(true);
    expect(Math.ceil(engine.getRemainingTime())).toBe(30);
  });

  it('auto-transitions to next drill after configured rest interval', () => {
    const playlist: Playlist = {
      id: 'custom-seq-2',
      name: 'Transition Test',
      defaultRestIntervalSec: 6,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 60, restIntervalSec: 3 },
        { id: 'e2', scenarioId: 'track-smooth', durationSec: 60 },
      ],
    };

    ui.startPlaylist(playlist, 'intermediate');
    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Simulate completion of drill 1
    const mockResult1: SessionResult = {
      id: 'sess-1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1200,
      hits: 12,
      misses: 2,
      headshots: 10,
      accuracy: 85.7,
      avgReactionMs: 250,
      medianReactionMs: 240,
      bestReactionMs: 190,
      targetsPerSecond: 0.2,
    };

    ui.showResultsScreen(mockResult1, false);

    // Rest interval countdown should be 3 seconds (override)
    expect(mockClock.activeTimeouts.size).toBeGreaterThan(0);
    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Tick clock forward 3 seconds to trigger transition
    mockClock.tick(3000);

    // Should now be on drill 2
    expect(ui.activeRoutine?.currentIndex).toBe(1);
    expect(ui.activeRoutine?.scenarioIds[1]).toBe('track-smooth');
  });

  it('immediately transitions when rest interval is 0', () => {
    const playlist: Playlist = {
      id: 'instant-transition',
      name: 'Zero Rest',
      defaultRestIntervalSec: 0,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 60, restIntervalSec: 0 },
        { id: 'e2', scenarioId: 'track-smooth', durationSec: 60 },
      ],
    };

    ui.startPlaylist(playlist, 'intermediate');

    const mockResult: SessionResult = {
      id: 'sess-instant',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      headshots: 8,
      accuracy: 100,
      avgReactionMs: 240,
      medianReactionMs: 240,
      bestReactionMs: 200,
      targetsPerSecond: 0.17,
    };

    ui.showResultsScreen(mockResult, false);

    // Advanced immediately to drill 2 without waiting
    expect(ui.activeRoutine?.currentIndex).toBe(1);
  });

  it('supports pause and resume during playlist sessions', () => {
    const playlist = createDefaultPlaylist('Pause Test');
    ui.startPlaylist(playlist, 'intermediate');

    expect(ui.activeRoutine?.totalPausedMs).toBe(0);

    // Simulate pause (pointer lock lost)
    mockClock.tick(5000);
    // Simulate pointerlockchange unlock
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(ui.activeRoutine?.pauseStartTimestamp).toBeGreaterThan(0);

    // Simulate 3 seconds paused
    mockClock.tick(3000);

    // Simulate resume (pointer lock acquired)
    // Manually set pointerLockElement to simulate lock
    Object.defineProperty(document, 'pointerLockElement', {
      value: canvas,
      configurable: true,
    });
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(ui.activeRoutine?.pauseStartTimestamp).toBe(0);
    expect(ui.activeRoutine?.totalPausedMs).toBe(3000);
  });

  it('stops playlist cleanly and returns to menu', () => {
    const playlist = createDefaultPlaylist('Stop Test');
    ui.startPlaylist(playlist, 'intermediate');

    expect(ui.activeRoutine).toBeDefined();
    expect(engine.isRunning).toBe(true);

    ui.exitToMenu();

    expect(ui.activeRoutine).toBeNull();
    expect(engine.isRunning).toBe(false);
  });

  it('skips invalid or missing scenario IDs gracefully', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const playlist: Playlist = {
      id: 'missing-scenarios',
      name: 'Resilience Test',
      defaultRestIntervalSec: 4,
      entries: [
        { id: 'e1', scenarioId: 'nonexistent-id-1', durationSec: 60 },
        { id: 'e2', scenarioId: 'flick-static', durationSec: 60 },
        { id: 'e3', scenarioId: 'nonexistent-id-2', durationSec: 60 },
      ],
    };

    ui.startPlaylist(playlist, 'intermediate');

    // Should have skipped e1 and launched flick-static directly
    expect(ui.activeRoutine?.currentIndex).toBe(1);
    expect(engine.isRunning).toBe(true);

    // Advance should skip e3 and finish playlist
    ui.advanceRoutine();
    expect(ui.activeRoutine).toBeNull(); // Completed
    warnSpy.mockRestore();
  });

  it('completes playlist, saves summary with drill results, and protects PB records on custom duration', () => {
    // Record an initial standard PB for flick-static
    const standardSession: SessionResult = {
      id: 'std-sess',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() - 10000,
      durationSec: 60,
      score: 2000,
      hits: 20,
      misses: 0,
      headshots: 20,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.33,
    };
    store.addSession(standardSession);
    expect(store.getPB('flick-static')?.score).toBe(2000);

    // Run a custom 120s drill (which could score higher than standard 60s)
    const customSession: SessionResult = {
      id: 'custom-sess',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 120, // Non-standard duration
      score: 4000,      // Higher score due to 2x duration!
      hits: 40,
      misses: 0,
      headshots: 40,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.33,
    };
    const { isPB } = store.addSession(customSession);

    // PB MUST NOT BE DISTORTED by non-standard custom duration
    expect(isPB).toBe(false);
    expect(store.getPB('flick-static')?.score).toBe(2000);

    // Full playlist completion screen test
    const playlist: Playlist = {
      id: 'p-summary-test',
      name: 'Summary Playlist',
      defaultRestIntervalSec: 4,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 60 },
      ],
    };

    ui.startPlaylist(playlist, 'intermediate');
    ui.showResultsScreen(standardSession, false);

    // Finished!
    const summaries = store.getRoutineSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].isPlaylist).toBe(true);
    expect(summaries[0].completionRate).toBe(100);
    expect(summaries[0].drillResults?.length).toBe(1);
    expect(summaries[0].drillResults?.[0].score).toBe(2000);
  });
});

describe('Phase 2 — Playlist Editor UI Interactions', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;
  let ui: UIManager;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
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
    ui = new UIManager(engine, appContainer, canvas);
  });

  afterEach(() => {
    ui.exitToMenu();
    controls.dispose();
    document.body.innerHTML = '';
  });

  it('renders plans page with preset routines and custom playlist action', () => {
    ui.navigateTo('plans');
    const createBtn = document.getElementById('btn-create-playlist');
    expect(createBtn).not.toBeNull();

    // Check all preset routines are present
    expect(document.querySelector('[data-plan-id="routine-5m"]')).not.toBeNull();
    expect(document.querySelector('[data-plan-id="routine-10m"]')).not.toBeNull();
    expect(document.querySelector('[data-plan-id="routine-20m"]')).not.toBeNull();
  });

  it('opens editor when clicking create playlist, supports editing and saving', () => {
    ui.navigateTo('plans');
    const createBtn = document.getElementById('btn-create-playlist')!;
    createBtn.click();

    expect(ui.editingPlaylist).not.toBeNull();
    const nameInput = document.getElementById('editor-name-input') as HTMLInputElement;
    expect(nameInput).not.toBeNull();

    // Edit playlist name
    nameInput.value = 'Precision Mastery';
    nameInput.dispatchEvent(new Event('input'));

    // Save playlist
    const saveBtn = document.getElementById('btn-editor-save')!;
    saveBtn.click();

    // Editor should close and playlist should now appear in store and page
    expect(ui.editingPlaylist).toBeNull();
    expect(store.getPlaylists().length).toBe(1);
    expect(store.getPlaylists()[0].name).toBe('Precision Mastery');
    expect(document.querySelector('[data-start-playlist]')).not.toBeNull();
  });

  it('supports reordering drills up and down in editor', () => {
    ui.editingPlaylist = {
      id: 'reorder-ui',
      name: 'Reorder Test',
      defaultRestIntervalSec: 4,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 60 },
        { id: 'e2', scenarioId: 'track-smooth', durationSec: 60 },
      ],
    };
    ui.navigateTo('plans');

    expect(ui.editingPlaylist.entries[0].scenarioId).toBe('flick-static');

    // Click Move Down on first drill
    const moveDownBtn = document.querySelector('[data-move-down="0"]') as HTMLButtonElement;
    expect(moveDownBtn).not.toBeNull();
    moveDownBtn.click();

    // First and second drills should now be swapped
    expect(ui.editingPlaylist.entries[0].scenarioId).toBe('track-smooth');
    expect(ui.editingPlaylist.entries[1].scenarioId).toBe('flick-static');
  });

  it('supports removing and adding drills in editor', () => {
    ui.editingPlaylist = {
      id: 'add-remove-ui',
      name: 'Add Remove Test',
      defaultRestIntervalSec: 4,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 60 },
      ],
    };
    ui.navigateTo('plans');

    // Add drill from scenario browser
    const addBtn = document.querySelector('[data-add-scenario-id="track-smooth"]') as HTMLButtonElement;
    expect(addBtn).not.toBeNull();
    addBtn.click();

    expect(ui.editingPlaylist.entries.length).toBe(2);
    expect(ui.editingPlaylist.entries[1].scenarioId).toBe('track-smooth');

    // Remove first drill
    const removeBtn = document.querySelector('[data-remove-idx="0"]') as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    expect(ui.editingPlaylist.entries.length).toBe(1);
    expect(ui.editingPlaylist.entries[0].scenarioId).toBe('track-smooth');
  });

  it('validates editor inputs and shows errors when invalid', () => {
    ui.editingPlaylist = {
      id: 'invalid-ui',
      name: '',
      defaultRestIntervalSec: 4,
      entries: [],
    };
    ui.navigateTo('plans');

    const saveBtn = document.getElementById('btn-editor-save')!;
    saveBtn.click();

    // Should still be in editor mode with errors
    expect(ui.editingPlaylist).not.toBeNull();
    expect(ui.editorErrors.length).toBeGreaterThan(0);
    expect(store.getPlaylists().length).toBe(0);
  });
});
