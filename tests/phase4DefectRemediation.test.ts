import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { WarmupLabDatabase } from '../src/db/database';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { UIManager, TimingClock } from '../src/ui';
import {
  createDefaultCustomScenario,
  STARTER_TEMPLATES,
  hasMaterialConfigChanges,
  validateCustomScenarioJSON,
  convertCustomScenarioToConfig,
} from '../src/scenarioConfig';
import type { WarmupLabScenarioV1, SessionResult, Playlist } from '../src/types';

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

describe('Defect 1 — Template Identifier Mismatch & Canonical Mapping', () => {
  it('maps tracking_smooth canonically to the Smooth Tracking configuration', () => {
    const sc = createDefaultCustomScenario('tracking_smooth');
    expect(sc.name).toBe('Custom Smooth Tracking');
    expect(sc.category).toBe('tracking');
    expect(sc.target.shape).toBe('sphere');
    expect(sc.target.movementPattern).toBe('strafe');
    expect(sc.interaction?.mode).toBe('track');
    expect(validateCustomScenarioJSON(sc).valid).toBe(true);
  });

  it('preserves backward compatibility with legacy smooth_track identifier', () => {
    const sc = createDefaultCustomScenario('smooth_track');
    expect(sc.name).toBe('Custom Smooth Tracking');
    expect(sc.category).toBe('tracking');
    expect(sc.target.movementPattern).toBe('strafe');
  });

  it('verifies every available template produces its intended configuration', () => {
    expect(STARTER_TEMPLATES).toContain('static_flick');
    expect(STARTER_TEMPLATES).toContain('tracking_smooth');
    expect(STARTER_TEMPLATES).toContain('tactical_peek');
    expect(STARTER_TEMPLATES).toContain('retaliatory_duel');

    // 1. static_flick
    const flick = createDefaultCustomScenario('static_flick');
    expect(flick.name).toBe('Custom Static Flicks');
    expect(flick.category).toBe('flick');
    expect(flick.target.movementPattern).toBe('static');
    expect(validateCustomScenarioJSON(flick).valid).toBe(true);

    // 2. tactical_peek
    const peek = createDefaultCustomScenario('tactical_peek');
    expect(peek.name).toBe('Custom Angle Peek Duel');
    expect(peek.category).toBe('tactical');
    expect(peek.spawner.mode).toBe('peek');
    expect(peek.target.movementPattern).toBe('peek');
    expect(validateCustomScenarioJSON(peek).valid).toBe(true);

    // 3. retaliatory_duel
    const skirmish = createDefaultCustomScenario('retaliatory_duel');
    expect(skirmish.name).toBe('Custom Retaliatory Skirmish');
    expect(skirmish.category).toBe('tactical');
    expect(skirmish.target.retaliatory).toBe(true);
    expect(skirmish.target.retaliateDelayMs).toBe(800);
    expect(validateCustomScenarioJSON(skirmish).valid).toBe(true);
  });
});

describe('Defect 2 — Save as New Drill & Update and Reset PB Workflows', () => {
  let db: WarmupLabDatabase;
  let store: Store;

  beforeEach(async () => {
    localStorage.clear();
    db = new WarmupLabDatabase(`TestDefect2DB_${Date.now()}_${Math.random()}`);
    store = new Store(db);
    await store.init();
  });

  afterEach(async () => {
    await db.delete();
    localStorage.clear();
  });

  it('Save as New Drill creates a genuinely independent drill, preserving original and its PB', () => {
    const original = createDefaultCustomScenario('static_flick');
    original.name = 'Micro Flick Drill';
    store.saveCustomScenario(original);

    // Record PB on original
    store.addSession({
      id: 'sess_orig_1',
      scenarioId: original.id,
      scenarioName: original.name,
      category: original.category,
      difficulty: original.difficulty,
      configVersion: 1,
      timestamp: Date.now() - 5000,
      durationSec: original.durationSec,
      score: 1800,
      hits: 18,
      misses: 0,
      headshots: 18,
      bodyHits: 0,
      shotsFired: 18,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 200,
      targetsPerSecond: 0.3,
      shotsMoving: 0,
      shotsStationary: 18,
    });
    expect(store.getPB(original.id)?.score).toBe(1800);

    // Save as new drill
    const forkRes = store.saveAsNewCustomScenario(original, 'Micro Flick Drill (Hardened)');
    expect(forkRes.success).toBe(true);
    const forked = forkRes.scenario!;

    expect(forked.id).not.toBe(original.id);
    expect(forked.id.startsWith('custom_')).toBe(true);
    expect(forked.name).toBe('Micro Flick Drill (Hardened)');
    expect(forked.metadata.configVersion).toBe(1);

    // Verify original drill and its PB remain unchanged
    expect(store.getCustomScenario(original.id)?.name).toBe('Micro Flick Drill');
    expect(store.getPB(original.id)?.score).toBe(1800);

    // Verify forked drill has no PB yet
    expect(store.getPB(forked.id)).toBeNull();

    // Record score on forked drill — affects only forked PB
    store.addSession({
      id: 'sess_fork_1',
      scenarioId: forked.id,
      scenarioName: forked.name,
      category: forked.category,
      difficulty: forked.difficulty,
      configVersion: 1,
      timestamp: Date.now(),
      durationSec: forked.durationSec,
      score: 950,
      hits: 10,
      misses: 2,
      headshots: 10,
      bodyHits: 0,
      shotsFired: 12,
      accuracy: 83.3,
      headshotPct: 100,
      avgReactionMs: 220,
      medianReactionMs: 220,
      bestReactionMs: 220,
      targetsPerSecond: 0.16,
      shotsMoving: 0,
      shotsStationary: 12,
    });

    expect(store.getPB(forked.id)?.score).toBe(950);
    expect(store.getPB(original.id)?.score).toBe(1800); // Unchanged!
  });

  it('Update & Reset PB increments configVersion, clears PB, preserves historical sessions', () => {
    const sc = createDefaultCustomScenario('retaliatory_duel');
    sc.name = 'Skirmish v1';
    store.saveCustomScenario(sc);

    // Pre-populate PB and history
    store.addSession({
      id: 'sess_hist_1',
      scenarioId: sc.id,
      scenarioName: sc.name,
      category: sc.category,
      difficulty: sc.difficulty,
      configVersion: 1,
      timestamp: 1700000000,
      durationSec: sc.durationSec,
      score: 2000,
      hits: 20,
      misses: 0,
      headshots: 20,
      bodyHits: 0,
      shotsFired: 20,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 210,
      medianReactionMs: 210,
      bestReactionMs: 210,
      targetsPerSecond: 0.33,
      shotsMoving: 0,
      shotsStationary: 20,
    });
    expect(store.getPB(sc.id)?.score).toBe(2000);

    // Built-in PB check to verify isolation
    store.addSession({
      id: 'sess_builtin_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1700000000,
      durationSec: 60,
      score: 2500,
      hits: 25,
      misses: 0,
      headshots: 25,
      bodyHits: 0,
      shotsFired: 25,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 190,
      medianReactionMs: 190,
      bestReactionMs: 190,
      targetsPerSecond: 0.41,
      shotsMoving: 0,
      shotsStationary: 25,
    });
    expect(store.getPB('flick-static')?.score).toBe(2500);

    // Execute Update & Reset PB on custom scenario
    const updatedSc = {
      ...sc,
      name: 'Skirmish v2 (Faster Bots)',
      target: {
        ...sc.target,
        speedMultiplier: 1.8,
        retaliateDelayMs: 600,
      },
    };

    const updateRes = store.saveCustomScenario(updatedSc, {
      resetPB: true,
      incrementVersion: true,
    });
    expect(updateRes.success).toBe(true);

    const saved = store.getCustomScenario(sc.id);
    expect(saved?.metadata.configVersion).toBe(2);
    expect(saved?.name).toBe('Skirmish v2 (Faster Bots)');

    // Relevant custom PB is reset
    expect(store.getPB(sc.id)).toBeNull();

    // Built-in PB is untouched
    expect(store.getPB('flick-static')?.score).toBe(2500);

    // Historical session remains in store
    const history = store.getSessions(sc.id);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('sess_hist_1');
    expect(history[0].score).toBe(2000);
    expect(history[0].configVersion).toBe(1);
  });

  it('evaluates material configuration changes policy accurately', () => {
    const base = createDefaultCustomScenario('static_flick');

    // Cosmetic changes: name, description, tags -> Non-material
    const cosmeticChange = {
      ...base,
      name: 'Renamed Static Flick',
      description: 'Brand new description',
      tags: ['click', 'speed'],
    };
    expect(hasMaterialConfigChanges(base, cosmeticChange)).toBe(false);

    // Material changes: duration
    expect(hasMaterialConfigChanges(base, { ...base, durationSec: 30 })).toBe(true);

    // Material changes: target size
    expect(hasMaterialConfigChanges(base, {
      ...base,
      target: { ...base.target, sizeMultiplier: 0.6 },
    })).toBe(true);

    // Material changes: speed multiplier
    expect(hasMaterialConfigChanges(base, {
      ...base,
      target: { ...base.target, speedMultiplier: 1.5 },
    })).toBe(true);

    // Material changes: spawner maxAlive
    expect(hasMaterialConfigChanges(base, {
      ...base,
      spawner: { ...base.spawner, maxAlive: 3 },
    })).toBe(true);

    // Material changes: scoring bonus
    expect(hasMaterialConfigChanges(base, {
      ...base,
      scoring: { ...base.scoring, headshotBonus: 100 },
    })).toBe(true);
  });
});

describe('Defect 3 — Configuration Version Tracking & Analytics', () => {
  let db: WarmupLabDatabase;
  let store: Store;

  beforeEach(async () => {
    localStorage.clear();
    db = new WarmupLabDatabase(`TestDefect3DB_${Date.now()}_${Math.random()}`);
    store = new Store(db);
    await store.init();
  });

  afterEach(async () => {
    await db.delete();
    localStorage.clear();
  });

  it('distinguishes configuration versions in trends and does not merge them', () => {
    const sc = createDefaultCustomScenario('static_flick');
    sc.metadata.configVersion = 1;
    store.saveCustomScenario(sc);

    // 2 sessions on configVersion 1
    store.addSession({
      id: 'sess_v1_1',
      scenarioId: sc.id,
      scenarioName: sc.name,
      category: sc.category,
      difficulty: sc.difficulty,
      configVersion: 1,
      timestamp: 1000,
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      headshots: 10,
      bodyHits: 0,
      shotsFired: 10,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 250,
      medianReactionMs: 250,
      bestReactionMs: 250,
      targetsPerSecond: 0.16,
      shotsMoving: 0,
      shotsStationary: 10,
    });

    store.addSession({
      id: 'sess_v1_2',
      scenarioId: sc.id,
      scenarioName: sc.name,
      category: sc.category,
      difficulty: sc.difficulty,
      configVersion: 1,
      timestamp: 2000,
      durationSec: 60,
      score: 1200,
      hits: 12,
      misses: 0,
      headshots: 12,
      bodyHits: 0,
      shotsFired: 12,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 230,
      medianReactionMs: 230,
      bestReactionMs: 230,
      targetsPerSecond: 0.2,
      shotsMoving: 0,
      shotsStationary: 12,
    });

    const v1Trend = store.getScenarioTrend(sc.id, undefined, 1);
    expect(v1Trend.hasEnoughData).toBe(true);
    expect(v1Trend.sampleCount).toBe(2);
    expect(v1Trend.scoreDelta).toBe(200); // 1200 - 1000

    // Now update scenario to Version 2 and record 1 session on v2
    store.saveCustomScenario(sc, { incrementVersion: true, resetPB: true });

    store.addSession({
      id: 'sess_v2_1',
      scenarioId: sc.id,
      scenarioName: sc.name,
      category: sc.category,
      difficulty: sc.difficulty,
      configVersion: 2,
      timestamp: 3000,
      durationSec: 60,
      score: 600, // Harder drill, lower score
      hits: 6,
      misses: 4,
      headshots: 6,
      bodyHits: 0,
      shotsFired: 10,
      accuracy: 60,
      headshotPct: 100,
      avgReactionMs: 320,
      medianReactionMs: 320,
      bestReactionMs: 320,
      targetsPerSecond: 0.1,
      shotsMoving: 0,
      shotsStationary: 10,
    });

    // Requesting trend for active version (v2) must NOT compare against v1 sessions
    const v2Trend = store.getScenarioTrend(sc.id); // defaults to latest session version = 2
    expect(v2Trend.configVersion).toBe(2);
    expect(v2Trend.sampleCount).toBe(1);
    expect(v2Trend.hasEnoughData).toBe(false); // Only 1 sample on v2, does not blindly compute -600 delta against v1!
  });

  it('treats legacy sessions without configVersion as legacy and preserves backward compatibility', () => {
    // Legacy session without configVersion
    store.addSession({
      id: 'sess_legacy_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
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

    store.addSession({
      id: 'sess_legacy_2',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 2000,
      durationSec: 60,
      score: 1700,
      hits: 17,
      misses: 0,
      headshots: 17,
      bodyHits: 0,
      shotsFired: 17,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 190,
      medianReactionMs: 190,
      bestReactionMs: 190,
      targetsPerSecond: 0.28,
      shotsMoving: 0,
      shotsStationary: 17,
    });

    const trend = store.getScenarioTrend('flick-static');
    expect(trend.hasEnoughData).toBe(true);
    expect(trend.configVersion).toBeUndefined();
    expect(trend.sampleCount).toBe(2);
    expect(trend.scoreDelta).toBe(200);
  });
});

describe('Defect 4 — Playlist Missing Scenario Notification & Accurate Completion', () => {
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

  it('displays user toast when skipping a missing drill and continues to next drill', () => {
    const showToastSpy = vi.spyOn(ui, 'showToast');

    const testPlaylist: Playlist = {
      id: 'pl_missing_test',
      name: 'Playlist With Missing Drill',
      defaultRestIntervalSec: 0,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 10 },
        { id: 'e2', scenarioId: 'deleted-custom-id-xyz', durationSec: 10 },
        { id: 'e3', scenarioId: 'track-smooth', durationSec: 10 },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    ui.startPlaylist(testPlaylist);
    expect(ui.activeRoutine).not.toBeNull();
    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Finish drill 1 (with restIntervalSec: 0, showResultsScreen automatically advances immediately)
    const res1: SessionResult = {
      id: 'res1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 10,
      score: 500,
      hits: 5,
      misses: 0,
      headshots: 5,
      bodyHits: 0,
      shotsFired: 5,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 200,
      targetsPerSecond: 0.5,
    };
    ui.showResultsScreen(res1, false);

    // Check toast was shown for deleted drill
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping missing scenario "deleted-custom-id-xyz"'),
      'info'
    );

    // Sequencer jumped index 1 (missing) and auto-advanced to drill 3 (track-smooth, index 2)
    expect(ui.activeRoutine?.currentIndex).toBe(2);
  });

  it('calculates completion metrics correctly (2 completed, 1 skipped, 3 planned -> 67%)', () => {
    const testPlaylist: Playlist = {
      id: 'pl_metrics_test',
      name: 'Metrics Test Playlist',
      defaultRestIntervalSec: 0,
      entries: [
        { id: 'e1', scenarioId: 'flick-static', durationSec: 10 },
        { id: 'e2', scenarioId: 'deleted-custom-drill', durationSec: 10 },
        { id: 'e3', scenarioId: 'track-smooth', durationSec: 10 },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    ui.startPlaylist(testPlaylist);

    // Simulate completion of drill 1 (auto-advances, skips drill 2, lands on drill 3)
    const res1: SessionResult = {
      id: 'res1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 10,
      score: 600,
      hits: 6,
      misses: 0,
      headshots: 6,
      bodyHits: 0,
      shotsFired: 6,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 200,
      targetsPerSecond: 0.6,
    };
    ui.showResultsScreen(res1, false);
    expect(ui.activeRoutine?.currentIndex).toBe(2);

    // Simulate completion of drill 3 (last drill)
    const res3: SessionResult = {
      id: 'res3',
      scenarioId: 'track-smooth',
      scenarioName: 'Smooth Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 10,
      score: 800,
      hits: 20,
      misses: 0,
      headshots: 0,
      bodyHits: 20,
      shotsFired: 20,
      accuracy: 100,
      headshotPct: 0,
      avgReactionMs: 0,
      medianReactionMs: 0,
      bestReactionMs: 0,
      targetsPerSecond: 2.0,
    };
    ui.showResultsScreen(res3, false);

    // Check stored routine summary
    const summaries = store.getRoutineSummaries();
    expect(summaries.length).toBe(1);
    const summary = summaries[0];

    // Completed: 2, Skipped: 1, Planned: 3
    expect(summary.drillsCompleted).toBe(2);
    expect(summary.totalDrills).toBe(3);
    expect(summary.skippedDrills).toBe(1);
    // Completion rate: 2 / 3 = 66.67% -> displayed/rounded as 67%
    expect(summary.completionRate).toBe(67);

    // Check DOM badges in completion screen
    const content = document.getElementById('result-modal-content');
    expect(content?.innerHTML).toContain('2/3 DRILLS FINISHED');
    expect(content?.innerHTML).toContain('1 SKIPPED');
    expect(content?.innerHTML).toContain('67% COMPLETE');
  });
});
