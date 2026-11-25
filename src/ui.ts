// =====================================================================
// ui.ts — Professional Esports UI, HUD, Routing & Pages
// =====================================================================

import type { Engine, EngineHUDState } from './engine';
import { escapeHtml } from './utils';
import {
  renderSettingsHTML as renderSettingsViewHTML,
  attachSettingsListeners as attachSettingsViewListeners,
} from './views/settingsView';
import {
  renderResultModalHTML,
  renderRoutineCompletionHTML,
  attachResultModalListeners,
  attachRoutineCompletionListeners,
} from './views/resultsView';
import {
  renderScenariosHTML as renderScenariosViewHTML,
  attachScenariosListeners as attachScenariosViewListeners,
} from './views/scenarioBrowserView';
import {
  renderHUDHTML,
  renderMarkersAndOverlaysHTML,
  HUDView,
} from './views/hudView';
import {
  renderStatsHTML as renderStatsViewHTML,
  attachStatsListeners as attachStatsViewListeners,
  generateSparklineSVG,
} from './views/statsView';
export { generateSparklineSVG };
import {
  renderPlansHTML as renderPlansViewHTML,
  attachPlansListeners as attachPlansViewListeners,
} from './views/playlistView';
import {
  renderCreatorStudioHTML as renderCreatorStudioViewHTML,
  attachCreatorStudioListeners as attachCreatorStudioViewListeners,
} from './views/creatorStudioView';
import {
  TRAINING_ROUTINES,
  getScenarioById,
  getRoutineDuration,
  ROUTINE_TRANSITION_SEC,
} from './scenarios';
import { createDefaultCustomScenario } from './scenarioConfig';
import type {
  PageId,
  SessionResult,
  Settings,
  DifficultyId,
  TrainingRoutine,
  RoutineSummary,
  RecommendationResult,
  Playlist,
  PlaylistEntry,
  ScenarioConfig,
  WarmupLabScenarioV1,
} from './types';
import { calculateRoutineReactionSummary } from './analytics';
import { generateRecommendation } from './recommendations';
import {
  calculatePlaylistDurations,
  convertRoutineToPlaylist,
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
  private hudView: HUDView = new HUDView();
  private hudEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private routineBadgeEl!: HTMLElement;
  private lockOverlay!: HTMLElement;
  private resultOverlay!: HTMLElement;

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
        ${renderHUDHTML()}
      </div>

      ${renderMarkersAndOverlaysHTML()}

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
    this.hudView.bind(this.appContainer);
    this.hudEl = document.getElementById('hud')!;
    this.fpsEl = this.hudView.fpsEl;
    this.routineBadgeEl = this.hudView.routineBadgeEl!;
    this.lockOverlay = document.getElementById('lock-overlay')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
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
    const handleTick = (hud: EngineHUDState) => {
      const routineText = this.activeRoutine && this.routineBadgeEl
        ? `ROUTINE: DRILL ${this.activeRoutine.currentIndex + 1}/${this.activeRoutine.scenarioIds.length}`
        : null;
      this.hudView.update(hud, routineText);
    };

    const handleHit = (_pts: number, headshot: boolean) => {
      this.hudView.showHit(headshot);
    };

    const handleInaccurate = () => {
      this.hudView.showMovementWarning();
    };

    const handleFlash = (intensity: number, durationMs: number) => {
      this.hudView.showFlash(intensity, durationMs);
    };

    const handleComplete = (result: SessionResult, isPB: boolean) => {
      this.showResultsScreen(result, isPB);
    };

    const handleRetaliate = (_targetId: string, penalty: number) => {
      this.hudView.showRetaliate();
      this.showToast(`ENEMY FIRED AT YOU! (-${penalty} PTS)`, 'info');
    };

    // Subscriptions on typed GameplayEventEmitter (single authoritative event bus)
    this.engine.events.on('onTick', handleTick);
    this.engine.events.on('onHit', (p) => handleHit(p.score, p.headshot));
    this.engine.events.on('onMovementInaccurate', handleInaccurate);
    this.engine.events.on('onFlash', (p) => handleFlash(p.intensity, p.durationMs));
    this.engine.events.on('onScenarioComplete', (p) => handleComplete(p.result, p.isPB));
    this.engine.events.on('onRetaliationHit', (p) => handleRetaliate(p.targetId, p.penalty));
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
              <div class="card scenario-card" data-routine="${r.id}" role="button" tabindex="0" aria-label="Start ${this.escapeHtml(r.name)} routine">
                <div class="badge badge-lime font-game">${badgeLabel}</div>
                <div class="scenario-card-title mt-8">${this.escapeHtml(r.name)}</div>
                <p class="scenario-card-desc">${this.escapeHtml(r.description)}</p>
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
                        <div style="font-weight:600; font-size:0.95rem;">${this.escapeHtml(scen?.name ?? pb.scenarioId)}</div>
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
                      <div style="font-weight:600; font-size:0.95rem;">${this.escapeHtml(s.scenarioName)}</div>
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
    return renderScenariosViewHTML(
      this.engine.store.getAllScenarios(),
      this.selectedCategory,
      (id) => this.engine.store.getPB(id),
      this.escapeHtml.bind(this)
    );
  }

  private attachScenariosListeners(container: HTMLElement): void {
    attachScenariosViewListeners(container, {
      onOpenCreator: () => {
        this.editingScenario = createDefaultCustomScenario('static_flick');
        this.studioErrors = [];
        this.navigateTo('creator');
      },
      onSelectCategory: (cat) => {
        this.selectedCategory = cat;
        this.renderPage('scenarios');
      },
      onLaunchScenario: (scenId) => {
        this.launchScenario(scenId);
      },
      onEditCustom: (scenId) => {
        const scen = this.engine.store.getCustomScenario(scenId);
        if (scen) {
          this.editingScenario = JSON.parse(JSON.stringify(scen));
          this.studioErrors = [];
          this.navigateTo('creator');
        }
      },
      onDuplicateCustom: async (scenId) => {
        const dup = await this.engine.store.duplicateCustomScenario(scenId);
        if (dup) {
          this.showToast(`Duplicated drill as "${dup.name}"`, 'success');
          this.renderPage('scenarios');
        }
      },
      onExportCustom: (scenId) => {
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
      },
      onDeleteCustom: async (scenId) => {
        if (window.confirm('Are you sure you want to delete this custom drill?')) {
          await this.engine.store.deleteCustomScenario(scenId);
          this.showToast('Custom drill deleted', 'info');
          this.renderPage('scenarios');
        }
      },
    });
  }

  private escapeHtml(text: string): string {
    return escapeHtml(text);
  }

  private renderPlansHTML(): string {
    return renderPlansViewHTML(this.engine, {
      playlistTab: this.playlistTab,
      editingPlaylist: this.editingPlaylist,
      editorErrors: this.editorErrors,
      editorSearchQuery: this.editorSearchQuery,
      editorCategoryFilter: this.editorCategoryFilter,
      playlistToDelete: this.playlistToDelete,
    }, this.escapeHtml.bind(this));
  }

  private attachPlansListeners(container: HTMLElement): void {
    attachPlansViewListeners(
      container,
      this.engine,
      {
        get playlistTab() { return (this as any)._ui.playlistTab; },
        set playlistTab(v) { (this as any)._ui.playlistTab = v; },
        get editingPlaylist() { return (this as any)._ui.editingPlaylist; },
        set editingPlaylist(v) { (this as any)._ui.editingPlaylist = v; },
        get editorErrors() { return (this as any)._ui.editorErrors; },
        set editorErrors(v) { (this as any)._ui.editorErrors = v; },
        get editorSearchQuery() { return (this as any)._ui.editorSearchQuery; },
        set editorSearchQuery(v) { (this as any)._ui.editorSearchQuery = v; },
        get editorCategoryFilter() { return (this as any)._ui.editorCategoryFilter; },
        set editorCategoryFilter(v) { (this as any)._ui.editorCategoryFilter = v; },
        get playlistToDelete() { return (this as any)._ui.playlistToDelete; },
        set playlistToDelete(v) { (this as any)._ui.playlistToDelete = v; },
        _ui: this,
      } as any,
      {
        onStartPlaylist: (playlist, difficulty) => this.startPlaylist(playlist, difficulty),
        onStartRoutine: (routine, difficulty) => this.startRoutine(routine, difficulty),
        onRenderPage: () => this.renderPage(this.currentPage),
        showToast: (msg, type) => this.showToast(msg, type),
        escapeHtmlFn: this.escapeHtml.bind(this),
      }
    );
  }

  private renderStatsHTML(): string {
    return renderStatsViewHTML(this.engine, {
      historyFeedbackMessage: this.historyFeedbackMessage,
      selectedTrendScenario: this.selectedTrendScenario,
      selectedTrendDifficulty: this.selectedTrendDifficulty,
      historyPage: this.historyPage,
      historyPageSize: this.historyPageSize,
      historyCategoryFilter: this.historyCategoryFilter,
      historyDifficultyFilter: this.historyDifficultyFilter,
      historySortBy: this.historySortBy,
      isClearModalOpen: this.isClearModalOpen,
    }, this.escapeHtml.bind(this));
  }

  private attachStatsListeners(container: HTMLElement): void {
    attachStatsViewListeners(
      container,
      this.engine,
      {
        get historyFeedbackMessage() { return (this as any)._ui.historyFeedbackMessage; },
        set historyFeedbackMessage(v) { (this as any)._ui.historyFeedbackMessage = v; },
        get selectedTrendScenario() { return (this as any)._ui.selectedTrendScenario; },
        set selectedTrendScenario(v) { (this as any)._ui.selectedTrendScenario = v; },
        get selectedTrendDifficulty() { return (this as any)._ui.selectedTrendDifficulty; },
        set selectedTrendDifficulty(v) { (this as any)._ui.selectedTrendDifficulty = v; },
        get historyPage() { return (this as any)._ui.historyPage; },
        set historyPage(v) { (this as any)._ui.historyPage = v; },
        get historyPageSize() { return (this as any)._ui.historyPageSize; },
        set historyPageSize(v) { (this as any)._ui.historyPageSize = v; },
        get historyCategoryFilter() { return (this as any)._ui.historyCategoryFilter; },
        set historyCategoryFilter(v) { (this as any)._ui.historyCategoryFilter = v; },
        get historyDifficultyFilter() { return (this as any)._ui.historyDifficultyFilter; },
        set historyDifficultyFilter(v) { (this as any)._ui.historyDifficultyFilter = v; },
        get historySortBy() { return (this as any)._ui.historySortBy; },
        set historySortBy(v) { (this as any)._ui.historySortBy = v; },
        get isClearModalOpen() { return (this as any)._ui.isClearModalOpen; },
        set isClearModalOpen(v) { (this as any)._ui.isClearModalOpen = v; },
        _ui: this,
      } as any,
      {
        onLaunchRecommendation: (rec) => this.executeRecommendationLaunch(rec),
        onLaunchScenario: (scenId) => this.launchScenario(scenId),
        onNavigate: (page) => this.navigateTo(page),
        onRenderPage: () => this.renderPage(this.currentPage),
        escapeHtmlFn: this.escapeHtml.bind(this),
      }
    );
  }

  private renderSettingsHTML(): string {
    return renderSettingsViewHTML(this.engine, this.escapeHtml.bind(this));
  }

  private attachSettingsListeners(container: HTMLElement): void {
    attachSettingsViewListeners(container, this.engine, {
      showToast: this.showToast.bind(this),
      renderPage: this.renderPage.bind(this),
      applyCrosshairStyles: this.applyCrosshairStyles.bind(this),
      fpsEl: this.fpsEl,
    });
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

    content.innerHTML = renderResultModalHTML({
      result,
      isPB,
      config,
      meaningfulReaction,
      meaningfulTracking,
      scoreVal,
      accVal,
      hsPctVal,
      avgReactVal,
      medReactVal,
      tpmVal,
      tpsVal,
      bodyHits,
      shotsFired,
      isInRoutine,
      routineName: this.activeRoutine?.name,
      routineCurrentDrill,
      routineTotalDrills,
      nextDrillConfig,
      rec,
      escapeHtmlFn: this.escapeHtml.bind(this),
    });

    this.resultOverlay.classList.add('visible');

    attachResultModalListeners(content, {
      onLaunchRecommendation: (r) => this.executeRecommendationLaunch(r),
      onRetry: () => {
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
      },
      onNext: isInRoutine ? () => this.advanceRoutine() : undefined,
      onMenu: () => this.exitToMenu(),
    }, !isInRoutine ? rec : undefined);

    if (isInRoutine) {
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
    content.innerHTML = renderRoutineCompletionHTML({
      routineName: routine.name,
      difficulty: routine.difficulty,
      isPlaylist,
      completedDrillsCount,
      totalPlannedDrills,
      skippedDrillsCount,
      completionRate,
      activeTrainingSec,
      totalElapsedSec,
      transitionSec,
      retriesCount: routine.retriesCount ?? 0,
      totalScore,
      overallAcc,
      hsPct,
      totalHits,
      completedResults,
      escapeHtmlFn: this.escapeHtml.bind(this),
    });

    this.resultOverlay.classList.add('visible');

    attachRoutineCompletionListeners(content, () => {
      this.activeRoutine = null;
      this.exitToMenu();
    });
  }

  // ── Creator Studio (Phase 4) ──────────────────────────────────────────

  private getStudioStateAdapter() {
    return {
      get editingScenario() { return (this as any)._ui.editingScenario; },
      set editingScenario(v) { (this as any)._ui.editingScenario = v; },
      get studioActiveTemplate() { return (this as any)._ui.studioActiveTemplate; },
      set studioActiveTemplate(v) { (this as any)._ui.studioActiveTemplate = v; },
      get studioErrors() { return (this as any)._ui.studioErrors; },
      set studioErrors(v) { (this as any)._ui.studioErrors = v; },
      _ui: this,
    } as any;
  }

  private renderCreatorStudioHTML(): string {
    return renderCreatorStudioViewHTML(this.engine, this.getStudioStateAdapter(), this.escapeHtml.bind(this));
  }

  private attachCreatorStudioListeners(container: HTMLElement): void {
    attachCreatorStudioViewListeners(
      container,
      this.engine,
      this.getStudioStateAdapter(),
      {
        onLaunchPreview: (config) => this.launchCustomPreview(config),
        onNavigate: (page) => this.navigateTo(page),
        onRenderPage: () => this.renderPage(this.currentPage),
        showToast: (msg, type) => this.showToast(msg, type),
        escapeHtmlFn: this.escapeHtml.bind(this),
      }
    );
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
    this.hudView.dispose();
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
