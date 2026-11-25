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
import { resolveScenarioConfig, validateScenarioConfig, type ResolvedScenarioConfig } from './scenarioConfig';
import { Spawner } from './spawner';
import { GameplayEventEmitter } from './events';
import { getWeaponPreset, calculateBulletSpread, type WeaponPreset } from './weapons';
import {
  SCORE_HIT,
  SCORE_HEADSHOT,
  SCORE_MISS,
  SCORE_SPEED_MAX,
  SCORE_SPEED_DECAY,
} from './constants';
import type {
  ScenarioConfig,
  SessionResult,
  DifficultyId,
  KillEvent,
  HitEventPayload,
  HeadshotEventPayload,
  KillEventPayload,
  SpawnEventPayload,
  EngineHUDState,
} from './types';

export type { EngineHUDState };

export interface EngineCallbacks {
  onTick?: (hud: EngineHUDState) => void;
  onHit?: (pts: number, headshot: boolean, x: number, y: number) => void;
  onKill?: (event: KillEvent) => void;
  onMiss?: () => void;
  onFlash?: (intensity: number, durationMs: number) => void;
  onScenarioComplete?: (result: SessionResult, isPB: boolean) => void;
  onMovementInaccurate?: () => void;
  onSpawn?: (payload: SpawnEventPayload) => void;
  onRetaliationHit?: (targetId: string, penalty: number) => void;
}

export class Engine {
  renderer: Renderer;
  controls: Controls;
  targets: TargetManager;
  audio: AudioManager;
  settings: SettingsManager;
  store: Store;
  vandal: VandalViewModel;
  spawner: Spawner;
  public readonly events = new GameplayEventEmitter();

  activeConfig: ScenarioConfig | null = null;
  resolvedConfig: ResolvedScenarioConfig | null = null;
  currentWeapon: WeaponPreset = getWeaponPreset('vandal');
  isRunning = false;
  isPaused = false;
  renderWhenInactive = false;

  private startTime = 0;
  private durationSec = 60;
  private score = 0;
  private hits = 0;
  private misses = 0;
  private headshots = 0;
  private bodyHits = 0;
  private legHits = 0;
  private shotsFired = 0;
  private shotsMoving = 0;
  private shotsStationary = 0;
  private reactions: number[] = [];
  private sessionSaved = false;

  // Weapon & Recoil mechanics
  private lastShotTime = -Infinity;
  private recoilIndex = 0;
  private boltRecoveryUntil = 0;
  private sprayBulletsFired = 0;
  private sprayBulletsHit = 0;
  private first10Fired = 0;
  private first10Hit = 0;

  // Scenario-specific metrics
  private friendlyFireCount = 0;
  private missedEnemiesCount = 0;
  private earlyShotsCount = 0;
  private fakePeekShotsCount = 0;
  private overkillShots = 0;
  private timesShotByBot = 0;

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

  // Cached scenario flags to optimize hot update loop
  private activeMovementEnabled = false;
  private activeHasCover = false;

  private _callbackUnsubs: Record<string, () => void> = {};
  public readonly callbacks: EngineCallbacks = {
    get onTick() {
      return (hud: EngineHUDState) => (this as any)._engine?.events.emit('onTick', hud);
    },
    set onTick(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onTick']) eng._callbackUnsubs['onTick']();
      if (fn) eng._callbackUnsubs['onTick'] = eng.events.on('onTick', fn);
    },
    get onHit() {
      return (pts: number, headshot: boolean, _x?: number, _y?: number) =>
        (this as any)._engine?.events.emit('onHit', { targetId: '', headshot, score: pts, accuracyScore: 0 });
    },
    set onHit(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onHit']) eng._callbackUnsubs['onHit']();
      if (fn) eng._callbackUnsubs['onHit'] = eng.events.on('onHit', (p) => fn(p.score, p.headshot, 0, 0));
    },
    get onMiss() {
      return () => (this as any)._engine?.events.emit('onMiss', { reason: 'aim_miss', penalty: 0 });
    },
    set onMiss(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onMiss']) eng._callbackUnsubs['onMiss']();
      if (fn) eng._callbackUnsubs['onMiss'] = eng.events.on('onMiss', () => fn());
    },
    get onKill() {
      return (event: KillEvent) => (this as any)._engine?.events.emit('onKill', event as any);
    },
    set onKill(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onKill']) eng._callbackUnsubs['onKill']();
      if (fn) eng._callbackUnsubs['onKill'] = eng.events.on('onKill', (p: any) => fn({
        targetId: p.targetId,
        headshot: p.headshot,
        position: p.position,
        streak: p.streak,
      }));
    },
    get onSpawn() {
      return (payload: SpawnEventPayload) => (this as any)._engine?.events.emit('onSpawn', payload);
    },
    set onSpawn(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onSpawn']) eng._callbackUnsubs['onSpawn']();
      if (fn) eng._callbackUnsubs['onSpawn'] = eng.events.on('onSpawn', fn);
    },
    get onMovementInaccurate() {
      return () => (this as any)._engine?.events.emit('onMovementInaccurate');
    },
    set onMovementInaccurate(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onMovementInaccurate']) eng._callbackUnsubs['onMovementInaccurate']();
      if (fn) eng._callbackUnsubs['onMovementInaccurate'] = eng.events.on('onMovementInaccurate', () => fn());
    },
    get onFlash() {
      return (intensity: number, durationMs: number) =>
        (this as any)._engine?.events.emit('onFlash', { intensity, durationMs });
    },
    set onFlash(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onFlash']) eng._callbackUnsubs['onFlash']();
      if (fn) eng._callbackUnsubs['onFlash'] = eng.events.on('onFlash', (p) => fn(p.intensity, p.durationMs));
    },
    get onScenarioComplete() {
      return (result: SessionResult, isPB: boolean) =>
        (this as any)._engine?.events.emit('onScenarioComplete', { result, isPB });
    },
    set onScenarioComplete(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onScenarioComplete']) eng._callbackUnsubs['onScenarioComplete']();
      if (fn) eng._callbackUnsubs['onScenarioComplete'] = eng.events.on('onScenarioComplete', (p) => fn(p.result, p.isPB));
    },
    get onRetaliationHit() {
      return (targetId: string, penalty: number) =>
        (this as any)._engine?.events.emit('onRetaliationHit', { targetId, penalty });
    },
    set onRetaliationHit(fn) {
      const eng = (this as any)._engine as Engine;
      if (!eng) return;
      if (eng._callbackUnsubs['onRetaliationHit']) eng._callbackUnsubs['onRetaliationHit']();
      if (fn) eng._callbackUnsubs['onRetaliationHit'] = eng.events.on('onRetaliationHit', (p) => fn(p.targetId, p.penalty));
    },
  };

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
    this.spawner = new Spawner();
    Object.defineProperty(this.callbacks, '_engine', { value: this, enumerable: false, writable: true });

    // Vandal viewmodel — initialised once, persists for the app lifetime.
    this.vandal = new VandalViewModel();

    // Bind controls
    this.controls.onShoot = this.handleShoot.bind(this);
    this.controls.sensitivity = this.settings.get('sensitivity');
    this.controls.invertY = this.settings.get('invertY');
    this.renderer.updateFov(this.settings.get('fov'));

    // Decoupled audio subscriptions to engine gameplay events
    this.events.on('onKill', (e) => {
      this.audio.playKill(e.streak, e.headshot, e.position);
    });
    this.events.on('onMiss', () => {
      this.audio.playMiss();
    });

    this.targets.onTargetRetaliate = (target) => {
      if (!this.isRunning || this.isPaused) return;
      this.timesShotByBot++;
      const pen = target.retaliationPenalty ?? 250;
      this.score = Math.max(0, this.score - pen);
      this.audio.playRetaliatoryShot(target.position);
      this.events.emit('onMiss', { reason: 'retaliation_hit', penalty: -pen });
      this.events.emit('onRetaliationHit', { targetId: target.id, penalty: pen });
    };
  }

  startScenario(config: ScenarioConfig, difficulty?: DifficultyId): void {
    const validation = validateScenarioConfig(config);
    if (!validation.valid) {
      console.warn(`Scenario config validation warnings for "${config.id}":`, validation.errors);
    }
    const activeConfig = difficulty ? applyDifficultyPreset(config, difficulty) : { ...config };
    this.activeConfig = activeConfig;
    this.resolvedConfig = resolveScenarioConfig(activeConfig);
    this.currentWeapon = getWeaponPreset(this.resolvedConfig.weapon.preset);
    this.durationSec = activeConfig.durationSec;
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.headshots = 0;
    this.bodyHits = 0;
    this.legHits = 0;
    this.shotsFired = 0;
    this.shotsMoving = 0;
    this.shotsStationary = 0;
    this.reactions = [];
    this.totalTrackingTicks = 0;
    this.onTargetTrackingTicks = 0;
    this.flashAvoidCount = 0;
    this.totalFlashes = 0;
    this.sessionSaved = false;

    // Reset weapon & recoil mechanics
    this.lastShotTime = -Infinity;
    this.recoilIndex = 0;
    this.boltRecoveryUntil = 0;
    this.sprayBulletsFired = 0;
    this.sprayBulletsHit = 0;
    this.first10Fired = 0;
    this.first10Hit = 0;

    // Reset scenario-specific metrics
    this.friendlyFireCount = 0;
    this.missedEnemiesCount = 0;
    this.earlyShotsCount = 0;
    this.fakePeekShotsCount = 0;
    this.overkillShots = 0;
    this.timesShotByBot = 0;

    this.targets.clear();
    const playerPos = this.resolvedConfig.environment.customPlayerPos;
    this.controls.reset(
      new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z),
      0,
      0
    );

    // Wire spawner callbacks before init so initial spawns trigger onTargetSpawned
    this.spawner.callbacks.onTargetSpawned = (target) => {
      const payload: SpawnEventPayload = {
        targetId: target.id,
        position: { x: target.position.x, y: target.position.y, z: target.position.z },
        kind: target.kind ?? 'standard',
        hp: target.hp,
        maxHp: target.maxHp,
      };
      this.events.emit('onSpawn', payload);
    };
    this.spawner.callbacks.onWaveComplete = (waveIdx) => {
      if (this.resolvedConfig?.end.type === 'waves' && waveIdx >= this.resolvedConfig.end.waves) {
        this.completeScenario();
      }
    };
    this.spawner.callbacks.onTargetExpired = (_targetId, kind) => {
      if (this.resolvedConfig?.id === 'friend-or-foe' && kind === 'enemy') {
        this.missedEnemiesCount++;
        this.score = Math.max(0, this.score + (this.resolvedConfig.scoring.missedEnemyPenalty ?? -100));
      }
    };
    this.targets.onTargetExpired = (t) => {
      this.spawner.onTargetRetreatedOrExpired(t.id);
    };

    // Initialize spawner with resolved configuration
    this.spawner.init(this.resolvedConfig, this.targets);

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

    // Cache scenario characteristics to avoid repeated string matching in hot frame loop
    this.activeMovementEnabled = activeConfig.category === 'movement' ||
      activeConfig.id === 'tactical-counter-strafe' ||
      activeConfig.id.includes('duel') ||
      activeConfig.id.includes('clutch') ||
      activeConfig.id.includes('skirmish');

    this.activeHasCover = Boolean(
      this.resolvedConfig?.environment.customCover ||
      activeConfig.id.includes('peek') ||
      activeConfig.id === 'tactical-angle-clear' ||
      activeConfig.id === 'tactical-jiggle' ||
      activeConfig.id === 'tactical-wideswing' ||
      activeConfig.id === 'flash-pop'
    );
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
    this.resolvedConfig = null;
    this.currentKillStreak = 0;
    this.activeMovementEnabled = false;
    this.activeHasCover = false;
    this.spawner.reset();
    this.targets.clear();
  }

  dispose(): void {
    this.stopScenario();
    this.vandal.dispose();
    for (const unsub of Object.values(this._callbackUnsubs)) {
      unsub();
    }
    this._callbackUnsubs = {};
  }

  private handleShoot(): void {
    if (!this.isRunning || this.isPaused || !this.activeConfig) return;

    const now = performance.now();

    // Enforce bolt action recovery (e.g. Operator chambering)
    if (now < this.boltRecoveryUntil) {
      return;
    }

    // Enforce fire rate limit if configured
    if (this.resolvedConfig?.weapon.enforceFireRate && Number.isFinite(this.lastShotTime) && (now - this.lastShotTime < this.currentWeapon.cycleTimeMs)) {
      return;
    }

    // Reset recoil pattern index if player paused shooting longer than recovery time
    if (now - this.lastShotTime > this.currentWeapon.recoveryTimeMs) {
      this.recoilIndex = 0;
    }
    this.lastShotTime = now;

    if (this.currentWeapon.boltActionDelayMs) {
      this.boltRecoveryUntil = now + this.currentWeapon.boltActionDelayMs;
    }

    // Viewmodel animation + gunshot sound
    this.vandal.fire(now);
    this.audio.playGunshot();

    const isStationary = this.controls.isCounterStrafed();
    if (isStationary) {
      this.shotsStationary++;
    } else {
      this.shotsMoving++;
    }
    this.shotsFired++;
    this.sprayBulletsFired++;
    if (this.sprayBulletsFired <= 10) {
      this.first10Fired++;
    }

    // Camera recoil kick (upward pitch jerk)
    const recoilStep = this.currentWeapon.recoilPattern[Math.min(this.recoilIndex, this.currentWeapon.recoilPattern.length - 1)];
    if (recoilStep && recoilStep.pitchDeg > 0 && typeof this.controls.pitchObject?.rotation?.x === 'number') {
      this.controls.pitchObject.rotation.x -= (recoilStep.pitchDeg * 0.35 * Math.PI) / 180;
    }
    this.recoilIndex++;

    // Movement inaccuracy check (Valorant counter-strafing requirement)
    if (this.activeConfig.requireSteadyAim || this.resolvedConfig?.weapon.requireCounterStrafe) {
      if (!isStationary) {
        this.misses++;
        const pen = this.resolvedConfig?.scoring.movingShotPenalty ?? (SCORE_MISS * 2);
        this.score = Math.max(0, this.score + pen);
        this.events.emit('onMovementInaccurate');
        this.events.emit('onMiss', { reason: 'movement_inaccurate', penalty: pen });
        return;
      }
    }

    // Early shot violation check (e.g. Peek & Tap)
    if (this.resolvedConfig?.interaction.penalizeEarlyShot) {
      if (!this.spawner.hasExposedTarget()) {
        this.earlyShotsCount++;
        this.misses++;
        const pen = this.resolvedConfig.scoring.earlyShotPenalty ?? -200;
        this.score = Math.max(0, this.score + pen);
        this.events.emit('onMiss', { reason: 'early_shot', penalty: pen });
        return;
      }
    }

    // Raycast with movement spread perturbation
    const ray = this.controls.getRay();
    let effectiveRay = ray;
    if (!isStationary && this.currentWeapon.movementSpreadMultiplier > 1) {
      const spread = calculateBulletSpread(this.currentWeapon, this.recoilIndex, false);
      const cloned = ray.clone();
      cloned.direction.x += spread.yawOffsetRad * 0.5;
      cloned.direction.y += spread.pitchOffsetRad * 0.5;
      cloned.direction.normalize();
      effectiveRay = cloned;
    }

    if (this.resolvedConfig?.interaction.mode === 'track') {
      // In tracking scenarios, targets remain alive while being tracked; clicks do not eliminate targets
      return;
    }

    const hasCover = Boolean(
      this.resolvedConfig?.environment.customCover ||
      this.activeConfig?.id.includes('peek') ||
      this.activeConfig?.id === 'tactical-angle-clear' ||
      this.activeConfig?.id === 'tactical-jiggle' ||
      this.activeConfig?.id === 'tactical-wideswing' ||
      this.activeConfig?.id === 'flash-pop'
    );
    const hit = this.targets.checkHit(effectiveRay, hasCover);

    if (hit.hit) {
      const hitTarget = this.targets.getTarget(hit.targetId);
      if (!hitTarget || !hitTarget.alive) return;

      const hitPos = { x: hitTarget.position.x, y: hitTarget.position.y, z: hitTarget.position.z };

      // Friendly target hit (Friend or Foe scenario)
      if (hitTarget.kind === 'friend') {
        this.friendlyFireCount++;
        this.misses++;
        const pen = this.resolvedConfig?.scoring.friendlyFirePenalty ?? -500;
        this.score = Math.max(0, this.score + pen);
        this.targets.removeTarget(hit.targetId);
        this.spawner.onTargetKilled(hit.targetId, hitPos);
        this.events.emit('onMiss', { reason: 'friendly_fire', penalty: pen });
        return;
      }

      // Fake peek shot (Jiggle Reading scenario)
      if (hitTarget.isFakePeek) {
        this.fakePeekShotsCount++;
        this.misses++;
        const pen = this.resolvedConfig?.scoring.fakePeekShotPenalty ?? -250;
        this.score = Math.max(0, this.score + pen);
        this.targets.removeTarget(hit.targetId);
        this.spawner.onTargetKilled(hit.targetId, hitPos);
        this.events.emit('onMiss', { reason: 'fake_peek', penalty: pen });
        return;
      }

      // Headshot-only rule (Headline scenario)
      if (this.resolvedConfig?.target.headshotOnly && !hit.headshot) {
        this.misses++;
        let pen = 0;
        if (hit.bodyPart === 'legs') {
          this.legHits++;
          pen = this.resolvedConfig.scoring.legShotPenalty ?? -150;
          this.score = Math.max(0, this.score + pen);
        } else {
          this.bodyHits++;
        }
        this.events.emit('onMiss', { reason: 'headshot_only_violation', penalty: pen });
        // Disappear immediately after hit
        this.targets.removeTarget(hit.targetId);
        this.spawner.onTargetKilled(hit.targetId, hitPos);
        return;
      }

      this.hits++;
      this.sprayBulletsHit++;
      if (this.sprayBulletsFired <= 10) {
        this.first10Hit++;
      }
      this.reactions.push(hit.reactionMs);

      let pts = this.resolvedConfig?.scoring.baseHitScore ?? SCORE_HIT;

      if (hit.headshot) {
        this.headshots++;
        pts += this.resolvedConfig?.scoring.headshotBonus ?? SCORE_HEADSHOT;
      } else if (hit.bodyPart === 'legs') {
        this.legHits++;
        if (this.resolvedConfig?.scoring.legShotPenalty) {
          pts += this.resolvedConfig.scoring.legShotPenalty;
        }
      } else {
        this.bodyHits++;
      }

      // Bonus for center accuracy
      pts += Math.round(hit.accuracyScore * 50);

      // Speed bonus
      const speedBonusMax = this.resolvedConfig?.scoring.speedBonusMax ?? SCORE_SPEED_MAX;
      const speedDecay = this.resolvedConfig?.scoring.speedDecay ?? SCORE_SPEED_DECAY;
      const speedBonus = Math.max(0, Math.round(speedBonusMax - hit.reactionMs * speedDecay));
      pts += speedBonus;

      // Counter-strafe bonus
      if (isStationary && this.resolvedConfig?.scoring.counterStrafeBonus) {
        pts += this.resolvedConfig.scoring.counterStrafeBonus;
      }

      // Fast reaction bonus (<250ms) for Peek & Tap
      if (hit.reactionMs < 250 && this.resolvedConfig?.id === 'peek-and-tap') {
        pts += 200;
      }

      // Damage calculation
      let damage = 40;
      if (hit.headshot) {
        damage = this.currentWeapon.damage.head;
      } else if (hit.bodyPart === 'legs') {
        damage = this.currentWeapon.damage.legs;
      } else {
        damage = this.currentWeapon.damage.body;
      }

      // Multi-shot target handling (e.g. spray-control dummy with 400 HP)
      const isMultiShot = Boolean(this.resolvedConfig?.target.multiShot);
      const currentHp = typeof hitTarget.hp === 'number' ? hitTarget.hp : (this.resolvedConfig?.target.hp ?? 100);
      const isLethal = !isMultiShot || (currentHp - damage <= 0);
      const remainingHp = isLethal ? 0 : Math.max(0, currentHp - damage);
      if (isMultiShot) {
        hitTarget.hp = remainingHp;
      }

      const hitPayload: HitEventPayload = {
        targetId: hit.targetId,
        hitZone: hit.bodyPart ?? 'head',
        damage,
        remainingHp,
        headshot: hit.headshot,
        score: pts,
        reactionMs: hit.reactionMs,
        accuracyScore: hit.accuracyScore,
      };

      this.score += pts;

      if (!isLethal) {
        // Non-lethal hit on multi-shot target: provide hit feedback and reduce HP without removing target
        this.renderer.flashTarget(hit.targetId);
        this.audio.playHit();
        this.events.emit('onHit', hitPayload);
        if (hit.headshot) {
          this.events.emit('onHeadshot', hitPayload as HeadshotEventPayload);
        }
        return;
      }

      this.currentKillStreak++;
      const currentStreak = this.currentKillStreak;

      // Immediate visual removal from scene and active targets
      this.targets.removeTarget(hit.targetId);
      this.spawner.onTargetKilled(hit.targetId, hitPos);

      const killPayload: KillEventPayload = {
        targetId: hit.targetId,
        hitZone: hit.bodyPart ?? 'head',
        headshot: hit.headshot,
        position: hitPos,
        streak: currentStreak,
        score: pts,
        reactionMs: hit.reactionMs,
      };

      this.events.emit('onHit', hitPayload);
      if (hit.headshot) {
        this.events.emit('onHeadshot', hitPayload as HeadshotEventPayload);
      }
      this.events.emit('onKill', killPayload);

      // Target count completion condition
      if (this.resolvedConfig?.end.type === 'target_count' && this.hits >= this.resolvedConfig.end.targetCount) {
        this.completeScenario();
      }
    } else {
      const isOverkill = this.targets.checkOverkill(effectiveRay, now);
      if (isOverkill) {
        this.overkillShots++;
      } else {
        this.targets.handleNearMiss(effectiveRay, now);
      }
      this.misses++;
      const missPen = this.resolvedConfig?.scoring.missPenalty ?? (this.activeConfig.penalizeMiss ? SCORE_MISS : 0);
      if (missPen !== 0) {
        this.score = Math.max(0, this.score + missPen);
      }
      this.events.emit('onMiss', { reason: isOverkill ? 'overkill' : 'aim_miss', penalty: missPen });
    }
  }

  renderFrame(): void {
    this.renderer.render();
    this.vandal.render(this.renderer.renderer);
  }

  update(): void {
    const now = performance.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!this.isRunning || !this.activeConfig) {
      if (this.renderWhenInactive) {
        this.renderer.render();
        this.vandal.update(delta * 1000, now);
        this.vandal.render(this.renderer.renderer);
      }
      return;
    }

    // Calculate FPS
    this.fpsFrames++;
    if (now - this.fpsLastCalc >= 500) {
      this.currentFps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastCalc));
      this.fpsFrames = 0;
      this.fpsLastCalc = now;
    }

    if (this.isPaused) {
      // Paused drill: render background scene under lock overlay but skip physics/target tick
      const elapsed = (now - this.startTime) / 1000;
      const remaining = Math.max(0, this.durationSec - elapsed);
      const totalShots = this.hits + this.misses;
      const accuracy = calculateAccuracy(this.hits, totalShots);
      const headshotPct = calculateHeadshotPercentage(this.headshots, this.hits);

      const hudState: EngineHUDState = {
        timeRemaining: remaining,
        totalDuration: this.durationSec,
        score: this.score,
        hits: this.hits,
        misses: this.misses,
        accuracy,
        headshots: this.headshots,
        fps: this.currentFps,
        isTracking: false,
        isPaused: true,
        shotsFired: this.shotsFired,
        headshotPct,
        playerSpeed: 0,
        isStationary: true,
        activeKeys: { w: false, a: false, s: false, d: false },
        threatProgress: 0,
      };

      this.events.emit('onTick', hudState);

      this.renderer.render();
      this.vandal.update(delta * 1000, now);
      this.vandal.render(this.renderer.renderer);
      return;
    }

    const elapsed = (now - this.startTime) / 1000;
    const remaining = Math.max(0, this.durationSec - elapsed);

    // Update player movement (enable movement if scenario involves counter-strafing or evasion)
    this.controls.update(delta, this.activeMovementEnabled);
    this.targets.update(delta, now, this.controls.yawObject.position);

    // Spawner update (handles wave progression, peek lifecycles, and interval spawns)
    this.spawner.update(delta, now);

    // Tracking scenario logic
    let isCurrentlyTracking = false;
    if (this.activeConfig.category === 'tracking' || this.resolvedConfig?.interaction.mode === 'track') {
      this.totalTrackingTicks++;
      const ray = this.controls.getRay();
      const track = this.targets.checkTracking(ray, this.activeHasCover);
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
      this.events.emit('onFlash', { intensity: flashIntensity, durationMs: dur });

      this.nextFlashTime = now + 6000 + Math.random() * 7000;
    }

    // HUD Callback
    const totalShots = this.hits + this.misses;
    const accuracy = calculateAccuracy(this.hits, totalShots);
    const headshotPct = calculateHeadshotPercentage(this.headshots, this.hits);

    const hudState: EngineHUDState = {
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
      playerSpeed: this.controls.getSpeed(),
      isStationary: this.controls.isCounterStrafed(),
      activeKeys: this.controls.getActiveKeys(),
      threatProgress: this.targets.getHighestThreatProgress(this.controls.yawObject.position),
    };

    this.events.emit('onTick', hudState);

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

    const sprayAccuracy = this.sprayBulletsFired > 0
      ? Number(((this.sprayBulletsHit / this.sprayBulletsFired) * 100).toFixed(1))
      : undefined;
    const first10Accuracy = this.first10Fired > 0
      ? Number(((this.first10Hit / this.first10Fired) * 100).toFixed(1))
      : undefined;
    const totalDecisions = this.hits + this.friendlyFireCount + this.fakePeekShotsCount;
    const decisionAccuracy = totalDecisions > 0
      ? Number(((this.hits / totalDecisions) * 100).toFixed(1))
      : undefined;
    const counterStrafeAccuracy = (this.shotsStationary + this.shotsMoving) > 0
      ? Number(((this.shotsStationary / (this.shotsStationary + this.shotsMoving)) * 100).toFixed(1))
      : undefined;

    const result: SessionResult = {
      id: `session_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      scenarioId: this.activeConfig.id,
      scenarioName: this.activeConfig.name,
      category: this.activeConfig.category,
      difficulty: this.activeConfig.difficulty,
      configVersion: this.activeConfig.configVersion,
      timestamp: Date.now(),
      durationSec: this.durationSec,
      score: metrics.score,
      hits: metrics.hits,
      misses: metrics.misses,
      headshots: metrics.headshots,
      bodyHits: this.bodyHits || metrics.bodyHits,
      legHits: this.legHits || undefined,
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
      friendlyFireCount: this.friendlyFireCount || undefined,
      missedEnemiesCount: this.missedEnemiesCount || undefined,
      earlyShotsCount: this.earlyShotsCount || undefined,
      fakePeekShotsCount: this.fakePeekShotsCount || undefined,
      sprayAccuracy,
      first10Accuracy,
      decisionAccuracy,
      overkillShots: this.overkillShots || undefined,
      counterStrafeAccuracy,
      timesShotByBot: this.timesShotByBot || undefined,
    };

    const { isPB } = this.store.addSession(result);
    if (isPB) {
      this.audio.playPB();
    }

    this.events.emit('onScenarioComplete', { result, isPB });
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
