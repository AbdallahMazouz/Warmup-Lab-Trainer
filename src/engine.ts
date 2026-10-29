// =====================================================================
// engine.ts — Core Simulation Engine & Session Lifecycle
// =====================================================================

import * as THREE from 'three';
import { Renderer } from './renderer';
import { Controls } from './controls';
import { TargetManager } from './targetManager';
import { AudioManager } from './audio';
import { SettingsManager } from './settings';
import { Store } from './store';
import { VandalViewModel } from './vandal';
import { calculateSessionMetrics, calculateAccuracy, calculateHeadshotPercentage } from './analytics';
import { applyDifficultyPreset } from './scenarios';
import {
  SCORE_HIT,
  SCORE_HEADSHOT,
  SCORE_MISS,
  SCORE_SPEED_MAX,
  SCORE_SPEED_DECAY,
} from './constants';
import type { ScenarioConfig, SessionResult, DifficultyId, KillEvent } from './types';

export interface EngineCallbacks {
  onTick?: (hud: EngineHUDState) => void;
  onHit?: (pts: number, headshot: boolean, x: number, y: number) => void;
  onKill?: (event: KillEvent) => void;
  onMiss?: () => void;
  onFlash?: (intensity: number, durationMs: number) => void;
  onScenarioComplete?: (result: SessionResult, isPB: boolean) => void;
  onMovementInaccurate?: () => void;
}

export interface EngineHUDState {
  timeRemaining: number;
  totalDuration: number;
  score: number;
  hits: number;
  misses: number;
  accuracy: number;
  headshots: number;
  fps: number;
  isTracking: boolean;
  isPaused?: boolean;
  shotsFired?: number;
  headshotPct?: number;
}

export class Engine {
  renderer: Renderer;
  controls: Controls;
  targets: TargetManager;
  audio: AudioManager;
  settings: SettingsManager;
  store: Store;
  vandal: VandalViewModel;

  activeConfig: ScenarioConfig | null = null;
  isRunning = false;
  isPaused = false;

  private startTime = 0;
  private durationSec = 60;
  private score = 0;
  private hits = 0;
  private misses = 0;
  private headshots = 0;
  private shotsFired = 0;
  private shotsMoving = 0;
  private shotsStationary = 0;
  private reactions: number[] = [];
  private sessionSaved = false;

  // Tracking metrics
  private totalTrackingTicks = 0;
  private onTargetTrackingTicks = 0;

  // Flash metrics
  private nextFlashTime = 0;
  private flashAvoidCount = 0;
  private totalFlashes = 0;

  // Pause timing
  private pauseStartTime = 0;
  private totalPausedDurationMs = 0;

  // Frame timing
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsLastCalc = 0;
  private currentFps = 60;

  // Streak tracking
  private currentKillStreak = 0;

  callbacks: EngineCallbacks = {};

  getKillStreak(): number {
    return this.currentKillStreak;
  }

  constructor(
    renderer: Renderer,
    controls: Controls,
    audio: AudioManager,
    settings: SettingsManager,
    store: Store
  ) {
    this.renderer = renderer;
    this.controls = controls;
    this.audio = audio;
    this.settings = settings;
    this.store = store;

    this.targets = new TargetManager(this.renderer);

    // Vandal viewmodel — initialised once, persists for the app lifetime.
    this.vandal = new VandalViewModel();

    // Bind controls
    this.controls.onShoot = this.handleShoot.bind(this);
    this.controls.sensitivity = this.settings.get('sensitivity');
    this.controls.invertY = this.settings.get('invertY');
    this.renderer.updateFov(this.settings.get('fov'));
  }

  startScenario(config: ScenarioConfig, difficulty?: DifficultyId): void {
    const activeConfig = difficulty ? applyDifficultyPreset(config, difficulty) : { ...config };
    this.activeConfig = activeConfig;
    this.durationSec = activeConfig.durationSec;
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsMoving = 0;
    this.shotsStationary = 0;
    this.reactions = [];
    this.totalTrackingTicks = 0;
    this.onTargetTrackingTicks = 0;
    this.flashAvoidCount = 0;
    this.totalFlashes = 0;
    this.sessionSaved = false;

    this.targets.clear();
    this.controls.reset(
      new THREE.Vector3(0, 1.7, 0),
      0,
      0
    );

    // Initial target spawn
    for (let i = 0; i < activeConfig.targetCount; i++) {
      this.targets.spawnTarget(activeConfig);
    }

    if (activeConfig.flashEnabled) {
      this.nextFlashTime = performance.now() + 4000 + Math.random() * 5000;
    }

    this.startTime = performance.now();
    this.lastTime = performance.now();
    this.fpsLastCalc = performance.now();
    this.fpsFrames = 0;
    this.isRunning = true;
    this.isPaused = false;
    this.pauseStartTime = 0;
    this.totalPausedDurationMs = 0;
    this.currentKillStreak = 0;

    this.audio.playStart();
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.pauseStartTime = performance.now();
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    if (this.pauseStartTime > 0) {
      const pauseDuration = performance.now() - this.pauseStartTime;
      this.totalPausedDurationMs += pauseDuration;
      this.startTime += pauseDuration;
      this.pauseStartTime = 0;
    }
  }

  getPausedDurationMs(): number {
    let extra = 0;
    if (this.isPaused && this.pauseStartTime > 0) {
      extra = performance.now() - this.pauseStartTime;
    }
    return this.totalPausedDurationMs + extra;
  }

  getRemainingTime(): number {
    if (!this.isRunning) return 0;
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    return Math.max(0, this.durationSec - elapsed);
  }

  stopScenario(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.pauseStartTime = 0;
    this.sessionSaved = false;
    this.activeConfig = null;
    this.currentKillStreak = 0;
    this.targets.clear();
  }

  dispose(): void {
    this.stopScenario();
    this.vandal.dispose();
  }

  private handleShoot(): void {
    if (!this.isRunning || this.isPaused || !this.activeConfig) return;

    // ── Vandal: fire animation + gunshot sound on every trigger pull ──
    const now = performance.now();
    this.vandal.fire(now);
    this.audio.playGunshot();

    const isStationary = this.controls.isCounterStrafed();
    if (isStationary) {
      this.shotsStationary++;
    } else {
      this.shotsMoving++;
    }
    this.shotsFired++;

    // Movement inaccuracy check (Valorant counter-strafing requirement)
    if (this.activeConfig.requireSteadyAim) {
      if (!isStationary) {
        // Player shot while moving!
        this.misses++;
        this.score = Math.max(0, this.score + SCORE_MISS * 2);
        this.audio.playMiss();
        if (this.callbacks.onMovementInaccurate) {
          this.callbacks.onMovementInaccurate();
        }
        if (this.callbacks.onMiss) {
          this.callbacks.onMiss();
        }
        return;
      }
    }

    const ray = this.controls.getRay();
    const hit = this.targets.checkHit(ray);

    if (hit.hit) {
      const hitTarget = this.targets.getTarget(hit.targetId);
      // Guard against stale callbacks or already-removed targets
      if (!hitTarget || !hitTarget.alive) return;

      this.hits++;
      this.reactions.push(hit.reactionMs);
      this.currentKillStreak++;
      const currentStreak = this.currentKillStreak;

      let pts = SCORE_HIT;
      if (hit.headshot) {
        this.headshots++;
        pts += SCORE_HEADSHOT;
      }

      // Bonus for center accuracy
      pts += Math.round(hit.accuracyScore * 50);

      // Speed bonus: faster flick = higher score
      const speedBonus = Math.max(0, Math.round(SCORE_SPEED_MAX - hit.reactionMs * SCORE_SPEED_DECAY));
      pts += speedBonus;

      const hitPos = hitTarget.position;

      this.score += pts;
      // Confirmed target elimination kill audio with ascending streak progression
      this.audio.playKill(currentStreak, hit.headshot, hitPos);
      this.renderer.flashTarget(hit.targetId);

      // Despawn and replace target
      this.targets.removeTarget(hit.targetId);
      if (this.targets.getActiveCount() < this.activeConfig.targetCount) {
        this.targets.spawnTarget(this.activeConfig);
      }

      if (this.callbacks.onKill) {
        this.callbacks.onKill({
          targetId: hit.targetId,
          headshot: hit.headshot,
          position: hitPos,
          streak: currentStreak,
        });
      }

      if (this.callbacks.onHit) {
        this.callbacks.onHit(pts, hit.headshot, 0, 0);
      }
    } else {
      this.misses++;
      if (this.activeConfig.penalizeMiss) {
        this.score = Math.max(0, this.score + SCORE_MISS);
      }
      this.audio.playMiss();
      if (this.callbacks.onMiss) {
        this.callbacks.onMiss();
      }
    }
  }

  update(): void {
    const now = performance.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Calculate FPS
    this.fpsFrames++;
    if (now - this.fpsLastCalc >= 500) {
      this.currentFps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastCalc));
      this.fpsFrames = 0;
      this.fpsLastCalc = now;
    }

    if (!this.isRunning || this.isPaused || !this.activeConfig) {
      // Just render scene + viewmodel
      this.renderer.render();
      this.vandal.update(delta * 1000, now);
      this.vandal.render(this.renderer.renderer);
      return;
    }

    const elapsed = (now - this.startTime) / 1000;
    const remaining = Math.max(0, this.durationSec - elapsed);

    // Update player movement (enable movement if scenario involves counter-strafing or evasion)
    const movementEnabled = this.activeConfig.category === 'movement' ||
      this.activeConfig.id === 'tactical-counter-strafe' ||
      this.activeConfig.id.includes('duel') ||
      this.activeConfig.id.includes('clutch');

    this.controls.update(delta, movementEnabled);
    this.targets.update(delta, now);

    // Maintain target count
    while (this.targets.getActiveCount() < this.activeConfig.targetCount) {
      this.targets.spawnTarget(this.activeConfig);
    }

    // Tracking scenario logic
    let isCurrentlyTracking = false;
    if (this.activeConfig.category === 'tracking') {
      this.totalTrackingTicks++;
      const ray = this.controls.getRay();
      const track = this.targets.checkTracking(ray);
      if (track.isOnTarget) {
        this.onTargetTrackingTicks++;
        isCurrentlyTracking = true;
        // Continuous score accumulation for tracking
        this.score += Math.round(15 * (0.8 + 0.4 * track.accuracy));
      }
    }

    // Flash scenario logic
    if (this.activeConfig.flashEnabled && now >= this.nextFlashTime) {
      this.totalFlashes++;
      this.audio.playFlash();

      // Check if player turned away from flash position (placed at 0, 1.8, -10)
      const flashPos = new THREE.Vector3(0, 1.8, -10);
      const camDir = new THREE.Vector3();
      this.controls.camera.getWorldDirection(camDir);

      const toFlash = new THREE.Vector3().subVectors(flashPos, this.controls.yawObject.position).normalize();
      const dot = camDir.dot(toFlash);

      // If dot < 0.25, the player has turned away > 75 degrees!
      let flashIntensity = this.activeConfig.flashIntensity;
      if (dot < 0.25) {
        // Successful flash dodge!
        this.flashAvoidCount++;
        flashIntensity *= 0.12; // minimal glare
        this.score += 250; // reward for turning flash
      }

      const dur = this.activeConfig.flashDurationMs;
      if (this.callbacks.onFlash) {
        this.callbacks.onFlash(flashIntensity, dur);
      }

      this.nextFlashTime = now + 6000 + Math.random() * 7000;
    }

    // HUD Callback
    const totalShots = this.hits + this.misses;
    const accuracy = calculateAccuracy(this.hits, totalShots);
    const headshotPct = calculateHeadshotPercentage(this.headshots, this.hits);

    if (this.callbacks.onTick) {
      this.callbacks.onTick({
        timeRemaining: remaining,
        totalDuration: this.durationSec,
        score: this.score,
        hits: this.hits,
        misses: this.misses,
        accuracy,
        headshots: this.headshots,
        fps: this.currentFps,
        isTracking: isCurrentlyTracking,
        isPaused: this.isPaused,
        shotsFired: this.shotsFired,
        headshotPct,
      });
    }

    // Render frame
    this.renderer.render();
    this.vandal.update(delta * 1000, now);
    this.vandal.render(this.renderer.renderer);

    // Check completion
    if (remaining <= 0) {
      this.completeScenario();
    }
  }

  private completeScenario(): void {
    if (!this.isRunning || !this.activeConfig || this.sessionSaved) return;
    this.sessionSaved = true;
    this.isRunning = false;
    this.currentKillStreak = 0;
    this.audio.playEnd();

    const metrics = calculateSessionMetrics({
      score: this.score,
      hits: this.hits,
      misses: this.misses,
      headshots: this.headshots,
      reactions: this.reactions,
      durationSec: this.durationSec,
      shotsMoving: this.shotsMoving,
      shotsStationary: this.shotsStationary,
      totalTrackingTicks: this.totalTrackingTicks,
      onTargetTrackingTicks: this.onTargetTrackingTicks,
      totalFlashes: this.totalFlashes,
      flashAvoidCount: this.flashAvoidCount,
    });

    const result: SessionResult = {
      id: `session_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      scenarioId: this.activeConfig.id,
      scenarioName: this.activeConfig.name,
      category: this.activeConfig.category,
      difficulty: this.activeConfig.difficulty,
      timestamp: Date.now(),
      durationSec: this.durationSec,
      score: metrics.score,
      hits: metrics.hits,
      misses: metrics.misses,
      headshots: metrics.headshots,
      bodyHits: metrics.bodyHits,
      shotsFired: metrics.shotsFired,
      accuracy: metrics.accuracy,
      headshotPct: metrics.headshotPct,
      avgReactionMs: metrics.avgReactionMs,
      medianReactionMs: metrics.medianReactionMs,
      bestReactionMs: metrics.bestReactionMs,
      targetsPerSecond: metrics.targetsPerSecond,
      targetsPerMinute: metrics.targetsPerMinute,
      shotsMoving: metrics.shotsMoving,
      shotsStationary: metrics.shotsStationary,
      timeOnTarget: metrics.timeOnTarget,
      flashAvoidRate: metrics.flashAvoidRate,
    };

    const { isPB } = this.store.addSession(result);
    if (isPB) {
      this.audio.playPB();
    }

    if (this.callbacks.onScenarioComplete) {
      this.callbacks.onScenarioComplete(result, isPB);
    }
  }

  applySettings(): void {
    this.controls.sensitivity = this.settings.get('sensitivity');
    this.controls.invertY = this.settings.get('invertY');
    this.renderer.updateFov(this.settings.get('fov'));
    this.audio.setMasterVolume(this.settings.get('volume'));
    this.audio.setSfxVolume(this.settings.get('sfxVolume') ?? 0.8);
    this.audio.setMuted(this.settings.get('audioMuted') ?? false);
    this.audio.setSoundProfile(this.settings.get('soundProfile') ?? 'classic');
    this.audio.setKillStreakAudioEnabled(this.settings.get('killStreakAudioEnabled') ?? true);
  }
}
