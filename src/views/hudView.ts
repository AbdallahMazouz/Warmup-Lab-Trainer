// =====================================================================
// views/hudView.ts — In-Game HUD, Hit Markers, Warnings & Overlays
// =====================================================================

import type { EngineHUDState } from '../engine';

export function renderHUDHTML(): string {
  return `
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
  `;
}

export function renderMarkersAndOverlaysHTML(): string {
  return `
    <!-- Hit Marker — body shot (green diagonal ticks, default) -->
    <div id="hit-marker">
      <svg viewBox="0 0 32 32" fill="none" stroke="#00ff88" stroke-width="2.5">
        <line x1="6" y1="6" x2="11" y2="11" />
        <line x1="26" y1="26" x2="21" y2="21" />
        <line x1="6" y1="26" x2="11" y2="21" />
        <line x1="26" y1="6" x2="21" y2="11" />
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
  `;
}

export class HUDView {
  public timerEl!: HTMLElement;
  public scoreEl!: HTMLElement;
  public accEl!: HTMLElement;
  public fpsEl!: HTMLElement;
  public hitMarkerEl!: HTMLElement;
  public headshotMarkerEl!: HTMLElement;
  public flashOverlay!: HTMLElement;
  public movementWarningEl!: HTMLElement;
  public routineBadgeEl: HTMLElement | null = null;
  public keyW: HTMLElement | null = null;
  public keyA: HTMLElement | null = null;
  public keyS: HTMLElement | null = null;
  public keyD: HTMLElement | null = null;
  public speedValEl: HTMLElement | null = null;
  public speedStatusEl: HTMLElement | null = null;
  public threatMeterEl: HTMLElement | null = null;
  public threatFillEl: HTMLElement | null = null;
  public threatOverlay: HTMLElement | null = null;

  private movementWarningTimeout: any = null;
  private flashTimeout: any = null;
  private flashTransitionTimeout: any = null;
  private threatTimeout: any = null;
  public threatHitActive = false;

  bind(root: Document | HTMLElement): void {
    const doc = root instanceof Document ? root : root.ownerDocument || document;
    this.timerEl = doc.getElementById('hud-timer')!;
    this.scoreEl = doc.getElementById('hud-score')!;
    this.accEl = doc.getElementById('hud-acc')!;
    this.fpsEl = doc.getElementById('hud-fps')!;
    this.hitMarkerEl = doc.getElementById('hit-marker')!;
    this.headshotMarkerEl = doc.getElementById('headshot-marker')!;
    this.flashOverlay = doc.getElementById('flash-overlay')!;
    this.movementWarningEl = doc.getElementById('hud-movement-warning')!;
    this.routineBadgeEl = doc.getElementById('hud-routine-badge');

    this.keyW = doc.getElementById('key-w');
    this.keyA = doc.getElementById('key-a');
    this.keyS = doc.getElementById('key-s');
    this.keyD = doc.getElementById('key-d');
    this.speedValEl = doc.getElementById('hud-speed-val');
    this.speedStatusEl = doc.getElementById('hud-speed-status');
    this.threatMeterEl = doc.getElementById('hud-threat-meter');
    this.threatFillEl = doc.getElementById('hud-threat-fill');
    this.threatOverlay = doc.getElementById('threat-overlay');
  }

  update(hud: EngineHUDState, routineText?: string | null): void {
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

    if (routineText && this.routineBadgeEl) {
      this.routineBadgeEl.style.display = 'block';
      this.routineBadgeEl.textContent = routineText;
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
  }

  showHit(headshot: boolean): void {
    if (headshot) {
      this.hitMarkerEl.classList.remove('show');
      this.headshotMarkerEl.classList.remove('show');
      void this.headshotMarkerEl.offsetWidth; // reflow
      this.headshotMarkerEl.classList.add('show');
    } else {
      this.headshotMarkerEl.classList.remove('show');
      this.hitMarkerEl.classList.remove('show');
      void this.hitMarkerEl.offsetWidth; // reflow
      this.hitMarkerEl.classList.add('show');
    }
  }

  showMovementWarning(): void {
    this.movementWarningEl.style.display = 'block';
    if (this.movementWarningTimeout) clearTimeout(this.movementWarningTimeout);
    this.movementWarningTimeout = setTimeout(() => {
      this.movementWarningEl.style.display = 'none';
      this.movementWarningTimeout = null;
    }, 700);
  }

  showFlash(intensity: number, durationMs: number): void {
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
  }

  showRetaliate(onFinish?: () => void): void {
    this.threatHitActive = true;
    if (this.threatOverlay) {
      this.threatOverlay.classList.remove('hit');
      void this.threatOverlay.offsetWidth;
      this.threatOverlay.classList.add('hit');
    }
    if (this.threatTimeout) clearTimeout(this.threatTimeout);
    this.threatTimeout = setTimeout(() => {
      this.threatHitActive = false;
      if (this.threatOverlay) this.threatOverlay.classList.remove('hit');
      if (onFinish) onFinish();
    }, 500);
  }

  dispose(): void {
    if (this.movementWarningTimeout) {
      clearTimeout(this.movementWarningTimeout);
      this.movementWarningTimeout = null;
    }
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    if (this.flashTransitionTimeout) {
      clearTimeout(this.flashTransitionTimeout);
      this.flashTransitionTimeout = null;
    }
    if (this.threatTimeout) {
      clearTimeout(this.threatTimeout);
      this.threatTimeout = null;
    }
  }
}
