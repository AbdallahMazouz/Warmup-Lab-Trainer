// =====================================================================
// spawner.ts — Data-Driven Target Spawner System
// =====================================================================

import * as THREE from 'three';
import type { TargetManager, ActiveTarget } from './targetManager';
import type { ResolvedScenarioConfig } from './scenarioConfig';
import type { TargetKind } from './types';
import { HEAD_LEVEL_Y } from './constants';
import { ARENA_COVER_BOXES, getCoverExposedX } from './movementControllers';

export interface SpawnerCallbacks {
  onWaveComplete?: (waveIndex: number) => void;
  onTargetExpired?: (targetId: string, kind: TargetKind) => void;
  onTargetSpawned?: (target: ActiveTarget) => void;
}

interface PendingRespawn {
  spawnAt: number;
}

export class Spawner {
  private config: ResolvedScenarioConfig | null = null;
  private targets: TargetManager | null = null;
  private rng: () => number;

  private waveIndex = 0;
  private nextSpawnTime = 0;
  private isWaitingForWave = false;
  private peekCooldownUntil = 0;
  private isPeekerActive = false;
  private pendingRespawns: PendingRespawn[] = [];
  private spidershotCenterNext = true;
  private lastKilledPos: THREE.Vector3 | null = null;

  callbacks: SpawnerCallbacks = {};

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  init(config: ResolvedScenarioConfig, targets: TargetManager): void {
    this.config = config;
    this.targets = targets;
    this.waveIndex = 0;
    this.isWaitingForWave = false;
    this.peekCooldownUntil = 0;
    this.isPeekerActive = false;
    this.nextSpawnTime = 0;
    this.pendingRespawns = [];
    this.spidershotCenterNext = true;
    this.lastKilledPos = null;

    // Initial spawn
    this.spawnInitialTargets();
  }

  reset(): void {
    this.pendingRespawns = [];
    this.waveIndex = 0;
    this.isWaitingForWave = false;
    this.peekCooldownUntil = 0;
    this.isPeekerActive = false;
    this.nextSpawnTime = 0;
    this.spidershotCenterNext = true;
    this.lastKilledPos = null;
  }

  private spawnInitialTargets(): void {
    if (!this.config || !this.targets) return;

    const { spawner } = this.config;
    if (spawner.mode === 'wave') {
      this.spawnWave();
    } else if (spawner.mode === 'peek') {
      this.scheduleNextPeek(performance.now(), true);
    } else {
      const initialCount = Math.min(
        spawner.maxAlive,
        spawner.initialTargetCount ?? this.config.targetCount ?? spawner.maxAlive
      );
      for (let i = 0; i < initialCount; i++) {
        this.spawnOneTarget();
      }
    }
  }

  update(_deltaSec: number, nowMs: number): void {
    if (!this.config || !this.targets) return;

    const { spawner } = this.config;

    // 1. Process pending queued respawns
    if (this.pendingRespawns.length > 0) {
      for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
        if (nowMs >= this.pendingRespawns[i].spawnAt) {
          this.pendingRespawns.splice(i, 1);
          if (this.targets.getActiveCount() < spawner.maxAlive) {
            this.spawnOneTarget();
          }
        }
      }
    }

    // 2. Peek spawner lifecycle
    if (spawner.mode === 'peek') {
      if (!this.isPeekerActive && nowMs >= this.peekCooldownUntil) {
        this.spawnPeekTarget(nowMs);
      }
      return;
    }

    // 3. Wave completion check
    if (spawner.mode === 'wave') {
      if (this.targets.getActiveCount() === 0 && !this.isWaitingForWave) {
        this.waveIndex++;
        if (this.callbacks.onWaveComplete) {
          this.callbacks.onWaveComplete(this.waveIndex);
        }
        this.spawnWave();
      }
      return;
    }

    // 4. Interval or fill-up spawning
    if (spawner.spawnIntervalMs && spawner.spawnIntervalMs > 0) {
      if (
        nowMs >= this.nextSpawnTime &&
        this.targets.getActiveCount() + this.pendingRespawns.length < spawner.maxAlive
      ) {
        this.spawnOneTarget();
        this.nextSpawnTime = nowMs + spawner.spawnIntervalMs;
      }
    } else if (
      spawner.respawnOnKill &&
      this.targets.getActiveCount() + this.pendingRespawns.length < spawner.maxAlive
    ) {
      while (
        this.targets.getActiveCount() + this.pendingRespawns.length < spawner.maxAlive
      ) {
        this.spawnOneTarget();
      }
    }
  }

  onTargetKilled(_targetId: string, killedPos?: { x: number; y: number; z: number }): void {
    if (!this.config || !this.targets) return;
    if (killedPos) {
      this.lastKilledPos = new THREE.Vector3(killedPos.x, killedPos.y, killedPos.z);
    }
    const { spawner } = this.config;

    if (spawner.mode === 'peek') {
      this.isPeekerActive = false;
      this.scheduleNextPeek(performance.now());
      return;
    }

    if (spawner.mode === 'wave') {
      if (this.targets.getActiveCount() === 0 && !this.isWaitingForWave) {
        this.waveIndex++;
        if (this.callbacks.onWaveComplete) {
          this.callbacks.onWaveComplete(this.waveIndex);
        }
        this.spawnWave();
      }
      return;
    }

    if (spawner.respawnOnKill) {
      this.queueOrExecuteRespawn();
    }
  }

  onTargetRetreatedOrExpired(targetId: string): void {
    if (!this.config || !this.targets) return;
    const target = this.targets.getTarget(targetId);
    if (target) {
      this.lastKilledPos = target.position.clone();
    }
    const kind = target?.kind ?? 'standard';

    if (this.config.spawner.mode === 'peek') {
      this.isPeekerActive = false;
      this.scheduleNextPeek(performance.now());
    } else if (this.config.spawner.respawnOnKill && this.config.spawner.mode !== 'wave') {
      this.queueOrExecuteRespawn();
    }

    if (this.callbacks.onTargetExpired) {
      this.callbacks.onTargetExpired(targetId, kind);
    }
  }

  private queueOrExecuteRespawn(): void {
    if (!this.config || !this.targets) return;
    const { spawner } = this.config;
    const totalCurrent = this.targets.getActiveCount() + this.pendingRespawns.length;
    if (totalCurrent >= spawner.maxAlive) return;

    if (spawner.respawnDelayMs > 0) {
      this.pendingRespawns.push({ spawnAt: performance.now() + spawner.respawnDelayMs });
    } else {
      this.spawnOneTarget();
    }
  }

  private scheduleNextPeek(nowMs: number, isInitial = false): void {
    if (!this.config) return;
    const { minDelayMs, maxDelayMs } = this.config.spawner;
    const delay = isInitial
      ? 500
      : minDelayMs + this.rng() * (maxDelayMs - minDelayMs);
    this.peekCooldownUntil = nowMs + delay;
  }

  private spawnWave(): void {
    if (!this.config || !this.targets) return;
    const { waveSize } = this.config.spawner;

    for (let i = 0; i < waveSize; i++) {
      this.spawnOneTarget();
    }
  }

  private isPositionValid(pos: THREE.Vector3, minDist = 1.8): boolean {
    if (!this.targets) return true;
    for (const t of this.targets.getTargets()) {
      if (!t.alive) continue;
      if (pos.distanceTo(t.position) < minDist) {
        return false;
      }
    }
    return true;
  }

  private spawnOneTarget(): void {
    if (!this.config || !this.targets) return;

    const { spawner, target: targetCfg } = this.config;
    let pos: THREE.Vector3;

    // Determine target kind for Friend or Foe
    let kind: TargetKind = 'standard';
    if (targetCfg.isFriendOrFoe) {
      const activeTargets = this.targets.getTargets().filter((t) => t.alive);
      const enemyCount = activeTargets.filter((t) => t.kind === 'enemy').length;
      const friendCount = activeTargets.filter((t) => t.kind === 'friend').length;

      if (enemyCount === 0) {
        kind = 'enemy';
      } else if (friendCount === 0 && activeTargets.length >= 1) {
        kind = 'friend';
      } else {
        kind = this.rng() < 0.35 ? 'friend' : 'enemy';
      }
    }

    switch (spawner.mode) {
      case 'fixed_points': {
        const points = spawner.fixedPoints;
        let bestPt = points[0];
        let maxMinDist = -1;

        for (const pt of points) {
          const v = new THREE.Vector3(pt.x, pt.y, pt.z);
          let minDist = Infinity;
          for (const t of this.targets.getTargets()) {
            if (t.alive) minDist = Math.min(minDist, v.distanceTo(t.position));
          }
          if (minDist > 1.5) {
            bestPt = pt;
            break;
          }
          if (minDist > maxMinDist) {
            maxMinDist = minDist;
            bestPt = pt;
          }
        }
        pos = new THREE.Vector3(bestPt.x, bestPt.y, bestPt.z);
        break;
      }

      case 'grid': {
        const { rows, cols, spacingX, spacingY } = spawner.gridDimensions;
        const total = rows * cols;
        const startX = -((cols - 1) * spacingX) / 2;
        const startY = HEAD_LEVEL_Y - ((rows - 1) * spacingY) / 2;
        const freeSlots: THREE.Vector3[] = [];
        const minGap = Math.min(spacingX, spacingY) * 0.75;

        for (let idx = 0; idx < total; idx++) {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const cand = new THREE.Vector3(startX + col * spacingX, startY + row * spacingY, -12);
          if (this.isPositionValid(cand, minGap)) {
            freeSlots.push(cand);
          }
        }

        // Filter out the exact slot that was just killed so replacement always moves to a new location
        let eligibleSlots = freeSlots;
        if (this.lastKilledPos && freeSlots.length > 1) {
          const filtered = freeSlots.filter(s => s.distanceTo(this.lastKilledPos!) >= 1.0);
          if (filtered.length > 0) eligibleSlots = filtered;
        }

        if (eligibleSlots.length > 0) {
          pos = eligibleSlots[Math.floor(this.rng() * eligibleSlots.length)];
        } else {
          pos = new THREE.Vector3(startX, startY, -12);
        }
        break;
      }

      case 'random_arc': {
        const halfArcRad = ((spawner.arcDegrees / 2) * Math.PI) / 180;
        let chosen = new THREE.Vector3(0, HEAD_LEVEL_Y, -12);

        for (let attempt = 0; attempt < 15; attempt++) {
          const angle = -halfArcRad + this.rng() * (halfArcRad * 2);
          const dist = 10 + this.rng() * 5;
          const x = Math.sin(angle) * dist;
          const z = -Math.cos(angle) * dist;
          const y = this.config.headLevel ? HEAD_LEVEL_Y : HEAD_LEVEL_Y + (this.rng() - 0.5) * 1.5;
          const cand = new THREE.Vector3(x, y, z);
          if (this.isPositionValid(cand, 1.8)) {
            chosen = cand;
            break;
          }
          chosen = cand;
        }
        pos = chosen;
        break;
      }

      case 'random_area':
      case 'respawn_on_kill':
      case 'wave':
      case 'sequential':
      default: {
        if (this.config.id === 'aimlab-spidershot') {
          if (this.spidershotCenterNext) {
            pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -12);
          } else {
            const side = this.rng() > 0.5 ? 1 : -1;
            const x = side * (2.8 + this.rng() * 4.2);
            const y = HEAD_LEVEL_Y + (this.rng() - 0.5) * 2.2;
            pos = new THREE.Vector3(x, y, -12);
          }
          this.spidershotCenterNext = !this.spidershotCenterNext;
        } else if (this.config.environment.type === 'corridor' || this.config.id === 'headline') {
          // Corridor head-level
          let chosen = new THREE.Vector3(0, HEAD_LEVEL_Y, -14);
          for (let attempt = 0; attempt < 15; attempt++) {
            const x = (this.rng() - 0.5) * 4.5;
            const z = -(11 + this.rng() * 7);
            const cand = new THREE.Vector3(x, HEAD_LEVEL_Y, z);
            if (this.isPositionValid(cand, 1.8)) {
              chosen = cand;
              break;
            }
            chosen = cand;
          }
          pos = chosen;
        } else {
          const radius = spawner.spawnRadius || this.config.spawnRadius || 10;
          let chosen = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
          for (let attempt = 0; attempt < 15; attempt++) {
            const angle = (this.rng() - 0.5) * Math.PI * 0.7; // ~126 degree front arc
            const dist = 6 + this.rng() * (radius - 4);
            const x = Math.sin(angle) * dist;
            const z = -Math.cos(angle) * dist;
            const y = this.config.headLevel ? HEAD_LEVEL_Y : HEAD_LEVEL_Y + (this.rng() - 0.5) * 2.0;
            const cand = new THREE.Vector3(x, y, z);
            if (this.isPositionValid(cand, 1.8)) {
              if (this.lastKilledPos && cand.distanceTo(this.lastKilledPos) < 2.5 && attempt < 12) {
                continue;
              }
              chosen = cand;
              break;
            }
            chosen = cand;
          }
          pos = chosen;
        }
        break;
      }
    }

    const lifetime = spawner.targetLifetimeSec || this.config.targetLifetimeSec || 0;
    const spawned = this.targets.spawnTarget(this.config, pos, undefined, lifetime);

    if (spawned) {
      spawned.hp = targetCfg.hp;
      spawned.maxHp = targetCfg.hp;
      spawned.kind = kind;
      if (this.callbacks.onTargetSpawned) {
        this.callbacks.onTargetSpawned(spawned);
      }
    }
  }

  private spawnPeekTarget(_nowMs: number): void {
    if (!this.config || !this.targets) return;

    this.isPeekerActive = true;
    const { target: targetCfg } = this.config;
    const isFake = targetCfg.fakePeekChance > 0 && this.rng() < targetCfg.fakePeekChance;

    // Pick cover box
    const box = ARENA_COVER_BOXES[Math.floor(this.rng() * ARENA_COVER_BOXES.length)];
    const side = this.rng() > 0.5 ? 'right' : 'left';
    const anchorZ = box.max.z - 0.25;
    const hiddenX = box.center.x;

    // Fake peek: only emerge shoulder distance (0.15m), real swing: 0.85m outwards
    const displacement = isFake ? 0.15 : 0.85;
    const exposedX = getCoverExposedX(box, side, anchorZ, displacement);

    const pos = new THREE.Vector3(hiddenX, HEAD_LEVEL_Y, anchorZ);
    const spawned = this.targets.spawnTarget(this.config, pos, 'peek');

    if (spawned) {
      spawned.hp = targetCfg.hp;
      spawned.maxHp = targetCfg.hp;
      spawned.isFakePeek = isFake;
      spawned.controllerState = {
        type: 'cover_peek',
        mode: 'jiggle',
        boxId: box.id,
        side,
        state: 'emerging',
        stateTimer: 0,
        peekProgress: 0,
        hiddenX,
        exposedX,
        anchorY: HEAD_LEVEL_Y,
        anchorZ,
        emergeSpeed: 4.5 * this.config.targetSpeedMultiplier,
        retreatSpeed: 5.0 * this.config.targetSpeedMultiplier,
        exposedDuelDuration: isFake ? 0.08 : (targetCfg.peekDurationSec || 0.75),
        hiddenDuration: 0.3,
      };
      if (this.callbacks.onTargetSpawned) {
        this.callbacks.onTargetSpawned(spawned);
      }
    }
  }

  hasExposedTarget(): boolean {
    if (!this.targets) return false;
    for (const t of this.targets.getTargets()) {
      if (t.alive && !t.isCovered) {
        return true;
      }
    }
    return false;
  }
}
