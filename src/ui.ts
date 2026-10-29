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
} from './types';
import {
  getAllSoundProfiles,
  getSoundProfile,
} from './soundProfiles';
import { calculateRoutineReactionSummary } from './analytics';
import { generateRecommendation } from './recommendations';

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
      <nav class="nav">
        <a href="#" class="nav-logo" data-page="home">VALO <span>WARMUP</span></a>
        <div class="nav-link active" data-page="home">Home</div>
        <div class="nav-link" data-page="scenarios">Scenarios</div>
        <div class="nav-link" data-page="plans">Warm-Up Plans</div>
        <div class="nav-link" data-page="stats">Statistics</div>
        <div class="nav-link" data-page="settings">Settings</div>
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

      <!-- Pointer Lock Overlay -->
      <div id="lock-overlay">
        <h2>CLICK TO ENTER ARENA</h2>
        <p>Your mouse will be locked for precision 3D aim training.<br>Press <strong>ESC</strong> at any time to exit or pause.</p>
        <button class="btn btn-primary btn-lg" id="btn-lock-confirm">RESUME TRAINING</button>
      </div>

      <!-- Results Overlay -->
      <div id="result-overlay">
        <div id="result-modal-content" style="max-width:680px; width:90%; background:var(--panel); border:1px solid var(--border-2); border-radius:var(--r-xl); padding:36px; box-shadow:0 12px 48px rgba(0,0,0,0.6); text-align:center;">
          <!-- Dynamically populated -->
        </div>
      </div>

      <!-- Toast container -->
      <div id="toast-container"></div>
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

    // ESC key to stop session or exit result screen cleanly
    this.windowKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
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
          <div class="badge badge-red font-game">VALORANT-SPECIFIC AIM TRAINER</div>
          <h1 class="hero-title">ELEVATE YOUR <span class="accent">CROSSHAIR</span> MASTERY</h1>
          <p class="hero-sub">
            Warm up your flicks, micro-adjustments, strafe tracking, and counter-strafing in a dedicated 3D arena built for tactical shooter mechanics.
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" id="btn-hero-play">START QUICK WARM-UP</button>
            <button class="btn btn-secondary btn-lg" id="btn-hero-browse">BROWSE SCENARIOS</button>
          </div>
        </section>

        <!-- Quick Warm-Up Routines Grid -->
        <div class="section-header mt-32">
          <h2>RECOMMENDED WARM-UP ROUTINES</h2>
          <span class="section-sub">Curated routines designed for quick match readiness</span>
        </div>
        <div class="grid-3">
          ${TRAINING_ROUTINES.map(r => {
            const activeMin = Math.round((r.activeDurationSec ?? (r.totalDurationSec ?? getRoutineDuration(r))) / 60);
            const totalMin = Math.floor((r.totalElapsedSec ?? r.totalDurationSec) / 60);
            const totalSec = (r.totalElapsedSec ?? r.totalDurationSec) % 60;
            const badgeLabel = `${activeMin} Min Active (${totalMin}m ${totalSec.toString().padStart(2, '0')}s Total)`;
            return `
              <div class="card scenario-card" data-routine="${r.id}">
                <div class="badge badge-teal">${badgeLabel}</div>
                <div class="scenario-card-title mt-8">${r.name}</div>
                <p class="scenario-card-desc">${r.description}</p>
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
                    <div class="font-game font-bold text-teal" style="font-size:1.3rem;">${s.score.toLocaleString()}</div>
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
    container.querySelector('#btn-hero-play')?.addEventListener('click', () => {
      this.launchScenario('flick-static');
    });

    container.querySelector('#btn-hero-browse')?.addEventListener('click', () => {
      this.navigateTo('scenarios');
    });

    container.querySelectorAll('[data-routine]').forEach(el => {
      el.addEventListener('click', () => {
        const rId = (el as HTMLElement).dataset.routine;
        const routine = TRAINING_ROUTINES.find(r => r.id === rId);
        if (routine) {
          this.startRoutine(routine);
        }
      });
    });
  }

  private renderScenariosHTML(): string {
    const categories = [
      { id: 'all', label: 'All Categories' },
      { id: 'flick', label: 'Flicks' },
      { id: 'tracking', label: 'Tracking' },
      { id: 'tactical', label: 'Valorant Tactical' },
      { id: 'flash', label: 'Flash Recovery' },
      { id: 'reaction', label: 'Reaction Time' },
      { id: 'hybrid', label: 'Hybrid' },
    ];

    const filtered = this.selectedCategory === 'all'
      ? SCENARIOS
      : SCENARIOS.filter(s => s.category === this.selectedCategory);

    return `
      <div class="page-inner">
        <div class="section-header">
          <h2>TRAINING SCENARIOS</h2>
          <span class="section-sub">Choose a specialized exercise targeting your aim weaknesses</span>
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
          ${filtered.map(s => {
            const pb = this.engine.store.getPB(s.id);
            return `
              <div class="card scenario-card" data-scen="${s.id}">
                <div class="scenario-card-meta">
                  <span class="badge badge-red">${s.category}</span>
                  <span class="badge badge-teal">${s.difficulty}</span>
                  <span class="badge badge-gold">${s.durationSec}s</span>
                </div>
                <div class="scenario-card-title">${s.name}</div>
                <p class="scenario-card-desc">${s.description}</p>
                <div class="text-dim text-sm mb-8"><strong>Skill:</strong> ${s.skill}</div>
                <div class="scenario-card-pb">
                  <span class="pb-label">Personal Best</span>
                  <span class="pb-value">${pb ? pb.score.toLocaleString() : '—'}</span>
                </div>
                <button class="btn btn-primary btn-sm w-full mt-16">PLAY SCENARIO</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private attachScenariosListeners(container: HTMLElement): void {
    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedCategory = (btn as HTMLElement).dataset.cat ?? 'all';
        this.renderPage('scenarios');
      });
    });

    container.querySelectorAll('[data-scen]').forEach(card => {
      card.addEventListener('click', () => {
        const scenId = (card as HTMLElement).dataset.scen;
        if (scenId) this.launchScenario(scenId);
      });
    });
  }

  private renderPlansHTML(): string {
    return `
      <div class="page-inner">
        <div class="section-header">
          <h2>STRUCTURED WARM-UP ROUTINES</h2>
          <span class="section-sub">Play through sequential scenario playlists with automatic transitions</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:20px;">
          ${TRAINING_ROUTINES.map(r => {
            const activeMin = Math.round((r.activeDurationSec ?? (r.totalDurationSec ?? getRoutineDuration(r))) / 60);
            const totalMin = Math.floor((r.totalElapsedSec ?? r.totalDurationSec) / 60);
            const totalSec = (r.totalElapsedSec ?? r.totalDurationSec) % 60;
            const badgeLabel = `${activeMin} Min Active (${totalMin}m ${totalSec.toString().padStart(2, '0')}s Total)`;

            return `
              <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap;">
                <div style="flex:1; min-width:280px;">
                  <div class="badge badge-teal font-game mb-8">${badgeLabel}</div>
                  <h3>${r.name}</h3>
                  <p class="text-dim text-sm mt-8">${r.description}</p>
                  <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
                    ${r.scenarioIds.map(sid => {
                      const sc = getScenarioById(sid);
                      return `<span class="badge badge-gold">${sc?.name ?? sid}</span>`;
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
                  <button class="btn btn-primary btn-lg" data-plan-id="${r.id}">START ROUTINE</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private attachPlansListeners(container: HTMLElement): void {
    container.querySelectorAll('[data-plan-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.planId;
        const routine = TRAINING_ROUTINES.find(r => r.id === id);
        const selectEl = container.querySelector(`[data-routine-select="${id}"]`) as HTMLSelectElement | null;
        const difficulty = (selectEl?.value as DifficultyId) || 'intermediate';
        if (routine) this.startRoutine(routine, difficulty);
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
    const aDelta = trend.accuracyDelta ?? 0;
    const hsDelta = trend.headshotDelta ?? 0;

    const sClass = sDelta > 0 ? 'trend-up' : (sDelta < 0 ? 'trend-down' : 'trend-neutral');
    const aClass = aDelta > 0 ? 'trend-up' : (aDelta < 0 ? 'trend-down' : 'trend-neutral');
    const hsClass = hsDelta > 0 ? 'trend-up' : (hsDelta < 0 ? 'trend-down' : 'trend-neutral');

    const sSign = sDelta > 0 ? '+' : '';
    const aSign = aDelta > 0 ? '+' : '';
    const hsSign = hsDelta > 0 ? '+' : '';

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
              ${sSign}${sDelta.toLocaleString()}
            </div>
            <span class="text-dim text-xs">${trend.latest?.score.toLocaleString()} vs ${trend.previous?.score.toLocaleString()}</span>
          </div>

          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Accuracy Delta</span>
            <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${aClass}">
              ${aSign}${aDelta.toFixed(1)}%
            </div>
            <span class="text-dim text-xs">${trend.latest?.accuracy.toFixed(1)}% vs ${trend.previous?.accuracy.toFixed(1)}%</span>
          </div>

          <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
            <span class="text-dim text-xs uppercase" style="display:block;">Headshot Rate Delta</span>
            <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${hsClass}">
              ${hsSign}${hsDelta.toFixed(1)}%
            </div>
            <span class="text-dim text-xs">Latest vs previous</span>
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
    `;
  }

  private renderSkillBarHTML(dim: SkillDimensionEvaluation): string {
    const hasData = dim.sampleCount > 0;
    const scoreColor = dim.isDeficit
      ? 'var(--red)'
      : (dim.score < dim.benchmark ? 'var(--gold)' : 'var(--teal)');
    const barClass = dim.isDeficit
      ? 'red'
      : (dim.score < dim.benchmark ? 'gold' : 'teal');

    const badgeHTML = !hasData
      ? `<span class="badge badge-dim font-game">UNTESTED</span>`
      : (dim.isDeficit
        ? `<span class="badge badge-red font-game">DEFICIT</span>`
        : (dim.sampleCount < 2
          ? `<span class="badge badge-gold font-game">PRELIMINARY</span>`
          : `<span class="badge badge-teal font-game">ON TARGET</span>`));

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
        : `<span class="badge badge-teal font-game">MAINTENANCE & PROGRESSION</span>`);

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
        <div style="background:var(--bg-2); border-left:4px solid ${rec.isColdStart ? 'var(--gold)' : (rec.primaryDimension ? 'var(--red)' : 'var(--teal)')}; border-radius:0 var(--r-md) var(--r-md) 0; padding:16px 20px; margin-bottom:24px;">
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
              <span class="badge ${rec.confidence >= 0.5 ? 'badge-teal' : 'badge-gold'}" style="font-size:0.75rem;">
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
    const sessions = this.engine.store.getRecentSessions(20);
    const routineSummaries = this.engine.store.getRoutineSummaries(10);
    const bestScenarios = this.engine.store.getBestPerformingScenarios(5);
    const allSessions = this.engine.store.getSessions(undefined, 50);
    const preferredDifficulty = allSessions[0]?.difficulty || 'intermediate';
    const rec = generateRecommendation(allSessions, preferredDifficulty);

    if (agg.totalDrills === 0 && agg.totalRoutines === 0) {
      return `
        <div class="page-inner">
          <div class="section-header">
            <h2>TRAINING PROGRESS DASHBOARD</h2>
            <span class="section-sub">Comprehensive aim analytics, consistency metrics, and personal records</span>
          </div>

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
            <div class="stat-value text-red">${agg.totalDrills}</div>
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
                <span style="font-weight:700; color:var(--teal); font-family:var(--font-game);">${pbList.length}</span>
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
                <span style="font-weight:700; color:var(--teal); font-family:var(--font-game);">${recentStats.avgScore.toLocaleString()}</span>
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
            <div style="overflow-x:auto;">
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
            <div style="overflow-x:auto;">
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

        <!-- Recent Session History -->
        <div class="card">
          <h3 class="mb-16">RECENT DRILL SESSIONS (LATEST 20)</h3>
          ${sessions.length === 0 ? `
            <p class="text-dim text-sm">No session logs available.</p>
          ` : `
            <div style="overflow-x:auto;">
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
                  ${sessions.map(s => {
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
          `}
        </div>
      </div>
    `;
  }

  private attachStatsListeners(container: HTMLElement): void {
    const allSessions = this.engine.store.getSessions(undefined, 50);
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
              <span class="badge badge-teal font-game" id="profile-badge">${activeProfile.badgeLabel}</span>
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

  launchScenario(scenarioId: string, customDifficulty?: DifficultyId): void {
    const config = getScenarioById(scenarioId);
    if (!config) return;

    // Show canvas & HUD
    this.canvas.classList.add('visible');
    this.hudEl.classList.add('visible');
    this.resultOverlay.classList.remove('visible');

    // Hide UI page
    document.getElementById('page-container')!.style.display = 'none';

    // Start engine
    this.engine.audio.init();
    this.engine.startScenario(config, customDifficulty);

    // Request pointer lock
    this.engine.controls.lock();
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

  startRoutine(
    routine: TrainingRoutine,
    difficulty: DifficultyId = 'intermediate'
  ): void {
    this.clearRoutineTimers();

    const activeSec = routine.activeDurationSec ?? (routine.totalDurationSec ?? getRoutineDuration(routine as any));
    const expectedElapsedSec = routine.totalElapsedSec ?? (activeSec + Math.max(0, routine.scenarioIds.length - 1) * ROUTINE_TRANSITION_SEC);

    this.activeRoutine = {
      id: routine.id,
      name: routine.name,
      durationLabel: routine.durationLabel ?? '',
      totalDurationSec: activeSec,
      activeDurationSec: activeSec,
      expectedElapsedSec,
      difficulty,
      scenarioIds: [...routine.scenarioIds],
      currentIndex: 0,
      retriesCount: 0,
      routineStartTime: this.clock.now(),
      currentDrillStartTime: this.clock.now(),
      totalPausedMs: 0,
      pauseStartTimestamp: 0,
      results: [],
      isAdvancing: false,
    };

    if (this.activeRoutine.scenarioIds.length > 0) {
      this.launchScenario(this.activeRoutine.scenarioIds[0], this.activeRoutine.difficulty);
    }
  }

  advanceRoutine(): void {
    if (!this.activeRoutine) return;
    if (this.activeRoutine.isAdvancing) return;
    this.activeRoutine.isAdvancing = true;

    this.clearRoutineTimers();

    this.activeRoutine.currentIndex++;
    this.activeRoutine.currentDrillStartTime = this.clock.now();
    const nextId = this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
    this.resultOverlay.classList.remove('visible');

    if (nextId) {
      this.launchScenario(nextId, this.activeRoutine.difficulty);
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

    const allSessions = this.engine.store.getSessions(undefined, 50);
    const rec = generateRecommendation(allSessions, result.difficulty);

    content.innerHTML = `
      ${isPB ? `
        <div style="background:rgba(245,197,24,0.15); border:1px solid var(--gold); border-radius:var(--r-md); padding:10px 20px; color:var(--gold); font-family:var(--font-game); font-weight:700; font-size:1.4rem; letter-spacing:0.06em; margin-bottom:20px; animation:pulse-gold 1s infinite alternate;">
          🏆 NEW PERSONAL BEST!
        </div>
      ` : ''}

      ${isInRoutine ? `
        <div style="background:rgba(0,255,200,0.1); border:1px solid var(--teal); border-radius:var(--r-md); padding:8px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-family:var(--font-game); font-weight:700; color:var(--teal);">ROUTINE: ${this.activeRoutine!.name.toUpperCase()}</span>
          <span class="badge badge-teal font-game">DRILL ${routineCurrentDrill} OF ${routineTotalDrills}</span>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:center; gap:8px; margin-bottom:8px;">
        <span class="badge badge-teal font-game">${result.category.toUpperCase()}</span>
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
          <div class="stat-value text-teal" style="font-size:2.0rem;">${accVal}</div>
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
      </div>

      ${(result.shotsMoving !== undefined || result.shotsStationary !== undefined) ? `
        <div style="display:flex; justify-content:center; gap:20px; font-size:0.85rem; color:var(--text-dim); margin-bottom:20px;">
          <span>Stationary Shots: <strong style="color:var(--text);">${result.shotsStationary ?? 0}</strong></span>
          <span>Moving Shots: <strong style="color:var(--text);">${result.shotsMoving ?? 0}</strong></span>
        </div>
      ` : ''}

      ${(meaningfulTracking && result.timeOnTarget !== undefined) ? `
        <div style="font-size:0.9rem; color:var(--teal); margin-bottom:20px;">
          Time on Target: <strong>${result.timeOnTarget.toFixed(1)}%</strong>
        </div>
      ` : ''}

      ${isInRoutine && nextDrillConfig ? `
        <div style="background:var(--panel-2); border-left:3px solid var(--teal); padding:10px 16px; margin-bottom:20px; text-align:left; border-radius:0 var(--r-sm) var(--r-sm) 0;">
          <div class="text-dim text-sm" style="margin-bottom:2px;">NEXT DRILL:</div>
          <div style="font-weight:700; color:var(--text);">${nextDrillConfig.name} <span class="badge badge-gold" style="margin-left:6px;">${nextDrillConfig.skill}</span></div>
          <div id="routine-countdown-text" style="font-size:0.85rem; color:var(--teal); margin-top:4px;">Starting next drill in 4s...</div>
        </div>
      ` : ''}

      ${!isInRoutine ? `
        <div class="card mb-20" style="background:var(--panel-2); border:1px solid var(--border-2); padding:16px; text-align:left; border-radius:var(--r-md);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <div style="font-family:var(--font-game); font-weight:700; color:var(--teal); font-size:1.1rem;">
              🧠 NEXT TRAINING STEP: ${rec.recommendedScenarioName ? rec.recommendedScenarioName.toUpperCase() : (rec.recommendedRoutineName ? rec.recommendedRoutineName.toUpperCase() : rec.title.toUpperCase())}
            </div>
            <span class="badge ${rec.isColdStart ? 'badge-gold' : (rec.primaryDimension ? 'badge-red' : 'badge-teal')} font-game">
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
            <button class="btn btn-primary btn-sm" id="btn-res-rec-launch" style="background:var(--teal); border-color:var(--teal); font-weight:700;">
              ⚡ LAUNCH ${rec.recommendationType === 'routine' ? 'ROUTINE' : 'DRILL'} &rarr;
            </button>
          </div>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="btn-res-retry">${isInRoutine ? 'RETRY DRILL' : 'PLAY AGAIN'}</button>
        ${isInRoutine ? `
          <button class="btn btn-primary btn-lg" id="btn-res-next" style="background:var(--teal); border-color:var(--teal);">NEXT DRILL &rarr;</button>
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
        const currId = this.activeRoutine.scenarioIds[this.activeRoutine.currentIndex];
        this.launchScenario(currId, this.activeRoutine.difficulty);
      } else {
        const diff = result.difficulty;
        this.launchScenario(result.scenarioId, diff);
      }
    });

    if (isInRoutine) {
      content.querySelector('#btn-res-next')?.addEventListener('click', () => {
        this.advanceRoutine();
      });

      // Clearable auto-transition timer using injectable clock
      let remainingSec = ROUTINE_TRANSITION_SEC;
      const countdownEl = content.querySelector('#routine-countdown-text');
      const routineSession = this.activeRoutine;
      const transitionToken = ++this.routineTransitionToken;

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
      }, ROUTINE_TRANSITION_SEC * 1000);
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
    const completedResults = routine.results;
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
      drillsCompleted: completedResults.length,
      totalDrills: routine.scenarioIds.length,
      totalScore,
      overallAccuracy: overallAcc,
      totalHits,
      totalHeadshots,
      totalShotsFired: totalShots,
      avgReactionMs: reactionSummary.weightedAvgReactionMs > 0 ? reactionSummary.weightedAvgReactionMs : undefined,
    };

    this.engine.store.addRoutineSummary(summary);

    const content = document.getElementById('result-modal-content')!;
    content.innerHTML = `
      <div style="background:rgba(0,255,136,0.15); border:1px solid var(--green); border-radius:var(--r-md); padding:12px 20px; color:var(--green); font-family:var(--font-game); font-weight:700; font-size:1.5rem; letter-spacing:0.06em; margin-bottom:16px;">
        🏆 WARM-UP ROUTINE COMPLETE!
      </div>

      <div style="display:flex; justify-content:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <span class="badge badge-teal font-game">${routine.name.toUpperCase()}</span>
        <span class="badge badge-red font-game">${routine.difficulty.toUpperCase()}</span>
        <span class="badge badge-gold font-game">${completedResults.length}/${routine.scenarioIds.length} DRILLS FINISHED</span>
        <span class="badge badge-teal font-game">${Math.floor(activeTrainingSec / 60)}m ${activeTrainingSec % 60}s ACTIVE</span>
        <span class="badge badge-gold font-game">${Math.floor(totalElapsedSec / 60)}m ${totalElapsedSec % 60}s TOTAL ELAPSED</span>
      </div>

      <h2 style="font-size:2.2rem; margin:6px 0 20px;">Routine Summary</h2>

      <!-- Primary Aggregates -->
      <div class="grid-4 mb-24">
        <div class="card" style="padding:14px;">
          <div class="stat-value text-gold" style="font-size:2.0rem;">${totalScore.toLocaleString()}</div>
          <div class="stat-label">Total Score</div>
        </div>
        <div class="card" style="padding:14px;">
          <div class="stat-value text-teal" style="font-size:2.0rem;">${overallAcc.toFixed(1)}%</div>
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

  showToast(message: string, type: 'success' | 'info' | 'pb' = 'info'): void {
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
