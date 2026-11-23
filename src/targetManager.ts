// =====================================================================
// targetManager.ts — Target lifecycle, movement patterns & hit detection
// =====================================================================

import * as THREE from 'three';
import {
  TARGET_SIZE_DEFAULT,
  HEAD_LEVEL_Y,
  TARGET_SPAWN_DIST_MIN,
  TARGET_SPAWN_DIST_MAX,
  TARGET_HEAD_RADIUS,
  TARGET_TORSO_RADIUS,
  TARGET_TORSO_HEIGHT,
  TARGET_TORSO_OFFSET_Y,
  TARGET_LEGS_RADIUS,
  TARGET_LEGS_HEIGHT,
  TARGET_LEGS_OFFSET_Y,
} from './constants';
import type { MovementPattern, HitResult, ScenarioConfig, BodyPartType, HitRegionDimensions, TargetKind } from './types';
import {
  ARENA_COVER_BOXES,
  intersectRayCoverBoxes,
  getCoverExposedX,
  type TargetControllerState,
  updateTacticalStrafe,
  updateCoverPeek,
  updateSmoothSteering,
  updateMobility,
} from './movementControllers';

export interface TargetRenderer {
  addTarget(
    id: string,
    position: THREE.Vector3,
    radius: number,
    dimensions?: HitRegionDimensions,
    kind?: TargetKind
  ): void;
  updateTargetPosition(id: string, position: THREE.Vector3): void;
  removeTarget(id: string): void;
  clearTargets(): void;
  flashTarget?(id: string): void;
  getTargetPosition?(id: string): THREE.Vector3 | undefined;
}

export interface ActiveTarget {
  id: string;
  position: THREE.Vector3;
  radius: number;
  pattern: MovementPattern;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  phase: number;
  speed: number;
  range: number;
  alive: boolean;
  spawnTime: number;
  lifetimeSec: number;
  isCovered?: boolean;
  dimensions: HitRegionDimensions;
  directionChangeMultiplier?: number;
  pauseDuration?: number;
  controllerState?: TargetControllerState;
  hp?: number;
  maxHp?: number;
  kind?: TargetKind;
  isFakePeek?: boolean;
  retaliatory?: boolean;
  retaliateDelayMs?: number;
  retaliationPenalty?: number;
  timeVisibleMs?: number;
  hasRetaliated?: boolean;
  shielded?: boolean;
}

export interface TargetRayIntersection {
  bodyPart: BodyPartType;
  distance: number;
  accuracyScore: number;
}

/**
 * Generates a smooth periodic ping-pong waveform between -1 and +1 with a pause at each turnaround.
 * Continuous C0 and C1 (smooth zero velocity at turnaround before and after pause).
 * Guaranteed frame-rate independent and deterministic.
 */
export function pausedPingPong(phase: number, pauseRatio = 0.2): number {
  const twoPi = Math.PI * 2;
  let norm = phase % twoPi;
  if (norm < 0) norm += twoPi;

  const halfPeriod = Math.PI;
  const clampedPause = Math.min(0.45, Math.max(0.05, pauseRatio));
  const moveWindow = halfPeriod * (1 - clampedPause);

  if (norm < halfPeriod) {
    // Phase 1: moving from -1 to +1, then holding pause at +1
    if (norm < moveWindow) {
      const u = norm / moveWindow;
      return -Math.cos(Math.PI * u);
    }
    return 1.0;
  } else {
    // Phase 2: moving from +1 to -1, then holding pause at -1
    const sub = norm - halfPeriod;
    if (sub < moveWindow) {
      const u = sub / moveWindow;
      return Math.cos(Math.PI * u);
    }
    return -1.0;
  }
}

export class TargetManager {
  public onTargetExpired?: (target: ActiveTarget) => void;
  public onTargetRetaliate?: (target: ActiveTarget) => void;
  private renderer?: TargetRenderer;
  private targets = new Map<string, ActiveTarget>();
  private nextId = 1;
  private rng: () => number;
  private _vHeadCenter = new THREE.Vector3();
  private _vToCenter = new THREE.Vector3();

  constructor(renderer?: TargetRenderer, rng: () => number = Math.random) {
    this.renderer = renderer;
    this.rng = rng;
  }

  clear(): void {
    this.targets.clear();
    if (this.renderer && typeof this.renderer.clearTargets === 'function') {
      this.renderer.clearTargets();
    }
  }

  getActiveCount(): number {
    return this.targets.size;
  }

  getTargets(): ActiveTarget[] {
    return Array.from(this.targets.values());
  }

  getTarget(id: string): ActiveTarget | undefined {
    return this.targets.get(id);
  }

  spawnTarget(
    config: ScenarioConfig,
    customPos?: THREE.Vector3,
    customPattern?: MovementPattern,
    lifetimeSec = 0,
    customDimensions?: Partial<HitRegionDimensions>
  ): ActiveTarget {
    const id = `target_${this.nextId++}`;
    const radius = TARGET_SIZE_DEFAULT * config.targetSizeMultiplier;
    const scale = config.targetSizeMultiplier;

    const isSphere = config.target?.shape === 'sphere' || customDimensions?.shape === 'sphere';
    const hasLegs = !isSphere && Boolean(
      customDimensions?.legsHeight !== undefined ||
      config.target?.hitboxes?.legs !== undefined ||
      config.id === 'headline'
    );

    const dimensions: HitRegionDimensions = {
      shape: isSphere ? 'sphere' : 'humanoid',
      headRadius: customDimensions?.headRadius ?? (isSphere ? radius : TARGET_HEAD_RADIUS * scale),
      torsoRadius: customDimensions?.torsoRadius ?? (isSphere ? 0 : TARGET_TORSO_RADIUS * scale),
      torsoHeight: customDimensions?.torsoHeight ?? (isSphere ? 0 : TARGET_TORSO_HEIGHT * scale),
      torsoOffsetY: customDimensions?.torsoOffsetY ?? (isSphere ? 0 : TARGET_TORSO_OFFSET_Y * scale),
      headOffsetY: customDimensions?.headOffsetY ?? 0,
      legsRadius: hasLegs ? (customDimensions?.legsRadius ?? TARGET_LEGS_RADIUS * scale) : undefined,
      legsHeight: hasLegs ? (customDimensions?.legsHeight ?? TARGET_LEGS_HEIGHT * scale) : undefined,
      legsOffsetY: hasLegs ? (customDimensions?.legsOffsetY ?? TARGET_LEGS_OFFSET_Y * scale) : undefined,
    };

    let pos: THREE.Vector3;
    let controllerState: TargetControllerState | undefined;

    let pattern = customPattern || config.movementPattern;
    if (config.id === 'hybrid-clutch' && !customPattern) {
      const clutchIdx = this.targets.size % 3;
      if (clutchIdx === 0) pattern = 'wideswing';
      else if (clutchIdx === 1) pattern = 'strafe';
      else pattern = 'wander';
    }
    const speed = (2.0 + this.rng() * 2.5) * config.targetSpeedMultiplier;
    const range = 2.0 + this.rng() * 3.5;
    const dirMult = config.directionChangeMultiplier ?? 1.0;
    const effectiveLifetime = lifetimeSec || (config.targetLifetimeSec ?? 0);

    // Cover anchoring detection
    const isCoverScenario = !customPos && (
      config.id === 'tactical-jiggle' ||
      config.id === 'tactical-wideswing' ||
      config.id === 'tactical-angle-clear' ||
      config.id === 'flash-pop' ||
      pattern === 'wideswing'
    );

    if (customPos) {
      pos = customPos.clone();
    } else if (isCoverScenario) {
      // Anchor target relative to actual arena cover obstacles
      const boxIndex = (this.targets.size + Math.floor(this.rng() * ARENA_COVER_BOXES.length)) % ARENA_COVER_BOXES.length;
      const box = ARENA_COVER_BOXES[boxIndex];
      const side = this.rng() > 0.5 ? 'right' : 'left';
      // Anchor depth: 0.25m behind near face ensures hidden target is tucked behind cover obstacle
      const anchorZ = box.max.z - 0.25;

      if (config.id === 'tactical-angle-clear') {
        // Methodical angle clearing: stationary target placed right at the near corner boundary
        const cornerMargin = 0.40;
        const cornerX = side === 'right' ? box.rightEdgeX + cornerMargin : box.leftEdgeX - cornerMargin;
        pos = new THREE.Vector3(cornerX, HEAD_LEVEL_Y, box.max.z);
      } else if (config.id === 'tactical-jiggle') {
        // Fast ADAD shoulder peek from behind cover box with perspective-corrected line of sight
        const hiddenX = box.center.x;
        const exposedX = getCoverExposedX(box, side, anchorZ, 0.45);
        pos = new THREE.Vector3(hiddenX, HEAD_LEVEL_Y, anchorZ);
        controllerState = {
          type: 'cover_peek',
          mode: 'jiggle',
          boxId: box.id,
          side,
          state: 'hidden',
          stateTimer: 0.1 + this.rng() * 0.25,
          peekProgress: 0,
          hiddenX,
          exposedX,
          anchorY: HEAD_LEVEL_Y,
          anchorZ,
          emergeSpeed: (3.8 + this.rng() * 1.2) * config.targetSpeedMultiplier,
          retreatSpeed: (4.2 + this.rng() * 1.2) * config.targetSpeedMultiplier,
          exposedDuelDuration: Math.max(0.20, (0.32 + this.rng() * 0.14) / dirMult),
          hiddenDuration: Math.max(0.25, (0.40 + this.rng() * 0.30) / dirMult),
        };
      } else if (config.id === 'tactical-wideswing' || pattern === 'wideswing') {
        // Aggressive wide swing from behind cover: high speed emergence, deceleration into duel deadstop
        const swingInwards = box.center.x < 0 ? 'right' : 'left';
        const hiddenX = box.center.x;
        const exposedX = getCoverExposedX(box, swingInwards, anchorZ, 2.0);
        pos = new THREE.Vector3(hiddenX, HEAD_LEVEL_Y, anchorZ);
        controllerState = {
          type: 'cover_peek',
          mode: 'wideswing',
          boxId: box.id,
          side: swingInwards,
          state: 'emerging',
          stateTimer: 0,
          peekProgress: 0,
          hiddenX,
          exposedX,
          anchorY: HEAD_LEVEL_Y,
          anchorZ,
          emergeSpeed: (4.4 + this.rng() * 1.4) * config.targetSpeedMultiplier,
          retreatSpeed: 3.2 * config.targetSpeedMultiplier,
          exposedDuelDuration: Math.max(0.40, (0.70 + this.rng() * 0.25) / dirMult),
          hiddenDuration: 0.8,
        };
      } else {
        // flash-pop: synchronized cover emergence for flash duel
        const hiddenX = box.center.x;
        const exposedX = getCoverExposedX(box, side, anchorZ, 1.2);
        pos = new THREE.Vector3(hiddenX, HEAD_LEVEL_Y, anchorZ);
        controllerState = {
          type: 'cover_peek',
          mode: 'peek',
          boxId: box.id,
          side,
          state: 'emerging',
          stateTimer: 0,
          peekProgress: 0,
          hiddenX,
          exposedX,
          anchorY: HEAD_LEVEL_Y,
          anchorZ,
          emergeSpeed: 3.5 * config.targetSpeedMultiplier,
          retreatSpeed: 3.8 * config.targetSpeedMultiplier,
          exposedDuelDuration: Math.max(0.50, 0.85 / dirMult),
          hiddenDuration: 0.7,
        };
      }
    } else {
      // Random angle in front of player (arc of approx 140° or wide swing)
      let arc = Math.PI * 0.75;
      if (config.category === 'tactical' && config.name.includes('Wide Swing')) {
        arc = Math.PI * 0.95;
      }

      // Generate non-overlapping position within arena limits (up to 8 attempts)
      const minDistance = Math.max(1.2, radius * 2.5);
      let bestCandidate = new THREE.Vector3();
      let bestDist = -1;

      for (let attempt = 0; attempt < 8; attempt++) {
        const angle = (this.rng() - 0.5) * arc;
        const dist = TARGET_SPAWN_DIST_MIN + this.rng() * (TARGET_SPAWN_DIST_MAX - TARGET_SPAWN_DIST_MIN);

        const x = Math.max(-16.0, Math.min(16.0, Math.sin(angle) * dist));
        const z = Math.max(-18.0, Math.min(-3.5, -Math.cos(angle) * dist));

        let y = HEAD_LEVEL_Y;
        if (!config.headLevel) {
          y = HEAD_LEVEL_Y + (this.rng() - 0.5) * 1.8;
        }
        y = Math.max(0.6, Math.min(3.2, y));

        const candidate = new THREE.Vector3(x, y, z);

        // Check distance to existing targets
        let closestOther = Infinity;
        for (const existing of this.targets.values()) {
          const d = candidate.distanceTo(existing.position);
          if (d < closestOther) closestOther = d;
        }

        if (closestOther >= minDistance || this.targets.size === 0) {
          bestCandidate = candidate;
          break;
        }

        if (closestOther > bestDist) {
          bestDist = closestOther;
          bestCandidate = candidate;
        }
      }

      pos = bestCandidate;
    }

    // Initialize behaviour controller state for dynamic non-cover targets if not yet assigned
    if (!controllerState && pattern !== 'static') {
      if (pattern === 'vertical' || config.id === 'track-vertical') {
        // MobilityController: parabolic updraft and jump physics with gravity
        controllerState = {
          type: 'mobility',
          vy: (6.5 + this.rng() * 1.5) * config.targetSpeedMultiplier,
          vx: (this.rng() - 0.5) * 2.0 * config.targetSpeedMultiplier,
          gravity: -18.0,
          jumpImpulse: (7.2 + this.rng() * 1.8) * config.targetSpeedMultiplier,
          groundY: pos.y,
          maxJumpY: pos.y + 2.2,
          state: 'ascending',
          stateTimer: 0,
          strafeDir: this.rng() > 0.5 ? 1 : -1,
          driftSpeed: (1.2 + this.rng() * 1.0) * config.targetSpeedMultiplier,
        };
      } else if (config.id === 'hybrid-clutch') {
        // 3 distinct threats: Target 0 = wide-swing, Target 1 = tactical strafe, Target 2 = steering flanker
        const clutchIdx = this.targets.size % 3;
        if (clutchIdx === 0) {
          controllerState = {
            type: 'tactical_strafe',
            direction: this.rng() > 0.5 ? 1 : -1,
            currentSpeed: 0,
            cruiseSpeed: 3.6 * config.targetSpeedMultiplier,
            accel: 16.0,
            state: 'accelerating',
            stateTimer: 0,
            minStrafeDuration: 0.5,
            maxStrafeDuration: 1.0,
            deadstopDuration: 0.25,
            minX: Math.max(-17.5, pos.x - 3.5),
            maxX: Math.min(17.5, pos.x + 3.5),
          };
        } else if (clutchIdx === 1) {
          controllerState = {
            type: 'tactical_strafe',
            direction: this.rng() > 0.5 ? 1 : -1,
            currentSpeed: 0,
            cruiseSpeed: 2.8 * config.targetSpeedMultiplier,
            accel: 14.0,
            state: 'accelerating',
            stateTimer: 0,
            minStrafeDuration: 0.3,
            maxStrafeDuration: 0.6,
            deadstopDuration: 0.18,
            minX: Math.max(-17.5, pos.x - 2.5),
            maxX: Math.min(17.5, pos.x + 2.5),
          };
        } else {
          controllerState = {
            type: 'smooth_steering',
            vx: (this.rng() - 0.5) * 2.5 * config.targetSpeedMultiplier,
            vz: (this.rng() - 0.5) * 2.5 * config.targetSpeedMultiplier,
            targetVx: 0,
            targetVz: 0,
            speed: 2.5 * config.targetSpeedMultiplier,
            turnRate: 2.2,
            changeTimer: 0,
            isReactive: true,
            minZ: -17.5,
            maxZ: -4.0,
          };
        }
      } else if (pattern === 'strafe') {
        // TacticalStrafeController: human counter-strafing with dead-zone stopping
        const cruise = (2.6 + this.rng() * 1.4) * config.targetSpeedMultiplier;
        controllerState = {
          type: 'tactical_strafe',
          direction: this.rng() > 0.5 ? 1 : -1,
          currentSpeed: 0,
          cruiseSpeed: cruise,
          accel: 14.0,
          state: 'accelerating',
          stateTimer: 0,
          minStrafeDuration: 0.35 / dirMult,
          maxStrafeDuration: 0.75 / dirMult,
          deadstopDuration: Math.max(0.12, 0.22 / dirMult),
          minX: Math.max(-18.0, pos.x - range),
          maxX: Math.min(18.0, pos.x + range),
        };
      } else if (pattern === 'wander' || pattern === 'variable') {
        // SmoothSteeringController: 2D wander with fluid vector steering and bound repelling
        const wanderSpeed = (2.2 + this.rng() * 1.5) * config.targetSpeedMultiplier;
        controllerState = {
          type: 'smooth_steering',
          vx: (this.rng() - 0.5) * wanderSpeed,
          vz: (this.rng() - 0.5) * wanderSpeed,
          targetVx: 0,
          targetVz: 0,
          speed: wanderSpeed,
          turnRate: pattern === 'variable' ? 3.8 : 1.8,
          changeTimer: 0,
          isReactive: pattern === 'variable',
          minZ: -17.5,
          maxZ: -3.5,
        };
      }
    }

    const target: ActiveTarget = {
      id,
      position: pos.clone(),
      radius,
      pattern,
      origin: pos.clone(),
      velocity: new THREE.Vector3(
        (this.rng() - 0.5) * speed,
        0,
        (this.rng() - 0.5) * speed
      ),
      // For peek pattern (Flash-Pop), start at phase 0 so newly spawned targets immediately begin their active emergence movement
      phase: pattern === 'peek' ? 0 : this.rng() * Math.PI * 2,
      speed,
      range,
      alive: true,
      spawnTime: performance.now(),
      lifetimeSec: effectiveLifetime,
      dimensions,
      directionChangeMultiplier: dirMult,
      pauseDuration: 0.20,
      controllerState,
      hp: config.target?.hp,
      maxHp: config.target?.hp,
      kind: config.target?.kind,
      retaliatory: Boolean(config.target?.retaliatory || config.id.includes('skirmish') || config.id === 'tactical-skirmish'),
      retaliateDelayMs: config.target?.retaliateDelayMs ?? 850,
      retaliationPenalty: config.target?.retaliationPenalty ?? 250,
      timeVisibleMs: 0,
      hasRetaliated: false,
      shielded: Boolean(config.target?.shielded),
    };

    this.targets.set(id, target);
    if (target.kind) {
      this.renderer?.addTarget(id, target.position, target.radius, target.dimensions, target.kind);
    } else {
      this.renderer?.addTarget(id, target.position, target.radius, target.dimensions);
    }
    return target;
  }

  update(delta: number, now = performance.now(), playerPos?: THREE.Vector3): void {
    const dt = Math.min(delta, 0.1);
    const toRemove: string[] = [];

    for (const [id, target] of this.targets) {
      if (!target.alive) {
        toRemove.push(id);
        continue;
      }

      // Check lifetime expiration
      if (target.lifetimeSec > 0) {
        const elapsed = (now - target.spawnTime) / 1000;
        if (elapsed >= target.lifetimeSec) {
          if (this.onTargetExpired) {
            this.onTargetExpired(target);
          }
          toRemove.push(id);
          continue;
        }
      }

      if (target.controllerState) {
        switch (target.controllerState.type) {
          case 'tactical_strafe':
            updateTacticalStrafe(target.controllerState, target.position, dt, this.rng);
            break;
          case 'cover_peek':
            updateCoverPeek(target.controllerState, target.position, dt, this.rng);
            target.isCovered = target.controllerState.state === 'hidden';
            break;
          case 'smooth_steering':
            updateSmoothSteering(target.controllerState, target.position, dt, this.rng);
            break;
          case 'mobility':
            updateMobility(target.controllerState, target.position, dt, this.rng);
            break;
        }
      } else {
        target.phase += dt * target.speed;

        switch (target.pattern) {
          case 'static':
            // Stays at origin
            target.position.copy(target.origin);
            break;

          case 'strafe': {
            // Smooth lateral strafe with turnaround pause
            const pause = target.pauseDuration ?? 0.20;
            const wave = pausedPingPong(target.phase, pause);
            target.position.x = target.origin.x + wave * target.range;
            break;
          }

          case 'jiggle': {
            // Sharp fast jiggle peek (ADAD peek) with snappy direction reversals
            const freq = (target.directionChangeMultiplier ?? 1.0) * 2.2;
            const wave = pausedPingPong(target.phase * freq, 0.25);
            target.position.x = target.origin.x + wave * (target.range * 0.55);
            break;
          }

          case 'wander': {
            // Smooth 2D wandering in arena
            const freq = target.directionChangeMultiplier ?? 1.0;
            const nx = target.origin.x + Math.sin(target.phase * 0.7 * freq) * target.range;
            const nz = target.origin.z + Math.cos(target.phase * 0.9 * freq) * (target.range * 0.7);
            target.position.x = nx;
            target.position.z = nz;
            break;
          }

          case 'peek': {
            // Emerge from cover, stay exposed briefly, then retreat
            const cycle = (target.phase % (Math.PI * 2));
            if (cycle < Math.PI) {
              const u = cycle / Math.PI;
              target.position.x = target.origin.x + Math.sin(u * Math.PI) * target.range;
              target.isCovered = false;
            } else {
              target.position.x = target.origin.x;
              target.isCovered = true;
            }
            break;
          }

          case 'vertical': {
            // Oscillate elevation to practice micro adjustments on crouch/jump
            const freq = target.directionChangeMultiplier ?? 1.0;
            const vertOffset = Math.sin(target.phase * 1.5 * freq) * (target.range * 0.35);
            target.position.y = Math.max(0.4, target.origin.y + vertOffset);
            break;
          }

          case 'variable': {
            // Variable-speed strafing with alternating intervals and pauses
            const freq = target.directionChangeMultiplier ?? 1.0;
            const speedFactor = 0.5 + 0.5 * Math.sin(target.phase * 0.4 * freq);
            const wave = pausedPingPong(target.phase * (0.8 + 0.5 * speedFactor), 0.20);
            target.position.x = target.origin.x + wave * target.range;
            break;
          }
        }
      }

      // Enforce arena boundaries (arena floor is 40x40, walls at +/-20)
      target.position.x = Math.max(-18.5, Math.min(18.5, target.position.x));
      target.position.y = Math.max(0.4, Math.min(6.5, target.position.y));
      target.position.z = Math.max(-18.5, Math.min(-2.5, target.position.z));

      // Retaliatory threat accumulation when exposed to player line-of-sight
      const inLos = this.hasLineOfSight(target, playerPos);
      if (target.alive && target.retaliatory && inLos && !target.shielded) {
        target.timeVisibleMs = (target.timeVisibleMs || 0) + dt * 1000;
        if (!target.hasRetaliated && target.timeVisibleMs >= (target.retaliateDelayMs || 850)) {
          target.hasRetaliated = true;
          if (this.onTargetRetaliate) {
            this.onTargetRetaliate(target);
          }
        }
      } else if (!inLos) {
        target.timeVisibleMs = 0;
      }

      this.renderer?.updateTargetPosition(id, target.position);
    }

    for (const id of toRemove) {
      this.removeTarget(id);
    }
  }

  hasLineOfSight(target: ActiveTarget, playerPos = new THREE.Vector3(0, 1.7, 0)): boolean {
    if (!target.alive || target.shielded || target.isCovered) return false;
    if (target.controllerState?.type === 'cover_peek' && target.controllerState.state === 'hidden') {
      return false;
    }
    // Arena boundaries / walls: arena floor is 40x40 (-20 to 20), height 0 to 8
    if (
      Math.abs(target.position.x) > 20 ||
      Math.abs(target.position.z) > 20 ||
      target.position.y < 0 ||
      target.position.y > 8
    ) {
      return false;
    }
    // Ray from player eye position to target center
    const toTarget = new THREE.Vector3().subVectors(target.position, playerPos);
    const dist = toTarget.length();
    if (dist <= 0.001) return true;
    toTarget.normalize();
    const ray = new THREE.Ray(playerPos, toTarget);
    const coverDist = intersectRayCoverBoxes(ray);
    if (coverDist < dist - 0.05) {
      return false;
    }
    return true;
  }

  getHighestThreatProgress(playerPos?: THREE.Vector3): number {
    let highest = 0;
    for (const target of this.targets.values()) {
      if (target.alive && target.retaliatory && !target.shielded && !target.hasRetaliated && this.hasLineOfSight(target, playerPos)) {
        const delay = target.retaliateDelayMs || 850;
        const prog = Math.min(1, (target.timeVisibleMs || 0) / delay);
        if (prog > highest) highest = prog;
      }
    }
    return highest;
  }

  removeTarget(id: string): void {
    const target = this.targets.get(id);
    if (target) {
      target.alive = false;
      this.targets.delete(id);
      this.renderer?.removeTarget(id);
    }
  }

  // ── Hit Detection ───────────────────────────────────────────────────

  /**
   * Ray-sphere intersection for target head hit region.
   */
  private intersectHead(
    ray: THREE.Ray,
    target: ActiveTarget
  ): { distance: number; accuracyScore: number } | null {
    this._vHeadCenter.set(
      target.position.x,
      target.position.y + (target.dimensions.headOffsetY ?? 0),
      target.position.z
    );
    const radius = target.dimensions.headRadius;

    // Vector from ray origin to sphere center
    this._vToCenter.subVectors(this._vHeadCenter, ray.origin);
    const proj = this._vToCenter.dot(ray.direction);

    // Head is behind ray origin
    if (proj <= 0) return null;

    // Perpendicular distance squared from ray to sphere center
    const toCenterSq = this._vToCenter.lengthSq();
    const perpDistSq = toCenterSq - proj * proj;
    const radiusSq = radius * radius;

    if (perpDistSq > radiusSq) {
      return null;
    }

    // Distance to entry intersection along ray
    const halfChord = Math.sqrt(radiusSq - perpDistSq);
    let hitDistance = proj - halfChord;
    if (hitDistance <= 0) {
      hitDistance = proj + halfChord;
      if (hitDistance <= 0) return null;
    }

    const perpDist = Math.sqrt(Math.max(0, perpDistSq));
    const accuracyScore = Math.max(0, 1 - perpDist / radius);

    return { distance: hitDistance, accuracyScore };
  }

  /**
   * Ray-cylinder intersection for target torso hit region (including caps).
   */
  private intersectTorso(
    ray: THREE.Ray,
    target: ActiveTarget
  ): { distance: number; accuracyScore: number } | null {
    const torsoY = target.position.y + target.dimensions.torsoOffsetY;
    const halfH = target.dimensions.torsoHeight / 2;
    const yMin = torsoY - halfH;
    const yMax = torsoY + halfH;
    const radius = target.dimensions.torsoRadius;
    const radiusSq = radius * radius;

    const ox = ray.origin.x - target.position.x;
    const oz = ray.origin.z - target.position.z;
    const dx = ray.direction.x;
    const dz = ray.direction.z;

    const a = dx * dx + dz * dz;
    let minT = Infinity;

    // Ray-cylinder wall intersection in XZ plane
    if (a > 1e-9) {
      const b = ox * dx + oz * dz;
      const c = ox * ox + oz * oz - radiusSq;
      const disc = b * b - a * c;

      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / a;
        const t2 = (-b + sqrtDisc) / a;

        for (const t of [t1, t2]) {
          if (t > 0 && t < minT) {
            const hitY = ray.origin.y + t * ray.direction.y;
            if (hitY >= yMin && hitY <= yMax) {
              minT = t;
            }
          }
        }
      }
    }

    // Top and bottom disk caps
    if (Math.abs(ray.direction.y) > 1e-9) {
      for (const capY of [yMin, yMax]) {
        const t = (capY - ray.origin.y) / ray.direction.y;
        if (t > 0 && t < minT) {
          const hitX = ox + t * dx;
          const hitZ = oz + t * dz;
          if (hitX * hitX + hitZ * hitZ <= radiusSq) {
            minT = t;
          }
        }
      }
    }

    if (minT === Infinity) {
      return null;
    }

    // Compute accuracy relative to torso central axis in horizontal plane
    let accuracyScore = 0;
    if (a > 1e-9) {
      const b = ox * dx + oz * dz;
      const proj = -b / a;
      const perpX = ox + proj * dx;
      const perpZ = oz + proj * dz;
      const perpDist = Math.sqrt(perpX * perpX + perpZ * perpZ);
      accuracyScore = Math.max(0, 1 - perpDist / radius);
    }

    return { distance: minT, accuracyScore };
  }

  /**
   * Ray-cylinder intersection for target legs hit region.
   */
  private intersectLegs(
    ray: THREE.Ray,
    target: ActiveTarget
  ): { distance: number; accuracyScore: number } | null {
    if (!target.dimensions.legsHeight || !target.dimensions.legsRadius) {
      return null;
    }
    const legsY = target.position.y + (target.dimensions.legsOffsetY ?? -0.90);
    const halfH = target.dimensions.legsHeight / 2;
    const yMin = legsY - halfH;
    const yMax = legsY + halfH;
    const radius = target.dimensions.legsRadius;
    const radiusSq = radius * radius;

    const ox = ray.origin.x - target.position.x;
    const oz = ray.origin.z - target.position.z;
    const dx = ray.direction.x;
    const dz = ray.direction.z;

    const a = dx * dx + dz * dz;
    let minT = Infinity;

    if (a > 1e-9) {
      const b = ox * dx + oz * dz;
      const c = ox * ox + oz * oz - radiusSq;
      const disc = b * b - a * c;

      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / a;
        const t2 = (-b + sqrtDisc) / a;

        for (const t of [t1, t2]) {
          if (t > 0 && t < minT) {
            const hitY = ray.origin.y + t * ray.direction.y;
            if (hitY >= yMin && hitY <= yMax) {
              minT = t;
            }
          }
        }
      }
    }

    if (Math.abs(ray.direction.y) > 1e-9) {
      for (const capY of [yMin, yMax]) {
        const t = (capY - ray.origin.y) / ray.direction.y;
        if (t > 0 && t < minT) {
          const hitX = ox + t * dx;
          const hitZ = oz + t * dz;
          if (hitX * hitX + hitZ * hitZ <= radiusSq) {
            minT = t;
          }
        }
      }
    }

    if (minT === Infinity) {
      return null;
    }

    let accuracyScore = 0;
    if (a > 1e-9) {
      const b = ox * dx + oz * dz;
      const proj = -b / a;
      const perpX = ox + proj * dx;
      const perpZ = oz + proj * dz;
      const perpDist = Math.sqrt(perpX * perpX + perpZ * perpZ);
      accuracyScore = Math.max(0, 1 - perpDist / radius);
    }

    return { distance: minT, accuracyScore };
  }

  /**
   * Tests ray intersection against head, torso, and legs regions of a single target.
   * Nearest intersection along the ray wins.
   */
  intersectTarget(ray: THREE.Ray, target: ActiveTarget): TargetRayIntersection | null {
    const headHit = this.intersectHead(ray, target);
    if (target.dimensions.shape === 'sphere') {
      if (headHit) {
        return {
          bodyPart: 'head',
          distance: headHit.distance,
          accuracyScore: headHit.accuracyScore,
        };
      }
      return null;
    }

    const torsoHit = this.intersectTorso(ray, target);
    const legsHit = this.intersectLegs(ray, target);

    let best: TargetRayIntersection | null = null;

    if (headHit) {
      best = {
        bodyPart: 'head',
        distance: headHit.distance,
        accuracyScore: headHit.accuracyScore,
      };
    }

    if (torsoHit && (!best || torsoHit.distance < best.distance)) {
      best = {
        bodyPart: 'torso',
        distance: torsoHit.distance,
        accuracyScore: torsoHit.accuracyScore,
      };
    }

    if (legsHit && (!best || legsHit.distance < best.distance)) {
      best = {
        bodyPart: 'legs',
        distance: legsHit.distance,
        accuracyScore: legsHit.accuracyScore,
      };
    }

    return best;
  }

  /**
   * Raycast from crosshair to find nearest valid target hit.
   * Nearest target along ray wins.
   */
  checkHit(ray: THREE.Ray, checkCover = true): HitResult {
    let closestTarget: ActiveTarget | null = null;
    let closestIntersection: TargetRayIntersection | null = null;
    let minDistance = Infinity;

    // Test ray against solid arena cover geometry only if scenario uses cover
    const coverDist = checkCover ? intersectRayCoverBoxes(ray) : Infinity;

    for (const target of this.targets.values()) {
      if (!target.alive) continue;

      const hit = this.intersectTarget(ray, target);
      if (hit && hit.distance < minDistance) {
        minDistance = hit.distance;
        closestTarget = target;
        closestIntersection = hit;
      }
    }

    // Cover occlusion: if cover is closer than the nearest target along the ray, cover blocks the shot
    if (coverDist < minDistance) {
      return {
        hit: false,
        headshot: false,
        targetId: '',
        distanceMetres: 0,
        reactionMs: 0,
        accuracyScore: 0,
      };
    }

    if (closestTarget && closestIntersection) {
      const reactionMs = performance.now() - closestTarget.spawnTime;
      return {
        hit: true,
        headshot: closestIntersection.bodyPart === 'head',
        bodyPart: closestIntersection.bodyPart,
        targetId: closestTarget.id,
        distanceMetres: minDistance,
        reactionMs,
        accuracyScore: closestIntersection.accuracyScore,
      };
    }

    return {
      hit: false,
      headshot: false,
      targetId: '',
      distanceMetres: 0,
      reactionMs: 0,
      accuracyScore: 0,
    };
  }

  /**
   * Evaluates tracking: is crosshair currently hovering over any valid hit region?
   */
  checkTracking(ray: THREE.Ray, checkCover = true): {
    isOnTarget: boolean;
    targetId?: string;
    accuracy: number;
    bodyPart?: BodyPartType;
  } {
    let closestTarget: ActiveTarget | null = null;
    let closestIntersection: TargetRayIntersection | null = null;
    let minDistance = Infinity;

    const coverDist = checkCover ? intersectRayCoverBoxes(ray) : Infinity;

    for (const target of this.targets.values()) {
      if (!target.alive) continue;

      const hit = this.intersectTarget(ray, target);
      if (hit && hit.distance < minDistance) {
        minDistance = hit.distance;
        closestTarget = target;
        closestIntersection = hit;
      }
    }

    // If cover is between crosshair and target, tracking ray is blocked
    if (coverDist < minDistance && closestTarget) {
      return { isOnTarget: false, accuracy: 0 };
    }

    if (closestTarget && closestIntersection) {
      return {
        isOnTarget: true,
        targetId: closestTarget.id,
        accuracy: closestIntersection.accuracyScore,
        bodyPart: closestIntersection.bodyPart,
      };
    }

    return { isOnTarget: false, accuracy: 0 };
  }
}
