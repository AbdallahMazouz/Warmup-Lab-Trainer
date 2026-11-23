// =====================================================================
// weapons.ts — Configurable Weapon Presets, Ballistics & Recoil System
// =====================================================================

import type { WeaponPresetId } from './types';

export interface WeaponPreset {
  id: WeaponPresetId;
  name: string;
  fireRateRps: number;
  cycleTimeMs: number;
  magSize: number;
  reloadTimeMs: number;
  recoveryTimeMs: number;
  damage: {
    head: number;
    body: number;
    legs: number;
  };
  firstShotInaccuracyDeg: number;
  movementSpreadMultiplier: number;
  recoilPattern: { pitchDeg: number; yawDeg: number }[];
  isAutomatic: boolean;
  boltActionDelayMs?: number;
}

export const WEAPON_PRESETS: Record<WeaponPresetId, WeaponPreset> = {
  vandal: {
    id: 'vandal',
    name: 'Vandal',
    fireRateRps: 9.75,
    cycleTimeMs: 102.5,
    magSize: 25,
    reloadTimeMs: 2500,
    recoveryTimeMs: 380,
    damage: {
      head: 160,
      body: 40,
      legs: 34,
    },
    firstShotInaccuracyDeg: 0.15,
    movementSpreadMultiplier: 4.5,
    recoilPattern: [
      { pitchDeg: 0.0, yawDeg: 0.0 },
      { pitchDeg: 0.40, yawDeg: 0.02 },
      { pitchDeg: 0.75, yawDeg: -0.04 },
      { pitchDeg: 1.10, yawDeg: 0.06 },
      { pitchDeg: 1.40, yawDeg: -0.08 },
      { pitchDeg: 1.60, yawDeg: 0.12 },
      { pitchDeg: 1.70, yawDeg: -0.15 },
      { pitchDeg: 1.75, yawDeg: 0.18 },
      { pitchDeg: 1.72, yawDeg: -0.20 },
      { pitchDeg: 1.70, yawDeg: 0.16 },
    ],
    isAutomatic: true,
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    fireRateRps: 11.0,
    cycleTimeMs: 90.9,
    magSize: 30,
    reloadTimeMs: 2500,
    recoveryTimeMs: 340,
    damage: {
      head: 156,
      body: 39,
      legs: 33,
    },
    firstShotInaccuracyDeg: 0.11,
    movementSpreadMultiplier: 3.8,
    recoilPattern: [
      { pitchDeg: 0.0, yawDeg: 0.0 },
      { pitchDeg: 0.28, yawDeg: 0.01 },
      { pitchDeg: 0.55, yawDeg: -0.02 },
      { pitchDeg: 0.80, yawDeg: 0.04 },
      { pitchDeg: 1.02, yawDeg: -0.06 },
      { pitchDeg: 1.18, yawDeg: 0.09 },
      { pitchDeg: 1.25, yawDeg: -0.10 },
      { pitchDeg: 1.28, yawDeg: 0.12 },
    ],
    isAutomatic: true,
  },
  sheriff: {
    id: 'sheriff',
    name: 'Sheriff',
    fireRateRps: 4.0,
    cycleTimeMs: 250,
    magSize: 6,
    reloadTimeMs: 2200,
    recoveryTimeMs: 400,
    damage: {
      head: 159,
      body: 55,
      legs: 46,
    },
    firstShotInaccuracyDeg: 0.18,
    movementSpreadMultiplier: 5.0,
    recoilPattern: [
      { pitchDeg: 0.0, yawDeg: 0.0 },
      { pitchDeg: 0.85, yawDeg: 0.05 },
      { pitchDeg: 1.45, yawDeg: -0.08 },
    ],
    isAutomatic: false,
  },
  operator: {
    id: 'operator',
    name: 'Operator',
    fireRateRps: 0.75,
    cycleTimeMs: 1333,
    magSize: 5,
    reloadTimeMs: 3700,
    recoveryTimeMs: 1500,
    damage: {
      head: 255,
      body: 150,
      legs: 120,
    },
    firstShotInaccuracyDeg: 0.0,
    movementSpreadMultiplier: 10.0,
    recoilPattern: [
      { pitchDeg: 2.5, yawDeg: 0.0 },
    ],
    isAutomatic: false,
    boltActionDelayMs: 1400,
  },
};

export function getWeaponPreset(presetId?: string): WeaponPreset {
  if (presetId && presetId in WEAPON_PRESETS) {
    return WEAPON_PRESETS[presetId as WeaponPresetId];
  }
  return WEAPON_PRESETS.vandal;
}

/**
 * Calculates directional spread perturbation (in radians) for a shot.
 * Stationary shots benefit from minimal base spread; moving shots incur heavy spread multiplier.
 */
export function calculateBulletSpread(
  preset: WeaponPreset,
  bulletIdx: number,
  isStationary: boolean,
  rng: () => number = Math.random
): { pitchOffsetRad: number; yawOffsetRad: number } {
  const recoilStep = preset.recoilPattern[Math.min(bulletIdx, preset.recoilPattern.length - 1)];
  const basePitchDeg = recoilStep ? recoilStep.pitchDeg : 0;
  const baseYawDeg = recoilStep ? recoilStep.yawDeg : 0;

  let spreadRadiusDeg = preset.firstShotInaccuracyDeg;
  if (!isStationary) {
    spreadRadiusDeg *= preset.movementSpreadMultiplier;
  } else if (bulletIdx > 0) {
    // Continuous spray adds small inherent dispersion
    spreadRadiusDeg += Math.min(0.5, bulletIdx * 0.04);
  }

  // Random angle around cone
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spreadRadiusDeg;

  const degToRad = Math.PI / 180;
  return {
    pitchOffsetRad: (basePitchDeg + r * Math.sin(theta)) * degToRad,
    yawOffsetRad: (baseYawDeg + r * Math.cos(theta)) * degToRad,
  };
}
