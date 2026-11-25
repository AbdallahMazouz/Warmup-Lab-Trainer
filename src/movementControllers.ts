// =====================================================================
// movementControllers.ts — Reusable Behaviour Controllers & Cover System
// =====================================================================

import * as THREE from 'three';
import { HEAD_LEVEL_Y } from './constants';
import type { BotPersonalityId } from './types';

// ── Arena Cover Boxes (Geometry matches Renderer.buildArena) ───────────
export interface ArenaCoverBox {
  id: string;
  name: string;
  center: { x: number; y: number; z: number };
  size: { w: number; h: number; d: number };
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  leftEdgeX: number;
  rightEdgeX: number;
  standY: number;
}

export const ARENA_COVER_BOXES: ArenaCoverBox[] = [
  // Front-Left Cover Box: center (-8, 1, -8), w=2, h=2, d=0.4
  {
    id: 'front_left',
    name: 'Front-Left Barrier',
    center: { x: -8, y: 1, z: -8 },
    size: { w: 2, h: 2, d: 0.4 },
    min: { x: -9.0, y: 0.0, z: -8.2 },
    max: { x: -7.0, y: 2.0, z: -7.8 },
    leftEdgeX: -9.0,
    rightEdgeX: -7.0,
    standY: HEAD_LEVEL_Y,
  },
  // Front-Right Cover Box: center (8, 1, -8), w=2, h=2, d=0.4
  {
    id: 'front_right',
    name: 'Front-Right Barrier',
    center: { x: 8, y: 1, z: -8 },
    size: { w: 2, h: 2, d: 0.4 },
    min: { x: 7.0, y: 0.0, z: -8.2 },
    max: { x: 9.0, y: 2.0, z: -7.8 },
    leftEdgeX: 7.0,
    rightEdgeX: 9.0,
    standY: HEAD_LEVEL_Y,
  },
  // Deep-Left Pillar: center (-6, 1, -14), w=0.4, h=2, d=3
  {
    id: 'deep_left',
    name: 'Deep-Left Column',
    center: { x: -6, y: 1, z: -14 },
    size: { w: 0.4, h: 2, d: 3 },
    min: { x: -6.2, y: 0.0, z: -15.5 },
    max: { x: -5.8, y: 2.0, z: -12.5 },
    leftEdgeX: -6.2,
    rightEdgeX: -5.8,
    standY: HEAD_LEVEL_Y,
  },
  // Deep-Right Pillar: center (6, 1, -14), w=0.4, h=2, d=3
  {
    id: 'deep_right',
    name: 'Deep-Right Column',
    center: { x: 6, y: 1, z: -14 },
    size: { w: 0.4, h: 2, d: 3 },
    min: { x: 5.8, y: 0.0, z: -15.5 },
    max: { x: 6.2, y: 2.0, z: -12.5 },
    leftEdgeX: 5.8,
    rightEdgeX: 6.2,
    standY: HEAD_LEVEL_Y,
  },
];

/**
 * Fast ray-AABB intersection slab test against all arena cover obstacles.
 * Returns closest intersection distance t > 0, or Infinity if no cover hit.
 */
export function intersectRayCoverBoxes(ray: THREE.Ray): number {
  let closestCoverDist = Infinity;

  const ox = ray.origin.x;
  const oy = ray.origin.y;
  const oz = ray.origin.z;
  const dx = ray.direction.x;
  const dy = ray.direction.y;
  const dz = ray.direction.z;

  for (let i = 0; i < ARENA_COVER_BOXES.length; i++) {
    const box = ARENA_COVER_BOXES[i];

    // X slabs
    let txMin: number, txMax: number;
    if (Math.abs(dx) > 1e-9) {
      txMin = (box.min.x - ox) / dx;
      txMax = (box.max.x - ox) / dx;
      if (txMin > txMax) { const tmp = txMin; txMin = txMax; txMax = tmp; }
    } else {
      if (ox < box.min.x || ox > box.max.x) continue;
      txMin = -Infinity;
      txMax = Infinity;
    }

    // Y slabs
    let tyMin: number, tyMax: number;
    if (Math.abs(dy) > 1e-9) {
      tyMin = (box.min.y - oy) / dy;
      tyMax = (box.max.y - oy) / dy;
      if (tyMin > tyMax) { const tmp = tyMin; tyMin = tyMax; tyMax = tmp; }
    } else {
      if (oy < box.min.y || oy > box.max.y) continue;
      tyMin = -Infinity;
      tyMax = Infinity;
    }

    if (txMin > tyMax || tyMin > txMax) continue;
    const tNearXY = txMin > tyMin ? txMin : tyMin;
    const tFarXY = txMax < tyMax ? txMax : tyMax;

    // Z slabs
    let tzMin: number, tzMax: number;
    if (Math.abs(dz) > 1e-9) {
      tzMin = (box.min.z - oz) / dz;
      tzMax = (box.max.z - oz) / dz;
      if (tzMin > tzMax) { const tmp = tzMin; tzMin = tzMax; tzMax = tmp; }
    } else {
      if (oz < box.min.z || oz > box.max.z) continue;
      tzMin = -Infinity;
      tzMax = Infinity;
    }

    if (tNearXY > tzMax || tzMin > tFarXY) continue;
    const tEntry = tNearXY > tzMin ? tNearXY : tzMin;
    const tExit = tFarXY < tzMax ? tFarXY : tzMax;

    if (tExit < 0) continue; // Behind ray origin

    const hitT = tEntry > 0 ? tEntry : tExit;
    if (hitT > 0 && hitT < closestCoverDist) {
      closestCoverDist = hitT;
    }
  }

  return closestCoverDist;
}

/**
 * Computes perspective-corrected X coordinate for cover emergence.
 * Takes the line-of-sight ray from player origin (0, 1.7, 0) grazing the near face
 * corner of the cover obstacle at target depth anchorZ, and applies a configurable
 * exposure margin so the target is genuinely exposed beyond the obstacle's shadow.
 */
export function getCoverExposedX(
  box: ArenaCoverBox,
  side: 'left' | 'right',
  anchorZ: number,
  marginMetres: number
): number {
  const zNear = box.max.z; // near face of box (closest to player at Z=0)
  // Perspective projection factor from player at Z=0 to target at anchorZ
  const ratio = (anchorZ < zNear && zNear < 0) ? (anchorZ / zNear) : 1.0;

  if (side === 'right') {
    return (box.max.x * ratio) + marginMetres;
  } else {
    return (box.min.x * ratio) - marginMetres;
  }
}

// ── Controller State Interfaces ────────────────────────────────────────

export interface TacticalStrafeState {
  type: 'tactical_strafe';
  direction: 1 | -1;
  currentSpeed: number;
  cruiseSpeed: number;
  accel: number;
  state: 'accelerating' | 'cruising' | 'stopping' | 'deadstop';
  stateTimer: number;
  minStrafeDuration: number;
  maxStrafeDuration: number;
  deadstopDuration: number;
  minX: number;
  maxX: number;
  personality?: BotPersonalityId;
  strafeCount?: number;
  feintChance?: number;
}

export interface CoverPeekState {
  type: 'cover_peek';
  mode: 'jiggle' | 'wideswing' | 'peek';
  boxId: string;
  side: 'left' | 'right';
  state: 'hidden' | 'emerging' | 'exposed_duel' | 'retreating';
  stateTimer: number;
  peekProgress: number; // 0 = fully hidden, 1 = maximum exposure
  hiddenX: number;
  exposedX: number;
  anchorY: number;
  anchorZ: number;
  emergeSpeed: number;
  retreatSpeed: number;
  exposedDuelDuration: number;
  hiddenDuration: number;
  personality?: BotPersonalityId;
}

export interface SmoothSteeringState {
  type: 'smooth_steering';
  vx: number;
  vz: number;
  targetVx: number;
  targetVz: number;
  speed: number;
  turnRate: number;
  changeTimer: number;
  isReactive: boolean;
  minZ: number;
  maxZ: number;
}

export interface MobilityState {
  type: 'mobility';
  vy: number;
  vx: number;
  gravity: number;
  jumpImpulse: number;
  groundY: number;
  maxJumpY: number;
  state: 'ground_crouch' | 'ascending' | 'descending';
  stateTimer: number;
  strafeDir: 1 | -1;
  driftSpeed: number;
  personality?: BotPersonalityId;
}

export type TargetControllerState =
  | TacticalStrafeState
  | CoverPeekState
  | SmoothSteeringState
  | MobilityState;

// ── Controller Implementations ─────────────────────────────────────────

/**
 * 1. TacticalStrafeController
 * Implements human counter-strafing with realistic acceleration, randomized
 * duration, and zero-velocity dead-zone stopping before switching direction.
 */
export function updateTacticalStrafe(
  state: TacticalStrafeState,
  pos: THREE.Vector3,
  dt: number,
  rng: () => number
): void {
  const prevSpeed = state.currentSpeed;
  state.stateTimer -= dt;

  switch (state.state) {
    case 'accelerating':
      state.currentSpeed += state.accel * dt;
      if (state.currentSpeed >= state.cruiseSpeed) {
        state.currentSpeed = state.cruiseSpeed;
        state.state = 'cruising';
        state.strafeCount = (state.strafeCount ?? 0) + 1;
        if (state.personality === 'strafe_specialist') {
          // Alternating rhythm: even count = short juke, odd count = wide sweep
          const isShort = (state.strafeCount % 2 === 0);
          state.stateTimer = isShort
            ? state.minStrafeDuration * (0.8 + rng() * 0.4)
            : state.maxStrafeDuration * (0.8 + rng() * 0.4);
        } else {
          state.stateTimer = state.minStrafeDuration + rng() * (state.maxStrafeDuration - state.minStrafeDuration);
        }
      }
      break;

    case 'cruising':
      if (state.stateTimer <= 0) {
        state.state = 'stopping';
      }
      break;

    case 'stopping':
      state.currentSpeed -= state.accel * 1.6 * dt;
      if (state.currentSpeed <= 0) {
        state.currentSpeed = 0;
        state.state = 'deadstop';
        state.stateTimer = state.deadstopDuration;
      }
      break;

    case 'deadstop':
      state.currentSpeed = 0;
      if (state.stateTimer <= 0) {
        // Human-like strafe direction selection: boundary protection + probabilistic feint
        const nearMin = pos.x <= state.minX + 0.8;
        const nearMax = pos.x >= state.maxX - 0.8;
        if (nearMin) {
          state.direction = 1;
        } else if (nearMax) {
          state.direction = -1;
        } else {
          // Standard reversal vs feint in same direction
          const feintProb = state.feintChance ?? 0.25;
          const isFeint = rng() < feintProb;
          if (!isFeint) {
            state.direction = (state.direction === 1 ? -1 : 1);
          }
        }
        state.state = 'accelerating';
      }
      break;
  }

  // Position displacement using average velocity over the step (trapezoidal integration for frame-rate independence)
  const avgSpeed = (prevSpeed + state.currentSpeed) * 0.5;
  pos.x += state.direction * avgSpeed * dt;

  // Boundary turnaround protection
  if (pos.x <= state.minX) {
    pos.x = state.minX;
    state.direction = 1;
    state.currentSpeed = 0;
    state.state = 'deadstop';
    state.stateTimer = state.deadstopDuration * 0.5;
  } else if (pos.x >= state.maxX) {
    pos.x = state.maxX;
    state.direction = -1;
    state.currentSpeed = 0;
    state.state = 'deadstop';
    state.stateTimer = state.deadstopDuration * 0.5;
  }
}

/**
 * 2. CoverPeekController
 * Implements tactical cover interactions (jiggle peeks, wide swings, and pop flash peeks).
 * Keeps target strictly behind cover obstacle geometry when hidden, and emerges smoothly into line of sight.
 */
export function updateCoverPeek(
  state: CoverPeekState,
  pos: THREE.Vector3,
  dt: number,
  rng: () => number
): void {
  state.stateTimer -= dt;

  switch (state.state) {
    case 'hidden':
      state.peekProgress = 0;
      pos.x = state.hiddenX;
      pos.y = state.anchorY;
      pos.z = state.anchorZ;

      if (state.stateTimer <= 0) {
        state.state = 'emerging';
      }
      break;

    case 'emerging':
      state.peekProgress += state.emergeSpeed * dt;
      if (state.peekProgress >= 1.0) {
        state.peekProgress = 1.0;
        state.state = 'exposed_duel';
        state.stateTimer = state.exposedDuelDuration;
      }
      pos.x = state.hiddenX + (state.exposedX - state.hiddenX) * state.peekProgress;
      break;

    case 'exposed_duel':
      state.peekProgress = 1.0;
      pos.x = state.exposedX;

      if (state.stateTimer <= 0) {
        state.state = 'retreating';
      }
      break;

    case 'retreating':
      state.peekProgress -= state.retreatSpeed * dt;
      if (state.peekProgress <= 0.0) {
        state.peekProgress = 0.0;
        state.state = 'hidden';
        if (state.personality === 'tactical_peeker') {
          // Tactical Peeker: 40% quick re-peek, 60% patient angle reset
          const isQuick = rng() < 0.40;
          state.stateTimer = isQuick ? (0.18 + rng() * 0.12) : state.hiddenDuration * (0.8 + rng() * 0.4);
        } else {
          state.stateTimer = state.hiddenDuration * (0.8 + rng() * 0.4);
        }

        // Dynamic exposure depth & duel duration variation for the next peek cycle
        const box = ARENA_COVER_BOXES.find(b => b.id === state.boxId);
        if (box) {
          let displacement: number;
          let duelDuration: number;
          if (state.mode === 'wideswing') {
            displacement = 1.6 + rng() * 0.6;
            duelDuration = 0.5 + rng() * 0.3;
          } else if (state.personality === 'tactical_peeker') {
            // Tactical Peeker profile: 35% shoulder bait, 25% wide swing, 40% standard slice
            const roll = rng();
            if (roll < 0.35) {
              displacement = 0.32;
              duelDuration = 0.20;
            } else if (roll < 0.60) {
              displacement = 1.95;
              duelDuration = 0.65;
            } else {
              displacement = 0.85;
              duelDuration = 0.45;
            }
          } else {
            const roll = rng();
            if (roll < 0.25) {
              // Shoulder bait / feint
              displacement = 0.35;
              duelDuration = 0.22;
            } else if (roll < 0.45) {
              // Wide swing
              displacement = 1.85;
              duelDuration = 0.60;
            } else {
              // Standard peek
              displacement = 0.85;
              duelDuration = 0.45;
            }
          }
          state.exposedX = getCoverExposedX(box, state.side, state.anchorZ, displacement);
          state.exposedDuelDuration = duelDuration;
        }
      }
      pos.x = state.hiddenX + (state.exposedX - state.hiddenX) * state.peekProgress;
      break;
  }
}

/**
 * 3. SmoothSteeringController
 * Implements fluid 2D wander tracking with momentum, angular turning limits,
 * and arena wall avoidance. Supports reactive direction cutting.
 */
export function updateSmoothSteering(
  state: SmoothSteeringState,
  pos: THREE.Vector3,
  dt: number,
  rng: () => number
): void {
  state.changeTimer -= dt;

  // Repel from arena boundaries
  const marginX = 2.5;
  const marginZ = 2.0;
  const repellingLeft = pos.x < -18.0 + marginX;
  const repellingRight = pos.x > 18.0 - marginX;
  const repellingFar = pos.z < state.minZ + marginZ;
  const repellingNear = pos.z > state.maxZ - marginZ;

  if (state.changeTimer <= 0 || repellingLeft || repellingRight || repellingFar || repellingNear) {
    let desiredAngle: number;

    if (repellingLeft || repellingRight || repellingFar || repellingNear) {
      // Steer back towards center field (0, 0, -10)
      desiredAngle = Math.atan2(-10 - pos.z, 0 - pos.x);
      state.changeTimer = 1.2 + rng() * 0.8;
    } else {
      // Pick random new heading
      if (state.isReactive) {
        // Reactive tracking: sharper direction reversals (up to 180° shift)
        desiredAngle = rng() * Math.PI * 2;
        state.changeTimer = 0.35 + rng() * 0.45;
      } else {
        // Smooth tracking: continuous forward drift with gentle steering
        desiredAngle = (rng() - 0.5) * Math.PI * 1.4 - Math.PI / 2; // generally in front
        state.changeTimer = 1.2 + rng() * 1.5;
      }
    }

    state.targetVx = Math.cos(desiredAngle) * state.speed;
    state.targetVz = Math.sin(desiredAngle) * state.speed;
  }

  // Smoothly steer velocity towards target velocity
  const steerFactor = Math.min(1.0, state.turnRate * dt);
  state.vx += (state.targetVx - state.vx) * steerFactor;
  state.vz += (state.targetVz - state.vz) * steerFactor;

  pos.x += state.vx * dt;
  pos.z += state.vz * dt;

  // Clamp within arena boundaries
  pos.x = Math.max(-18.5, Math.min(18.5, pos.x));
  pos.z = Math.max(state.minZ, Math.min(state.maxZ, pos.z));
}

/**
 * 4. MobilityController
 * Implements realistic vertical updraft and jump physics with gravity,
 * parabolic apex suspension, horizontal drift, and landing compression.
 */
export function updateMobility(
  state: MobilityState,
  pos: THREE.Vector3,
  dt: number,
  rng: () => number
): void {
  switch (state.state) {
    case 'ground_crouch':
      state.stateTimer -= dt;
      // Slight crouch dip before jumping
      pos.y = state.groundY - 0.12;

      if (state.stateTimer <= 0) {
        state.state = 'ascending';
        state.vy = state.jumpImpulse;
        state.strafeDir = (rng() > 0.5 ? 1 : -1);
      }
      break;

    case 'ascending':
      state.vy += state.gravity * dt;
      pos.y += state.vy * dt;
      pos.x += state.strafeDir * state.driftSpeed * dt;

      if (state.vy <= 0) {
        state.state = 'descending';
      }
      break;

    case 'descending':
      state.vy += state.gravity * dt;
      pos.y += state.vy * dt;
      pos.x += state.strafeDir * state.driftSpeed * dt;

      if (pos.y <= state.groundY) {
        pos.y = state.groundY;
        state.vy = 0;
        state.state = 'ground_crouch';
        // Landing recovery interval before next jump
        state.stateTimer = 0.25 + rng() * 0.40;
      }
      break;
  }

  // Keep within arena bounds
  pos.x = Math.max(-18.0, Math.min(18.0, pos.x));
  pos.y = Math.max(0.4, Math.min(6.5, pos.y));
}
