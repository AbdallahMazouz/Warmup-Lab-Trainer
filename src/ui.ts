// =====================================================================
// ui.ts — Professional Esports UI, HUD, Routing & Pages
// =====================================================================

import type { Engine, EngineHUDState } from './engine';
import {
  SCENARIOS,
  TRAINING_ROUTINES,
  getScenarioById,
  getRoutineDuration,
  ROUTINE_TRANSITION_SEC,
} from './scenarios';
import type {
  PageId,
  SessionResult,
  Settings,
  DifficultyId,
  TrainingRoutine,
  RoutineSummary,
  SoundProfileId,
  RecommendationResult,
  SkillDimensionEvaluation,
  Playlist,
  PlaylistEntry,
  ScenarioConfig,
  WarmupLabScenarioV1,
} from './types';
import {
  createDefaultCustomScenario,
  convertCustomScenarioToConfig,
  validateCustomScenarioJSON,
} from './scenarioConfig';
import {
  getAllSoundProfiles,
  getSoundProfile,
} from './soundProfiles';
import { calculateRoutineReactionSummary } from './analytics';
import { generateRecommendation } from './recommendations';
import {
  calculatePlaylistDurations,
  convertRoutineToPlaylist,
  createDefaultPlaylist,
  validatePlaylist,
} from './playlist';
import { DEFAULT_REST_INTERVAL_SEC } from './constants';

export interface TimingClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): any;
  clearTimeout(id: any): void;
  setInterval(fn: () => void, ms: number): any;
  clearInterval(id: any): void;
}

export const defaultClock: TimingClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

export interface ActiveRoutineState {
  id: string;
  name: string;
  durationLabel: string;
  totalDurationSec: number;        // Active drill duration (for backwards compatibility)
  activeDurationSec: number;       // Explicit active training duration
  expectedElapsedSec: number;      // Active + expected transitions
  difficulty: DifficultyId;
  scenarioIds: string[];
  currentIndex: number;
  routineStartTime: number;        // when routine started
  currentDrillStartTime: number;   // when current drill started
  totalPausedMs: number;
  pauseStartTimestamp: number;
  results: SessionResult[];        // indexed by drill index to prevent duplicates on retry
  retriesCount?: number;           // total retry attempts across this routine
  isAdvancing: boolean;
  entries?: PlaylistEntry[];
  defaultRestIntervalSec?: number;
  isCustomPlaylist?: boolean;
}

export function generateSparklineSVG(scores: number[], width = 180, height = 40): string {
  if (!scores || scores.length === 0) return '';
  if (scores.length === 1) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;" aria-label="Score progression">
      <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--teal)" stroke-dasharray="3 3" stroke-width="1.5" />
      <circle cx="${width / 2}" cy="${height / 2}" r="4" fill="var(--teal)" />
    </svg>`;
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min === 0 ? 1 : max - min;
  const paddingY = 6;
  const usableHeight = height - paddingY * 2;
  const stepX = width / (scores.length - 1);

  const points = scores.map((val, idx) => {
    const x = idx * stepX;
    const y = height - paddingY - ((val - min) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');
  const lastPoint = points[points.length - 1].split(',');
  const isUp = scores[scores.length - 1] >= scores[0];
  const strokeColor = isUp ? 'var(--teal)' : 'var(--red)';

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;" aria-label="Score progression">
    <polyline fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylineStr}" />
    <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="4" fill="${strokeColor}" />
  </svg>`;
}

export class UIManager {
  private engine: Engine;
  private appContainer: HTMLElement;
  private canvas: HTMLCanvasElement;
  public clock: TimingClock;

  private currentPage: PageId = 'home';
  private selectedCategory = 'all';
  private selectedTrendScenario = 'flick-static';
  private selectedTrendDifficulty: DifficultyId | 'all' = 'all';

  // Session History Management & Pagination
  private historyPage = 1;
  private historyPageSize = 10;
  private historyCategoryFilter = 'all';
  private historyDifficultyFilter: DifficultyId | 'all' = 'all';
  private historySortBy: 'date_desc' | 'date_asc' | 'score_desc' | 'score_asc' | 'accuracy_desc' = 'date_desc';
  private historyFeedbackMessage: { type: 'success' | 'error'; text: string } | null = null;
  private isClearModalOpen = false;

  // HUD elements
  private hudEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private accEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private routineBadgeEl!: HTMLElement;
  private flashOverlay!: HTMLElement;
  private hitMarkerEl!: HTMLElement;
  private headshotMarkerEl!: HTMLElement;
  private lockOverlay!: HTMLElement;
  private resultOverlay!: HTMLElement;
  private movementWarningEl!: HTMLElement;

  // AD Counter-Strafe & Retaliatory Threat HUD
  private keyW: HTMLElement | null = null;
  private keyA: HTMLElement | null = null;
  private keyS: HTMLElement | null = null;
  private keyD: HTMLElement | null = null;
  private speedValEl: HTMLElement | null = null;
  private speedStatusEl: HTMLElement | null = null;
  private threatMeterEl: HTMLElement | null = null;
  private threatFillEl: HTMLElement | null = null;
  private threatOverlay: HTMLElement | null = null;
  private threatHitActive = false;
  private threatTimeout: any = null;

  // Active playlist queue for training plans
  public activeRoutine: ActiveRoutineState | null = null;
  private routineTransitionTimer: any = null;
  private routineCountdownInterval: any = null;
  private routineTransitionToken = 0;
  private flashTimeout: any = null;
  private flashTransitionTimeout: any = null;
  private movementWarningTimeout: any = null;
  private windowKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private windowResizeHandler: (() => void) | null = null;
  private isLaunchingRecommendation = false;

  // Playlist Management & Editor State
  public editingPlaylist: Playlist | null = null;
  public editorCategoryFilter: string = 'all';
  public editorSearchQuery: string = '';
  public editorErrors: string[] = [];
  public playlistTab: 'all' | 'custom' | 'presets' = 'all';
  public playlistToDelete: string | null = null;

  // Creator Studio State (Phase 4)
  public editingScenario: WarmupLabScenarioV1 | null = null;
  public studioErrors: string[] = [];
  public studioActiveTemplate: string = 'static_flick';

  constructor(
    engine: Engine,
    appContainer: HTMLElement,
    canvas: HTMLCanvasElement,
    clock: TimingClock = defaultClock
  ) {
    this.engine = engine;
    this.appContainer = appContainer;
    this.canvas = canvas;
    this.clock = clock;

    this.buildBaseDOM();
    this.bindEngineCallbacks();
    this.bindControls();
    this.applyCrosshairStyles(this.engine.settings.getAll());
    this.renderPage('home');
  }

  private buildBaseDOM(): void {
    this.appContainer.innerHTML = `
      <nav class="nav" role="navigation" aria-label="Main Navigation">
        <a href="#" class="nav-logo" data-page="home" aria-label="WarmupLab Home">WARMUP <span>LAB</span> <span class="badge badge-lime font-game" style="font-size:0.68rem; padding:2px 8px; margin-left:8px; vertical-align:middle; letter-spacing:0.06em;">PRO 2.0</span></a>
        <button type="button" class="nav-link active" data-page="home">Home</button>
        <button type="button" class="nav-link" data-page="scenarios">Scenarios</button>
        <button type="button" class="nav-link" data-page="plans">Warm-Up Plans</button>
        <button type="button" class="nav-link" data-page="creator">Creator Studio</button>
        <button type="button" class="nav-link" data-page="stats">Statistics</button>
        <button type="button" class="nav-link" data-page="settings">Settings</button>
        <div class="nav-spacer"></div>
        <button class="btn btn-primary btn-sm" id="btn-quick-play">START TRAINING</button>
      </nav>

      <main class="page active" id="page-container"></main>

      <!-- In-Game HUD -->
      <div id="hud">
        <div class="hud-top">
          <div class="hud-timer" id="hud-timer">60</div>
          <div class="hud-score-box">
            <div class="hud-score" id="hud-score">0</div>
            <div class="hud-score-label">SCORE</div>
          </div>
          <div>
            <div class="hud-acc" id="hud-acc">100%</div>
            <div class="hud-acc-label">ACCURACY</div>
          </div>
        </div>

        <div id="hud-movement-warning" style="display:none; position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,70,85,0.9); color:#fff; font-family:var(--font-game); font-weight:700; padding:8px 24px; border-radius:4px; letter-spacing:0.1em; z-index:20; box-shadow:0 0 20px rgba(255,70,85,0.8);">
          STOP MOVING TO SHOOT! (COUNTER-STRAFE)
        </div>

        <div class="crosshair" id="crosshair">
          <div class="crosshair-line ch-h ch-left"></div>
          <div class="crosshair-line ch-h ch-right"></div>
          <div class="crosshair-line ch-v ch-top"></div>
          <div class="crosshair-line ch-v ch-bottom"></div>
          <div class="ch-dot" id="ch-dot" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); border-radius:50%;"></div>
        </div>

        <div id="hud-routine-badge" class="hud-routine-badge" style="display:none;"></div>
        <div id="hud-fps" style="position:fixed; bottom:12px; right:16px; font-size:12px; color:var(--text-dim); font-family:monospace; pointer-events:none;">FPS: 60</div>
        <div style="position:fixed; bottom:12px; left:16px; font-size:13px; color:var(--text-dim); pointer-events:none;">ESC — Pause / Return to Menu</div>

        <!-- AD Counter-Strafe Velocity HUD (Aimflare-inspired) -->
        <div id="hud-input-visualizer" class="hud-input-visualizer">
          <div class="hud-keys-row">
            <span class="hud-key" id="key-w">W</span>
          </div>
          <div class="hud-keys-row">
            <span class="hud-key" id="key-a">A</span>
            <span class="hud-key" id="key-s">S</span>
            <span class="hud-key" id="key-d">D</span>
          </div>
          <div class="hud-speed-row">
            <span class="hud-speed-label">VELOCITY</span>
            <span class="hud-speed-val" id="hud-speed-val">0.00 m/s</span>
          </div>
          <div class="hud-speed-status stopped" id="hud-speed-status">STOPPED (ACCURATE)</div>
          <div id="hud-threat-meter" class="hud-threat-meter" style="display:none;">
            <div class="hud-threat-label">ENEMY LOCKING ON</div>
            <div class="hud-threat-bar"><div class="hud-threat-fill" id="hud-threat-fill"></div></div>
          </div>
        </div>
      </div>

      <!-- Hit Marker — body shot (green diagonal ticks, default) -->
      <div id="hit-marker">
        <svg viewBox="0 0 32 32" fill="none" stroke="#00ff88" stroke-width="2.5">
          <line x1="6" y1="6" x2="11" y2="11" />
          <line x1="26" y1="6" x2="21" y2="11" />
          <line x1="6" y1="26" x2="11" y2="21" />
          <line x1="26" y1="26" x2="21" y2="21" />
        </svg>
      </div>

      <!-- Headshot Marker — distinct gold X with centre dot -->
      <div id="headshot-marker">
        <svg viewBox="0 0 32 32" fill="none" stroke="#ffd700" stroke-width="3">
          <line x1="8" y1="8" x2="24" y2="24" />
          <line x1="24" y1="8" x2="8" y2="24" />
          <circle cx="16" cy="16" r="2.5" fill="#ffd700" stroke="none" />
        </svg>
      </div>

      <!-- Flash Overlay -->
      <div id="flash-overlay"></div>

      <!-- Threat Screen Vignette Overlay (Valofy-inspired) -->
      <div id="threat-overlay" class="threat-overlay"></div>

      <!-- Pointer Lock Overlay -->
      <div id="lock-overlay">
        <h2>TRAINING PAUSED</h2>
        <p>Mouse pointer lock is required for 3D aim training.<br>Click below to lock your crosshair and resume.</p>
        <button class="btn btn-primary btn-lg" id="btn-lock-confirm">CLICK TO RESUME</button>
      </div>

      <!-- Results Overlay -->
      <div id="result-overlay">
        <div id="result-modal-content" style="max-width:680px; width:90%; background:var(--panel); border:1px solid var(--border-2); border-radius:var(--r-xl); padding:36px; box-shadow:0 12px 48px rgba(0,0,0,0.6); text-align:center;">
          <!-- Dynamically populated -->
        </div>
      </div>

      <!-- Toast container -->
      <div id="toast-container" aria-live="polite" aria-atomic="true"></div>
    `;

    // Cache elements
    this.hudEl = document.getElementById('hud')!;
    this.timerEl = document.getElementById('hud-timer')!;
    this.scoreEl = document.getElementById('hud-score')!;
    this.accEl = document.getElementById('hud-acc')!;
    this.fpsEl = document.getElementById('hud-fps')!;
    this.routineBadgeEl = document.getElementById('hud-routine-badge')!;
    this.flashOverlay = document.getElementById('flash-overlay')!;
    this.hitMarkerEl = document.getElementById('hit-marker')!;
    this.headshotMarkerEl = document.getElementById('headshot-marker')!;
    this.lockOverlay = document.getElementById('lock-overlay')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
    this.movementWarningEl = document.getElementById('hud-movement-warning')!;
    this.keyW = document.getElementById('key-w');
    this.keyA = document.getElementById('key-a');
    this.keyS = document.getElementById('key-s');
    this.keyD = document.getElementById('key-d');
    this.speedValEl = document.getElementById('hud-speed-val');
    this.speedStatusEl = document.getElementById('hud-speed-status');
    this.threatMeterEl = document.getElementById('hud-threat-meter');
    this.threatFillEl = document.getElementById('hud-threat-fill');
    this.threatOverlay = document.getElementById('threat-overlay');
  }

  private bindControls(): void {
    // Navigation links
    this.appContainer.querySelectorAll('.nav-link, .nav-logo').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const page = (el as HTMLElement).dataset.page as PageId;
        if (page) this.navigateTo(page);
      });
    });

    // Quick play header button
    document.getElementById('btn-quick-play')?.addEventListener('click', () => {
      this.launchScenario('flick-static');
    });

    // Resume click on pointer lock overlay
    document.getElementById('btn-lock-confirm')?.addEventListener('click', () => {
      this.engine.controls.lock();
    });

    this.lockOverlay.addEventListener('click', () => {
      this.engine.controls.lock();
    });

    // Listen to pointer lock state changes
    this.engine.controls.onLockChange = (locked: boolean) => {
      if (this.engine.isRunning) {
        if (!locked) {
          this.lockOverlay.classList.add('visible');
          this.engine.pause();
          if (this.activeRoutine && this.activeRoutine.pauseStartTimestamp === 0) {
            this.activeRoutine.pauseStartTimestamp = this.clock.now();
          }
        } else {
          this.lockOverlay.classList.remove('visible');
          this.engine.resume();
          if (this.activeRoutine && this.activeRoutine.pauseStartTimestamp > 0) {
            this.activeRoutine.totalPausedMs += (this.clock.now() - this.activeRoutine.pauseStartTimestamp);
            this.activeRoutine.pauseStartTimestamp = 0;
          }
        }
      }
    };

    // ESC key to dismiss modal, stop session or exit result screen cleanly
    this.windowKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.key === 'Escape') {
        if (this.isClearModalOpen) {
          this.isClearModalOpen = false;
          this.renderPage(this.currentPage);
          (document.getElementById('btn-clear-history') as HTMLElement | null)?.focus();
          return;
        }
        if (this.engine.isRunning && this.lockOverlay.classList.contains('visible')) {
          this.exitToMenu();
        } else if (this.resultOverlay.classList.contains('visible') && !this.activeRoutine) {
          this.exitToMenu();
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.windowKeyHandler);
    }

    // Window resize
    this.windowResizeHandler = () => {
      this.engine.renderer.resize(window.innerWidth, window.innerHeight);
      if (this.canvas.classList.contains('visible') && !this.engine.isRunning) {
        this.engine.renderFrame();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.windowResizeHandler);
    }
  }

  private bindEngineCallbacks(): void {
    this.engine.callbacks.onTick = (hud: EngineHUDState) => {
      if (hud.isPaused) {
        this.timerEl.textContent = 'PAUSED';
        this.timerEl.className = 'hud-timer warning';
      } else {
        const remainingSec = Math.ceil(hud.timeRemaining);
        this.timerEl.textContent = `${remainingSec}s`;

        if (remainingSec <= 5) {
          this.timerEl.className = 'hud-timer danger';
        } else if (remainingSec <= 15) {
          this.timerEl.className = 'hud-timer warning';
        } else {
          this.timerEl.className = 'hud-timer';
        }
      }

      if (this.activeRoutine && this.routineBadgeEl) {
        this.routineBadgeEl.style.display = 'block';
        this.routineBadgeEl.textContent = `ROUTINE: DRILL ${this.activeRoutine.currentIndex + 1}/${this.activeRoutine.scenarioIds.length}`;
      } else if (this.routineBadgeEl) {
        this.routineBadgeEl.style.display = 'none';
      }

      this.scoreEl.textContent = hud.score.toLocaleString();
      this.accEl.textContent = `${Math.round(hud.accuracy)}%`;
      this.fpsEl.textContent = `FPS: ${hud.fps}`;

      if (hud.activeKeys) {
        this.keyW?.classList.toggle('active', hud.activeKeys.w);
        this.keyA?.classList.toggle('active', hud.activeKeys.a);
        this.keyS?.classList.toggle('active', hud.activeKeys.s);
        this.keyD?.classList.toggle('active', hud.activeKeys.d);
      }

      if (hud.playerSpeed !== undefined) {
        if (this.speedValEl) this.speedValEl.textContent = `${hud.playerSpeed.toFixed(2)} m/s`;
        if (this.speedStatusEl) {
          if (hud.isStationary) {
            this.speedStatusEl.textContent = 'STOPPED (ACCURATE)';
            this.speedStatusEl.className = 'hud-speed-status stopped';
          } else {
            this.speedStatusEl.textContent = 'MOVING (SPREAD)';
            this.speedStatusEl.className = 'hud-speed-status moving';
          }
        }
      }

      if (hud.threatProgress !== undefined && hud.threatProgress > 0) {
        if (this.threatMeterEl) this.threatMeterEl.style.display = 'block';
        if (this.threatFillEl) this.threatFillEl.style.width = `${Math.min(100, Math.round(hud.threatProgress * 100))}%`;
        if (this.threatOverlay && !this.threatHitActive) {
          this.threatOverlay.style.opacity = `${(hud.threatProgress * 0.5).toFixed(2)}`;
        }
      } else {
        if (this.threatMeterEl) this.threatMeterEl.style.display = 'none';
        if (this.threatOverlay && !this.threatHitActive) {
          this.threatOverlay.style.opacity = '0';
        }
      }
    };

    this.engine.callbacks.onHit = (_pts, headshot) => {
      if (headshot) {
        // Show gold headshot marker, hide body-shot marker.
        this.hitMarkerEl.classList.remove('show');
        this.headshotMarkerEl.classList.remove('show');
        void this.headshotMarkerEl.offsetWidth; // reflow
        this.headshotMarkerEl.classList.add('show');
      } else {
        // Show green body-hit marker, hide headshot marker.
        this.headshotMarkerEl.classList.remove('show');
        this.hitMarkerEl.classList.remove('show');
        void this.hitMarkerEl.offsetWidth; // reflow
        this.hitMarkerEl.classList.add('show');
      }
    };

    this.engine.callbacks.onMovementInaccurate = () => {
      this.movementWarningEl.style.display = 'block';
      if (this.movementWarningTimeout) clearTimeout(this.movementWarningTimeout);
      this.movementWarningTimeout = setTimeout(() => {
        this.movementWarningEl.style.display = 'none';
        this.movementWarningTimeout = null;
      }, 700);
    };

    this.engine.callbacks.onFlash = (intensity: number, durationMs: number) => {
      this.flashOverlay.style.opacity = `${intensity}`;
      if (this.flashTimeout) clearTimeout(this.flashTimeout);
      if (this.flashTransitionTimeout) clearTimeout(this.flashTransitionTimeout);

      this.flashTimeout = setTimeout(() => {
        this.flashOverlay.style.transition = `opacity ${durationMs}ms ease-out`;
        this.flashOverlay.style.opacity = '0';
        this.flashTransitionTimeout = setTimeout(() => {
          this.flashOverlay.style.transition = 'opacity 80ms linear';
          this.flashTransitionTimeout = null;
        }, durationMs);
        this.flashTimeout = null;
      }, 120);
    };

    this.engine.callbacks.onScenarioComplete = (result: SessionResult, isPB: boolean) => {
      this.showResultsScreen(result, isPB);
    };

    this.engine.callbacks.onRetaliationHit = (_targetId: string, penalty: number) => {
      this.threatHitActive = true;
      if (this.threatOverlay) {
        this.threatOverlay.classList.remove('hit');
        void this.threatOverlay.offsetWidth;
        this.threatOverlay.classList.add('hit');
      }
      this.showToast(`ENEMY FIRED AT YOU! (-${penalty} PTS)`, 'info');
      if (this.threatTimeout) clearTimeout(this.threatTimeout);
      this.threatTimeout = setTimeout(() => {
        this.threatHitActive = false;
        if (this.threatOverlay) this.threatOverlay.classList.remove('hit');
      }, 500);
    };
  }

  navigateTo(page: PageId): void {
    this.currentPage = page;

    // Update nav active classes
    this.appContainer.querySelectorAll('.nav-link').forEach(link => {
      const p = (link as HTMLElement).dataset.page;
      link.classList.toggle('active', p === page);
    });

    this.renderPage(page);
  }

  private renderPage(page: PageId): void {
    const container = document.getElementById('page-container')!;
    container.innerHTML = '';

    switch (page) {
      case 'home':
        container.innerHTML = this.renderHomeHTML();
        this.attachHomeListeners(container);
        break;
      case 'scenarios':
        container.innerHTML = this.renderScenariosHTML();
        this.attachScenariosListeners(container);
        break;
      case 'plans':
        container.innerHTML = this.renderPlansHTML();
        this.attachPlansListeners(container);
        break;
      case 'stats':
        container.innerHTML = this.renderStatsHTML();
        this.attachStatsListeners(container);
        break;
      case 'creator':
        container.innerHTML = this.renderCreatorStudioHTML();
        this.attachCreatorStudioListeners(container);
        break;
      case 'settings':
        container.innerHTML = this.renderSettingsHTML();
        this.attachSettingsListeners(container);
        break;
    }
  }

  // ── Pages HTML Generators ───────────────────────────────────────────

  private renderHomeHTML(): string {
    const pbs = this.engine.store.getAllPBs();
    const pbEntries = Object.values(pbs);
    const recent = this.engine.store.getRecentSessions(4);

    return `
      <div class="page-inner">
        <section class="hero">
          <div style="display:inline-flex; align-items:center; gap:8px; margin-bottom:12px;">
            <div class="badge badge-red font-game">VALORANT-SPECIFIC AIM TRAINER</div>
            <div class="badge badge-lime font-game">COMPETITIVE AIM PROTOCOL</div>
          </div>
          <h1 class="hero-title">ELEVATE YOUR <span class="accent">CROSSHAIR</span> MASTERY</h1>
          <p class="hero-sub">
            Warm up your flicks, micro-adjustments, strafe tracking, and counter-strafing in a dedicated 3D arena built for tactical shooter mechanics.
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" id="btn-hero-play" title="Stationary targets flick warmup">FLICK TRAINING</button>
            <button class="btn btn-secondary btn-lg" id="btn-hero-gridshot" style="border-color:#ff4655; color:#ff4655;" title="Aim Lab Gridshot 3-target rapid switching">🎯 GRIDSHOT (AIM LAB)</button>
            <button class="btn btn-secondary btn-lg" id="btn-hero-tilefrenzy" style="border-color:#00f0ff; color:#00f0ff;" title="KovaaK's Tile Frenzy 3-target speed flicking">⚡ TILE FRENZY (KOVAAK'S)</button>
            <button class="btn btn-secondary btn-lg" id="btn-hero-track" style="border-color:var(--lime-primary); color:var(--lime-primary);" title="Moving targets tracking warmup">TRACKING TRAINING</button>
            <button class="btn btn-secondary btn-lg" id="btn-hero-browse">BROWSE ALL</button>
          </div>
          <div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin-top:12px; font-size:0.85rem; color:var(--text-dim);">
            <span>🎯 <strong>Gridshot (Aim Lab):</strong> 3 spherical targets, instant respawn, rhythm flicking</span>
            <span>⚡ <strong>Tile Frenzy (KovaaK's):</strong> 3 wall targets, rapid switching transitions</span>
          </div>
        </section>

        <!-- Quick Warm-Up Routines Grid -->
        <div class="section-header mt-32">
          <h2>RECOMMENDED WARM-UP ROUTINES</h2>
          <span class="section-sub">Curated routines designed for quick match readiness (Drill 1 opener uses stationary targets)</span>
        </div>
        <div class="grid-3">
          ${TRAINING_ROUTINES.map(r => {
            const activeMin = Math.round((r.activeDurationSec ?? (r.totalDurationSec ?? getRoutineDuration(r))) / 60);
            const totalMin = Math.floor((r.totalElapsedSec ?? r.totalDurationSec) / 60);
            const totalSec = (r.totalElapsedSec ?? r.totalDurationSec) % 60;
            const badgeLabel = `${activeMin} Min Active (${totalMin}m ${totalSec.toString().padStart(2, '0')}s Total)`;
            return `
              <div class="card scenario-card" data-routine="${r.id}" role="button" tabindex="0" aria-label="Start ${r.name} routine">
                <div class="badge badge-lime font-game">${badgeLabel}</div>
                <div class="scenario-card-title mt-8">${r.name}</div>
                <p class="scenario-card-desc">${r.description}</p>
                <div class="text-dim text-sm mt-8" style="font-size:0.8rem; color:var(--text-dim);">
                  <strong>Opener:</strong> Static Flicks (Stationary)
                </div>
                <button class="btn btn-primary btn-sm w-full mt-8">START ROUTINE</button>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Personal Bests & Recent Activity -->
        <div class="grid-2 mt-32">
          <div class="card">
            <div class="section-header" style="margin-bottom:12px;">
              <h3>TOP PERSONAL BESTS</h3>
            </div>
            ${pbEntries.length === 0 ? `
              <p class="text-dim text-sm">No personal bests recorded yet. Complete a training scenario to see your scores!</p>
            ` : `
              <div style="display:flex; flex-direction:column; gap:10px;">
                ${pbEntries.slice(0, 5).map(pb => {
                  const scen = getScenarioById(pb.scenarioId);
                  return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
                      <div>
                        <div style="font-weight:600; font-size:0.95rem;">${scen?.name ?? pb.scenarioId}</div>
                        <div class="text-dim text-sm">${pb.accuracy.toFixed(0)}% acc &bull; ${pb.avgReactionMs}ms reaction</div>
                      </div>
                      <div class="font-game font-bold text-gold" style="font-size:1.4rem;">${pb.score.toLocaleString()}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div class="card">
            <div class="section-header" style="margin-bottom:12px;">
              <h3>RECENT SESSIONS</h3>
            </div>
            ${recent.length === 0 ? `
              <p class="text-dim text-sm">No recent sessions yet. Jump into an arena drill!</p>
            ` : `
              <div style="display:flex; flex-direction:column; gap:10px;">
                ${recent.map(s => `
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
                    <div>
                      <div style="font-weight:600; font-size:0.95rem;">${s.scenarioName}</div>
                      <div class="text-dim text-sm">${s.accuracy.toFixed(0)}% accuracy &bull; ${s.hits} hits</div>
                    </div>
                    <div class="font-game font-bold text-lime" style="font-size:1.3rem;">${s.score.toLocaleString()}</div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  private attachHomeListeners(container: HTMLElement): void {
    container.querySelector('#btn-hero-gridshot')?.addEventListener('click', () => {
      this.launchScenario('aimlab-gridshot');
    });

    container.querySelector('#btn-hero-tilefrenzy')?.addEventListener('click', () => {
      this.launchScenario('kovaaks-tile-frenzy');
    });

    container.querySelector('#btn-hero-play')?.addEventListener('click', () => {
      this.launchScenario('flick-static');
    });

    container.querySelector('#btn-hero-track')?.addEventListener('click', () => {
      this.launchScenario('track-smooth');
    });

    container.querySelector('#btn-hero-browse')?.addEventListener('click', () => {
      this.navigateTo('scenarios');
    });

    container.querySelectorAll('[data-routine]').forEach(el => {
      const activate = () => {
        const rId = (el as HTMLElement).dataset.routine;
        const routine = TRAINING_ROUTINES.find(r => r.id === rId);
        if (routine) {
          this.startRoutine(routine);
        }
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          activate();
        }
      });
    });
  }

  private renderScenariosHTML(): string {
    const categories = [
      { id: 'all', label: 'All Categories' },
      { id: 'custom', label: '🛠️ Custom Drills' },
      { id: 'aimlab', label: '🎯 Aim Lab' },
      { id: 'kovaaks', label: "⚡ KovaaK's" },
      { id: 'flick', label: 'Clicking / Flicking' },
      { id: 'tracking', label: 'Tracking' },
      { id: 'reaction', label: 'Reaction' },
      { id: 'switching', label: 'Switching' },
      { id: 'tactical', label: 'Tactical' },
      { id: 'precision', label: 'Precision' },
      { id: 'decision', label: 'Decision Making' },
      { id: 'movement', label: 'Movement' },
      { id: 'flash', label: 'Flash Recovery' },
      { id: 'hybrid', label: 'Hybrid' },
    ];

    const allScens = this.engine.store.getAllScenarios();
    const filtered = this.selectedCategory === 'all'
      ? allScens
      : this.selectedCategory === 'custom'
        ? allScens.filter(s => s.id.startsWith('custom_'))
        : this.selectedCategory === 'aimlab'
          ? allScens.filter(s => s.id.startsWith('aimlab-'))
          : this.selectedCategory === 'kovaaks'
            ? allScens.filter(s => s.id.startsWith('kovaaks-'))
            : allScens.filter(s => s.category === this.selectedCategory);

    return `
      <div class="page-inner">
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
          <div>
            <h2>TRAINING SCENARIOS</h2>
            <span class="section-sub">Choose a specialized exercise targeting your aim weaknesses</span>
          </div>
          <div>
            <button class="btn btn-primary btn-md" id="btn-open-creator" style="font-family:var(--font-game); letter-spacing:0.04em;">
              + CREATE CUSTOM DRILL
            </button>
          </div>
        </div>

        <!-- Filter pills -->
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px;">
          ${categories.map(c => `
            <button class="btn btn-sm ${this.selectedCategory === c.id ? 'btn-primary' : 'btn-secondary'}" data-cat="${c.id}">
              ${c.label}
            </button>
          `).join('')}
        </div>

        <!-- Grid of scenarios -->
        <div class="scenario-grid">
          ${filtered.length === 0 ? `
            <div class="card" style="grid-column: 1 / -1; padding:32px; text-align:center; color:var(--text-dim);">
              No scenarios found in this category.
              ${this.selectedCategory === 'custom' ? '<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" id="btn-empty-creator">+ CREATE YOUR FIRST DRILL</button></div>' : ''}
            </div>
          ` : filtered.map(s => {
            const pb = this.engine.store.getPB(s.id);
            const isCustom = s.id.startsWith('custom_');
            const behaviorBadge = isCustom
              ? `<span class="badge badge-gold">CUSTOM DRILL</span>`
              : s.id.startsWith('aimlab-')
              ? `<span class="badge" style="background:rgba(255,70,85,0.2); color:#ff4655; border:1px solid rgba(255,70,85,0.4);">🎯 AIM LAB</span>`
              : s.id.startsWith('kovaaks-')
                ? `<span class="badge" style="background:rgba(0,240,255,0.2); color:#00f0ff; border:1px solid rgba(0,240,255,0.4);">⚡ KOVAAK'S</span>`
                : s.id === 'headline'
              ? `<span class="badge" style="background:rgba(255,70,85,0.15); color:#ff4655; border:1px solid rgba(255,70,85,0.3);">HEADLINE</span>`
              : s.id === 'peek-and-tap'
                ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">ANGLE HOLD</span>`
                : s.id === 'counter-strafe-duel'
                  ? `<span class="badge" style="background:rgba(0,255,200,0.15); color:#00ffc8; border:1px solid rgba(0,255,200,0.3);">COUNTER-STRAFE</span>`
                  : s.id === 'jiggle-reading'
                    ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">PEEK READING</span>`
                    : s.id === 'spray-control'
                      ? `<span class="badge" style="background:rgba(255,215,0,0.15); color:#ffd700; border:1px solid rgba(255,215,0,0.3);">SPRAY CONTROL</span>`
                      : s.id === 'target-transfer'
                        ? `<span class="badge" style="background:rgba(0,200,255,0.15); color:#00c8ff; border:1px solid rgba(0,200,255,0.3);">TARGET TRANSFER</span>`
                        : s.id === 'operator-flick'
                          ? `<span class="badge" style="background:rgba(180,100,255,0.15); color:#d080ff; border:1px solid rgba(180,100,255,0.3);">OPERATOR FLICK</span>`
                          : s.id === 'friend-or-foe'
                            ? `<span class="badge" style="background:rgba(51,153,255,0.15); color:#3399ff; border:1px solid rgba(51,153,255,0.3);">FRIEND OR FOE</span>`
                            : s.movementPattern === 'static'
                              ? `<span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-dim); border:1px solid rgba(255,255,255,0.12);">STATIONARY</span>`
                              : (s.id === 'tactical-jiggle' || s.id === 'tactical-wideswing' || s.id === 'flash-pop')
                                ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">COVER DUEL</span>`
                                : s.id === 'track-vertical'
                                  ? `<span class="badge" style="background:rgba(180,100,255,0.15); color:#d080ff; border:1px solid rgba(180,100,255,0.3);">MOBILITY</span>`
                                  : s.category === 'tracking'
                                    ? `<span class="badge" style="background:rgba(0,255,136,0.12); color:#00ff88; border:1px solid rgba(0,255,136,0.25);">TRACKING</span>`
                                    : s.category === 'hybrid'
                                      ? `<span class="badge" style="background:rgba(0,200,255,0.15); color:#00c8ff; border:1px solid rgba(0,200,255,0.3);">HYBRID THREAT</span>`
                                      : `<span class="badge" style="background:rgba(255,70,85,0.15); color:#ff4655; border:1px solid rgba(255,70,85,0.3);">TACTICAL STRAFE</span>`;

            return `
              <div class="card scenario-card" data-scen="${s.id}" role="button" tabindex="0" aria-label="Play ${s.name} scenario">
                <div class="scenario-card-meta">
                  <span class="badge badge-red">${s.category}</span>
                  ${behaviorBadge}
                  <span class="badge badge-lime">${s.difficulty}</span>
                  <span class="badge badge-gold">${s.durationSec}s</span>
                </div>
                <div class="scenario-card-title">${s.name}</div>
                <p class="scenario-card-desc">${s.description}</p>
                <div class="text-dim text-sm mb-8"><strong>Skill:</strong> ${s.skill}</div>
                <div class="scenario-card-pb">
                  <span class="pb-label">Personal Best</span>
                  <span class="pb-value">${pb ? pb.score.toLocaleString() : '—'}</span>
                </div>
                ${isCustom ? `
                  <div style="display:flex; gap:6px; margin-top:16px;">
                    <button class="btn btn-primary btn-sm" data-play-custom="${s.id}" style="flex:1;">PLAY</button>
                    <button class="btn btn-secondary btn-sm" data-edit-custom="${s.id}" title="Edit Drill">✏️</button>
                    <button class="btn btn-secondary btn-sm" data-dup-custom="${s.id}" title="Duplicate Drill">📋</button>
                    <button class="btn btn-secondary btn-sm" data-export-custom="${s.id}" title="Export JSON">💾</button>
                    <button class="btn btn-secondary btn-sm" data-del-custom="${s.id}" title="Delete Drill" style="color:var(--status-danger);">&times;</button>
                  </div>
                ` : `
                  <button class="btn btn-primary btn-sm w-full mt-16">PLAY SCENARIO</button>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private attachScenariosListeners(container: HTMLElement): void {
    container.querySelector('#btn-open-creator')?.addEventListener('click', () => {
      this.editingScenario = createDefaultCustomScenario('static_flick');
      this.studioErrors = [];
      this.navigateTo('creator');
    });

    container.querySelector('#btn-empty-creator')?.addEventListener('click', () => {
      this.editingScenario = createDefaultCustomScenario('static_flick');
      this.studioErrors = [];
      this.navigateTo('creator');
    });

    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedCategory = (btn as HTMLElement).dataset.cat ?? 'all';
        this.renderPage('scenarios');
      });
    });

    container.querySelectorAll('[data-play-custom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const scenId = (btn as HTMLElement).dataset.playCustom;
        if (scenId) this.launchScenario(scenId);
      });
    });

    container.querySelectorAll('[data-edit-custom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const scenId = (btn as HTMLElement).dataset.editCustom;
        if (!scenId) return;
        const scen = this.engine.store.getCustomScenario(scenId);
        if (scen) {
          this.editingScenario = JSON.parse(JSON.stringify(scen));
          this.studioErrors = [];
          this.navigateTo('creator');
        }
      });
    });

    container.querySelectorAll('[data-dup-custom]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const scenId = (btn as HTMLElement).dataset.dupCustom;
        if (!scenId) return;
        const dup = await this.engine.store.duplicateCustomScenario(scenId);
        if (dup) {
          this.showToast(`Duplicated drill as "${dup.name}"`, 'success');
          this.renderPage('scenarios');
        }
      });
    });

    container.querySelectorAll('[data-export-custom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const scenId = (btn as HTMLElement).dataset.exportCustom;
        if (!scenId) return;
        const scen = this.engine.store.getCustomScenario(scenId);
        if (scen) {
          const blob = new Blob([JSON.stringify(scen, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${scen.id}.warmuplab.json`;
          a.click();
          URL.revokeObjectURL(url);
          this.showToast(`Exported "${scen.name}"`, 'success');
        }
      });
    });

    container.querySelectorAll('[data-del-custom]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const scenId = (btn as HTMLElement).dataset.delCustom;
        if (!scenId) return;
        if (window.confirm('Are you sure you want to delete this custom drill?')) {
          await this.engine.store.deleteCustomScenario(scenId);
          this.showToast('Custom drill deleted', 'info');
          this.renderPage('scenarios');
        }
      });
    });

    container.querySelectorAll('[data-scen]').forEach(card => {
      const activate = () => {
        const scenId = (card as HTMLElement).dataset.scen;
        if (scenId) this.launchScenario(scenId);
      };
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-edit-custom], [data-dup-custom], [data-export-custom], [data-del-custom], [data-play-custom]')) {
          return;
        }
        activate();
      });
      card.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          activate();
        }
      });
    });
  }

  private escapeHtml(text: string): string {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private renderPlansHTML(): string {
    if (this.editingPlaylist !== null) {
      return this.renderPlaylistEditorHTML();
    }

    const customPlaylists = this.engine.store.getPlaylists();
    const showCustom = this.playlistTab === 'all' || this.playlistTab === 'custom';
    const showPresets = this.playlistTab === 'all' || this.playlistTab === 'presets';

    return `
      <div class="page-inner">
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
          <div>
            <h2>TRAINING PLAYLISTS & ROUTINES</h2>
            <span class="section-sub">Create, customize, and play multi-drill training sequences with automatic transitions</span>
          </div>
          <div>
            <button class="btn btn-primary btn-md" id="btn-create-playlist" style="font-family:var(--font-game); letter-spacing:0.04em;">
              + CREATE NEW PLAYLIST
            </button>
          </div>
        </div>

        <!-- Filter Tabs -->
        <div style="display:flex; gap:10px; margin-bottom:24px; border-bottom:1px solid var(--border-2); padding-bottom:12px; flex-wrap:wrap;">
          <button class="btn btn-sm ${this.playlistTab === 'all' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="all">
            ALL PLAYLISTS (${customPlaylists.length + TRAINING_ROUTINES.length})
          </button>
          <button class="btn btn-sm ${this.playlistTab === 'custom' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="custom">
            CUSTOM PLAYLISTS (${customPlaylists.length})
          </button>
          <button class="btn btn-sm ${this.playlistTab === 'presets' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="presets">
            PRESET ROUTINES (${TRAINING_ROUTINES.length})
          </button>
        </div>

        <div style="display:flex; flex-direction:column; gap:20px;" id="playlists-list-container">
          ${showCustom && customPlaylists.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:16px;">
              ${customPlaylists.map(p => {
                const durations = calculatePlaylistDurations(p);
                const activeMin = Math.floor(durations.activeSec / 60);
                const activeSecRem = durations.activeSec % 60;
                const totalMin = Math.floor(durations.totalElapsedSec / 60);
                const totalSecRem = durations.totalElapsedSec % 60;
                const badgeLabel = `${p.entries.length} Drills &bull; ${activeMin}m ${activeSecRem.toString().padStart(2, '0')}s Active (${totalMin}m ${totalSecRem.toString().padStart(2, '0')}s Total)`;

                return `
                  <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap; border-left:3px solid var(--lime-primary);">
                    <div style="flex:1; min-width:280px;">
                      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                        <span class="badge badge-lime font-game">CUSTOM PLAYLIST</span>
                        <span class="badge badge-gold font-game">${badgeLabel}</span>
                      </div>
                      <h3>${this.escapeHtml(p.name)}</h3>
                      ${p.description ? `<p class="text-dim text-sm mt-8">${this.escapeHtml(p.description)}</p>` : ''}
                      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
                        ${p.entries.map((entry) => {
                          const sc = getScenarioById(entry.scenarioId);
                          return `<span class="badge badge-lime">${sc?.name ?? entry.scenarioId} <span style="opacity:0.75;">(${entry.durationSec}s)</span></span>`;
                        }).join('')}
                      </div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span class="text-dim text-sm">Difficulty:</span>
                        <select class="form-select select-routine-diff" data-playlist-diff="${p.id}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                          <option value="beginner">Beginner</option>
                          <option value="intermediate" selected>Intermediate</option>
                          <option value="advanced">Advanced</option>
                          <option value="pro">Pro</option>
                        </select>
                      </div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                        <button class="btn btn-primary btn-md" data-start-playlist="${p.id}">START PLAYLIST</button>
                        <button class="btn btn-secondary btn-sm" data-edit-playlist="${p.id}">Edit</button>
                        <button class="btn btn-secondary btn-sm" data-dup-playlist="${p.id}">Duplicate</button>
                        ${this.playlistToDelete === p.id
                          ? `<button class="btn btn-sm" data-confirm-delete-playlist="${p.id}" style="background:var(--status-danger); color:#fff;">Confirm Delete?</button>`
                          : `<button class="btn btn-secondary btn-sm" data-del-playlist="${p.id}">Delete</button>`
                        }
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}

          ${showCustom && customPlaylists.length === 0 && this.playlistTab === 'custom' ? `
            <div class="card" style="padding:40px 20px; text-align:center;">
              <h3 style="margin-bottom:8px;">No custom playlists yet</h3>
              <p class="text-dim text-sm" style="margin-bottom:16px;">Create a personalized training sequence or duplicate one of the standard warm-up presets.</p>
              <button class="btn btn-primary btn-md" id="btn-empty-create-playlist">+ CREATE YOUR FIRST PLAYLIST</button>
            </div>
          ` : ''}

          ${showPresets ? `
            <div style="display:flex; flex-direction:column; gap:16px;">
              ${TRAINING_ROUTINES.map(r => {
                const activeMin = Math.round((r.activeDurationSec ?? (r.totalDurationSec ?? getRoutineDuration(r))) / 60);
                const totalMin = Math.floor((r.totalElapsedSec ?? r.totalDurationSec) / 60);
                const totalSec = (r.totalElapsedSec ?? r.totalDurationSec) % 60;
                const badgeLabel = `${activeMin} Min Active (${totalMin}m ${totalSec.toString().padStart(2, '0')}s Total)`;

                return `
                  <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:280px;">
                      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                        <span class="badge badge-gold font-game">PRESET ROUTINE</span>
                        <span class="badge badge-lime font-game">${badgeLabel}</span>
                      </div>
                      <h3>${r.name}</h3>
                      <p class="text-dim text-sm mt-8">${r.description}</p>
                      <div class="text-dim text-sm mt-8" style="font-size:0.85rem;">
                        <em>Drill 1 opener: <strong>Static Flicks</strong> (stationary target calibration)</em>
                      </div>
                      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
                        ${r.scenarioIds.map((sid, idx) => {
                          const sc = getScenarioById(sid);
                          const isOpener = idx === 0 && sid === 'flick-static';
                          return `<span class="badge ${isOpener ? 'badge-lime' : 'badge-gold'}">${sc?.name ?? sid}${isOpener ? ' (Stationary)' : ''}</span>`;
                        }).join('')}
                      </div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span class="text-dim text-sm">Difficulty:</span>
                        <select class="form-select select-routine-diff" data-routine-select="${r.id}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                          <option value="beginner">Beginner</option>
                          <option value="intermediate" selected>Intermediate</option>
                          <option value="advanced">Advanced</option>
                          <option value="pro">Pro</option>
                        </select>
                      </div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                        <button class="btn btn-primary btn-lg" data-plan-id="${r.id}">START ROUTINE</button>
                        <button class="btn btn-secondary btn-sm" data-dup-routine="${r.id}">Customize / Clone</button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderPlaylistEditorHTML(): string {
    if (!this.editingPlaylist) return '';

    const p = this.editingPlaylist;
    const durations = calculatePlaylistDurations(p);
    const activeMin = Math.floor(durations.activeSec / 60);
    const activeSecRem = durations.activeSec % 60;
    const totalMin = Math.floor(durations.totalElapsedSec / 60);
    const totalSecRem = durations.totalElapsedSec % 60;

    const categories: Array<{ id: string; label: string }> = [
      { id: 'all', label: 'All' },
      { id: 'custom', label: 'Custom' },
      { id: 'flick', label: 'Flick' },
      { id: 'tracking', label: 'Tracking' },
      { id: 'tactical', label: 'Tactical' },
      { id: 'reaction', label: 'Reaction' },
      { id: 'flash', label: 'Flash' },
      { id: 'hybrid', label: 'Hybrid' },
      { id: 'aimlab', label: 'Aimlab' },
      { id: 'kovaaks', label: 'Kovaaks' },
    ];

    const q = this.editorSearchQuery.trim().toLowerCase();
    const allScenarios = this.engine.store.getAllScenarios();
    const availableScenarios = allScenarios.filter(sc => {
      const matchCat =
        this.editorCategoryFilter === 'all'
          ? true
          : this.editorCategoryFilter === 'custom'
          ? sc.id.startsWith('custom_')
          : this.editorCategoryFilter === 'aimlab'
          ? sc.id.startsWith('aimlab-')
          : this.editorCategoryFilter === 'kovaaks'
          ? sc.id.startsWith('kovaaks-')
          : sc.category === this.editorCategoryFilter;

      if (!matchCat) return false;
      if (!q) return true;
      return (
        sc.name.toLowerCase().includes(q) ||
        sc.description.toLowerCase().includes(q) ||
        sc.skill.toLowerCase().includes(q) ||
        sc.category.toLowerCase().includes(q)
      );
    });

    return `
      <div class="page-inner">
        <!-- Editor Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-2); padding-bottom:16px;">
          <div>
            <div class="badge badge-teal font-game mb-4">PLAYLIST EDITOR</div>
            <h2 style="margin:0; font-size:1.8rem;">${p.name ? this.escapeHtml(p.name) : 'Untitled Playlist'}</h2>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary btn-md" id="btn-editor-cancel">Cancel</button>
            <button class="btn btn-primary btn-md" id="btn-editor-save">SAVE PLAYLIST</button>
          </div>
        </div>

        ${this.editorErrors.length > 0 ? `
          <div style="background:rgba(255,70,85,0.15); border:1px solid var(--red); border-radius:var(--r-md); padding:12px 16px; margin-bottom:20px; color:var(--red);">
            <strong style="display:block; margin-bottom:4px;">Cannot save playlist:</strong>
            ${this.editorErrors.map(err => `<div style="font-size:0.88rem;">&bull; ${this.escapeHtml(err)}</div>`).join('')}
          </div>
        ` : ''}

        <!-- Top Configuration & Live Summary -->
        <div class="card mb-20" style="padding:16px;">
          <div class="grid-3" style="align-items:flex-start; margin-bottom:16px;">
            <div>
              <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                Playlist Name <span style="color:var(--red);">*</span>
              </label>
              <input type="text" id="editor-name-input" class="form-input" value="${this.escapeHtml(p.name)}" placeholder="e.g. Daily Warm-Up" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;" />
            </div>
            <div>
              <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                Description (optional)
              </label>
              <input type="text" id="editor-desc-input" class="form-input" value="${this.escapeHtml(p.description || '')}" placeholder="Routine purpose or focus..." style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;" />
            </div>
            <div>
              <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                Default Rest Interval
              </label>
              <select id="editor-rest-select" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;">
                <option value="0" ${p.defaultRestIntervalSec === 0 ? 'selected' : ''}>0s (No Rest / Instant)</option>
                <option value="3" ${p.defaultRestIntervalSec === 3 ? 'selected' : ''}>3s Rest</option>
                <option value="4" ${p.defaultRestIntervalSec === 4 ? 'selected' : ''}>4s Rest (Standard)</option>
                <option value="5" ${p.defaultRestIntervalSec === 5 ? 'selected' : ''}>5s Rest</option>
                <option value="10" ${p.defaultRestIntervalSec === 10 ? 'selected' : ''}>10s Rest</option>
                <option value="15" ${p.defaultRestIntervalSec === 15 ? 'selected' : ''}>15s Rest</option>
                <option value="30" ${p.defaultRestIntervalSec === 30 ? 'selected' : ''}>30s Rest</option>
              </select>
            </div>
          </div>

          <!-- Duration KPI Badges -->
          <div style="display:flex; gap:12px; align-items:center; background:var(--panel-2); padding:10px 14px; border-radius:var(--r-sm); border:1px solid var(--border); flex-wrap:wrap;">
            <div><span class="text-dim text-xs">DRILLS:</span> <strong class="text-lime font-game" style="font-size:1.1rem;">${p.entries.length}</strong></div>
            <div style="color:var(--border-2);">&bull;</div>
            <div><span class="text-dim text-xs">ACTIVE AIM TIME:</span> <strong class="text-gold font-game" style="font-size:1.1rem;">${activeMin}m ${activeSecRem.toString().padStart(2, '0')}s</strong></div>
            <div style="color:var(--border-2);">&bull;</div>
            <div><span class="text-dim text-xs">REST INTERVALS:</span> <strong class="text-dim font-game" style="font-size:1.1rem;">${durations.restSec}s</strong></div>
            <div style="color:var(--border-2);">&bull;</div>
            <div><span class="text-dim text-xs">ESTIMATED TOTAL:</span> <strong class="text-lime font-game" style="font-size:1.1rem;">${totalMin}m ${totalSecRem.toString().padStart(2, '0')}s</strong></div>
          </div>
        </div>

        <!-- 2-Column Split: Timeline (Left) & Scenario Browser (Right) -->
        <div class="grid-2" style="align-items:start; gap:24px;">
          <!-- Left Column: Ordered Drill Timeline -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h3 style="font-size:1.15rem; margin:0;">DRILL TIMELINE (${p.entries.length})</h3>
              <span class="text-dim text-xs">Drag or use ▲/▼ to reorder</span>
            </div>

            <div id="playlist-timeline-container" style="display:flex; flex-direction:column; gap:10px;">
              ${p.entries.length === 0 ? `
                <div class="card" style="padding:32px 16px; text-align:center; border:1px dashed var(--border-2);">
                  <div class="text-dim text-sm mb-8">No drills in this playlist yet.</div>
                  <div style="font-size:0.85rem; color:var(--text-dim);">Select drills from the Available Scenarios browser on the right.</div>
                </div>
              ` : p.entries.map((entry, idx) => {
                const sc = getScenarioById(entry.scenarioId);
                const isFirst = idx === 0;
                const isLast = idx === p.entries.length - 1;

                return `
                  <div class="card drill-entry-card" style="padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-left:3px solid var(--lime-primary);">
                    <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:180px;">
                      <div class="badge badge-gold font-game" style="font-size:0.85rem; padding:4px 8px;">#${idx + 1}</div>
                      <div>
                        <div style="font-weight:600; font-size:0.95rem;">${sc?.name ?? entry.scenarioId}</div>
                        <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
                          <span class="badge badge-lime" style="font-size:0.7rem; padding:1px 6px;">${sc?.category ?? 'drill'}</span>
                          ${!sc ? '<span class="badge badge-red" style="font-size:0.7rem; padding:1px 6px;">Missing ID</span>' : ''}
                        </div>
                      </div>
                    </div>

                    <!-- Controls for this drill -->
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                      <!-- Duration selector -->
                      <div style="display:flex; align-items:center; gap:4px;">
                        <span class="text-dim text-xs">Duration:</span>
                        <select class="form-select select-entry-duration" data-entry-idx="${idx}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 6px; font-size:0.8rem;">
                          <option value="15" ${entry.durationSec === 15 ? 'selected' : ''}>15s</option>
                          <option value="30" ${entry.durationSec === 30 ? 'selected' : ''}>30s</option>
                          <option value="45" ${entry.durationSec === 45 ? 'selected' : ''}>45s</option>
                          <option value="60" ${entry.durationSec === 60 ? 'selected' : ''}>60s</option>
                          <option value="90" ${entry.durationSec === 90 ? 'selected' : ''}>90s</option>
                          <option value="120" ${entry.durationSec === 120 ? 'selected' : ''}>120s</option>
                          <option value="180" ${entry.durationSec === 180 ? 'selected' : ''}>180s</option>
                        </select>
                      </div>

                      <!-- Rest interval selector -->
                      <div style="display:flex; align-items:center; gap:4px;">
                        <span class="text-dim text-xs">Rest:</span>
                        <select class="form-select select-entry-rest" data-entry-idx="${idx}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 6px; font-size:0.8rem;">
                          <option value="default" ${entry.restIntervalSec === undefined ? 'selected' : ''}>Def (${p.defaultRestIntervalSec}s)</option>
                          <option value="0" ${entry.restIntervalSec === 0 ? 'selected' : ''}>0s</option>
                          <option value="3" ${entry.restIntervalSec === 3 ? 'selected' : ''}>3s</option>
                          <option value="5" ${entry.restIntervalSec === 5 ? 'selected' : ''}>5s</option>
                          <option value="10" ${entry.restIntervalSec === 10 ? 'selected' : ''}>10s</option>
                          <option value="15" ${entry.restIntervalSec === 15 ? 'selected' : ''}>15s</option>
                        </select>
                      </div>

                      <!-- Reorder Buttons -->
                      <div style="display:flex; gap:2px;">
                        <button class="btn btn-secondary btn-sm" data-move-up="${idx}" ${isFirst ? 'disabled style="opacity:0.3;"' : ''} title="Move Up" style="padding:4px 8px; font-size:0.75rem;">▲</button>
                        <button class="btn btn-secondary btn-sm" data-move-down="${idx}" ${isLast ? 'disabled style="opacity:0.3;"' : ''} title="Move Down" style="padding:4px 8px; font-size:0.75rem;">▼</button>
                      </div>

                      <!-- Delete Drill -->
                      <button class="btn btn-secondary btn-sm btn-remove-drill" data-remove-idx="${idx}" title="Remove Drill" style="padding:4px 8px; color:var(--red); font-weight:700;">&times;</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Right Column: Available Scenarios Browser -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
              <h3 style="font-size:1.15rem; margin:0;">AVAILABLE SCENARIOS</h3>
              <input type="text" id="editor-scen-search" class="form-input" value="${this.escapeHtml(this.editorSearchQuery)}" placeholder="Search scenarios..." style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 10px; font-size:0.85rem; width:180px;" />
            </div>

            <!-- Category Filter Pills -->
            <div style="display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:4px; flex-wrap:wrap;">
              ${categories.map(cat => `
                <button type="button" class="btn btn-sm ${this.editorCategoryFilter === cat.id ? 'btn-primary' : 'btn-secondary'}" data-editor-cat="${cat.id}" style="padding:3px 8px; font-size:0.75rem;">
                  ${cat.label}
                </button>
              `).join('')}
            </div>

            <!-- Scenarios List -->
            <div style="display:flex; flex-direction:column; gap:8px; max-height:560px; overflow-y:auto; padding-right:4px;">
              ${availableScenarios.length === 0 ? `
                <div class="card" style="padding:24px; text-align:center; color:var(--text-dim); font-size:0.88rem;">
                  No scenarios match "${this.escapeHtml(this.editorSearchQuery)}".
                </div>
              ` : availableScenarios.map(sc => `
                <div class="card" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                  <div style="flex:1; min-width:180px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <strong style="font-size:0.95rem;">${sc.name}</strong>
                      <span class="badge badge-teal" style="font-size:0.68rem; padding:1px 5px;">${sc.category}</span>
                    </div>
                    <div class="text-dim text-xs" style="margin-top:2px; line-height:1.3;">${sc.skill} &bull; ${sc.durationSec}s</div>
                  </div>
                  <button class="btn btn-primary btn-sm" data-add-scenario-id="${sc.id}" style="padding:4px 10px; font-size:0.8rem; font-family:var(--font-game); letter-spacing:0.04em;">
                    + ADD
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private attachPlansListeners(container: HTMLElement): void {
    if (this.editingPlaylist !== null) {
      // ── Editor Listeners ──────────────────────────────────────────
      const nameInput = container.querySelector('#editor-name-input') as HTMLInputElement | null;
      const descInput = container.querySelector('#editor-desc-input') as HTMLInputElement | null;
      const restSelect = container.querySelector('#editor-rest-select') as HTMLSelectElement | null;
      const searchInput = container.querySelector('#editor-scen-search') as HTMLInputElement | null;

      nameInput?.addEventListener('input', () => {
        if (this.editingPlaylist) {
          this.editingPlaylist.name = nameInput.value;
        }
      });

      descInput?.addEventListener('input', () => {
        if (this.editingPlaylist) {
          this.editingPlaylist.description = descInput.value;
        }
      });

      restSelect?.addEventListener('change', () => {
        if (this.editingPlaylist) {
          this.editingPlaylist.defaultRestIntervalSec = parseInt(restSelect.value, 10);
          this.renderPage('plans');
        }
      });

      searchInput?.addEventListener('input', () => {
        this.editorSearchQuery = searchInput.value;
        this.renderPage('plans');
        const updatedSearch = document.getElementById('editor-scen-search') as HTMLInputElement | null;
        if (updatedSearch) {
          updatedSearch.focus();
          updatedSearch.setSelectionRange(updatedSearch.value.length, updatedSearch.value.length);
        }
      });

      // Category filter pills
      container.querySelectorAll('[data-editor-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.editorCategoryFilter = (btn as HTMLElement).dataset.editorCat || 'all';
          this.renderPage('plans');
        });
      });

      // Add scenario to playlist
      container.querySelectorAll('[data-add-scenario-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = (btn as HTMLElement).dataset.addScenarioId;
          if (!sid || !this.editingPlaylist) return;
          const sc = getScenarioById(sid);
          const newEntry: PlaylistEntry = {
            id: `entry_${Date.now()}_${this.editingPlaylist.entries.length}`,
            scenarioId: sid,
            durationSec: sc?.durationSec ?? 60,
          };
          this.editingPlaylist.entries.push(newEntry);
          this.editorErrors = [];
          this.renderPage('plans');
        });
      });

      // Entry duration change
      container.querySelectorAll('.select-entry-duration').forEach(sel => {
        sel.addEventListener('change', () => {
          const idx = parseInt((sel as HTMLElement).dataset.entryIdx || '-1', 10);
          if (idx >= 0 && this.editingPlaylist && this.editingPlaylist.entries[idx]) {
            this.editingPlaylist.entries[idx].durationSec = parseInt((sel as HTMLSelectElement).value, 10);
            this.renderPage('plans');
          }
        });
      });

      // Entry rest interval change
      container.querySelectorAll('.select-entry-rest').forEach(sel => {
        sel.addEventListener('change', () => {
          const idx = parseInt((sel as HTMLElement).dataset.entryIdx || '-1', 10);
          if (idx >= 0 && this.editingPlaylist && this.editingPlaylist.entries[idx]) {
            const val = (sel as HTMLSelectElement).value;
            this.editingPlaylist.entries[idx].restIntervalSec = val === 'default' ? undefined : parseInt(val, 10);
            this.renderPage('plans');
          }
        });
      });

      // Reorder ▲ Move Up
      container.querySelectorAll('[data-move-up]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.moveUp || '-1', 10);
          if (idx > 0 && this.editingPlaylist && this.editingPlaylist.entries[idx]) {
            const temp = this.editingPlaylist.entries[idx];
            this.editingPlaylist.entries[idx] = this.editingPlaylist.entries[idx - 1];
            this.editingPlaylist.entries[idx - 1] = temp;
            this.renderPage('plans');
          }
        });
      });

      // Reorder ▼ Move Down
      container.querySelectorAll('[data-move-down]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.moveDown || '-1', 10);
          if (
            idx >= 0 &&
            this.editingPlaylist &&
            idx < this.editingPlaylist.entries.length - 1
          ) {
            const temp = this.editingPlaylist.entries[idx];
            this.editingPlaylist.entries[idx] = this.editingPlaylist.entries[idx + 1];
            this.editingPlaylist.entries[idx + 1] = temp;
            this.renderPage('plans');
          }
        });
      });

      // Remove Drill
      container.querySelectorAll('[data-remove-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.removeIdx || '-1', 10);
          if (idx >= 0 && this.editingPlaylist && this.editingPlaylist.entries[idx]) {
            this.editingPlaylist.entries.splice(idx, 1);
            this.renderPage('plans');
          }
        });
      });

      // Cancel editor
      container.querySelector('#btn-editor-cancel')?.addEventListener('click', () => {
        this.editingPlaylist = null;
        this.editorErrors = [];
        this.renderPage('plans');
      });

      // Save playlist
      container.querySelector('#btn-editor-save')?.addEventListener('click', () => {
        if (!this.editingPlaylist) return;
        if (nameInput) this.editingPlaylist.name = nameInput.value.trim();
        if (descInput) this.editingPlaylist.description = descInput.value.trim();
        if (restSelect) this.editingPlaylist.defaultRestIntervalSec = parseInt(restSelect.value, 10);

        const val = validatePlaylist(this.editingPlaylist);
        if (!val.valid) {
          this.editorErrors = val.errors;
          this.renderPage('plans');
          return;
        }

        const res = this.engine.store.savePlaylist(this.editingPlaylist);
        if (!res.success) {
          this.editorErrors = res.errors || ['Failed to save playlist.'];
          this.renderPage('plans');
          return;
        }

        this.editingPlaylist = null;
        this.editorErrors = [];
        this.renderPage('plans');
        this.showToast('Playlist saved successfully!', 'success');
      });

      return;
    }

    // ── Normal Plans Mode Listeners ──────────────────────────────────
    container.querySelector('#btn-create-playlist')?.addEventListener('click', () => {
      this.editingPlaylist = createDefaultPlaylist('My Warm-Up Playlist');
      this.editorErrors = [];
      this.renderPage('plans');
    });

    container.querySelector('#btn-empty-create-playlist')?.addEventListener('click', () => {
      this.editingPlaylist = createDefaultPlaylist('My Warm-Up Playlist');
      this.editorErrors = [];
      this.renderPage('plans');
    });

    container.querySelectorAll('[data-playlist-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.playlistTab = ((btn as HTMLElement).dataset.playlistTab as any) || 'all';
        this.renderPage('plans');
      });
    });

    // Start Custom Playlist
    container.querySelectorAll('[data-start-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.startPlaylist;
        if (!id) return;
        const playlist = this.engine.store.getPlaylistById(id);
        const diffSelect = container.querySelector(`[data-playlist-diff="${id}"]`) as HTMLSelectElement | null;
        const difficulty = (diffSelect?.value as DifficultyId) || 'intermediate';
        if (playlist) this.startPlaylist(playlist, difficulty);
      });
    });

    // Edit Custom Playlist
    container.querySelectorAll('[data-edit-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.editPlaylist;
        if (!id) return;
        const p = this.engine.store.getPlaylistById(id);
        if (p) {
          this.editingPlaylist = JSON.parse(JSON.stringify(p));
          this.editorErrors = [];
          this.renderPage('plans');
        }
      });
    });

    // Duplicate Custom Playlist
    container.querySelectorAll('[data-dup-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.dupPlaylist;
        if (!id) return;
        const cloned = this.engine.store.duplicatePlaylist(id);
        if (cloned) {
          this.showToast(`Playlist duplicated as "${cloned.name}"`, 'success');
          this.renderPage('plans');
        }
      });
    });

    // Request Delete Custom Playlist
    container.querySelectorAll('[data-del-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.delPlaylist;
        if (!id) return;
        this.playlistToDelete = id;
        this.renderPage('plans');
      });
    });

    // Confirm Delete Custom Playlist
    container.querySelectorAll('[data-confirm-delete-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.confirmDeletePlaylist;
        if (!id) return;
        this.engine.store.deletePlaylist(id);
        this.playlistToDelete = null;
        this.showToast('Playlist deleted.', 'info');
        this.renderPage('plans');
      });
    });

    // Start Preset Routine
    container.querySelectorAll('[data-plan-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.planId;
        const routine = TRAINING_ROUTINES.find(r => r.id === id);
        const selectEl = container.querySelector(`[data-routine-select="${id}"]`) as HTMLSelectElement | null;
        const difficulty = (selectEl?.value as DifficultyId) || 'intermediate';
        if (routine) this.startRoutine(routine, difficulty);
      });
    });

    // Customize / Clone Preset Routine
    container.querySelectorAll('[data-dup-routine]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.dupRoutine;
        if (!id) return;
        const cloned = this.engine.store.duplicatePlaylist(id);
        if (cloned) {
          this.editingPlaylist = cloned;
          this.editorErrors = [];
          this.renderPage('plans');
        }
      });
    });
  }

  private renderTrendDetailsHTML(scenarioId: string, diff: DifficultyId | 'all'): string {
    const trend = this.engine.store.getScenarioTrend(
      scenarioId,
      diff === 'all' ? undefined : diff
    );
    const sc = getScenarioById(scenarioId);

    if (!trend.hasEnoughData) {
      return `
        <div style="background:var(--panel-2); border:1px dashed var(--border-2); border-radius:var(--r-md); padding:20px; text-align:center;">
          <div class="text-dim text-sm" style="margin-bottom:6px;">
            ⚠️ Insufficient history for <strong>${sc?.name ?? scenarioId}</strong> ${diff !== 'all' ? `(${diff.toUpperCase()})` : '(All Difficulties)'}
          </div>
          <p style="font-size:0.9rem; margin:0; color:var(--text-dim);">
            At least 2 sessions with this scenario and difficulty scope are required to calculate performance trends. (Current recorded: <strong>${trend.sampleCount}</strong>)
          </p>
        </div>
      `;
    }

    const sDelta = trend.scoreDelta ?? 0;
    const aDelta = trend.accuracyDelta;
    const hsDelta = trend.headshotDelta;

    const sClass = sDelta > 0 ? 'trend-up' : (sDelta < 0 ? 'trend-down' : 'trend-neutral');
    const aClass = typeof aDelta === 'number' ? (aDelta > 0 ? 'trend-up' : (aDelta < 0 ? 'trend-down' : 'trend-neutral')) : 'trend-neutral';
    const hsClass = typeof hsDelta === 'number' ? (hsDelta > 0 ? 'trend-up' : (hsDelta < 0 ? 'trend-down' : 'trend-neutral')) : 'trend-neutral';

    const sSign = sDelta > 0 ? '+' : '';
    const aSign = typeof aDelta === 'number' && aDelta > 0 ? '+' : '';
    const hsSign = typeof hsDelta === 'number' && hsDelta > 0 ? '+' : '';

    let reactionDisplay = '<span class="text-dim">N/A (Tracking Drill)</span>';
    if (trend.meaningfulReactionTime) {
      if (trend.reactionDelta === null || trend.reactionDelta === undefined) {
        reactionDisplay = '<span class="text-dim">N/A</span>';
      } else {
        const rDelta = trend.reactionDelta;
        // Faster reaction is a negative delta (fewer ms), which is better!
        const rClass = rDelta < 0 ? 'trend-up' : (rDelta > 0 ? 'trend-down' : 'trend-neutral');
        const rText = rDelta < 0
          ? `${Math.abs(rDelta)} ms faster ⚡`
          : (rDelta > 0 ? `+${rDelta} ms slower` : '0 ms change');
        reactionDisplay = `<span class="${rClass}" style="font-weight:700;">${rText}</span>`;
      }
    }

    const sparklineSvg = generateSparklineSVG(trend.recentScores, 200, 44);
    const scopeBadge = diff === 'all'
      ? '<span class="badge badge-teal" style="font-size:0.75rem;">Aggregate Scope: All Difficulties</span>'
      : `<span class="badge badge-red" style="font-size:0.75rem;">Strict Scope: ${diff.toUpperCase()} Only</span>`;

    return `
      <div style="background:var(--panel-2); border:1px solid var(--border-2); border-radius:var(--r-md); padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h4 style="margin:0; font-size:1.15rem; color:var(--text);">${sc?.name ?? scenarioId}</h4>
              ${scopeBadge}
            </div>
            <span class="text-dim text-sm">Latest Attempt vs. Previous Attempt &bull; ${trend.sampleCount} total records</span>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="text-align:right;">
              <span class="text-dim text-xs" style="display:block; text-transform:uppercase; letter-spacing:0.06em;">Score Trend</span>
              <span class="text-dim text-xs">Last ${trend.recentScores.length} attempts</span>
            </div>
            ${sparklineSvg}
          </div>
        </div>

        <div class="grid-4" style="gap:12px;">
          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Score Delta</span>
            <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${sClass}">
              ${sSign}${sDelta.toLocaleString()} pts
            </div>
            <span class="text-dim text-xs">${trend.latest?.score.toLocaleString()} vs ${trend.previous?.score.toLocaleString()}</span>
          </div>

          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Accuracy Delta</span>
            <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${aClass}">
              ${typeof aDelta === 'number' ? `${aSign}${aDelta.toFixed(1)}%` : '<span class="text-dim font-game" style="font-size:1.15rem;">Untested</span>'}
            </div>
            <span class="text-dim text-xs">${typeof aDelta === 'number' ? `${trend.latest?.accuracy.toFixed(1)}% vs ${trend.previous?.accuracy.toFixed(1)}%` : 'Insufficient shots (&lt; 5)'}</span>
          </div>

          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Headshot Rate Delta</span>
            <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${hsClass}">
              ${typeof hsDelta === 'number' ? `${hsSign}${hsDelta.toFixed(1)}%` : '<span class="text-dim font-game" style="font-size:1.15rem;">Untested</span>'}
            </div>
            <span class="text-dim text-xs">${typeof hsDelta === 'number' ? 'Latest vs previous' : 'Insufficient shots (&lt; 5)'}</span>
          </div>

          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Reaction Time Delta</span>
            <div style="font-size:1.15rem; margin-top:4px;">
              ${reactionDisplay}
            </div>
            <span class="text-dim text-xs">${trend.meaningfulReactionTime ? `${trend.latest?.avgReactionMs ?? 0}ms vs ${trend.previous?.avgReactionMs ?? 0}ms` : 'Not applicable'}</span>
          </div>
        </div>
      </div>
            </div>
            <span class="text-dim text-xs">${trend.meaningfulReactionTime ? `${trend.latest?.avgReactionMs ?? 0}ms vs ${trend.previous?.avgReactionMs ?? 0}ms` : 'Not applicable'}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderSkillBarHTML(dim: SkillDimensionEvaluation): string {
    const hasData = dim.sampleCount > 0;
    const scoreColor = dim.isDeficit
      ? 'var(--status-danger)'
      : (dim.score < dim.benchmark ? 'var(--gold)' : 'var(--lime-primary)');
    const barClass = dim.isDeficit
      ? 'red'
      : (dim.score < dim.benchmark ? 'gold' : 'lime');

    const badgeHTML = !hasData
      ? `<span class="badge badge-dim font-game">UNTESTED</span>`
      : (dim.isDeficit
        ? `<span class="badge badge-red font-game">DEFICIT</span>`
        : (dim.sampleCount < 2
          ? `<span class="badge badge-gold font-game">PRELIMINARY</span>`
          : `<span class="badge badge-lime font-game">ON TARGET</span>`));

    const scoreDisplay = hasData
      ? `<span class="font-game" style="font-weight:700; font-size:1.15rem; color:${scoreColor};">${dim.score}<span style="font-size:0.85rem; color:var(--text-dim);">/100</span></span>`
      : `<span class="font-game text-dim" style="font-weight:700; font-size:0.95rem;">NO DATA</span>`;

    const coveragePct = Math.round(dim.confidence * 100);

    return `
      <div style="background:var(--panel-2); border:1px solid var(--border); border-radius:var(--r-md); padding:14px 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-weight:700; color:var(--text); font-size:0.95rem;">${dim.name}</span>
            <span style="font-size:0.8rem; color:var(--text-dim); margin-left:8px;">${dim.description}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:0.82rem; color:var(--text-dim);">Benchmark: <strong>${dim.benchmark}</strong></span>
            ${badgeHTML}
            ${scoreDisplay}
          </div>
        </div>

        <div class="progress-bar" style="height:7px; background:var(--bg-2); margin-bottom:8px;">
          <div class="progress-fill ${barClass}" style="width:${hasData ? dim.score : 0}%;"></div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text-dim); flex-wrap:wrap; gap:6px;">
          <span>${dim.evidenceSummary}</span>
          <span>${hasData ? `${dim.sampleCount} session(s) (${coveragePct}% evidence coverage)` : '0 sessions'}</span>
        </div>
      </div>
    `;
  }

  private renderTrainingIntelligenceSectionHTML(rec: RecommendationResult): string {
    const badgeType = rec.isColdStart
      ? `<span class="badge badge-gold font-game">DIAGNOSTIC BASELINE</span>`
      : (rec.primaryDimension
        ? `<span class="badge badge-red font-game">DEFICIT FOCUS: ${rec.dimensionName ? rec.dimensionName.toUpperCase() : 'TARGETED'}</span>`
        : `<span class="badge badge-lime font-game">MAINTENANCE & PROGRESSION</span>`);

    const actionBtnText = rec.recommendationType === 'routine'
      ? `⚡ LAUNCH 5-MIN DIAGNOSTIC ROUTINE`
      : `⚡ LAUNCH ${rec.recommendedScenarioName ? rec.recommendedScenarioName.toUpperCase() : 'RECOMMENDED DRILL'}`;

    const targetLabel = rec.recommendationType === 'routine'
      ? `Routine: <strong>${rec.recommendedRoutineName || 'Diagnostic Routine'}</strong>`
      : `Scenario: <strong>${rec.recommendedScenarioName || 'Target Drill'}</strong>`;

    const coveragePct = Math.round(rec.confidence * 100);

    return `
      <div class="card mb-32" style="border:1px solid var(--border-2); background:linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border); padding-bottom:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.3rem;">🧠</span>
              <h3 style="font-size:1.3rem; margin:0; letter-spacing:0.04em;">TRAINING INTELLIGENCE & RECOMMENDATIONS</h3>
            </div>
            <span class="section-sub" style="font-size:0.85rem;">Deterministic skill gap analysis and target drill selection</span>
          </div>
          <div>
            ${badgeType}
          </div>
        </div>

        <!-- Highlight Recommendation Box -->
        <div style="background:var(--bg-2); border-left:4px solid ${rec.isColdStart ? 'var(--gold)' : (rec.primaryDimension ? 'var(--status-danger)' : 'var(--lime-primary)')}; border-radius:0 var(--r-md) var(--r-md) 0; padding:16px 20px; margin-bottom:24px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:10px;">
            <div>
              <h4 style="font-size:1.25rem; color:var(--text); margin-bottom:4px; font-family:var(--font-game);">${rec.title}</h4>
              <div style="font-size:0.88rem; color:var(--text-dim);">
                ${targetLabel}
                <span style="margin:0 8px; color:var(--border-2);">|</span>
                <span>Preset: <strong style="color:var(--text);">${rec.targetDifficulty.toUpperCase()}</strong> <span style="font-size:0.75rem; color:var(--text-dim);">(default baseline)</span></span>
              </div>
            </div>
            <div style="text-align:right;">
              <span class="badge ${rec.confidence >= 0.5 ? 'badge-lime' : 'badge-gold'}" style="font-size:0.75rem;">
                ${coveragePct}% EVIDENCE COVERAGE
              </span>
            </div>
          </div>

          <div style="margin:12px 0; font-size:0.9rem; line-height:1.5;">
            <p style="color:var(--text); margin-bottom:6px;"><strong>Evidence:</strong> ${rec.evidence}</p>
            <p style="color:var(--text-dim); margin-bottom:6px;">${rec.rationale}</p>
            <p style="font-size:0.82rem; color:var(--text-dim);"><strong>Benchmark Target:</strong> <span style="color:var(--text);">${rec.benchmarkTarget}</span></p>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; flex-wrap:wrap; gap:12px;">
            <span style="font-size:0.78rem; color:var(--text-dim);">Confidence reflects historical sample coverage, not win probability.</span>
            <button class="btn btn-primary btn-lg" id="btn-rec-launch" style="font-weight:700;">
              ${actionBtnText}
            </button>
          </div>
        </div>

        <!-- 5 Skill Dimensions Breakdown -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h4 style="font-size:0.95rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim);">SKILL DIMENSION EVALUATIONS</h4>
            <span style="font-size:0.78rem; color:var(--text-dim);">Minimum 2 samples required per dimension to establish a deficit</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px;">
            ${rec.dimensionEvaluations.map((dim) => this.renderSkillBarHTML(dim)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderStatsHTML(): string {
    const agg = this.engine.store.getAggregateStats();
    const recentStats = this.engine.store.getRecentStats(10);
    const pbs = this.engine.store.getAllPBs();
    const pbList = Object.values(pbs);
    const routineSummaries = this.engine.store.getRoutineSummaries(10);
    const bestScenarios = this.engine.store.getBestPerformingScenarios(5);
    const allSessions = this.engine.store.getSessions(undefined, 100);
    const preferredDifficulty = allSessions[0]?.difficulty || 'intermediate';
    const rec = generateRecommendation(allSessions, preferredDifficulty);

    if (agg.totalDrills === 0 && agg.totalRoutines === 0) {
      return `
        <div class="page-inner">
          <div class="section-header">
            <h2>TRAINING PROGRESS DASHBOARD</h2>
            <span class="section-sub">Comprehensive aim analytics, consistency metrics, and personal records</span>
          </div>

          ${this.historyFeedbackMessage ? `
            <div role="status" aria-live="polite" style="padding:10px 14px; border-radius:var(--r-sm); margin-bottom:16px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; background:${this.historyFeedbackMessage.type === 'success' ? 'rgba(0,255,136,0.15)' : 'rgba(255,70,85,0.15)'}; border:1px solid ${this.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'}; color:${this.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'};">
              <span>${this.historyFeedbackMessage.text}</span>
              <button id="btn-dismiss-feedback" aria-label="Dismiss notification" style="background:none; border:none; color:inherit; font-weight:700; cursor:pointer;">&times;</button>
            </div>
          ` : ''}

          <div class="card" style="text-align:center; padding:48px 24px;">
            <div style="font-size:3rem; margin-bottom:12px;">🧠</div>
            <span class="badge badge-gold font-game" style="margin-bottom:12px;">DIAGNOSTIC BASELINE RECOMMENDED</span>
            <h3 style="font-size:1.6rem; margin-bottom:10px;">NO TRAINING SESSIONS RECORDED YET</h3>
            <p class="text-dim" style="max-width:560px; margin:0 auto 20px; font-size:0.95rem; line-height:1.6;">
              ${rec.evidence} Complete the Quick 5-Minute Warm-Up Routine to establish your initial baseline across flicks, tracking, and reaction speed.
            </p>
            <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
              <button class="btn btn-primary btn-lg" id="btn-empty-diagnostic">⚡ START 5-MIN DIAGNOSTIC ROUTINE</button>
              <button class="btn btn-secondary btn-lg" id="btn-empty-play">START QUICK DRILL</button>
              <button class="btn btn-secondary btn-lg" id="btn-empty-plans">BROWSE WARM-UP PLANS</button>
            </div>
          </div>
        </div>
      `;
    }

    const totalTimeMin = Math.round(agg.totalTimePlayedSec / 60);

    return `
      <div class="page-inner">
        <div class="section-header">
          <h2>TRAINING PROGRESS DASHBOARD</h2>
          <span class="section-sub">Real-time lifetime analytics, recent form trends, and routine performance</span>
        </div>

        <!-- Training Intelligence & Recommendations -->
        ${this.renderTrainingIntelligenceSectionHTML(rec)}

        <!-- Metric Overview Cards: Lifetime Totals -->
        <div class="grid-4 mb-24">
          <div class="card stats-summary-card">
            <div class="stat-value text-lime">${agg.totalDrills}</div>
            <div class="stat-label">Total Drills Completed</div>
          </div>
          <div class="card stats-summary-card">
            <div class="stat-value text-teal">${agg.totalRoutines}</div>
            <div class="stat-label">Warm-Up Routines Completed</div>
          </div>
          <div class="card stats-summary-card">
            <div class="stat-value text-gold">${agg.overallAccuracy.toFixed(1)}%</div>
            <div class="stat-label">Lifetime Accuracy (${agg.totalHits}/${agg.totalShots} shots)</div>
          </div>
          <div class="card stats-summary-card">
            <div class="stat-value text-green">${agg.overallHeadshotPct.toFixed(1)}%</div>
            <div class="stat-label">Lifetime Headshot Rate (${agg.totalHeadshots}/${agg.totalHits} hits)</div>
          </div>
        </div>

        <!-- Lifetime vs Recent Form Comparison -->
        <div class="grid-2 mb-32">
          <div class="card">
            <div class="section-header" style="margin-bottom:14px;">
              <h3>LIFETIME BENCHMARKS</h3>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Total Arena Time</span>
                <span style="font-weight:700; color:var(--text); font-family:var(--font-game);">${totalTimeMin} min (${agg.totalTimePlayedSec}s)</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Total Targets Hit</span>
                <span style="font-weight:700; color:var(--green); font-family:var(--font-game);">${agg.totalHits.toLocaleString()}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Total Headshots</span>
                <span style="font-weight:700; color:var(--gold); font-family:var(--font-game);">${agg.totalHeadshots.toLocaleString()}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="text-dim text-sm">Personal Bests Established</span>
                <span style="font-weight:700; color:var(--lime-primary); font-family:var(--font-game);">${pbList.length}</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-header" style="margin-bottom:14px;">
              <h3>RECENT FORM (LAST ${recentStats.count} SESSIONS)</h3>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Recent Accuracy</span>
                <span style="font-weight:700; color:var(--gold); font-family:var(--font-game);">${recentStats.accuracy.toFixed(1)}%</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Recent Headshot Rate</span>
                <span style="font-weight:700; color:var(--green); font-family:var(--font-game);">${recentStats.headshotPct.toFixed(1)}%</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
                <span class="text-dim text-sm">Recent Average Score</span>
                <span style="font-weight:700; color:var(--lime-primary); font-family:var(--font-game);">${recentStats.avgScore.toLocaleString()}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="text-dim text-sm">Recent Shots Fired</span>
                <span style="font-weight:700; color:var(--text); font-family:var(--font-game);">${recentStats.totalHits} / ${recentStats.totalShots}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Like-for-Like Trend Comparison & Sparkline -->
        <div class="card mb-32">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
            <div>
              <h3 style="margin:0 0 4px;">LIKE-FOR-LIKE PERFORMANCE TRENDS</h3>
              <span class="text-dim text-sm">Compare consecutive attempts under identical scenario and difficulty conditions</span>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <select id="trend-scenario-select" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 12px; font-size:0.85rem;">
                ${SCENARIOS.map(s => `<option value="${s.id}" ${this.selectedTrendScenario === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
              </select>
              <select id="trend-diff-select" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 12px; font-size:0.85rem;">
                <option value="all" ${this.selectedTrendDifficulty === 'all' ? 'selected' : ''}>All Difficulties</option>
                <option value="beginner" ${this.selectedTrendDifficulty === 'beginner' ? 'selected' : ''}>Beginner</option>
                <option value="intermediate" ${this.selectedTrendDifficulty === 'intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="advanced" ${this.selectedTrendDifficulty === 'advanced' ? 'selected' : ''}>Advanced</option>
                <option value="pro" ${this.selectedTrendDifficulty === 'pro' ? 'selected' : ''}>Pro</option>
              </select>
            </div>
          </div>

          <div id="trend-details-container">
            ${this.renderTrendDetailsHTML(this.selectedTrendScenario, this.selectedTrendDifficulty)}
          </div>
        </div>

        <!-- Top Performing Scenarios -->
        ${bestScenarios.length > 0 ? `
          <div class="card mb-32">
            <div class="section-header" style="margin-bottom:14px;">
              <h3>HIGHEST SINGLE-SESSION SCORES (BY SCENARIO)</h3>
              <span class="section-sub">Single-session personal bests across scenarios. Sample size and average score reflect consistency.</span>
            </div>
            <div style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                    <th style="padding:10px;">Scenario</th>
                    <th style="padding:10px;">Category</th>
                    <th style="padding:10px;">Single-Session Best</th>
                    <th style="padding:10px;">Average Score</th>
                    <th style="padding:10px;">Best Accuracy</th>
                    <th style="padding:10px;">Attempts (Sample Size)</th>
                  </tr>
                </thead>
                <tbody>
                  ${bestScenarios.map(b => {
                    const avg = b.avgScore ?? b.bestScore;
                    const isReliable = b.playCount >= 2;
                    return `
                      <tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:12px 10px; font-weight:600;">${b.scenarioName}</td>
                        <td style="padding:12px 10px;"><span class="badge badge-teal">${b.category.toUpperCase()}</span></td>
                        <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.15rem;">${b.bestScore.toLocaleString()}</td>
                        <td style="padding:12px 10px; font-weight:600; color:var(--text); font-family:var(--font-game);">${avg.toLocaleString()}</td>
                        <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${b.bestAccuracy.toFixed(1)}%</td>
                        <td style="padding:12px 10px;">
                          <span class="badge ${isReliable ? 'badge-green' : 'badge-gold'}">${b.playCount} ${b.playCount === 1 ? 'drill (single run)' : 'drills'}</span>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- All Personal Bests Table -->
        <div class="card mb-32">
          <h3 class="mb-16">ALL PERSONAL BESTS</h3>
          ${pbList.length === 0 ? `
            <p class="text-dim text-sm">No personal bests recorded yet.</p>
          ` : `
            <div class="table-scroll-wrapper" style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                    <th style="padding:10px;">Scenario</th>
                    <th style="padding:10px;">Score</th>
                    <th style="padding:10px;">Accuracy</th>
                    <th style="padding:10px;">Avg Reaction</th>
                    <th style="padding:10px;">Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${pbList.map(pb => {
                    const sc = getScenarioById(pb.scenarioId);
                    const isReactionMeaningful = sc ? sc.meaningfulReactionTime : true;
                    return `
                      <tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:12px 10px; font-weight:600;">${sc?.name ?? pb.scenarioId}</td>
                        <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.15rem;">${pb.score.toLocaleString()}</td>
                        <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${pb.accuracy.toFixed(1)}%</td>
                        <td style="padding:12px 10px;">${isReactionMeaningful && pb.avgReactionMs > 0 ? `${pb.avgReactionMs} ms` : 'N/A'}</td>
                        <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(pb.timestamp).toLocaleDateString()}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- Completed Warm-Up Routines Section (Dedicated & Isolated) -->
        <div class="card mb-32">
          <div class="section-header" style="margin-bottom:14px;">
            <h3>COMPLETED WARM-UP ROUTINES</h3>
            <span class="section-sub">Summaries of structured multi-drill warmup sessions</span>
          </div>
          ${routineSummaries.length === 0 ? `
            <p class="text-dim text-sm">No warm-up routines completed yet. Head to Warm-Up Plans to complete a 5, 10, or 20-minute structured routine!</p>
          ` : `
            <div class="table-scroll-wrapper" style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                    <th style="padding:10px;">Routine</th>
                    <th style="padding:10px;">Difficulty</th>
                    <th style="padding:10px;">Drills</th>
                    <th style="padding:10px;">Active Aim Time</th>
                    <th style="padding:10px;">Total Elapsed Time</th>
                    <th style="padding:10px;">Retries</th>
                    <th style="padding:10px;">Score</th>
                    <th style="padding:10px;">Accuracy</th>
                    <th style="padding:10px;">Headshot %</th>
                    <th style="padding:10px;">Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${routineSummaries.map(r => {
                    const activeSec = r.activeDurationSec ?? r.totalDurationSec;
                    const elapsedSec = r.totalElapsedSec ?? r.totalDurationSec;
                    const activeMin = Math.floor(activeSec / 60);
                    const activeRemSec = activeSec % 60;
                    const elapsedMin = Math.floor(elapsedSec / 60);
                    const elapsedRemSec = elapsedSec % 60;
                    const hsRate = r.totalHits > 0 ? ((r.totalHeadshots / r.totalHits) * 100).toFixed(1) : '0.0';

                    return `
                      <tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:12px 10px; font-weight:600;">${r.routineName}</td>
                        <td style="padding:12px 10px;"><span class="badge badge-red">${r.difficulty.toUpperCase()}</span></td>
                        <td style="padding:12px 10px;"><span class="badge badge-teal">${r.drillsCompleted}/${r.totalDrills}</span></td>
                        <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${activeMin}m ${activeRemSec.toString().padStart(2, '0')}s</td>
                        <td style="padding:12px 10px; color:var(--text-dim);">${elapsedMin}m ${elapsedRemSec.toString().padStart(2, '0')}s</td>
                        <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${r.retriesCount ?? 0}</td>
                        <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.1rem;">${r.totalScore.toLocaleString()}</td>
                        <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${r.overallAccuracy.toFixed(1)}%</td>
                        <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${hsRate}%</td>
                        <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(r.timestamp).toLocaleDateString()}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- Session History Management (Paginated & Filterable) -->
        <div class="card" id="session-history-container">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
            <div>
              <h3 style="margin:0 0 4px;">SESSION HISTORY & DIAGNOSTICS</h3>
              <span class="section-sub">Detailed records of individual drill attempts with client-side export and import</span>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <button class="btn btn-sm btn-secondary" id="btn-export-history" title="Export all stored sessions as JSON">
                📥 EXPORT JSON
              </button>
              <button class="btn btn-sm btn-secondary" id="btn-import-history" title="Import sessions from JSON file">
                📤 IMPORT JSON
              </button>
              <input type="file" id="input-import-history" accept=".json,application/json" style="display:none;" />
              <button class="btn btn-sm btn-secondary text-red" id="btn-clear-history" title="Clear drill session records" style="border-color:rgba(255,70,85,0.4);">
                🗑️ CLEAR HISTORY
              </button>
            </div>
          </div>

          <!-- Notification Toast (if any) -->
          ${this.historyFeedbackMessage ? `
            <div role="status" aria-live="polite" style="padding:10px 14px; border-radius:var(--r-sm); margin-bottom:16px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; background:${this.historyFeedbackMessage.type === 'success' ? 'rgba(0,255,136,0.15)' : 'rgba(255,70,85,0.15)'}; border:1px solid ${this.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'}; color:${this.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'};">
              <span>${this.historyFeedbackMessage.text}</span>
              <button id="btn-dismiss-feedback" aria-label="Dismiss notification" style="background:none; border:none; color:inherit; font-weight:700; cursor:pointer;">&times;</button>
            </div>
          ` : ''}

          <!-- Filter and Sort Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px; padding:10px 12px; background:var(--panel-2); border-radius:var(--r-sm); border:1px solid var(--border);">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <label class="text-dim text-xs uppercase" style="letter-spacing:0.06em;">Filter:</label>
              <select id="history-filter-cat" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
                <option value="all" ${this.historyCategoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
                <option value="flick" ${this.historyCategoryFilter === 'flick' ? 'selected' : ''}>Flicks</option>
                <option value="tracking" ${this.historyCategoryFilter === 'tracking' ? 'selected' : ''}>Tracking</option>
                <option value="tactical" ${this.historyCategoryFilter === 'tactical' ? 'selected' : ''}>Tactical</option>
                <option value="flash" ${this.historyCategoryFilter === 'flash' ? 'selected' : ''}>Flash Recovery</option>
                <option value="reaction" ${this.historyCategoryFilter === 'reaction' ? 'selected' : ''}>Reaction Time</option>
                <option value="hybrid" ${this.historyCategoryFilter === 'hybrid' ? 'selected' : ''}>Hybrid</option>
              </select>

              <select id="history-filter-diff" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
                <option value="all" ${this.historyDifficultyFilter === 'all' ? 'selected' : ''}>All Difficulties</option>
                <option value="beginner" ${this.historyDifficultyFilter === 'beginner' ? 'selected' : ''}>Beginner</option>
                <option value="intermediate" ${this.historyDifficultyFilter === 'intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="advanced" ${this.historyDifficultyFilter === 'advanced' ? 'selected' : ''}>Advanced</option>
                <option value="pro" ${this.historyDifficultyFilter === 'pro' ? 'selected' : ''}>Pro</option>
              </select>
            </div>

            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <label class="text-dim text-xs uppercase" style="letter-spacing:0.06em;">Sort:</label>
              <select id="history-sort-by" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
                <option value="date_desc" ${this.historySortBy === 'date_desc' ? 'selected' : ''}>Date (Newest First)</option>
                <option value="date_asc" ${this.historySortBy === 'date_asc' ? 'selected' : ''}>Date (Oldest First)</option>
                <option value="score_desc" ${this.historySortBy === 'score_desc' ? 'selected' : ''}>Score (High to Low)</option>
                <option value="accuracy_desc" ${this.historySortBy === 'accuracy_desc' ? 'selected' : ''}>Accuracy (High to Low)</option>
              </select>
            </div>
          </div>

          <!-- Table -->
          ${(() => {
            const filteredResult = this.engine.store.getFilteredSessions({
              category: this.historyCategoryFilter,
              difficulty: this.historyDifficultyFilter,
              sortBy: this.historySortBy,
              page: this.historyPage,
              pageSize: this.historyPageSize,
            });
            this.historyPage = filteredResult.currentPage;

            if (filteredResult.sessions.length === 0) {
              return `<p class="text-dim text-sm" style="padding:20px; text-align:center;">No matching session records found.</p>`;
            }

            return `
              <div class="table-scroll-wrapper" style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                  <thead>
                    <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                      <th style="padding:10px;">Scenario</th>
                      <th style="padding:10px;">Difficulty</th>
                      <th style="padding:10px;">Score</th>
                      <th style="padding:10px;">Accuracy</th>
                      <th style="padding:10px;">Headshot %</th>
                      <th style="padding:10px;">Hits / Misses</th>
                      <th style="padding:10px;">Targets / Min</th>
                      <th style="padding:10px;">Avg Reaction</th>
                      <th style="padding:10px;">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredResult.sessions.map(s => {
                      const sc = getScenarioById(s.scenarioId);
                      const isReactionMeaningful = sc ? sc.meaningfulReactionTime : true;
                      const hsPct = typeof s.headshotPct === 'number' && Number.isFinite(s.headshotPct)
                        ? `${s.headshotPct.toFixed(1)}%`
                        : (s.hits > 0 ? `${((s.headshots / s.hits) * 100).toFixed(1)}%` : '0.0%');
                      const tpm = typeof s.targetsPerMinute === 'number' && Number.isFinite(s.targetsPerMinute)
                        ? s.targetsPerMinute.toFixed(1)
                        : (s.durationSec > 0 ? ((s.hits / s.durationSec) * 60).toFixed(1) : '0.0');

                      return `
                        <tr style="border-bottom:1px solid var(--border);">
                          <td style="padding:12px 10px; font-weight:600;">${s.scenarioName}</td>
                          <td style="padding:12px 10px;"><span class="badge badge-red">${s.difficulty ? s.difficulty.toUpperCase() : 'INTERMEDIATE'}</span></td>
                          <td style="padding:12px 10px; font-weight:700; color:var(--text); font-family:var(--font-game); font-size:1.1rem;">${s.score.toLocaleString()}</td>
                          <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${s.accuracy.toFixed(1)}%</td>
                          <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${hsPct}</td>
                          <td style="padding:12px 10px;"><span class="text-green">${s.hits}</span> / <span class="text-red">${s.misses}</span></td>
                          <td style="padding:12px 10px;">${tpm}</td>
                          <td style="padding:12px 10px;">${isReactionMeaningful && s.avgReactionMs > 0 ? `${s.avgReactionMs} ms` : 'N/A'}</td>
                          <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(s.timestamp).toLocaleDateString()}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Pagination Controls -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--border); flex-wrap:wrap; gap:10px;">
                <span class="text-dim text-xs">
                  Showing page <strong>${filteredResult.currentPage}</strong> of <strong>${filteredResult.totalPages}</strong> &bull; Total records: <strong>${filteredResult.totalRecords}</strong>
                </span>
                <div style="display:flex; gap:8px;">
                  <button class="btn btn-sm btn-secondary" id="btn-history-prev" ${filteredResult.currentPage <= 1 ? 'disabled' : ''}>
                    &laquo; PREV
                  </button>
                  <button class="btn btn-sm btn-secondary" id="btn-history-next" ${filteredResult.currentPage >= filteredResult.totalPages ? 'disabled' : ''}>
                    NEXT &raquo;
                  </button>
                </div>
              </div>
            `;
          })()}
        </div>

        <!-- Clear Confirmation Modal -->
        <div id="modal-clear-history" role="dialog" aria-modal="true" aria-labelledby="clear-modal-title" style="display:${this.isClearModalOpen ? 'flex' : 'none'}; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center;">
          <div class="card" style="max-width:480px; width:90%; border:1px solid var(--red); background:var(--panel-2); padding:24px;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
              <span style="font-size:1.6rem;" aria-hidden="true">⚠️</span>
              <h3 id="clear-modal-title" style="margin:0; color:var(--red);">CLEAR DRILL SESSION HISTORY?</h3>
            </div>
            <p style="font-size:0.9rem; line-height:1.5; color:var(--text); margin-bottom:16px;">
              This will permanently delete all individual drill session records (<strong>${this.engine.store.totalSessions()}</strong> stored).
            </p>
            <p style="font-size:0.85rem; line-height:1.5; color:var(--text-dim); margin-bottom:24px; background:var(--panel); padding:10px; border-radius:var(--r-sm); border-left:3px solid var(--teal);">
              🛡️ <strong>Safety Guarantee:</strong> Your <strong>Personal Bests (PBs)</strong> and <strong>Completed Warm-Up Routine history</strong> will NOT be deleted.
            </p>
            <div style="display:flex; justify-content:flex-end; gap:12px;">
              <button class="btn btn-secondary btn-sm" id="btn-cancel-clear">CANCEL</button>
              <button class="btn btn-primary btn-sm" id="btn-confirm-clear" style="background:var(--red); border-color:var(--red);">CONFIRM CLEAR</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private attachStatsListeners(container: HTMLElement): void {
    const allSessions = this.engine.store.getSessions(undefined, 100);
    const preferredDifficulty = allSessions[0]?.difficulty || 'intermediate';
    const rec = generateRecommendation(allSessions, preferredDifficulty);

    container.querySelector('#btn-rec-launch')?.addEventListener('click', () => {
      this.executeRecommendationLaunch(rec);
    });

    container.querySelector('#btn-empty-diagnostic')?.addEventListener('click', () => {
      this.executeRecommendationLaunch(rec);
    });

    container.querySelector('#btn-empty-play')?.addEventListener('click', () => {
      this.launchScenario('flick-static');
    });

    container.querySelector('#btn-empty-plans')?.addEventListener('click', () => {
      this.navigateTo('plans');
    });

    const scenSelect = container.querySelector('#trend-scenario-select') as HTMLSelectElement | null;
    const diffSelect = container.querySelector('#trend-diff-select') as HTMLSelectElement | null;
    const detailsContainer = container.querySelector('#trend-details-container');

    const updateTrend = () => {
      if (scenSelect && detailsContainer) {
        this.selectedTrendScenario = scenSelect.value;
        this.selectedTrendDifficulty = (diffSelect?.value as DifficultyId | 'all') ?? 'all';
        detailsContainer.innerHTML = this.renderTrendDetailsHTML(
          this.selectedTrendScenario,
          this.selectedTrendDifficulty
        );
      }
    };

    scenSelect?.addEventListener('change', updateTrend);
    diffSelect?.addEventListener('change', updateTrend);

    // ── Session History Management Listeners ─────────────────────────────
    container.querySelector('#btn-export-history')?.addEventListener('click', () => {
      const jsonStr = this.engine.store.exportSessionsJSON();
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `warmup-lab-session-history-${dateStr}.json`;
      try {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (typeof url === 'string' && url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(url);
        }
        this.historyFeedbackMessage = {
          type: 'success',
          text: `Exported ${this.engine.store.totalSessions()} session(s) to ${filename}.`,
        };
      } catch (err: any) {
        this.historyFeedbackMessage = {
          type: 'error',
          text: `Export failed: ${err?.message || 'Unknown error'}`,
        };
      }
      this.renderPage(this.currentPage);
    });

    const fileInput = container.querySelector('#input-import-history') as HTMLInputElement | null;
    container.querySelector('#btn-import-history')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = typeof e.target?.result === 'string' ? e.target.result : '';
        const res = this.engine.store.importSessionsJSON(content);
        if (res.success) {
          this.historyPage = 1;
          const capNotice = typeof res.excludedByCapCount === 'number' && res.excludedByCapCount > 0
            ? ` (${res.retainedCount ?? res.importedCount} retained, ${res.excludedByCapCount} excluded by 100-session limit)`
            : '';
          this.historyFeedbackMessage = {
            type: 'success',
            text: `Import completed: ${res.importedCount} imported${capNotice}, ${res.duplicateCount} duplicate(s) skipped${res.invalidCount > 0 ? `, ${res.invalidCount} invalid record(s) discarded` : ''}.`,
          };
        } else {
          this.historyFeedbackMessage = {
            type: 'error',
            text: res.error || 'Import failed: Invalid file format.',
          };
        }
        fileInput.value = '';
        this.renderPage(this.currentPage);
      };

      reader.onerror = () => {
        this.historyFeedbackMessage = {
          type: 'error',
          text: 'File read error: Failed to read selected file.',
        };
        fileInput.value = '';
        this.renderPage(this.currentPage);
      };

      reader.readAsText(file);
    });

    const modalEl = container.querySelector('#modal-clear-history') as HTMLElement | null;
    const cancelClearBtn = container.querySelector('#btn-cancel-clear') as HTMLButtonElement | null;
    const confirmClearBtn = container.querySelector('#btn-confirm-clear') as HTMLButtonElement | null;

    if (this.isClearModalOpen && modalEl) {
      cancelClearBtn?.focus();

      modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!this.isClearModalOpen) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.isClearModalOpen = false;
          this.renderPage(this.currentPage);
          (document.getElementById('btn-clear-history') as HTMLElement | null)?.focus();
        } else if (e.key === 'Tab') {
          if (e.shiftKey) {
            if (document.activeElement === cancelClearBtn) {
              e.preventDefault();
              confirmClearBtn?.focus();
            }
          } else {
            if (document.activeElement === confirmClearBtn) {
              e.preventDefault();
              cancelClearBtn?.focus();
            }
          }
        }
      });
    }

    container.querySelector('#btn-clear-history')?.addEventListener('click', () => {
      this.isClearModalOpen = true;
      this.renderPage(this.currentPage);
    });

    cancelClearBtn?.addEventListener('click', () => {
      this.isClearModalOpen = false;
      this.renderPage(this.currentPage);
      (document.getElementById('btn-clear-history') as HTMLElement | null)?.focus();
    });

    confirmClearBtn?.addEventListener('click', () => {
      this.engine.store.clearSessions();
      this.isClearModalOpen = false;
      this.historyPage = 1;
      this.historyFeedbackMessage = {
        type: 'success',
        text: 'All drill session history cleared. Personal bests and routine records preserved.',
      };
      this.renderPage(this.currentPage);
    });

    const catSelect = container.querySelector('#history-filter-cat') as HTMLSelectElement | null;
    catSelect?.addEventListener('change', () => {
      this.historyCategoryFilter = catSelect.value;
      this.historyPage = 1;
      this.renderPage(this.currentPage);
    });

    const histDiffSelect = container.querySelector('#history-filter-diff') as HTMLSelectElement | null;
    histDiffSelect?.addEventListener('change', () => {
      this.historyDifficultyFilter = (histDiffSelect.value as DifficultyId | 'all') ?? 'all';
      this.historyPage = 1;
      this.renderPage(this.currentPage);
    });

    const sortSelect = container.querySelector('#history-sort-by') as HTMLSelectElement | null;
    sortSelect?.addEventListener('change', () => {
      this.historySortBy = sortSelect.value as any;
      this.historyPage = 1;
      this.renderPage(this.currentPage);
    });

    container.querySelector('#btn-history-prev')?.addEventListener('click', () => {
      if (this.historyPage > 1) {
        this.historyPage--;
        this.renderPage(this.currentPage);
      }
    });

    container.querySelector('#btn-history-next')?.addEventListener('click', () => {
      this.historyPage++;
      this.renderPage(this.currentPage);
    });

    container.querySelector('#btn-dismiss-feedback')?.addEventListener('click', () => {
      this.historyFeedbackMessage = null;
      this.renderPage(this.currentPage);
    });
  }

  private renderSettingsHTML(): string {
    const s = this.engine.settings.getAll();
    const profiles = getAllSoundProfiles();
    const activeProfile = getSoundProfile(s.soundProfile);
    const isAudioReady = this.engine.audio.isReady();

    return `
      <div class="page-inner" style="max-width:960px;">
        <div class="section-header">
          <h2>SETTINGS & CALIBRATION</h2>
          <span class="section-sub">Configure mouse look, field of view, audio profiles, and visual ergonomics</span>
        </div>

        <!-- Mouse Settings -->
        <div class="card settings-section">
          <div class="settings-section-title">MOUSE & SENSITIVITY</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Sensitivity</div>
              <div class="settings-row-desc">Calibrated for Valorant (e.g. 0.35 at 800 DPI &approx; 0.12 scale)</div>
            </div>
            <div class="settings-row-control">
              <div class="range-row">
                <input type="range" id="set-sens" min="0.01" max="1.0" step="0.01" value="${s.sensitivity}">
                <span class="range-value" id="val-sens">${s.sensitivity.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Invert Y Axis</div>
              <div class="settings-row-desc">Reverse vertical pitch aiming direction</div>
            </div>
            <div class="settings-row-control">
              <label class="toggle">
                <input type="checkbox" id="set-invert-y" ${s.invertY ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Visuals & FOV -->
        <div class="card settings-section">
          <div class="settings-section-title">FIELD OF VIEW & VISUALS</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Field of View (Horizontal)</div>
              <div class="settings-row-desc">Valorant standard is 103&deg; horizontal FOV</div>
            </div>
            <div class="settings-row-control">
              <div class="range-row">
                <input type="range" id="set-fov" min="70" max="120" step="1" value="${s.fov}">
                <span class="range-value" id="val-fov">${s.fov}&deg;</span>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Flash Intensity</div>
              <div class="settings-row-desc">Controls max brightness and whiteout during flash training</div>
            </div>
            <div class="settings-row-control">
              <div class="range-row">
                <input type="range" id="set-flash" min="0.1" max="1.0" step="0.05" value="${s.flashIntensity}">
                <span class="range-value" id="val-flash">${Math.round(s.flashIntensity * 100)}%</span>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Show Real-Time FPS</div>
              <div class="settings-row-desc">Display frame rate counter on HUD</div>
            </div>
            <div class="settings-row-control">
              <label class="toggle">
                <input type="checkbox" id="set-show-fps" ${s.showFps ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Crosshair Settings with Live Preview -->
        <div class="card settings-section">
          <div class="settings-section-title">CROSSHAIR ERGONOMICS</div>

          <div style="display:flex; gap:32px; align-items:flex-start; flex-wrap:wrap;">
            <div style="flex:1; min-width:280px;">
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Color Preset</div>
                </div>
                <div class="settings-row-control" style="display:flex; gap:6px;">
                  <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#00ff78" style="color:#00ff78;">Green</button>
                  <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#00ffff" style="color:#00ffff;">Cyan</button>
                  <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ffff00" style="color:#ffff00;">Yellow</button>
                  <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ffffff" style="color:#ffffff;">White</button>
                  <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ff4655" style="color:#ff4655;">Red</button>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Crosshair Size (Length)</div>
                </div>
                <div class="settings-row-control">
                  <div class="range-row">
                    <input type="range" id="set-ch-size" min="3" max="24" step="1" value="${s.crosshairSize}">
                    <span class="range-value" id="val-ch-size">${s.crosshairSize}px</span>
                  </div>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Inner Offset / Gap</div>
                </div>
                <div class="settings-row-control">
                  <div class="range-row">
                    <input type="range" id="set-ch-gap" min="1" max="16" step="1" value="${s.crosshairGap}">
                    <span class="range-value" id="val-ch-gap">${s.crosshairGap}px</span>
                  </div>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Line Thickness</div>
                </div>
                <div class="settings-row-control">
                  <div class="range-row">
                    <input type="range" id="set-ch-thick" min="1" max="6" step="1" value="${s.crosshairThickness}">
                    <span class="range-value" id="val-ch-thick">${s.crosshairThickness}px</span>
                  </div>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Center Dot</div>
                </div>
                <div class="settings-row-control">
                  <label class="toggle">
                    <input type="checkbox" id="set-ch-dot" ${s.crosshairDot ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Interactive Preview Box -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
              <div class="ch-preview-box" id="ch-preview">
                <div class="crosshair" id="ch-preview-inner">
                  <div class="crosshair-line ch-h ch-left"></div>
                  <div class="crosshair-line ch-h ch-right"></div>
                  <div class="crosshair-line ch-v ch-top"></div>
                  <div class="crosshair-line ch-v ch-bottom"></div>
                  <div class="ch-dot" id="ch-preview-dot" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); border-radius:50%;"></div>
                </div>
              </div>
              <span class="text-dim text-sm">Live Preview</span>
            </div>
          </div>
        </div>

        <!-- Audio & Vandal Sound Profiles -->
        <div class="card settings-section">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
            <div>
              <div class="settings-section-title" style="margin-bottom:4px;">VANDAL SOUND PROFILES & KILL-STREAK AUDIO</div>
              <span class="text-dim text-sm">Original procedural acoustic synthesis, custom weapon sound profiles, and kill-streak progression</span>
            </div>
            <div id="audio-status-badge">
              ${isAudioReady
                ? '<span class="badge badge-green">Web Audio: Active / Ready</span>'
                : '<span class="badge badge-gold">Web Audio: Click Preview or Unmute to Activate</span>'}
            </div>
          </div>

          <!-- Sound Profile Selection -->
          <div class="settings-row" style="align-items:flex-start;">
            <div class="settings-row-info">
              <div class="settings-row-label">Vandal Sound Profile</div>
              <div class="settings-row-desc">Select an original procedural acoustic profile for firing, hits, and eliminations</div>
            </div>
            <div class="settings-row-control" style="max-width:320px; width:100%;">
              <select id="set-sound-profile" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; width:100%; font-size:0.9rem;">
                ${profiles.map(p => `
                  <option value="${p.id}" ${s.soundProfile === p.id ? 'selected' : ''}>${p.name}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <!-- Profile Details Card -->
          <div id="audio-profile-card" style="background:var(--panel-2); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:16px; margin:16px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
              <span class="badge badge-lime font-game" id="profile-badge">${activeProfile.badgeLabel}</span>
              <span class="text-dim text-xs font-mono" id="profile-id-tag">ID: ${activeProfile.id}</span>
            </div>
            <div style="font-weight:700; font-size:1.05rem; color:var(--text); margin-bottom:4px;" id="profile-title">${activeProfile.name}</div>
            <p style="margin:0 0 8px; font-size:0.88rem; color:var(--text-dim); line-height:1.5;" id="profile-desc">${activeProfile.shortDescription}</p>
            <div style="font-size:0.78rem; color:var(--text-dim); border-top:1px dashed var(--border); padding-top:8px; font-style:italic;" id="profile-disclaimer">
              ${activeProfile.designNotes}
            </div>
          </div>

          <!-- Sound Previews (Non-mutating) -->
          <div class="settings-row" style="align-items:flex-start;">
            <div class="settings-row-info">
              <div class="settings-row-label">Acoustic Previews</div>
              <div class="settings-row-desc">Test weapon audio without starting a drill or modifying live kill streaks</div>
            </div>
            <div class="settings-row-control" style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-fire">🔊 PREVIEW FIRING</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-hit">🎯 PREVIEW BODY HIT</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-head">💥 PREVIEW HEADSHOT</button>
              </div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <select id="select-prev-stage" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                  <option value="1">Stage 1 (1 Kill)</option>
                  <option value="2">Stage 2 (2 Kills)</option>
                  <option value="3">Stage 3 (3 Kills)</option>
                  <option value="4">Stage 4 (4 Kills)</option>
                  <option value="5" selected>Stage 5+ (Ace / 5+ Kills)</option>
                </select>
                <button type="button" class="btn btn-primary btn-sm" id="btn-prev-kill">⭐ PREVIEW KILL STREAK</button>
              </div>
            </div>
          </div>

          <!-- Master Volume Slider -->
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Master Volume</div>
              <div class="settings-row-desc">Master output gain across all audio channels</div>
            </div>
            <div class="settings-row-control">
              <div class="range-row">
                <input type="range" id="set-vol" min="0" max="1.0" step="0.05" value="${s.volume}">
                <span class="range-value" id="val-vol">${Math.round(s.volume * 100)}%</span>
              </div>
            </div>
          </div>

          <!-- SFX Volume Slider -->
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Sound Effects (SFX) Volume</div>
              <div class="settings-row-desc">Volume of gunshots, hit indicators, and kill-streak cues</div>
            </div>
            <div class="settings-row-control">
              <div class="range-row">
                <input type="range" id="set-sfx-vol" min="0" max="1.0" step="0.05" value="${s.sfxVolume ?? 0.8}">
                <span class="range-value" id="val-sfx-vol">${Math.round((s.sfxVolume ?? 0.8) * 100)}%</span>
              </div>
            </div>
          </div>

          <!-- Mute Toggle -->
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Mute All Audio</div>
              <div class="settings-row-desc">Instantly silence all weapon firing, hit sounds, and cues</div>
            </div>
            <div class="settings-row-control">
              <label class="toggle">
                <input type="checkbox" id="set-audio-mute" ${s.audioMuted ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- Kill-Streak Progression Audio Toggle -->
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Kill-Streak Audio Progression</div>
              <div class="settings-row-desc">Play escalating harmonic chords as consecutive kills climb from Stage 1 to 5+</div>
            </div>
            <div class="settings-row-control">
              <label class="toggle">
                <input type="checkbox" id="set-streak-audio" ${s.killStreakAudioEnabled !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- Restore Audio Defaults Action -->
          <div style="display:flex; justify-content:flex-end; margin-top:16px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-audio">RESTORE AUDIO DEFAULTS</button>
          </div>
        </div>

        <!-- Storage & Local-First Database (Phase 3) -->
        <div class="card settings-section">
          <div class="settings-section-title">STORAGE & BACKUP (LOCAL-FIRST)</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Database Engine</div>
              <div class="settings-row-desc">WarmupLab uses local IndexedDB (Dexie.js) with zero cloud dependencies</div>
            </div>
            <div class="settings-row-control">
              <span class="badge ${this.engine.store.isFallback() ? 'badge-yellow' : 'badge-lime'} font-game" id="db-status-badge">
                ${this.engine.store.isFallback() ? 'LOCALSTORAGE FALLBACK' : 'INDEXEDDB (ACTIVE)'}
              </span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Full Workspace Backup</div>
              <div class="settings-row-desc">Export or restore all sessions, personal bests, routine stats, and custom playlists</div>
            </div>
            <div class="settings-row-control" style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-export-backup">💾 EXPORT FULL BACKUP (.JSON)</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-import-backup">📂 RESTORE BACKUP</button>
              <input type="file" id="input-import-backup" accept=".json" style="display:none;">
            </div>
          </div>
        </div>

        <!-- Reset Button -->
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
          <button class="btn btn-secondary" id="btn-reset-settings">RESET ALL SETTINGS TO DEFAULTS</button>
        </div>
      </div>
    `;
  }

  private attachSettingsListeners(container: HTMLElement): void {
    const bindRange = (
      sliderId: string,
      labelId: string,
      suffix: string,
      setter: (v: number) => void
    ) => {
      const slider = container.querySelector(`#${sliderId}`) as HTMLInputElement;
      const label = container.querySelector(`#${labelId}`);
      slider?.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        if (label) label.textContent = `${val}${suffix}`;
        setter(val);
        this.engine.applySettings();
      });
    };

    bindRange('set-sens', 'val-sens', '', v => this.engine.settings.set('sensitivity', v));
    bindRange('set-fov', 'val-fov', '°', v => this.engine.settings.set('fov', v));
    bindRange('set-flash', 'val-flash', '%', v => this.engine.settings.set('flashIntensity', v));
    bindRange('set-vol', 'val-vol', '%', v => this.engine.settings.set('volume', v));
    bindRange('set-sfx-vol', 'val-sfx-vol', '%', v => this.engine.settings.set('sfxVolume', v));

    // Sound Profile Selector
    const profileSelect = container.querySelector('#set-sound-profile') as HTMLSelectElement | null;
    profileSelect?.addEventListener('change', () => {
      const pid = profileSelect.value as SoundProfileId;
      this.engine.settings.set('soundProfile', pid);
      this.engine.applySettings();

      const p = getSoundProfile(pid);
      const badge = container.querySelector('#profile-badge');
      const idTag = container.querySelector('#profile-id-tag');
      const title = container.querySelector('#profile-title');
      const desc = container.querySelector('#profile-desc');
      const disc = container.querySelector('#profile-disclaimer');

      if (badge) badge.textContent = p.badgeLabel;
      if (idTag) idTag.textContent = `ID: ${p.id}`;
      if (title) title.textContent = p.name;
      if (desc) desc.textContent = p.shortDescription;
      if (disc) disc.textContent = p.designNotes;
    });

    // Sound Previews (safe, non-mutating)
    const updateAudioStatusBadge = () => {
      const badgeContainer = container.querySelector('#audio-status-badge');
      if (badgeContainer) {
        badgeContainer.innerHTML = '<span class="badge badge-green">Web Audio: Active / Ready</span>';
      }
    };

    container.querySelector('#btn-prev-fire')?.addEventListener('click', () => {
      const pid = (profileSelect?.value as SoundProfileId) || this.engine.settings.get('soundProfile');
      this.engine.audio.previewGunshot(pid);
      updateAudioStatusBadge();
    });

    container.querySelector('#btn-prev-hit')?.addEventListener('click', () => {
      const pid = (profileSelect?.value as SoundProfileId) || this.engine.settings.get('soundProfile');
      this.engine.audio.previewHit(pid, false);
      updateAudioStatusBadge();
    });

    container.querySelector('#btn-prev-head')?.addEventListener('click', () => {
      const pid = (profileSelect?.value as SoundProfileId) || this.engine.settings.get('soundProfile');
      this.engine.audio.previewHit(pid, true);
      updateAudioStatusBadge();
    });

    container.querySelector('#btn-prev-kill')?.addEventListener('click', () => {
      const pid = (profileSelect?.value as SoundProfileId) || this.engine.settings.get('soundProfile');
      const stageSelect = container.querySelector('#select-prev-stage') as HTMLSelectElement | null;
      const stage = stageSelect ? parseInt(stageSelect.value, 10) : 1;
      this.engine.audio.previewKill(pid, stage);
      updateAudioStatusBadge();
    });

    // Audio checkboxes
    container.querySelector('#set-audio-mute')?.addEventListener('change', e => {
      const checked = (e.target as HTMLInputElement).checked;
      this.engine.settings.set('audioMuted', checked);
      this.engine.applySettings();
    });

    container.querySelector('#set-streak-audio')?.addEventListener('change', e => {
      const checked = (e.target as HTMLInputElement).checked;
      this.engine.settings.set('killStreakAudioEnabled', checked);
      this.engine.applySettings();
    });

    // Audio reset defaults button
    container.querySelector('#btn-reset-audio')?.addEventListener('click', () => {
      this.engine.settings.resetAudio();
      this.engine.applySettings();
      this.renderPage('settings');
      this.showToast('Vandal audio settings restored to default presets.', 'info');
    });

    // Crosshair sliders
    bindRange('set-ch-size', 'val-ch-size', 'px', v => {
      this.engine.settings.set('crosshairSize', v);
      this.applyCrosshairStyles(this.engine.settings.getAll());
    });
    bindRange('set-ch-gap', 'val-ch-gap', 'px', v => {
      this.engine.settings.set('crosshairGap', v);
      this.applyCrosshairStyles(this.engine.settings.getAll());
    });
    bindRange('set-ch-thick', 'val-ch-thick', 'px', v => {
      this.engine.settings.set('crosshairThickness', v);
      this.applyCrosshairStyles(this.engine.settings.getAll());
    });

    // Checkboxes
    container.querySelector('#set-invert-y')?.addEventListener('change', e => {
      this.engine.settings.set('invertY', (e.target as HTMLInputElement).checked);
      this.engine.applySettings();
    });

    container.querySelector('#set-show-fps')?.addEventListener('change', e => {
      const checked = (e.target as HTMLInputElement).checked;
      this.engine.settings.set('showFps', checked);
      this.fpsEl.style.display = checked ? 'block' : 'none';
    });

    container.querySelector('#set-ch-dot')?.addEventListener('change', e => {
      const checked = (e.target as HTMLInputElement).checked;
      this.engine.settings.set('crosshairDot', checked);
      this.applyCrosshairStyles(this.engine.settings.getAll());
    });

    // Color buttons
    container.querySelectorAll('.ch-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = (btn as HTMLElement).dataset.color;
        if (color) {
          this.engine.settings.set('crosshairColor', color);
          this.applyCrosshairStyles(this.engine.settings.getAll());
        }
      });
    });

    // Full Backup Export (Phase 3)
    container.querySelector('#btn-export-backup')?.addEventListener('click', () => {
      const jsonStr = this.engine.store.exportBackupJSON();
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `warmuplab-full-backup-${dateStr}.json`;
      try {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (typeof url === 'string' && url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(url);
        }
        this.showToast('Full workspace backup exported successfully!');
      } catch (err: any) {
        this.showToast(`Export failed: ${err?.message || 'Error'}`, 'error');
      }
    });

    // Full Backup Import (Phase 3)
    const backupFileInput = container.querySelector('#input-import-backup') as HTMLInputElement | null;
    container.querySelector('#btn-import-backup')?.addEventListener('click', () => {
      backupFileInput?.click();
    });

    backupFileInput?.addEventListener('change', () => {
      const file = backupFileInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = typeof e.target?.result === 'string' ? e.target.result : '';
        const res = await this.engine.store.importBackupJSON(content);
        if (res.success) {
          this.showToast(`Restored: ${res.sessionsImported} sessions, ${res.playlistsImported} playlists, ${res.routinesImported} routines!`);
          this.renderPage('settings');
        } else {
          this.showToast(`Restore failed: ${res.errors.join(', ')}`, 'error');
        }
        backupFileInput.value = '';
      };
      reader.readAsText(file);
    });

    // Reset settings
    container.querySelector('#btn-reset-settings')?.addEventListener('click', () => {
      this.engine.settings.reset();
      this.engine.applySettings();
      this.applyCrosshairStyles(this.engine.settings.getAll());
      this.renderPage('settings');
      this.showToast('Settings restored to default presets.', 'info');
    });

    this.applyCrosshairStyles(this.engine.settings.getAll());
  }

  // ── Crosshair Styling ───────────────────────────────────────────────
  private applyCrosshairStyles(s: Settings): void {
    const root = document.documentElement;
    root.style.setProperty('--crosshair-color', s.crosshairColor);
    root.style.setProperty('--ch-size', `${s.crosshairSize}px`);
    root.style.setProperty('--ch-gap', `${s.crosshairGap}px`);
    root.style.setProperty('--ch-thick', `${s.crosshairThickness}px`);

    const dotEl = document.getElementById('ch-dot');
    if (dotEl) {
      dotEl.style.display = s.crosshairDot ? 'block' : 'none';
      dotEl.style.width = `${Math.max(2, s.crosshairThickness + 1)}px`;
      dotEl.style.height = `${Math.max(2, s.crosshairThickness + 1)}px`;
      dotEl.style.backgroundColor = s.crosshairColor;
    }

    const previewDot = document.getElementById('ch-preview-dot');
    if (previewDot) {
      previewDot.style.display = s.crosshairDot ? 'block' : 'none';
      previewDot.style.width = `${Math.max(2, s.crosshairThickness + 1)}px`;
      previewDot.style.height = `${Math.max(2, s.crosshairThickness + 1)}px`;
      previewDot.style.backgroundColor = s.crosshairColor;
    }
  }

  // ── Training Lifecycle & Overlays ───────────────────────────────────
  executeRecommendationLaunch(rec: RecommendationResult): void {
    if (this.isLaunchingRecommendation) return;

    // Stage 2.1 — Validate completely before any mutation
    if (!rec || typeof rec !== 'object') {
      console.error('Invalid recommendation object provided to executeRecommendationLaunch.');
      return;
    }

    const validDifficulties: DifficultyId[] = ['beginner', 'intermediate', 'advanced', 'pro'];

    if (rec.recommendationType === 'routine') {
      const routineId = rec.recommendedRoutineId || 'routine-5m';
      const routine = TRAINING_ROUTINES.find((r) => r.id === routineId);
      if (!routine) {
        console.error(`Recommended routine "${routineId}" not found in registry.`);
        return;
      }

      const targetDifficulty: DifficultyId =
        rec.targetDifficulty && validDifficulties.includes(rec.targetDifficulty)
          ? rec.targetDifficulty
          : 'intermediate';

      // Validation succeeded: acquire guard and execute mutations safely
      this.isLaunchingRecommendation = true;
      let launchSucceeded = false;
      try {
        this.clearRoutineTimers();
        this.resultOverlay.classList.remove('visible');
        this.startRoutine(routine, targetDifficulty);
        launchSucceeded = true;
      } finally {
        if (launchSucceeded) {
          this.clock.setTimeout(() => {
            this.isLaunchingRecommendation = false;
          }, 300);
        } else {
          // Failure recovery: release guard immediately if launch failed
          this.isLaunchingRecommendation = false;
        }
      }
    } else if (rec.recommendationType === 'drill') {
      const scenarioId = rec.recommendedScenarioId;
      if (!scenarioId) {
        console.error('No scenario ID specified in drill recommendation.');
        return;
      }
      const config = getScenarioById(scenarioId);
      if (!config) {
        console.error(`Recommended scenario "${scenarioId}" not found in registry.`);
        return;
      }

      const targetDifficulty: DifficultyId =
        rec.targetDifficulty && validDifficulties.includes(rec.targetDifficulty)
          ? rec.targetDifficulty
          : config.difficulty;

      // Validation succeeded: acquire guard and execute mutations safely
      this.isLaunchingRecommendation = true;
      let launchSucceeded = false;
      try {
        this.clearRoutineTimers();
        this.resultOverlay.classList.remove('visible');
        this.activeRoutine = null;
        this.launchScenario(config.id, targetDifficulty);
        launchSucceeded = true;
      } finally {
        if (launchSucceeded) {
          this.clock.setTimeout(() => {
            this.isLaunchingRecommendation = false;
          }, 300);
        } else {
          // Failure recovery: release guard immediately if launch failed
          this.isLaunchingRecommendation = false;
        }
      }
    } else {
      console.error(`Unknown recommendation type: "${(rec as any).recommendationType}".`);
      return;
    }
  }

  launchScenario(
    scenarioId: string,
    customDifficulty?: DifficultyId,
    configOverrides?: Partial<ScenarioConfig>
  ): void {
    const baseConfig = getScenarioById(scenarioId);
    if (!baseConfig) return;

    const config: ScenarioConfig = configOverrides
      ? { ...baseConfig, ...configOverrides }
      : baseConfig;

    // Show canvas & HUD
    this.canvas.classList.add('visible');
    this.hudEl.classList.add('visible');
    this.resultOverlay.classList.remove('visible');

    // Start engine & audio
    this.engine.audio.init();
    this.engine.startScenario(config, customDifficulty);

    // Request pointer lock while active user gesture context is preserved
    this.engine.controls.lock();

    // Hide UI page container
    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      pageContainer.style.display = 'none';
    }
  }

  private clearRoutineTimers(): void {
    this.routineTransitionToken++;
    if (this.routineTransitionTimer) {
      this.clock.clearTimeout(this.routineTransitionTimer);
      this.routineTransitionTimer = null;
    }
    if (this.routineCountdownInterval) {
      this.clock.clearInterval(this.routineCountdownInterval);
      this.routineCountdownInterval = null;
    }
  }

  startPlaylist(
    playlist: Playlist,
    difficulty: DifficultyId = 'intermediate'
  ): void {
    this.clearRoutineTimers();

    if (!playlist || !Array.isArray(playlist.entries) || playlist.entries.length === 0) {
      this.showToast('Playlist contains no drills.', 'error');
      return;
    }

    const durations = calculatePlaylistDurations(playlist);

    this.activeRoutine = {
      id: playlist.id,
      name: playlist.name,
      durationLabel: `${playlist.entries.length} Drills (${Math.round(durations.activeSec / 60)}m Active)`,
      totalDurationSec: durations.activeSec,
      activeDurationSec: durations.activeSec,
      expectedElapsedSec: durations.totalElapsedSec,
      difficulty,
      scenarioIds: playlist.entries.map(e => e.scenarioId),
      currentIndex: 0,
      retriesCount: 0,
      routineStartTime: this.clock.now(),
      currentDrillStartTime: this.clock.now(),
      totalPausedMs: 0,
      pauseStartTimestamp: 0,
      results: [],
      isAdvancing: false,
      entries: [...playlist.entries],
      defaultRestIntervalSec: playlist.defaultRestIntervalSec ?? DEFAULT_REST_INTERVAL_SEC,
      isCustomPlaylist: !playlist.isBuiltin,
    };

    // Skip any initial missing scenarios gracefully
    while (
      this.activeRoutine &&
      this.activeRoutine.currentIndex < this.activeRoutine.scenarioIds.length
    ) {
      const curId = this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
      if (getScenarioById(curId)) break;
      console.warn(`Scenario "${curId}" not found in registry, skipping drill.`);
      this.showToast(`Skipping missing scenario "${curId}".`, 'info');
      this.activeRoutine.currentIndex++;
    }

    if (this.activeRoutine && this.activeRoutine.currentIndex < this.activeRoutine.scenarioIds.length) {
      const curEntry = this.activeRoutine.entries ? this.activeRoutine.entries[this.activeRoutine.currentIndex] : null;
      const curId = curEntry ? curEntry.scenarioId : this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
      const overrides = curEntry ? { durationSec: curEntry.durationSec, ...(curEntry.configOverrides || {}) } : undefined;
      this.launchScenario(curId, difficulty, overrides);
    } else {
      this.activeRoutine = null;
      this.showToast('No valid scenarios found in playlist.', 'error');
    }
  }

  startRoutine(
    routine: TrainingRoutine,
    difficulty: DifficultyId = 'intermediate'
  ): void {
    const playlist = convertRoutineToPlaylist(routine);
    this.startPlaylist(playlist, difficulty);
    if (this.activeRoutine) {
      this.activeRoutine.id = routine.id;
      this.activeRoutine.name = routine.name;
      this.activeRoutine.durationLabel = routine.durationLabel ?? this.activeRoutine.durationLabel;
      this.activeRoutine.totalDurationSec = routine.activeDurationSec ?? (routine.totalDurationSec ?? this.activeRoutine.totalDurationSec);
      this.activeRoutine.activeDurationSec = routine.activeDurationSec ?? this.activeRoutine.activeDurationSec;
      this.activeRoutine.expectedElapsedSec = routine.totalElapsedSec ?? this.activeRoutine.expectedElapsedSec;
      this.activeRoutine.isCustomPlaylist = false;
    }
  }

  advanceRoutine(): void {
    if (!this.activeRoutine) return;
    if (this.activeRoutine.isAdvancing) return;
    this.activeRoutine.isAdvancing = true;

    this.clearRoutineTimers();

    this.activeRoutine.currentIndex++;
    this.activeRoutine.currentDrillStartTime = this.clock.now();
    this.resultOverlay.classList.remove('visible');

    // Skip missing scenarios if any
    while (
      this.activeRoutine &&
      this.activeRoutine.currentIndex < this.activeRoutine.scenarioIds.length
    ) {
      const curId = this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
      if (getScenarioById(curId)) break;
      console.warn(`Scenario "${curId}" not found in registry, skipping drill.`);
      this.showToast(`Skipping missing scenario "${curId}".`, 'info');
      this.activeRoutine.currentIndex++;
    }

    if (this.activeRoutine && this.activeRoutine.currentIndex < this.activeRoutine.scenarioIds.length) {
      const curEntry = this.activeRoutine.entries ? this.activeRoutine.entries[this.activeRoutine.currentIndex] : null;
      const nextId = curEntry ? curEntry.scenarioId : this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
      const overrides = curEntry ? { durationSec: curEntry.durationSec, ...(curEntry.configOverrides || {}) } : undefined;
      this.launchScenario(nextId, this.activeRoutine.difficulty, overrides);
    } else if (this.activeRoutine) {
      this.showRoutineCompletionScreen();
    }

    if (this.activeRoutine) {
      this.activeRoutine.isAdvancing = false;
    }
  }

  exitToMenu(): void {
    this.isLaunchingRecommendation = false;
    this.clearRoutineTimers();
    this.activeRoutine = null;
    this.engine.stopScenario();
    this.engine.controls.unlock();
    this.canvas.classList.remove('visible');
    this.hudEl.classList.remove('visible');
    this.lockOverlay.classList.remove('visible');
    this.resultOverlay.classList.remove('visible');
    document.getElementById('page-container')!.style.display = 'block';
    this.renderPage(this.currentPage);
  }

  showResultsScreen(result: SessionResult, isPB: boolean): void {
    this.isLaunchingRecommendation = false;
    this.engine.controls.unlock();
    this.lockOverlay.classList.remove('visible');
    this.clearRoutineTimers();

    // If within an active routine, store the drill result indexed by currentIndex (prevents duplicates on retry!)
    if (this.activeRoutine) {
      this.activeRoutine.results[this.activeRoutine.currentIndex] = result;

      // Check if this was the last drill in the routine
      if (this.activeRoutine.currentIndex >= this.activeRoutine.scenarioIds.length - 1) {
        this.showRoutineCompletionScreen();
        return;
      }
    }

    const content = document.getElementById('result-modal-content')!;
    const config = getScenarioById(result.scenarioId);
    const meaningfulReaction = config ? config.meaningfulReactionTime : true;
    const meaningfulTracking = config ? config.meaningfulTracking : (result.category === 'tracking');

    // Format metrics safely, guaranteeing never NaN or Infinity
    const scoreVal = Number.isFinite(result.score) ? result.score.toLocaleString() : '0';
    const accVal = Number.isFinite(result.accuracy) ? `${result.accuracy.toFixed(1)}%` : '0.0%';
    const hsPctVal = typeof result.headshotPct === 'number' && Number.isFinite(result.headshotPct)
      ? `${result.headshotPct.toFixed(1)}%`
      : (result.hits > 0 ? `${((result.headshots / result.hits) * 100).toFixed(1)}%` : '0.0%');

    // Display 'N/A' rather than misleading 0 or 0ms values for scenarios without meaningful reaction time
    const avgReactVal = meaningfulReaction
      ? (Number.isFinite(result.avgReactionMs) && result.avgReactionMs > 0 ? `${result.avgReactionMs} ms` : 'N/A')
      : 'N/A';
    const medReactVal = meaningfulReaction
      ? (typeof result.medianReactionMs === 'number' && Number.isFinite(result.medianReactionMs) && result.medianReactionMs > 0
          ? `${result.medianReactionMs} ms`
          : 'N/A')
      : 'N/A';

    const tpmVal = typeof result.targetsPerMinute === 'number' && Number.isFinite(result.targetsPerMinute)
      ? result.targetsPerMinute.toFixed(1)
      : (result.durationSec > 0 ? ((result.hits / result.durationSec) * 60).toFixed(1) : '0.0');
    const tpsVal = typeof result.targetsPerSecond === 'number' && Number.isFinite(result.targetsPerSecond)
      ? result.targetsPerSecond.toFixed(2)
      : '0.00';

    const bodyHits = typeof result.bodyHits === 'number' && Number.isFinite(result.bodyHits)
      ? result.bodyHits
      : Math.max(0, result.hits - result.headshots);
    const shotsFired = typeof result.shotsFired === 'number' && Number.isFinite(result.shotsFired)
      ? result.shotsFired
      : (result.hits + result.misses);

    const isInRoutine = !!this.activeRoutine;
    const routineCurrentDrill = isInRoutine ? this.activeRoutine!.currentIndex + 1 : 1;
    const routineTotalDrills = isInRoutine ? this.activeRoutine!.scenarioIds.length : 1;
    const nextDrillId = isInRoutine ? this.activeRoutine!.scenarioIds[this.activeRoutine!.currentIndex + 1] : null;
    const nextDrillConfig = nextDrillId ? getScenarioById(nextDrillId) : null;

    const allSessions = this.engine.store.getSessions(undefined, 100);
    const rec = generateRecommendation(allSessions, result.difficulty);

    content.innerHTML = `
      ${isPB ? `
        <div style="background:rgba(204,255,0,0.12); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:12px 24px; color:var(--lime-primary); font-family:var(--font-game); font-weight:700; font-size:1.4rem; letter-spacing:0.06em; margin-bottom:20px; box-shadow:0 0 20px rgba(204,255,0,0.2);">
          🏆 NEW PERSONAL BEST!
        </div>
      ` : ''}

      ${isInRoutine ? `
        <div style="background:rgba(204,255,0,0.08); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:8px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-family:var(--font-game); font-weight:700; color:var(--lime-primary);">ROUTINE: ${this.activeRoutine!.name.toUpperCase()}</span>
          <span class="badge badge-lime font-game">DRILL ${routineCurrentDrill} OF ${routineTotalDrills}</span>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:center; gap:8px; margin-bottom:8px;">
        <span class="badge badge-lime font-game">${result.category.toUpperCase()}</span>
        <span class="badge badge-red font-game">${result.difficulty.toUpperCase()}</span>
        <span class="badge badge-gold font-game">${result.durationSec}s</span>
      </div>
      <h2 style="font-size:2.2rem; margin:6px 0 20px;">${result.scenarioName}</h2>

      <!-- Primary Metrics Cards -->
      <div class="grid-4 mb-24">
        <div class="card" style="padding:14px;">
          <div class="stat-value text-gold" style="font-size:2.0rem;">${scoreVal}</div>
          <div class="stat-label">Final Score</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-lime" style="font-size:2.0rem;">${accVal}</div>
          <div class="stat-label">Accuracy</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-gold" style="font-size:2.0rem;">${hsPctVal}</div>
          <div class="stat-label">Headshot Rate</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-green" style="font-size:2.0rem;">${avgReactVal}</div>
          <div class="stat-label">Avg Reaction</div>
        </div>
      </div>

      <!-- Detailed Metrics Grid -->
      <div class="grid-4 mb-20" style="font-size:0.92rem; text-align:left; background:var(--panel-2); padding:16px; border-radius:var(--r-md); border:1px solid var(--border);">
        <div><span class="text-dim">Shots Fired:</span> <strong>${shotsFired}</strong></div>
        <div><span class="text-dim">Hits:</span> <strong class="text-green">${result.hits}</strong></div>
        <div><span class="text-dim">Headshots:</span> <strong class="text-gold">${result.headshots}</strong></div>
        <div><span class="text-dim">Body Hits:</span> <strong>${bodyHits}</strong></div>
        <div><span class="text-dim">Misses:</span> <strong class="text-red">${result.misses}</strong></div>
        <div><span class="text-dim">Median Reaction:</span> <strong>${medReactVal}</strong></div>
        <div><span class="text-dim">Targets / Min:</span> <strong>${tpmVal}</strong></div>
        <div><span class="text-dim">Kills / Sec:</span> <strong>${tpsVal}</strong></div>
        ${result.legHits !== undefined ? `<div><span class="text-dim">Leg Hits:</span> <strong class="text-red">${result.legHits}</strong></div>` : ''}
        ${result.friendlyFireCount !== undefined ? `<div><span class="text-dim">Friendly Fire:</span> <strong class="text-red">${result.friendlyFireCount}</strong></div>` : ''}
        ${result.earlyShotsCount !== undefined ? `<div><span class="text-dim">Early Shots:</span> <strong class="text-red">${result.earlyShotsCount}</strong></div>` : ''}
        ${result.sprayAccuracy !== undefined ? `<div><span class="text-dim">Spray Acc:</span> <strong class="text-teal">${result.sprayAccuracy.toFixed(1)}%</strong></div>` : ''}
        ${result.first10Accuracy !== undefined ? `<div><span class="text-dim">First 10 Bullets:</span> <strong class="text-gold">${result.first10Accuracy.toFixed(1)}%</strong></div>` : ''}
        ${result.decisionAccuracy !== undefined ? `<div><span class="text-dim">Decision Acc:</span> <strong class="text-green">${result.decisionAccuracy.toFixed(1)}%</strong></div>` : ''}
        ${result.counterStrafeAccuracy !== undefined ? `<div><span class="text-dim">Counter-Strafe Acc:</span> <strong class="text-lime">${result.counterStrafeAccuracy.toFixed(1)}%</strong></div>` : ''}
        ${result.overkillShots !== undefined ? `<div><span class="text-dim">Overkill Shots:</span> <strong class="text-red">${result.overkillShots}</strong></div>` : ''}
        ${result.timesShotByBot !== undefined ? `<div><span class="text-dim">Times Shot by Bot:</span> <strong class="text-red">${result.timesShotByBot}</strong></div>` : ''}
      </div>

      ${(result.shotsMoving !== undefined || result.shotsStationary !== undefined) ? `
        <div style="display:flex; justify-content:center; gap:20px; font-size:0.85rem; color:var(--text-dim); margin-bottom:20px;">
          <span>Stationary Shots: <strong style="color:var(--text);">${result.shotsStationary ?? 0}</strong></span>
          <span>Moving Shots: <strong style="color:var(--text);">${result.shotsMoving ?? 0}</strong></span>
        </div>
      ` : ''}

      ${(meaningfulTracking && result.timeOnTarget !== undefined) ? `
        <div style="font-size:0.9rem; color:var(--lime-primary); margin-bottom:20px;">
          Time on Target: <strong>${result.timeOnTarget.toFixed(1)}%</strong>
        </div>
      ` : ''}

      ${isInRoutine && nextDrillConfig ? `
        <div style="background:var(--panel-2); border-left:3px solid var(--lime-primary); padding:10px 16px; margin-bottom:20px; text-align:left; border-radius:0 var(--r-sm) var(--r-sm) 0;">
          <div class="text-dim text-sm" style="margin-bottom:2px;">NEXT DRILL:</div>
          <div style="font-weight:700; color:var(--text);">${nextDrillConfig.name} <span class="badge badge-gold" style="margin-left:6px;">${nextDrillConfig.skill}</span></div>
          <div id="routine-countdown-text" style="font-size:0.85rem; color:var(--lime-primary); margin-top:4px;">Starting next drill in 4s...</div>
        </div>
      ` : ''}

      ${!isInRoutine ? `
        <div class="card mb-20" style="background:var(--panel-2); border:1px solid var(--border-2); padding:16px; text-align:left; border-radius:var(--r-md);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <div style="font-family:var(--font-game); font-weight:700; color:var(--lime-primary); font-size:1.1rem;">
              🧠 NEXT TRAINING STEP: ${rec.recommendedScenarioName ? rec.recommendedScenarioName.toUpperCase() : (rec.recommendedRoutineName ? rec.recommendedRoutineName.toUpperCase() : rec.title.toUpperCase())}
            </div>
            <span class="badge ${rec.isColdStart ? 'badge-gold' : (rec.primaryDimension ? 'badge-red' : 'badge-lime')} font-game">
              ${rec.isColdStart ? 'DIAGNOSTIC BASELINE' : (rec.primaryDimension ? 'TARGETED FOCUS' : 'RECOMMENDED')}
            </span>
          </div>
          <div style="font-size:0.88rem; color:var(--text); margin-bottom:4px;">
            <strong>Evidence:</strong> ${rec.evidence}
          </div>
          <div style="font-size:0.84rem; color:var(--text-dim); margin-bottom:12px;">
            ${rec.rationale}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div style="font-size:0.8rem; color:var(--text-dim);">
              <span>Difficulty: <strong style="color:var(--text);">${rec.targetDifficulty.toUpperCase()}</strong> <span style="font-size:0.75rem; color:var(--text-dim);">(default baseline)</span></span>
              ${rec.confidence > 0 ? `<span style="margin-left:10px;">Evidence coverage: <strong>${Math.round(rec.confidence * 100)}%</strong></span>` : ''}
            </div>
            <button class="btn btn-primary btn-sm" id="btn-res-rec-launch">
              ⚡ LAUNCH ${rec.recommendationType === 'routine' ? 'ROUTINE' : 'DRILL'} &rarr;
            </button>
          </div>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="btn-res-retry">${isInRoutine ? 'RETRY DRILL' : 'PLAY AGAIN'}</button>
        ${isInRoutine ? `
          <button class="btn btn-primary btn-lg" id="btn-res-next">NEXT DRILL &rarr;</button>
          <button class="btn btn-secondary btn-lg" id="btn-res-menu">EXIT ROUTINE</button>
        ` : `
          <button class="btn btn-secondary btn-lg" id="btn-res-menu">RETURN TO MENU</button>
        `}
      </div>
    `;

    this.resultOverlay.classList.add('visible');

    // Button actions
    if (!isInRoutine) {
      content.querySelector('#btn-res-rec-launch')?.addEventListener('click', () => {
        this.executeRecommendationLaunch(rec);
      });
    }

    content.querySelector('#btn-res-retry')?.addEventListener('click', () => {
      this.clearRoutineTimers();
      this.resultOverlay.classList.remove('visible');
      if (this.activeRoutine) {
        this.activeRoutine.retriesCount = (this.activeRoutine.retriesCount ?? 0) + 1;
        this.activeRoutine.currentDrillStartTime = this.clock.now();
        const curEntry = this.activeRoutine.entries ? this.activeRoutine.entries[this.activeRoutine.currentIndex] : null;
        const currId = curEntry ? curEntry.scenarioId : this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
        const overrides = curEntry ? { durationSec: curEntry.durationSec, ...(curEntry.configOverrides || {}) } : undefined;
        this.launchScenario(currId, this.activeRoutine.difficulty, overrides);
      } else {
        const diff = result.difficulty;
        this.launchScenario(result.scenarioId, diff);
      }
    });

    if (isInRoutine) {
      content.querySelector('#btn-res-next')?.addEventListener('click', () => {
        this.advanceRoutine();
      });

      const curEntry = this.activeRoutine?.entries ? this.activeRoutine.entries[this.activeRoutine.currentIndex] : null;
      const restSec = curEntry?.restIntervalSec !== undefined
        ? curEntry.restIntervalSec
        : (this.activeRoutine?.defaultRestIntervalSec ?? ROUTINE_TRANSITION_SEC);

      if (restSec === 0) {
        this.advanceRoutine();
        return;
      }

      // Clearable auto-transition timer using injectable clock
      let remainingSec = restSec;
      const countdownEl = content.querySelector('#routine-countdown-text');
      const routineSession = this.activeRoutine;
      const transitionToken = ++this.routineTransitionToken;

      if (countdownEl) {
        countdownEl.textContent = `Starting next drill in ${remainingSec}s...`;
      }

      this.routineCountdownInterval = this.clock.setInterval(() => {
        if (this.routineTransitionToken !== transitionToken || this.activeRoutine !== routineSession) {
          if (this.routineCountdownInterval) {
            this.clock.clearInterval(this.routineCountdownInterval);
            this.routineCountdownInterval = null;
          }
          return;
        }
        remainingSec--;
        if (countdownEl) {
          countdownEl.textContent = `Starting next drill in ${remainingSec}s...`;
        }
        if (remainingSec <= 0) {
          if (this.routineCountdownInterval) {
            this.clock.clearInterval(this.routineCountdownInterval);
            this.routineCountdownInterval = null;
          }
        }
      }, 1000);

      this.routineTransitionTimer = this.clock.setTimeout(() => {
        if (this.routineTransitionToken !== transitionToken || this.activeRoutine !== routineSession) {
          return;
        }
        this.advanceRoutine();
      }, restSec * 1000);
    }

    content.querySelector('#btn-res-menu')?.addEventListener('click', () => {
      this.exitToMenu();
    });
  }

  private showRoutineCompletionScreen(): void {
    if (!this.activeRoutine) return;
    this.isLaunchingRecommendation = false;
    this.engine.controls.unlock();
    this.lockOverlay.classList.remove('visible');
    this.clearRoutineTimers();

    const routine = this.activeRoutine;
    this.activeRoutine = null; // Prevent duplicate completion events
    // Filter actual completed results to ignore empty/sparse slots from skipped drills
    const completedResults = routine.results.filter((r): r is SessionResult => Boolean(r && r.scenarioId));
    const completedDrillsCount = completedResults.length;
    const totalPlannedDrills = routine.scenarioIds.length;
    const skippedDrillsCount = Math.max(0, totalPlannedDrills - completedDrillsCount);
    const completionRate = totalPlannedDrills > 0
      ? Number(((completedDrillsCount / totalPlannedDrills) * 100).toFixed(1))
      : 100;

    const totalScore = completedResults.reduce((acc, r) => acc + (r.score || 0), 0);
    const totalHits = completedResults.reduce((acc, r) => acc + (r.hits || 0), 0);
    const totalHeadshots = completedResults.reduce((acc, r) => acc + (r.headshots || 0), 0);
    const totalShots = completedResults.reduce((acc, r) => acc + (r.shotsFired ?? (r.hits + r.misses)), 0);
    const overallAcc = totalShots > 0 ? Number(((totalHits / totalShots) * 100).toFixed(1)) : 0;
    const hsPct = totalHits > 0 ? Number(((totalHeadshots / totalHits) * 100).toFixed(1)) : 0;
    const activeTrainingSec = completedResults.reduce((acc, r) => acc + (r.durationSec || 0), 0);

    const rawElapsedMs = this.clock.now() - routine.routineStartTime;
    const totalElapsedSec = Math.max(activeTrainingSec, Math.round(rawElapsedMs / 1000));
    const pausedSec = Math.round(routine.totalPausedMs / 1000);
    const transitionCount = Math.max(0, routine.scenarioIds.length - 1);
    const transitionSec = transitionCount * ROUTINE_TRANSITION_SEC;
    const reactionSummary = calculateRoutineReactionSummary(completedResults);

    const isPlaylist = Boolean(routine.isCustomPlaylist);

    const summary: RoutineSummary = {
      id: `routine_summary_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      routineId: routine.id,
      routineName: routine.name,
      difficulty: routine.difficulty,
      timestamp: Date.now(),
      totalDurationSec: activeTrainingSec,
      activeDurationSec: activeTrainingSec,
      totalElapsedSec,
      transitionSec,
      pausedSec,
      retriesCount: routine.retriesCount ?? 0,
      drillsCompleted: completedDrillsCount,
      totalDrills: totalPlannedDrills,
      totalScore,
      overallAccuracy: overallAcc,
      totalHits,
      totalHeadshots,
      totalShotsFired: totalShots,
      avgReactionMs: reactionSummary.weightedAvgReactionMs > 0 ? reactionSummary.weightedAvgReactionMs : undefined,
      isPlaylist,
      completionRate: Math.round(completionRate),
      skippedDrills: skippedDrillsCount,
      drillResults: completedResults.map(r => ({
        scenarioId: r.scenarioId,
        scenarioName: r.scenarioName,
        score: r.score,
        accuracy: r.accuracy,
        durationSec: r.durationSec,
        hits: r.hits,
        headshots: r.headshots,
      })),
    };

    this.engine.store.addRoutineSummary(summary);

    const content = document.getElementById('result-modal-content')!;
    content.innerHTML = `
      <div style="background:rgba(204,255,0,0.12); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:14px 24px; color:var(--lime-primary); font-family:var(--font-game); font-weight:700; font-size:1.6rem; letter-spacing:0.06em; margin-bottom:16px; box-shadow:0 0 24px rgba(204,255,0,0.25);">
        🏆 ${isPlaylist ? 'TRAINING PLAYLIST COMPLETE!' : 'WARM-UP ROUTINE COMPLETE!'}
      </div>

      <div style="display:flex; justify-content:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <span class="badge badge-lime font-game">${routine.name.toUpperCase()}</span>
        <span class="badge badge-red font-game">${routine.difficulty.toUpperCase()}</span>
        <span class="badge badge-gold font-game">${completedDrillsCount}/${totalPlannedDrills} DRILLS FINISHED</span>
        ${skippedDrillsCount > 0 ? `<span class="badge badge-red font-game">${skippedDrillsCount} SKIPPED</span>` : ''}
        <span class="badge badge-green font-game">${Math.round(completionRate)}% COMPLETE</span>
        <span class="badge badge-lime font-game">${Math.floor(activeTrainingSec / 60)}m ${activeTrainingSec % 60}s ACTIVE</span>
        <span class="badge badge-gold font-game">${Math.floor(totalElapsedSec / 60)}m ${totalElapsedSec % 60}s TOTAL ELAPSED</span>
      </div>

      <h2 style="font-size:2.2rem; margin:6px 0 20px;">${isPlaylist ? 'Playlist' : 'Routine'} Summary</h2>

      <!-- Primary Aggregates -->
      <div class="grid-4 mb-24">
        <div class="card" style="padding:14px;">
          <div class="stat-value text-gold" style="font-size:2.0rem;">${totalScore.toLocaleString()}</div>
          <div class="stat-label">Total Score</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-lime" style="font-size:2.0rem;">${overallAcc.toFixed(1)}%</div>
          <div class="stat-label">Overall Accuracy</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-gold" style="font-size:2.0rem;">${hsPct.toFixed(1)}%</div>
          <div class="stat-label">Headshot Rate</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-green" style="font-size:2.0rem;">${totalHits}</div>
          <div class="stat-label">Total Targets Hit</div>
        </div>
      </div>

      <!-- Timing Transparency Breakdown -->
      <div class="grid-4 mb-20" style="font-size:0.92rem; text-align:left; background:var(--panel-2); padding:16px; border-radius:var(--r-md); border:1px solid var(--border);">
        <div><span class="text-dim">Active Aim Time:</span> <strong>${Math.floor(activeTrainingSec / 60)}m ${(activeTrainingSec % 60).toString().padStart(2, '0')}s</strong></div>
        <div><span class="text-dim">Total Elapsed Time:</span> <strong>${Math.floor(totalElapsedSec / 60)}m ${(totalElapsedSec % 60).toString().padStart(2, '0')}s</strong></div>
        <div><span class="text-dim">Transition Time:</span> <strong>${transitionSec}s</strong></div>
        <div><span class="text-dim">Retries:</span> <strong class="text-gold">${routine.retriesCount ?? 0}</strong></div>
      </div>

      <!-- Breakdown Table -->
      <div class="card mb-24" style="max-height:220px; overflow-y:auto; text-align:left; padding:12px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem;">
              <th style="padding:6px;">#</th>
              <th style="padding:6px;">Drill</th>
              <th style="padding:6px;">Duration</th>
              <th style="padding:6px;">Score</th>
              <th style="padding:6px;">Accuracy</th>
              <th style="padding:6px;">Headshots</th>
            </tr>
          </thead>
          <tbody>
            ${completedResults.map((res, idx) => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px; color:var(--text-dim);">${idx + 1}</td>
                <td style="padding:6px; font-weight:600;">${res.scenarioName}</td>
                <td style="padding:6px; color:var(--text-dim);">${res.durationSec}s</td>
                <td style="padding:6px; color:var(--gold); font-family:var(--font-game); font-weight:700;">${res.score.toLocaleString()}</td>
                <td style="padding:6px; color:var(--teal);">${res.accuracy.toFixed(1)}%</td>
                <td style="padding:6px; color:var(--gold);">${res.headshots}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="btn-routine-menu">RETURN TO MENU</button>
      </div>
    `;

    this.resultOverlay.classList.add('visible');

    content.querySelector('#btn-routine-menu')?.addEventListener('click', () => {
      this.activeRoutine = null;
      this.exitToMenu();
    });
  }

  // ── Creator Studio (Phase 4) ──────────────────────────────────────────

  private renderCreatorStudioHTML(): string {
    if (!this.editingScenario) {
      this.editingScenario = createDefaultCustomScenario(this.studioActiveTemplate || 'static_flick');
    }
    const s = this.editingScenario;
    const isExisting = Boolean(s.id && this.engine.store.getCustomScenario(s.id));
    const weapon = s.weapon ?? { preset: 'vandal' as const, requireCounterStrafe: false };
    const spawner = s.spawner;
    const target = s.target;
    const scoring = s.scoring ?? { baseHitScore: 100, headshotBonus: 50, missPenalty: -25, speedBonusMax: 300, counterStrafeBonus: 0 };
    const jsonStr = JSON.stringify(s, null, 2);

    return `
      <div class="page-inner">
        <!-- Studio Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:16px; border-bottom:1px solid var(--border-2); padding-bottom:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-lime font-game">CREATOR STUDIO</span>
              <span class="badge badge-gold font-game" style="font-size:0.7rem;">V1 ENGINE</span>
              ${isExisting ? `<span class="badge badge-gold font-game" style="font-size:0.7rem;">v${s.metadata?.configVersion || 1}</span>` : ''}
            </div>
            <h2 style="margin:4px 0 0 0; font-size:1.8rem;">${s.name ? this.escapeHtml(s.name) : 'Untitled Custom Drill'}</h2>
          </div>

          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px; background:var(--panel-2); padding:4px 8px; border-radius:var(--r-sm); border:1px solid var(--border-2);">
              <span class="text-dim text-xs">Template:</span>
              <select id="studio-template-select" class="form-select" style="background:transparent; color:var(--text); border:none; padding:2px 6px; font-size:0.85rem; font-weight:600;">
                <option value="static_flick" ${this.studioActiveTemplate === 'static_flick' ? 'selected' : ''}>Static Flick (Aim Lab/KovaaK's)</option>
                <option value="tracking_smooth" ${this.studioActiveTemplate === 'tracking_smooth' ? 'selected' : ''}>Smooth Tracking (Strafe)</option>
                <option value="tactical_peek" ${this.studioActiveTemplate === 'tactical_peek' ? 'selected' : ''}>Angle Peek Duel</option>
                <option value="retaliatory_duel" ${this.studioActiveTemplate === 'retaliatory_duel' ? 'selected' : ''}>Retaliatory Bot Skirmish</option>
              </select>
              <button class="btn btn-secondary btn-sm" id="btn-studio-template-new" style="padding:2px 8px; font-size:0.75rem;">Load</button>
            </div>

            <button class="btn btn-secondary btn-sm" id="btn-studio-import" title="Import from JSON file">📂 Import</button>
            <input type="file" id="input-studio-import" accept=".json" style="display:none;" />
            <button class="btn btn-secondary btn-sm" id="btn-studio-export" title="Export as JSON file">💾 Export</button>
            <button class="btn btn-primary btn-sm" id="btn-studio-preview">⚡ Preview</button>
            ${isExisting ? `
              <button class="btn btn-primary btn-sm" id="btn-studio-save">Update Drill</button>
              <button class="btn btn-secondary btn-sm" id="btn-studio-update-reset-pb" style="border-color:var(--gold); color:var(--gold);" title="Increment version and reset Personal Best">Update & Reset PB</button>
              <button class="btn btn-secondary btn-sm" id="btn-studio-save-new" title="Fork into a new independent drill">Save as New Drill</button>
            ` : `
              <button class="btn btn-primary btn-sm" id="btn-studio-save">SAVE DRILL</button>
            `}
            <button class="btn btn-secondary btn-sm" id="btn-studio-cancel">Cancel</button>
          </div>
        </div>

        ${this.studioErrors.length > 0 ? `
          <div style="background:rgba(255,70,85,0.15); border:1px solid var(--red); border-radius:var(--r-md); padding:12px 16px; margin-bottom:20px; color:var(--red);">
            <strong style="display:block; margin-bottom:4px;">Cannot save custom drill:</strong>
            ${this.studioErrors.map(err => `<div style="font-size:0.88rem;">&bull; ${this.escapeHtml(err)}</div>`).join('')}
          </div>
        ` : ''}

        <!-- 2-Column Split: Form (Left) & Live Inspector (Right) -->
        <div class="grid-2" style="align-items:start; gap:24px;">
          <!-- Left Column: Visual Editor Form -->
          <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- Card 1: Identity & General Parameters -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                1. GENERAL DRILL SPECIFICATION
              </h3>
              <div class="grid-2" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Drill Name <span style="color:var(--red);">*</span>
                  </label>
                  <input type="text" id="studio-name" class="form-input" value="${this.escapeHtml(s.name)}" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Category
                  </label>
                  <select id="studio-cat" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="flick" ${s.category === 'flick' ? 'selected' : ''}>Clicking / Flicking</option>
                    <option value="tracking" ${s.category === 'tracking' ? 'selected' : ''}>Tracking</option>
                    <option value="tactical" ${s.category === 'tactical' ? 'selected' : ''}>Tactical</option>
                    <option value="reaction" ${s.category === 'reaction' ? 'selected' : ''}>Reaction</option>
                    <option value="precision" ${s.category === 'precision' ? 'selected' : ''}>Precision</option>
                    <option value="switching" ${s.category === 'switching' ? 'selected' : ''}>Switching</option>
                    <option value="decision" ${s.category === 'decision' ? 'selected' : ''}>Decision Making</option>
                    <option value="movement" ${s.category === 'movement' ? 'selected' : ''}>Movement</option>
                    <option value="hybrid" ${s.category === 'hybrid' ? 'selected' : ''}>Hybrid</option>
                  </select>
                </div>
              </div>

              <div style="margin-bottom:12px;">
                <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                  Description
                </label>
                <input type="text" id="studio-desc" class="form-input" value="${this.escapeHtml(s.description || '')}" placeholder="What mechanics does this drill train?" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
              </div>

              <div class="grid-3" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Difficulty
                  </label>
                  <select id="studio-diff" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="beginner" ${s.difficulty === 'beginner' ? 'selected' : ''}>Beginner</option>
                    <option value="intermediate" ${s.difficulty === 'intermediate' ? 'selected' : ''}>Intermediate</option>
                    <option value="advanced" ${s.difficulty === 'advanced' ? 'selected' : ''}>Advanced</option>
                    <option value="pro" ${s.difficulty === 'pro' ? 'selected' : ''}>Pro</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Duration
                  </label>
                  <select id="studio-duration" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="15" ${s.durationSec === 15 ? 'selected' : ''}>15s (Quick Sprint)</option>
                    <option value="30" ${s.durationSec === 30 ? 'selected' : ''}>30s</option>
                    <option value="45" ${s.durationSec === 45 ? 'selected' : ''}>45s</option>
                    <option value="60" ${s.durationSec === 60 ? 'selected' : ''}>60s (Standard)</option>
                    <option value="90" ${s.durationSec === 90 ? 'selected' : ''}>90s</option>
                    <option value="120" ${s.durationSec === 120 ? 'selected' : ''}>120s (Endurance)</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Weapon
                  </label>
                  <select id="studio-weapon" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="vandal" ${weapon.preset === 'vandal' ? 'selected' : ''}>Vandal (Rifle)</option>
                    <option value="phantom" ${weapon.preset === 'phantom' ? 'selected' : ''}>Phantom (Rifle)</option>
                    <option value="sheriff" ${weapon.preset === 'sheriff' ? 'selected' : ''}>Sheriff (Pistol)</option>
                    <option value="operator" ${weapon.preset === 'operator' ? 'selected' : ''}>Operator (Sniper)</option>
                  </select>
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-require-cs" ${weapon.requireCounterStrafe ? 'checked' : ''} />
                  <span>Enforce Counter-Strafing (Penalize shooting while moving)</span>
                </label>
              </div>
            </div>

            <!-- Card 2: Spawner & Target Population -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                2. SPAWNER & TARGET POPULATION
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Spawn Mode
                  </label>
                  <select id="studio-spawn-mode" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="random_area" ${spawner.mode === 'random_area' ? 'selected' : ''}>Random Area</option>
                    <option value="grid" ${spawner.mode === 'grid' ? 'selected' : ''}>Grid</option>
                    <option value="peek" ${spawner.mode === 'peek' ? 'selected' : ''}>Cover Peek</option>
                    <option value="fixed_points" ${spawner.mode === 'fixed_points' ? 'selected' : ''}>Fixed Points</option>
                    <option value="wave" ${spawner.mode === 'wave' ? 'selected' : ''}>Wave</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Count (Max Alive)
                  </label>
                  <input type="number" id="studio-max-alive" min="1" max="10" value="${spawner.maxAlive}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Respawn Delay (ms)
                  </label>
                  <input type="number" id="studio-respawn-delay" min="0" max="2000" step="50" value="${spawner.respawnDelayMs ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Lifetime (sec, 0 = infinite)
                  </label>
                  <input type="number" id="studio-target-lifetime" min="0" max="10" step="0.1" value="${spawner.targetLifetimeSec ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Spawn Area Radius (meters)
                  </label>
                  <input type="number" id="studio-spawn-radius" min="4" max="30" step="1" value="${spawner.spawnRadius ?? 10}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-respawn-on-kill" ${spawner.respawnOnKill !== false ? 'checked' : ''} />
                  <span>Instant Respawn On Kill (Keeps continuous rhythm)</span>
                </label>
              </div>
            </div>

            <!-- Card 3: Target Model & Movement Physics -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                3. TARGET MODEL & MOVEMENT
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Shape
                  </label>
                  <select id="studio-target-shape" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="sphere" ${target.shape === 'sphere' ? 'selected' : ''}>Sphere (Aim Lab Standard)</option>
                    <option value="humanoid" ${target.shape === 'humanoid' ? 'selected' : ''}>Humanoid (Tactical Bot)</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Health (HP)
                  </label>
                  <input type="number" id="studio-target-hp" min="1" max="1000" value="${target.hp ?? 100}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Size Multiplier
                  </label>
                  <input type="number" id="studio-target-size" min="0.5" max="3.0" step="0.1" value="${target.sizeMultiplier ?? 1.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-3" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Movement Pattern
                  </label>
                  <select id="studio-movement-pattern" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="static" ${target.movementPattern === 'static' ? 'selected' : ''}>Static (Stationary)</option>
                    <option value="strafe" ${target.movementPattern === 'strafe' ? 'selected' : ''}>Tactical Strafe</option>
                    <option value="jiggle" ${target.movementPattern === 'jiggle' ? 'selected' : ''}>AD Jiggle Peek</option>
                    <option value="peek" ${target.movementPattern === 'peek' ? 'selected' : ''}>Cover Peek Out/In</option>
                    <option value="wander" ${target.movementPattern === 'wander' ? 'selected' : ''}>Wander / Dynamic</option>
                    <option value="vertical" ${target.movementPattern === 'vertical' ? 'selected' : ''}>Vertical Mobility</option>
                    <option value="variable" ${target.movementPattern === 'variable' ? 'selected' : ''}>Variable Rhythm</option>
                    <option value="wideswing" ${target.movementPattern === 'wideswing' ? 'selected' : ''}>Wide Swing</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Speed Multiplier
                  </label>
                  <input type="number" id="studio-speed-multiplier" min="0.0" max="3.0" step="0.1" value="${target.speedMultiplier ?? 0.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Fake Peek Chance
                  </label>
                  <input type="number" id="studio-fake-peek" min="0.0" max="1.0" step="0.05" value="${target.fakePeekChance ?? 0.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-head-level" ${target.headLevel ? 'checked' : ''} />
                  <span>Lock Targets to Valorant Crosshair Head-Level</span>
                </label>
              </div>
            </div>

            <!-- Card 4: Retaliatory Enemy Threat (Bot Defense) -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--red); border-bottom:1px solid var(--border); padding-bottom:6px;">
                4. RETALIATORY BOT & THREAT MECHANICS
              </h3>
              <div style="margin-bottom:12px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; font-weight:600;">
                  <input type="checkbox" id="studio-retaliation" ${target.retaliatory ? 'checked' : ''} />
                  <span>Enable Retaliatory Threat (Enemy bots fire back if not eliminated quickly)</span>
                </label>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Bot Reaction Time (ms)
                  </label>
                  <input type="number" id="studio-retaliate-delay" min="300" max="3000" step="50" value="${target.retaliateDelayMs ?? 800}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Firing Penalty (points deducted)
                  </label>
                  <input type="number" id="studio-retaliate-penalty" min="0" max="500" step="25" value="${target.retaliationPenalty ?? 200}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>
            </div>

            <!-- Card 5: Scoring Calibration -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--gold); border-bottom:1px solid var(--border); padding-bottom:6px;">
                5. SCORING CALIBRATION
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Base Hit Score
                  </label>
                  <input type="number" id="studio-score-hit" value="${scoring.baseHitScore ?? 100}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Headshot Bonus
                  </label>
                  <input type="number" id="studio-score-hs" value="${scoring.headshotBonus ?? 50}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Miss Penalty
                  </label>
                  <input type="number" id="studio-score-miss" value="${scoring.missPenalty ?? -25}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Speed Bonus Max
                  </label>
                  <input type="number" id="studio-score-speed-max" value="${scoring.speedBonusMax ?? 300}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Counter-Strafe Bonus
                  </label>
                  <input type="number" id="studio-score-cs" value="${scoring.counterStrafeBonus ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Live Inspector & Portable JSON -->
          <div style="position:sticky; top:20px; display:flex; flex-direction:column; gap:16px;">
            <div class="card" style="padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="font-size:1.05rem; margin:0;">LIVE DRILL INSPECTOR</h3>
                <span class="badge ${this.studioErrors.length === 0 ? 'badge-lime' : 'badge-red'}" id="studio-inspector-status">
                  ${this.studioErrors.length === 0 ? '✓ VALID SPEC' : '⚠️ ISSUES DETECTED'}
                </span>
              </div>

              <!-- Quick action buttons -->
              <button class="btn btn-primary btn-md w-full mb-10" id="btn-studio-inspector-preview">
                ⚡ TEST PLAY IN ARENA
              </button>
              <button class="btn btn-primary btn-md w-full mb-10" id="btn-studio-inspector-save">
                💾 ${isExisting ? 'UPDATE DRILL' : 'SAVE TO MY DRILLS'}
              </button>
              ${isExisting ? `
                <button class="btn btn-secondary btn-md w-full mb-10" id="btn-studio-inspector-update-reset-pb" style="border-color:var(--gold); color:var(--gold); font-size:0.85rem; font-weight:600;">
                  ⚡ UPDATE & RESET PB
                </button>
                <button class="btn btn-secondary btn-md w-full mb-16" id="btn-studio-inspector-save-new" style="font-size:0.85rem; font-weight:600;">
                  📑 SAVE AS NEW DRILL
                </button>
              ` : `
                <div class="mb-16"></div>
              `}

              <!-- Live KPI Badges -->
              <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px; background:var(--panel-2); padding:10px; border-radius:var(--r-sm); border:1px solid var(--border-2); font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Population:</span>
                  <strong id="studio-kpi-targets">${spawner.maxAlive} targets (${target.movementPattern})</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Weapon:</span>
                  <strong id="studio-kpi-weapon">${weapon.preset.toUpperCase()} ${weapon.requireCounterStrafe ? '(CS Enforced)' : ''}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Threat:</span>
                  <strong id="studio-kpi-threat" style="${target.retaliatory ? 'color:var(--status-danger);' : ''}">${target.retaliatory ? `⚠️ Return-Fire (${target.retaliateDelayMs}ms)` : 'Passive'}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Duration:</span>
                  <strong id="studio-kpi-duration">${s.durationSec}s</strong>
                </div>
              </div>

              <!-- JSON schema viewer -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="text-dim text-xs font-game">WARMUPLAB SCENARIO V1 JSON</span>
                <button class="btn btn-secondary btn-sm" id="btn-copy-json" style="padding:2px 8px; font-size:0.75rem;">📋 Copy</button>
              </div>
              <pre id="studio-json-preview" style="background:var(--surface-base); border:1px solid var(--border-medium); padding:12px; border-radius:var(--r-sm); font-size:0.78rem; font-family:var(--font-mono); max-height:440px; overflow-y:auto; color:var(--lime-primary); white-space:pre-wrap; word-break:break-all;">${this.escapeHtml(jsonStr)}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private attachCreatorStudioListeners(container: HTMLElement): void {
    const syncFromForm = (): void => {
      if (!this.editingScenario) return;

      const name = (container.querySelector('#studio-name') as HTMLInputElement)?.value.trim() ?? '';
      const desc = (container.querySelector('#studio-desc') as HTMLInputElement)?.value.trim() || '';
      const cat = (container.querySelector('#studio-cat') as HTMLSelectElement)?.value || 'flick';
      const diff = (container.querySelector('#studio-diff') as HTMLSelectElement)?.value as DifficultyId || 'intermediate';
      const dur = parseInt((container.querySelector('#studio-duration') as HTMLSelectElement)?.value || '60', 10);
      const weaponPreset = (container.querySelector('#studio-weapon') as HTMLSelectElement)?.value as any || 'vandal';
      const requireCS = (container.querySelector('#studio-require-cs') as HTMLInputElement)?.checked ?? false;

      const spawnMode = (container.querySelector('#studio-spawn-mode') as HTMLSelectElement)?.value as any || 'random_area';
      const maxAlive = parseInt((container.querySelector('#studio-max-alive') as HTMLInputElement)?.value || '1', 10);
      const respawnOnKill = (container.querySelector('#studio-respawn-on-kill') as HTMLInputElement)?.checked ?? true;
      const respawnDelay = parseInt((container.querySelector('#studio-respawn-delay') as HTMLInputElement)?.value || '0', 10);
      const targetLifetime = parseFloat((container.querySelector('#studio-target-lifetime') as HTMLInputElement)?.value || '0');
      const spawnRadius = parseFloat((container.querySelector('#studio-spawn-radius') as HTMLInputElement)?.value || '10');

      const targetShape = (container.querySelector('#studio-target-shape') as HTMLSelectElement)?.value as any || 'sphere';
      const targetHp = parseInt((container.querySelector('#studio-target-hp') as HTMLInputElement)?.value || '100', 10);
      const targetSize = parseFloat((container.querySelector('#studio-target-size') as HTMLInputElement)?.value || '1.0');
      const movePattern = (container.querySelector('#studio-movement-pattern') as HTMLSelectElement)?.value as any || 'static';
      const speedMult = parseFloat((container.querySelector('#studio-speed-multiplier') as HTMLInputElement)?.value || '0.0');
      const headLevel = (container.querySelector('#studio-head-level') as HTMLInputElement)?.checked ?? false;
      const fakePeek = parseFloat((container.querySelector('#studio-fake-peek') as HTMLInputElement)?.value || '0.0');

      const retaliatory = (container.querySelector('#studio-retaliation') as HTMLInputElement)?.checked ?? false;
      const retaliateDelay = parseInt((container.querySelector('#studio-retaliate-delay') as HTMLInputElement)?.value || '800', 10);
      const retaliatePenalty = parseInt((container.querySelector('#studio-retaliate-penalty') as HTMLInputElement)?.value || '200', 10);

      const baseHit = parseInt((container.querySelector('#studio-score-hit') as HTMLInputElement)?.value || '100', 10);
      const hsBonus = parseInt((container.querySelector('#studio-score-hs') as HTMLInputElement)?.value || '50', 10);
      const missPenalty = parseInt((container.querySelector('#studio-score-miss') as HTMLInputElement)?.value || '-25', 10);
      const speedMax = parseInt((container.querySelector('#studio-score-speed-max') as HTMLInputElement)?.value || '300', 10);
      const csBonus = parseInt((container.querySelector('#studio-score-cs') as HTMLInputElement)?.value || '0', 10);

      this.editingScenario = {
        ...this.editingScenario,
        name,
        description: desc,
        category: cat as any,
        difficulty: diff,
        durationSec: dur,
        weapon: {
          ...this.editingScenario.weapon,
          preset: weaponPreset,
          requireCounterStrafe: requireCS,
        },
        spawner: {
          ...this.editingScenario.spawner,
          mode: spawnMode,
          maxAlive,
          initialTargetCount: maxAlive,
          respawnOnKill,
          respawnDelayMs: respawnDelay,
          targetLifetimeSec: targetLifetime > 0 ? targetLifetime : undefined,
          spawnRadius,
        },
        target: {
          ...this.editingScenario.target,
          shape: targetShape,
          hp: targetHp,
          sizeMultiplier: targetSize,
          movementPattern: movePattern,
          speedMultiplier: speedMult,
          headLevel,
          fakePeekChance: fakePeek > 0 ? fakePeek : undefined,
          retaliatory,
          retaliateDelayMs: retaliateDelay,
          retaliationPenalty: retaliatePenalty,
        },
        scoring: {
          ...this.editingScenario.scoring,
          baseHitScore: baseHit,
          headshotBonus: hsBonus,
          missPenalty,
          speedBonusMax: speedMax,
          counterStrafeBonus: csBonus,
        },
        metadata: {
          ...this.editingScenario.metadata,
          updatedAt: Date.now(),
        },
      };

      this.updateStudioLiveInspector(container);
    };

    // Attach input listeners across all controls
    container.querySelectorAll('input, select').forEach(el => {
      if (el.id === 'studio-template-select' || el.id === 'input-studio-import') return;
      el.addEventListener('input', syncFromForm);
      el.addEventListener('change', syncFromForm);
    });

    // Template Selector + Load Button
    container.querySelector('#btn-studio-template-new')?.addEventListener('click', () => {
      const select = container.querySelector('#studio-template-select') as HTMLSelectElement | null;
      const tmpl = select?.value || 'static_flick';
      this.studioActiveTemplate = tmpl;
      this.editingScenario = createDefaultCustomScenario(tmpl);
      this.studioErrors = [];
      this.renderPage('creator');
      this.showToast(`Loaded ${tmpl.replace('_', ' ')} template`, 'info');
    });

    // Import JSON File
    const importInput = container.querySelector('#input-studio-import') as HTMLInputElement | null;
    container.querySelector('#btn-studio-import')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          const val = validateCustomScenarioJSON(parsed);
          if (!val.valid) {
            this.studioErrors = val.errors;
            this.showToast('Invalid drill JSON specification', 'error');
            this.renderPage('creator');
            return;
          }
          this.editingScenario = parsed as WarmupLabScenarioV1;
          this.studioErrors = [];
          this.showToast(`Imported "${this.editingScenario.name}" successfully!`, 'success');
          this.renderPage('creator');
        } catch (err: any) {
          this.studioErrors = [`Failed to parse JSON file: ${err.message}`];
          this.showToast('JSON parse error', 'error');
          this.renderPage('creator');
        }
      };
      reader.readAsText(file);
    });

    // Export JSON File
    container.querySelector('#btn-studio-export')?.addEventListener('click', () => {
      syncFromForm();
      if (!this.editingScenario) return;
      const blob = new Blob([JSON.stringify(this.editingScenario, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.editingScenario.id}.warmuplab.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Exported "${this.editingScenario.name}"`, 'success');
    });

    // Copy JSON to clipboard
    container.querySelector('#btn-copy-json')?.addEventListener('click', () => {
      syncFromForm();
      if (!this.editingScenario) return;
      navigator.clipboard?.writeText(JSON.stringify(this.editingScenario, null, 2));
      this.showToast('JSON copied to clipboard!', 'info');
    });

    // Preview in Arena (from header or inspector card)
    const handlePreview = () => {
      syncFromForm();
      if (!this.editingScenario) return;
      const val = validateCustomScenarioJSON(this.editingScenario);
      if (!val.valid) {
        this.studioErrors = val.errors;
        this.renderPage('creator');
        return;
      }
      const config = convertCustomScenarioToConfig(this.editingScenario);
      this.launchCustomPreview(config);
    };

    container.querySelector('#btn-studio-preview')?.addEventListener('click', handlePreview);
    container.querySelector('#btn-studio-inspector-preview')?.addEventListener('click', handlePreview);

    // Save Drill (from header or inspector card)
    const handleSave = async () => {
      syncFromForm();
      if (!this.editingScenario) return;
      const val = validateCustomScenarioJSON(this.editingScenario);
      if (!val.valid) {
        this.studioErrors = val.errors;
        this.renderPage('creator');
        return;
      }
      await this.engine.store.saveCustomScenario(this.editingScenario);
      this.showToast(`Custom drill "${this.editingScenario.name}" saved!`, 'success');
      this.editingScenario = null;
      this.navigateTo('scenarios');
    };

    container.querySelector('#btn-studio-save')?.addEventListener('click', handleSave);
    container.querySelector('#btn-studio-inspector-save')?.addEventListener('click', handleSave);

    // Save as New Drill (Fork into independent custom drill)
    const handleSaveAsNew = async () => {
      syncFromForm();
      if (!this.editingScenario) return;
      const val = validateCustomScenarioJSON(this.editingScenario);
      if (!val.valid) {
        this.studioErrors = val.errors;
        this.renderPage('creator');
        return;
      }
      const res = this.engine.store.saveAsNewCustomScenario(this.editingScenario);
      if (!res.success) {
        this.studioErrors = res.errors || ['Failed to fork scenario'];
        this.renderPage('creator');
        return;
      }
      this.showToast(`Saved as new drill "${res.scenario?.name}"!`, 'success');
      this.editingScenario = null;
      this.navigateTo('scenarios');
    };

    container.querySelector('#btn-studio-save-new')?.addEventListener('click', handleSaveAsNew);
    container.querySelector('#btn-studio-inspector-save-new')?.addEventListener('click', handleSaveAsNew);

    // Update & Reset PB (Increment configVersion & clear PB)
    const handleUpdateResetPB = async () => {
      syncFromForm();
      if (!this.editingScenario) return;
      const val = validateCustomScenarioJSON(this.editingScenario);
      if (!val.valid) {
        this.studioErrors = val.errors;
        this.renderPage('creator');
        return;
      }

      const curVersion = this.editingScenario.metadata?.configVersion || 1;
      const nextVersion = curVersion + 1;
      const drillName = this.editingScenario.name || 'Custom Drill';

      const confirmed = window.confirm(
        `Update "${drillName}" and Reset Personal Best?\n\n` +
        `• Version will increment from v${curVersion} to v${nextVersion}.\n` +
        `• Current PB for this scenario will be reset.\n` +
        `• Historical sessions remain preserved in your log.\n` +
        `• Unrelated custom drills and built-in PBs are not affected.\n\n` +
        `Proceed with update and PB reset?`
      );

      if (!confirmed) return;

      await this.engine.store.saveCustomScenario(this.editingScenario, {
        resetPB: true,
        incrementVersion: true,
      });

      this.showToast(`Updated "${drillName}" to v${nextVersion} and reset PB!`, 'pb');
      this.editingScenario = null;
      this.navigateTo('scenarios');
    };

    container.querySelector('#btn-studio-update-reset-pb')?.addEventListener('click', handleUpdateResetPB);
    container.querySelector('#btn-studio-inspector-update-reset-pb')?.addEventListener('click', handleUpdateResetPB);

    // Cancel Button
    container.querySelector('#btn-studio-cancel')?.addEventListener('click', () => {
      this.editingScenario = null;
      this.navigateTo('scenarios');
    });
  }

  private updateStudioLiveInspector(container: HTMLElement): void {
    if (!this.editingScenario) return;
    const s = this.editingScenario;
    const weapon = s.weapon ?? { preset: 'vandal' as const, requireCounterStrafe: false };
    const jsonStr = JSON.stringify(s, null, 2);

    const pre = container.querySelector('#studio-json-preview');
    if (pre) pre.textContent = jsonStr;

    const val = validateCustomScenarioJSON(s);
    const statusPill = container.querySelector('#studio-inspector-status');
    if (statusPill) {
      statusPill.className = `badge ${val.valid ? 'badge-teal' : 'badge-red'}`;
      statusPill.textContent = val.valid ? '✓ VALID SPEC' : '⚠️ ISSUES DETECTED';
    }

    const kpiTargets = container.querySelector('#studio-kpi-targets');
    if (kpiTargets) kpiTargets.textContent = `${s.spawner.maxAlive} targets (${s.target.movementPattern})`;

    const kpiWeapon = container.querySelector('#studio-kpi-weapon');
    if (kpiWeapon) kpiWeapon.textContent = `${weapon.preset.toUpperCase()} ${weapon.requireCounterStrafe ? '(CS Enforced)' : ''}`;

    const kpiThreat = container.querySelector('#studio-kpi-threat') as HTMLElement | null;
    if (kpiThreat) {
      kpiThreat.textContent = s.target.retaliatory ? `⚠️ Return-Fire (${s.target.retaliateDelayMs}ms)` : 'Passive';
      kpiThreat.style.color = s.target.retaliatory ? 'var(--red)' : '';
    }

    const kpiDuration = container.querySelector('#studio-kpi-duration');
    if (kpiDuration) kpiDuration.textContent = `${s.durationSec}s`;
  }

  launchCustomPreview(scenarioConfig: ScenarioConfig): void {
    this.canvas.classList.add('visible');
    this.hudEl.classList.add('visible');
    this.resultOverlay.classList.remove('visible');

    this.engine.audio.init();
    this.engine.startScenario(scenarioConfig);

    this.engine.controls.lock();

    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      pageContainer.style.display = 'none';
    }
  }

  showToast(message: string, type: 'success' | 'info' | 'pb' | 'error' = 'info'): void {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  dispose(): void {
    this.clearRoutineTimers();
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    if (this.flashTransitionTimeout) {
      clearTimeout(this.flashTransitionTimeout);
      this.flashTransitionTimeout = null;
    }
    if (this.movementWarningTimeout) {
      clearTimeout(this.movementWarningTimeout);
      this.movementWarningTimeout = null;
    }
    if (this.threatTimeout) {
      clearTimeout(this.threatTimeout);
      this.threatTimeout = null;
    }
    if (this.windowKeyHandler) {
      window.removeEventListener('keydown', this.windowKeyHandler);
      this.windowKeyHandler = null;
    }
    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }
  }
}
