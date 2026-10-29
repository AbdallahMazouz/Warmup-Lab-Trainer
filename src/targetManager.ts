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
} from './constants';
import type { MovementPattern, HitResult, ScenarioConfig, BodyPartType, HitRegionDimensions } from './types';

export interface TargetRenderer {
  addTarget(
    id: string,
    position: THREE.Vector3,
    radius: number,
    dimensions?: HitRegionDimensions
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

    const dimensions: HitRegionDimensions = {
      headRadius: customDimensions?.headRadius ?? TARGET_HEAD_RADIUS * scale,
      torsoRadius: customDimensions?.torsoRadius ?? TARGET_TORSO_RADIUS * scale,
      torsoHeight: customDimensions?.torsoHeight ?? TARGET_TORSO_HEIGHT * scale,
      torsoOffsetY: customDimensions?.torsoOffsetY ?? TARGET_TORSO_OFFSET_Y * scale,
      headOffsetY: customDimensions?.headOffsetY ?? 0,
    };

    let pos: THREE.Vector3;

    if (customPos) {
      pos = customPos.clone();
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

    const pattern = customPattern || config.movementPattern;
    const speed = (2.0 + this.rng() * 2.5) * config.targetSpeedMultiplier;
    const range = 2.0 + this.rng() * 3.5;
    const dirMult = config.directionChangeMultiplier ?? 1.0;
    const effectiveLifetime = lifetimeSec || (config.targetLifetimeSec ?? 0);

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
      phase: this.rng() * Math.PI * 2,
      speed,
      range,
      alive: true,
      spawnTime: performance.now(),
      lifetimeSec: effectiveLifetime,
      dimensions,
      directionChangeMultiplier: dirMult,
      pauseDuration: 0.20,
    };

    this.targets.set(id, target);
    this.renderer?.addTarget(id, target.position, target.radius, target.dimensions);
    return target;
  }

  update(delta: number, now = performance.now()): void {
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
          toRemove.push(id);
          continue;
        }
      }

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

      // Enforce arena boundaries (arena floor is 40x40, walls at +/-20)
      target.position.x = Math.max(-18.5, Math.min(18.5, target.position.x));
      target.position.y = Math.max(0.4, Math.min(6.5, target.position.y));
      target.position.z = Math.max(-18.5, Math.min(-2.5, target.position.z));

      this.renderer?.updateTargetPosition(id, target.position);
    }

    for (const id of toRemove) {
      this.removeTarget(id);
    }
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
   * Tests ray intersection against both head and torso regions of a single target.
   * If both are intersected, the closer intersection along the ray wins.
   */
  intersectTarget(ray: THREE.Ray, target: ActiveTarget): TargetRayIntersection | null {
    const headHit = this.intersectHead(ray, target);
    const torsoHit = this.intersectTorso(ray, target);

    if (headHit && torsoHit) {
      if (headHit.distance <= torsoHit.distance) {
        return {
          bodyPart: 'head',
          distance: headHit.distance,
          accuracyScore: headHit.accuracyScore,
        };
      } else {
        return {
          bodyPart: 'torso',
          distance: torsoHit.distance,
          accuracyScore: torsoHit.accuracyScore,
        };
      }
    }

    if (headHit) {
      return {
        bodyPart: 'head',
        distance: headHit.distance,
        accuracyScore: headHit.accuracyScore,
      };
    }

    if (torsoHit) {
      return {
        bodyPart: 'torso',
        distance: torsoHit.distance,
        accuracyScore: torsoHit.accuracyScore,
      };
    }

    return null;
  }

  /**
   * Raycast from crosshair to find nearest valid target hit.
   * Nearest target along ray wins.
   */
  checkHit(ray: THREE.Ray): HitResult {
    let closestTarget: ActiveTarget | null = null;
    let closestIntersection: TargetRayIntersection | null = null;
    let minDistance = Infinity;

    for (const target of this.targets.values()) {
      if (!target.alive) continue;

      const hit = this.intersectTarget(ray, target);
      if (hit && hit.distance < minDistance) {
        minDistance = hit.distance;
        closestTarget = target;
        closestIntersection = hit;
      }
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
  checkTracking(ray: THREE.Ray): {
    isOnTarget: boolean;
    targetId?: string;
    accuracy: number;
    bodyPart?: BodyPartType;
  } {
    let closestTarget: ActiveTarget | null = null;
    let closestIntersection: TargetRayIntersection | null = null;
    let minDistance = Infinity;

    for (const target of this.targets.values()) {
      if (!target.alive) continue;

      const hit = this.intersectTarget(ray, target);
      if (hit && hit.distance < minDistance) {
        minDistance = hit.distance;
        closestTarget = target;
        closestIntersection = hit;
      }
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
