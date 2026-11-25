// =====================================================================
// tests/botPersonalities.test.ts — Unit & Integration Tests for Bot Personalities
// =====================================================================

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  BOT_PERSONALITY_PROFILES,
  VALID_BOT_PERSONALITIES,
  resolveBotPersonality,
  getPersonalityProfile,
} from '../src/botPersonalities';
import { TargetManager } from '../src/targetManager';
import {
  ARENA_COVER_BOXES,
  updateTacticalStrafe,
  updateCoverPeek,
  type TacticalStrafeState,
  type CoverPeekState,
  type MobilityState,
} from '../src/movementControllers';
import {
  validateCustomScenarioJSON,
  convertCustomScenarioToConfig,
  hasMaterialConfigChanges,
  createDefaultCustomScenario,
} from '../src/scenarioConfig';
import { HEAD_LEVEL_Y } from '../src/constants';
import type { ScenarioConfig, WarmupLabScenarioV1 } from '../src/types';

function createMockRenderer() {
  return {
    addTarget: vi.fn(),
    updateTargetPosition: vi.fn(),
    removeTarget: vi.fn(),
    clearTargets: vi.fn(),
  };
}

describe('Phase 1: Personality Profiles & Auto-Derivation Engine', () => {
  it('contains all 4 valid personality IDs with complete profile definitions', () => {
    expect(VALID_BOT_PERSONALITIES).toEqual([
      'strafe_specialist',
      'tactical_peeker',
      'evasive_bot',
      'duelist',
    ]);
    for (const id of VALID_BOT_PERSONALITIES) {
      const p = BOT_PERSONALITY_PROFILES[id];
      expect(p).toBeDefined();
      expect(p.id).toBe(id);
      expect(p.name).toBeDefined();
      expect(p.evasionBehavior).toBeDefined();
      expect(typeof p.evasionCooldownMs).toBe('number');
    }
  });

  it('honors explicit personality configuration regardless of scenario name', () => {
    const resolved = resolveBotPersonality('duelist', 'flick-static', 'static', false);
    expect(resolved).toBe('duelist');
  });

  it('auto-derives personality from existing scenario characteristics when omitted', () => {
    // Retaliatory or skirmish -> duelist
    expect(resolveBotPersonality(undefined, 'tactical-skirmish', 'strafe', true)).toBe('duelist');
    expect(resolveBotPersonality(undefined, 'custom-duel', 'static', true)).toBe('duelist');

    // Cover / peek / jiggle / wideswing -> tactical_peeker
    expect(resolveBotPersonality(undefined, 'tactical-jiggle', 'jiggle', false)).toBe('tactical_peeker');
    expect(resolveBotPersonality(undefined, 'peek-and-tap', 'peek', false)).toBe('tactical_peeker');
    expect(resolveBotPersonality(undefined, 'tactical-wideswing', 'wideswing', false)).toBe('tactical_peeker');

    // Vertical mobility -> evasive_bot
    expect(resolveBotPersonality(undefined, 'track-vertical', 'vertical', false)).toBe('evasive_bot');

    // Strafe -> strafe_specialist
    expect(resolveBotPersonality(undefined, 'tactical-strafe', 'strafe', false)).toBe('strafe_specialist');

    // Generic static -> undefined
    expect(resolveBotPersonality(undefined, 'flick-static', 'static', false)).toBeUndefined();
  });

  it('scales personality profile attributes across difficulty tiers', () => {
    const beginner = getPersonalityProfile('strafe_specialist', 'beginner');
    const pro = getPersonalityProfile('strafe_specialist', 'pro');

    expect(pro.strafeRhythm!.deadstopDuration).toBeLessThan(beginner.strafeRhythm!.deadstopDuration);
    expect(pro.strafeRhythm!.feintChance).toBeGreaterThan(beginner.strafeRhythm!.feintChance);
    expect(pro.evasionCooldownMs).toBeLessThan(beginner.evasionCooldownMs);

    const peekerBeginner = getPersonalityProfile('tactical_peeker', 'beginner');
    const peekerPro = getPersonalityProfile('tactical_peeker', 'pro');
    expect(peekerPro.peekDistribution!.shoulderBaitChance).toBeGreaterThan(peekerBeginner.peekDistribution!.shoulderBaitChance);
  });
});

describe('Phase 2: Strafe Specialist & Duelist Personalities', () => {
  it('alternates between short burst and wide sweep rhythm for Strafe Specialist', () => {
    const state: TacticalStrafeState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 3.5,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'accelerating',
      stateTimer: 0,
      minStrafeDuration: 0.20,
      maxStrafeDuration: 0.70,
      deadstopDuration: 0.16,
      minX: -5.0,
      maxX: 5.0,
      personality: 'strafe_specialist',
    };
    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);

    // Step 1: accelerate to cruise (strafeCount = 1, odd -> long sweep ~0.70s)
    updateTacticalStrafe(state, pos, 0.016, () => 0.5);
    expect(state.state).toBe('cruising');
    expect(state.stateTimer).toBeCloseTo(0.70, 1);

    // Finish cruising and deadstop
    state.stateTimer = 0;
    updateTacticalStrafe(state, pos, 0.016, () => 0.5); // cruising -> stopping
    state.currentSpeed = 0;
    updateTacticalStrafe(state, pos, 0.016, () => 0.5); // stopping -> deadstop
    state.stateTimer = 0;
    updateTacticalStrafe(state, pos, 0.016, () => 0.5); // deadstop -> accelerating

    // Step 2: accelerate to cruise (strafeCount = 2, even -> short burst ~0.20s)
    state.currentSpeed = state.cruiseSpeed;
    updateTacticalStrafe(state, pos, 0.016, () => 0.5);
    expect(state.state).toBe('cruising');
    expect(state.stateTimer).toBeCloseTo(0.20, 1);
  });

  it('uses 35% feint probability for Strafe Specialist at deadstop', () => {
    const state: TacticalStrafeState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 0,
      cruiseSpeed: 3.5,
      accel: 14.0,
      state: 'deadstop',
      stateTimer: 0,
      minStrafeDuration: 0.20,
      maxStrafeDuration: 0.70,
      deadstopDuration: 0.16,
      minX: -5.0,
      maxX: 5.0,
      personality: 'strafe_specialist',
      feintChance: 0.35,
    };
    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);

    // Roll 0.30 (< 0.35 feintChance -> feint, keeps direction 1)
    updateTacticalStrafe(state, pos, 0.016, () => 0.30);
    expect(state.direction).toBe(1);

    // Reset to deadstop, roll 0.40 (>= 0.35 -> reversals, direction becomes -1)
    state.state = 'deadstop';
    state.stateTimer = 0;
    updateTacticalStrafe(state, pos, 0.016, () => 0.40);
    expect(state.direction).toBe(-1);
  });

  it('configures Duelist with automatic retaliation and micro-repositioning evasion', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const duelistConfig: ScenarioConfig = {
      id: 'custom-duel',
      name: 'Custom Duel',
      category: 'tactical',
      description: 'Duelist bot',
      skill: 'clicking',
      difficulty: 'advanced',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 1.0,
      directionChangeMultiplier: 1.0,
      target: {
        personality: 'duelist',
        hp: 100,
      },
    };

    const spawned = tm.spawnTarget(duelistConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    expect(spawned).not.toBeNull();
    if (!spawned) return;

    expect(spawned.personality).toBe('duelist');
    expect(spawned.retaliatory).toBe(true);
    expect(spawned.retaliateRepeat).toBe(true);
    expect(spawned.retaliateBurstIntervalMs).toBe(500);

    // Give bot tactical strafe controller
    spawned.controllerState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 3.0,
      cruiseSpeed: 3.0,
      accel: 14.0,
      state: 'cruising',
      stateTimer: 0.5,
      minStrafeDuration: 0.3,
      maxStrafeDuration: 0.7,
      deadstopDuration: 0.2,
      minX: -5.0,
      maxX: 5.0,
    };

    // Near-miss gunshot
    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.25, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    tm.handleNearMiss(ray, 1000);

    const cs = spawned.controllerState as TacticalStrafeState;
    // Duelist does not flee: micro-repositions (inverting direction to stopping while holding combat line)
    expect(cs.state).toBe('stopping');
    expect(cs.direction).toBe(-1);
    expect(spawned.retaliatory).toBe(true);
  });
});

describe('Phase 3: Tactical Peeker & Evasive Bot Personalities', () => {
  it('applies Tactical Peeker distribution (35% shoulder, 25% wide, 40% standard)', () => {
    const box = ARENA_COVER_BOXES[0];
    const state: CoverPeekState = {
      type: 'cover_peek',
      mode: 'peek',
      boxId: box.id,
      side: 'right',
      state: 'retreating',
      stateTimer: 0,
      peekProgress: 0.05,
      hiddenX: box.center.x,
      exposedX: -7.0,
      anchorY: HEAD_LEVEL_Y,
      anchorZ: -8.5,
      emergeSpeed: 4.5,
      retreatSpeed: 5.0,
      exposedDuelDuration: 0.45,
      hiddenDuration: 0.3,
      personality: 'tactical_peeker',
    };
    const pos = new THREE.Vector3(-7.5, HEAD_LEVEL_Y, -8.5);

    // 1. Roll 0.20 (< 0.35 -> shoulder bait: 0.20s duel duration)
    updateCoverPeek(state, pos, 0.02, () => 0.20);
    expect(state.state).toBe('hidden');
    expect(state.exposedDuelDuration).toBe(0.20);

    // 2. Roll 0.50 (>= 0.35 and < 0.60 -> wide swing: 0.65s duel duration)
    state.state = 'retreating';
    state.peekProgress = 0.05;
    updateCoverPeek(state, pos, 0.02, () => 0.50);
    expect(state.state).toBe('hidden');
    expect(state.exposedDuelDuration).toBe(0.65);

    // 3. Roll 0.80 (>= 0.60 -> standard slice: 0.45s duel duration)
    state.state = 'retreating';
    state.peekProgress = 0.05;
    updateCoverPeek(state, pos, 0.02, () => 0.80);
    expect(state.state).toBe('hidden');
    expect(state.exposedDuelDuration).toBe(0.45);
  });

  it('triggers aerial evasion and enforces 320ms cooldown for Evasive Bot', () => {
    const tm = new TargetManager(createMockRenderer() as any, () => 0.5);
    const evasiveConfig: ScenarioConfig = {
      id: 'custom-evasion',
      name: 'Custom Evasion',
      category: 'tracking',
      description: 'Evasive aerial bot',
      skill: 'tracking',
      difficulty: 'advanced',
      durationSec: 60,
      targetCount: 1,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 1.0,
      directionChangeMultiplier: 1.0,
      target: {
        personality: 'evasive_bot',
        hp: 100,
      },
    };

    const spawned = tm.spawnTarget(evasiveConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    if (!spawned) return;

    expect(spawned.personality).toBe('evasive_bot');

    spawned.controllerState = {
      type: 'mobility',
      vy: 0,
      vx: 0,
      gravity: -18.0,
      jumpImpulse: 8.2,
      groundY: HEAD_LEVEL_Y,
      maxJumpY: HEAD_LEVEL_Y + 2.2,
      state: 'ground_crouch',
      stateTimer: 0.4,
      strafeDir: 1,
      driftSpeed: 1.8,
      personality: 'evasive_bot',
    };

    const ray = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0.2, HEAD_LEVEL_Y, -10).sub(new THREE.Vector3(0, HEAD_LEVEL_Y, 0)).normalize()
    );

    // First near miss at t = 1000
    tm.handleNearMiss(ray, 1000);
    const cs = spawned.controllerState as MobilityState;
    expect(cs.state).toBe('ascending');
    expect(spawned.lastReactionTime).toBe(1000);

    // Mid-air near miss at t = 1200 (< 320ms cooldown -> skipped)
    cs.state = 'ascending';
    cs.strafeDir = 1;
    tm.handleNearMiss(ray, 1200);
    expect(cs.strafeDir).toBe(1); // Not changed

    // Mid-air near miss at t = 1350 (350ms elapsed >= 320ms cooldown -> triggered mid-flight evasion)
    tm.handleNearMiss(ray, 1350);
    expect(cs.strafeDir).toBe(-1); // Inverted drift direction
    expect(spawned.lastReactionTime).toBe(1350);
  });
});

describe('Phase 4: Creator Studio Integration & Validation', () => {
  it('validates custom scenario JSON with valid and invalid personality IDs', () => {
    const validScenario = createDefaultCustomScenario('static_flick');
    validScenario.target.personality = 'strafe_specialist';
    expect(validateCustomScenarioJSON(validScenario).valid).toBe(true);

    validScenario.target.personality = 'invalid_personality_xyz' as any;
    const result = validateCustomScenarioJSON(validScenario);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid target personality'))).toBe(true);
  });

  it('converts custom scenario with personality to runtime config seamlessly', () => {
    const custom = createDefaultCustomScenario('retaliatory_duel');
    custom.target.personality = 'duelist';
    const config = convertCustomScenarioToConfig(custom);

    expect(config.target.personality).toBe('duelist');
  });

  it('detects personality modifications in hasMaterialConfigChanges', () => {
    const s1 = createDefaultCustomScenario('static_flick');
    const s2 = structuredClone(s1);

    expect(hasMaterialConfigChanges(s1, s2)).toBe(false);

    s2.target.personality = 'strafe_specialist';
    expect(hasMaterialConfigChanges(s1, s2)).toBe(true);
  });
});
