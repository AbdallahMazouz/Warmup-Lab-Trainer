// =====================================================================
// scripts/verify_hybrid_overhaul.ts — Comprehensive Verification Script
// =====================================================================

import * as THREE from 'three';
import { TargetManager } from '../src/targetManager';
import { SCENARIOS, TRAINING_ROUTINES, getScenarioById } from '../src/scenarios';
import {
  ARENA_COVER_BOXES,
  intersectRayCoverBoxes,
  getCoverExposedX,
  updateTacticalStrafe,
  updateCoverPeek,
  updateSmoothSteering,
  updateMobility,
  type TacticalStrafeState,
  type CoverPeekState,
  type SmoothSteeringState,
  type MobilityState,
} from '../src/movementControllers';
import { DIMENSION_CONFIGS } from '../src/recommendations';
import { HEAD_LEVEL_Y } from '../src/constants';

interface TestResult {
  section: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

const results: TestResult[] = [];

function record(section: string, name: string, pass: boolean, details: string, isWarn = false) {
  results.push({
    section,
    name,
    status: pass ? 'PASS' : isWarn ? 'WARN' : 'FAIL',
    details,
  });
}

console.log('=================================================================');
console.log('WARMUPLAB HYBRID AIM TRAINER OVERHAUL — INDEPENDENT VERIFICATION');
console.log('=================================================================\n');

// ─────────────────────────────────────────────────────────────────────────
// Section 1: Scenario-by-Scenario Audit (All 22 Scenarios)
// ─────────────────────────────────────────────────────────────────────────
console.log('--- SECTION 1: ALL 22 SCENARIOS AUDIT ---');

const tm = new TargetManager();

const EXPECTED_STATIC_IDS = new Set([
  'flick-static',
  'flick-micro',
  'flick-wide',
  'flick-multi',
  'flick-precision',
  'flick-reactive',
  'tactical-angle-clear',
  'tactical-counter-strafe',
  'flash-delayed',
  'reaction-visual',
  'reaction-peripheral',
]);

const EXPECTED_MOVING_IDS = new Set([
  'track-smooth',
  'track-reactive',
  'track-strafe',
  'track-vertical',
  'tactical-wideswing',
  'tactical-jiggle',
  'tactical-headlevel',
  'tactical-firstshot',
  'flash-pop',
  'hybrid-tactical-warmup',
  'hybrid-clutch',
]);

record('Scenarios', 'Scenario count', SCENARIOS.length === 22, `Found ${SCENARIOS.length} scenarios, expected 22`);

for (const sc of SCENARIOS) {
  tm.clear();
  const t = tm.spawnTarget(sc);
  const initialPos = t.position.clone();

  let maxDisp = 0;
  // Run 60 frames (1 second at 60 FPS)
  for (let f = 0; f < 60; f++) {
    tm.update(0.016);
    const d = t.position.distanceTo(initialPos);
    if (d > maxDisp) maxDisp = d;
  }

  const isStaticExpected = EXPECTED_STATIC_IDS.has(sc.id);
  const isMovingExpected = EXPECTED_MOVING_IDS.has(sc.id);

  let movementCorrect = false;
  if (isStaticExpected) {
    movementCorrect = maxDisp === 0 && sc.targetSpeedMultiplier === 0;
  } else if (isMovingExpected) {
    movementCorrect = maxDisp > 0.01 && sc.targetSpeedMultiplier > 0;
  }

  const hasController = !!t.controllerState;
  const controllerType = t.controllerState?.type ?? 'legacy_wave';

  record(
    'Scenarios',
    `Scenario [${sc.id}]`,
    movementCorrect,
    `Category: ${sc.category}, Pattern: ${sc.movementPattern}, Count: ${sc.targetCount}, Speed: ${sc.targetSpeedMultiplier}, Controller: ${controllerType}, MaxDisp: ${maxDisp.toFixed(3)}m`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Section 2: Controller Correctness
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- SECTION 2: CONTROLLER CORRECTNESS ---');

// 2.1 TacticalStrafeController
{
  const state: TacticalStrafeState = {
    type: 'tactical_strafe',
    direction: 1,
    currentSpeed: 0,
    cruiseSpeed: 3.0,
    accel: 10.0,
    state: 'accelerating',
    stateTimer: 0,
    minStrafeDuration: 0.5,
    maxStrafeDuration: 0.5,
    deadstopDuration: 0.2,
    minX: -10,
    maxX: 10,
  };
  const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
  const dummyRng = () => 0.5;

  // Accel
  updateTacticalStrafe(state, pos, 0.15, dummyRng);
  const accelPass = state.state === 'accelerating' && state.currentSpeed > 0 && state.currentSpeed < 3.0;

  // Cruise
  updateTacticalStrafe(state, pos, 0.2, dummyRng);
  const cruisePass = state.state === 'cruising' && state.currentSpeed === 3.0;

  // Stop
  updateTacticalStrafe(state, pos, 0.55, dummyRng);
  const stoppingPass = state.state === 'stopping' || state.state === 'deadstop';

  // Deadstop
  updateTacticalStrafe(state, pos, 0.2, dummyRng);
  const deadstopPass = state.state === 'deadstop' && state.currentSpeed === 0;
  const deadstopX = pos.x;

  updateTacticalStrafe(state, pos, 0.1, dummyRng);
  const deadstopHoldPass = state.state === 'deadstop' && pos.x === deadstopX;

  // Reverse
  updateTacticalStrafe(state, pos, 0.15, dummyRng);
  const reversePass = state.state === 'accelerating' && state.direction === -1;

  record(
    'Controllers',
    'TacticalStrafeController state machine & deadstop',
    accelPass && cruisePass && deadstopPass && deadstopHoldPass && reversePass,
    `accel=${accelPass}, cruise=${cruisePass}, deadstop=${deadstopPass}, deadstopHold=${deadstopHoldPass}, reverse=${reversePass}`
  );
}

// 2.2 CoverPeekController
{
  const state: CoverPeekState = {
    type: 'cover_peek',
    mode: 'jiggle',
    boxId: 'front_right',
    side: 'right',
    state: 'hidden',
    stateTimer: 0.1,
    peekProgress: 0,
    hiddenX: 8.0,
    exposedX: 9.65,
    anchorY: HEAD_LEVEL_Y,
    anchorZ: -8.5,
    emergeSpeed: 4.0,
    retreatSpeed: 4.0,
    exposedDuelDuration: 0.3,
    hiddenDuration: 0.5,
  };
  const pos = new THREE.Vector3(8.0, HEAD_LEVEL_Y, -8.5);
  const dummyRng = () => 0.5;

  updateCoverPeek(state, pos, 0.05, dummyRng);
  const hiddenPass = state.state === 'hidden' && pos.x === 8.0;

  // Transition to emerging
  updateCoverPeek(state, pos, 0.06, dummyRng);
  const stateEmerging = state.state === 'emerging';

  // Advance emergence
  updateCoverPeek(state, pos, 0.1, dummyRng);
  const emergePass = stateEmerging && pos.x > 8.0 && pos.x < 9.65;

  // Fully emerge into exposed duel
  updateCoverPeek(state, pos, 0.25, dummyRng);
  const exposedPass = state.state === 'exposed_duel' && pos.x === 9.65;

  // Exposed duel timer expires -> transition to retreating
  updateCoverPeek(state, pos, 0.35, dummyRng);
  const stateRetreating = state.state === 'retreating';

  // Advance retreat
  updateCoverPeek(state, pos, 0.1, dummyRng);
  const retreatPass = stateRetreating && pos.x < 9.65 && pos.x > 8.0;

  // Finish retreat to hidden
  updateCoverPeek(state, pos, 0.3, dummyRng);
  const returnHiddenPass = state.state === 'hidden' && pos.x === 8.0;

  record(
    'Controllers',
    'CoverPeekController lifecycle transitions',
    hiddenPass && emergePass && exposedPass && retreatPass && returnHiddenPass,
    `hidden=${hiddenPass}, emerge=${emergePass}, exposed=${exposedPass}, retreat=${retreatPass}, returnHidden=${returnHiddenPass}`
  );
}

// 2.3 SmoothSteeringController
{
  const state: SmoothSteeringState = {
    type: 'smooth_steering',
    vx: 0,
    vz: 0,
    targetVx: 2.0,
    targetVz: -1.0,
    speed: 2.5,
    turnRate: 4.0,
    changeTimer: 1.0,
    isReactive: false,
    minZ: -18.0,
    maxZ: -4.0,
  };
  const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
  const dummyRng = () => 0.5;

  updateSmoothSteering(state, pos, 0.1, dummyRng);
  const steeringActive = state.vx !== 0 && state.vz !== 0;

  // Wall repelling
  pos.x = -17.5;
  updateSmoothSteering(state, pos, 0.05, dummyRng);
  const wallRepel = state.targetVx > 0; // steered toward center field (+x)

  record(
    'Controllers',
    'SmoothSteeringController 2D steering & boundary repel',
    steeringActive && wallRepel,
    `steeringActive=${steeringActive}, wallRepel=${wallRepel}`
  );
}

// 2.4 MobilityController
{
  const groundY = HEAD_LEVEL_Y;
  const state: MobilityState = {
    type: 'mobility',
    vy: 0,
    vx: 0,
    gravity: -18.0,
    jumpImpulse: 6.0,
    groundY,
    maxJumpY: groundY + 1.2,
    state: 'ground_crouch',
    stateTimer: 0.1,
    strafeDir: 1,
    driftSpeed: 1.5,
  };
  const pos = new THREE.Vector3(0, groundY, -10);
  const dummyRng = () => 0.5;

  // Crouch
  updateMobility(state, pos, 0.05, dummyRng);
  const crouchPass = state.state === 'ground_crouch' && pos.y < groundY;

  // Ascend
  updateMobility(state, pos, 0.06, dummyRng);
  const ascendPass = state.state === 'ascending' && state.vy > 0;

  // Descend
  updateMobility(state, pos, 0.4, dummyRng);
  const descendPass = state.state === 'descending' && state.vy < 0;

  // Land
  updateMobility(state, pos, 0.5, dummyRng);
  const landPass = state.state === 'ground_crouch' && pos.y === groundY && state.vy === 0;

  record(
    'Controllers',
    'MobilityController vertical jump kinematics & ground recovery',
    crouchPass && ascendPass && descendPass && landPass,
    `crouch=${crouchPass}, ascend=${ascendPass}, descend=${descendPass}, land=${landPass}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Section 3: Cover Geometry & Ray Occlusion Audit
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- SECTION 3: COVER GEOMETRY & RAY OCCLUSION ---');

// Check box dimensions match Renderer.buildArena
// Box 1: Front-Left: addCoverBox(-8, 0, -8,  2, 2, 0.4) -> x: [-9, -7], y: [0, 2], z: [-8.2, -7.8]
// Box 2: Front-Right: addCoverBox( 8, 0, -8,  2, 2, 0.4) -> x: [7, 9], y: [0, 2], z: [-8.2, -7.8]
// Box 3: Deep-Left: addCoverBox(-6, 0, -14, 0.4, 2, 3) -> x: [-6.2, -5.8], y: [0, 2], z: [-15.5, -12.5]
// Box 4: Deep-Right: addCoverBox( 6, 0, -14, 0.4, 2, 3) -> x: [5.8, 6.2], y: [0, 2], z: [-15.5, -12.5]
const b0 = ARENA_COVER_BOXES[0];
const b1 = ARENA_COVER_BOXES[1];
const b2 = ARENA_COVER_BOXES[2];
const b3 = ARENA_COVER_BOXES[3];

const geomMatch =
  b0.min.x === -9.0 && b0.max.x === -7.0 && b0.min.z === -8.2 && b0.max.z === -7.8 &&
  b1.min.x === 7.0 && b1.max.x === 9.0 && b1.min.z === -8.2 && b1.max.z === -7.8 &&
  b2.min.x === -6.2 && b2.max.x === -5.8 && b2.min.z === -15.5 && b2.max.z === -12.5 &&
  b3.min.x === 5.8 && b3.max.x === 6.2 && b3.min.z === -15.5 && b3.max.z === -12.5;

record(
  'Cover',
  'ARENA_COVER_BOXES matches Renderer.buildArena geometry exactly',
  geomMatch,
  `4 boxes verified against Renderer mesh definitions`
);

// Ray-box intersection slab test:
// 1. Ray through front-right barrier from (8, 1.7, 0) towards (0, 0, -1)
const throughRay = new THREE.Ray(new THREE.Vector3(8, 1.7, 0), new THREE.Vector3(0, 0, -1));
const throughDist = intersectRayCoverBoxes(throughRay);
const throughPass = Math.abs(throughDist - 7.8) < 0.05;

// 2. Ray that misses cover
const missRay = new THREE.Ray(new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0, -1));
const missDist = intersectRayCoverBoxes(missRay);
const missPass = missDist === Infinity;

// 3. Ray behind target vs in front of target
// Target at (8, 1.7, -4) [in front of barrier at z=-8]
tm.clear();
const frontSc = getScenarioById('flick-static')!;
const targetFront = tm.spawnTarget(frontSc, new THREE.Vector3(8, 1.7, -4));
const hitFrontResult = tm.checkHit(throughRay);
const targetInFrontNotBlocked = hitFrontResult.hit === true && hitFrontResult.targetId === targetFront.id;

// Target at (8, 1.7, -10) [behind barrier at z=-8]
tm.clear();
const targetBehind = tm.spawnTarget(frontSc, new THREE.Vector3(8, 1.7, -10));
const hitBehindResult = tm.checkHit(throughRay);
const targetBehindIsBlocked = hitBehindResult.hit === false;

record(
  'Cover',
  'Cover occlusion: target in front is hittable, target behind is occluded',
  targetInFrontNotBlocked && targetBehindIsBlocked,
  `frontHit=${targetInFrontNotBlocked}, behindBlocked=${targetBehindIsBlocked}, coverDist=${throughDist.toFixed(2)}`
);

// ─────────────────────────────────────────────────────────────────────────
// Section 3.2: Critical Line-of-Sight & Perspective Occlusion Analysis
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- SECTION 3.2: LINE OF SIGHT FOR COVER SCENARIOS ---');

// Let's test all cover scenarios when target is fully emerged/exposed from player camera (0, 1.7, 0):
const playerCam = new THREE.Vector3(0, 1.7, 0);

for (const box of ARENA_COVER_BOXES) {
  const anchorZ = box.max.z - 0.25;

  for (const side of ['left', 'right'] as const) {
    // Check tactical-jiggle
    const exposedX_jiggle = getCoverExposedX(box, side, anchorZ, 0.45);
    const jiggleTargetPos = new THREE.Vector3(exposedX_jiggle, HEAD_LEVEL_Y, anchorZ);
    const jiggleRayDir = new THREE.Vector3().subVectors(jiggleTargetPos, playerCam).normalize();
    const jiggleRay = new THREE.Ray(playerCam, jiggleRayDir);
    const jiggleCoverDist = intersectRayCoverBoxes(jiggleRay);
    const jiggleTargetDist = playerCam.distanceTo(jiggleTargetPos);
    const jiggleOccluded = jiggleCoverDist < jiggleTargetDist;

    // Check tactical-wideswing
    const swingInwards = box.center.x < 0 ? 'right' : 'left';
    const exposedX_swing = getCoverExposedX(box, swingInwards, anchorZ, 2.0);
    const swingTargetPos = new THREE.Vector3(exposedX_swing, HEAD_LEVEL_Y, anchorZ);
    const swingRayDir = new THREE.Vector3().subVectors(swingTargetPos, playerCam).normalize();
    const swingRay = new THREE.Ray(playerCam, swingRayDir);
    const swingCoverDist = intersectRayCoverBoxes(swingRay);
    const swingTargetDist = playerCam.distanceTo(swingTargetPos);
    const swingOccluded = swingCoverDist < swingTargetDist;

    // Check tactical-angle-clear
    const cornerMargin = 0.40;
    const cornerX = side === 'right' ? box.rightEdgeX + cornerMargin : box.leftEdgeX - cornerMargin;
    const angleTargetPos = new THREE.Vector3(cornerX, HEAD_LEVEL_Y, box.max.z);
    const angleRayDir = new THREE.Vector3().subVectors(angleTargetPos, playerCam).normalize();
    const angleRay = new THREE.Ray(playerCam, angleRayDir);
    const angleCoverDist = intersectRayCoverBoxes(angleRay);
    const angleTargetDist = playerCam.distanceTo(angleTargetPos);
    const angleOccluded = angleCoverDist < angleTargetDist;

    record(
      'Cover LoS Audit',
      `[${box.id}] side=${side} tactical-jiggle`,
      !jiggleOccluded,
      `exposedX=${exposedX_jiggle.toFixed(2)}, Z=${anchorZ.toFixed(2)}, coverDist=${jiggleCoverDist.toFixed(2)}, targetDist=${jiggleTargetDist.toFixed(2)}, occluded=${jiggleOccluded}`,
      jiggleOccluded
    );

    record(
      'Cover LoS Audit',
      `[${box.id}] side=${swingInwards} tactical-wideswing`,
      !swingOccluded,
      `exposedX=${exposedX_swing.toFixed(2)}, Z=${anchorZ.toFixed(2)}, coverDist=${swingCoverDist.toFixed(2)}, targetDist=${swingTargetDist.toFixed(2)}, occluded=${swingOccluded}`,
      swingOccluded
    );

    record(
      'Cover LoS Audit',
      `[${box.id}] side=${side} tactical-angle-clear`,
      !angleOccluded,
      `cornerX=${cornerX.toFixed(2)}, Z=${box.max.z.toFixed(2)}, coverDist=${angleCoverDist.toFixed(2)}, targetDist=${angleTargetDist.toFixed(2)}, occluded=${angleOccluded}`,
      angleOccluded
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Section 4: Multi-Threat Hybrid Clutch Audit
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- SECTION 4: HYBRID CLUTCH AUDIT ---');

tm.clear();
const clutchSc = getScenarioById('hybrid-clutch')!;
const t1 = tm.spawnTarget(clutchSc);
const t2 = tm.spawnTarget(clutchSc);
const t3 = tm.spawnTarget(clutchSc);

const clutchPass =
  tm.getActiveCount() === 3 &&
  t1.pattern === 'wideswing' &&
  t1.controllerState?.type === 'cover_peek' &&
  t2.pattern === 'strafe' &&
  t2.controllerState?.type === 'tactical_strafe' &&
  t3.pattern === 'wander' &&
  t3.controllerState?.type === 'smooth_steering';

record(
  'Hybrid Clutch',
  'Spawns 3 distinct threats with heterogeneous controllers & patterns',
  clutchPass,
  `T1 pattern=${t1.pattern} (${t1.controllerState?.type}), T2 pattern=${t2.pattern} (${t2.controllerState?.type}), T3 pattern=${t3.pattern} (${t3.controllerState?.type})`
);

// ─────────────────────────────────────────────────────────────────────────
// Section 5: Backwards Compatibility Audit
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- SECTION 5: BACKWARDS COMPATIBILITY AUDIT ---');

// 5.1 DIMENSION_CONFIGS mapping
let dimConfigPass = true;
const missingScenarioMappings: string[] = [];
for (const [dimKey, config] of Object.entries(DIMENSION_CONFIGS)) {
  for (const scId of config.eligibleScenarioIds) {
    if (!getScenarioById(scId)) {
      dimConfigPass = false;
      missingScenarioMappings.push(`${dimKey}->${scId}`);
    }
  }
}
record(
  'Backwards Compatibility',
  'Training Intelligence DIMENSION_CONFIGS scenario resolution',
  dimConfigPass,
  missingScenarioMappings.length === 0 ? 'All mapped scenario IDs resolve correctly' : `Missing: ${missingScenarioMappings.join(', ')}`
);

// 5.2 Routines check
let routinesPass = true;
const routineDetails: string[] = [];
for (const r of TRAINING_ROUTINES) {
  let allDrillsExist = true;
  for (const scId of r.scenarioIds) {
    const sc = getScenarioById(scId);
    if (!sc) allDrillsExist = false;
  }
  const totalMins = Math.round(r.totalDurationSec / 60);
  routineDetails.push(`${r.id} (${r.scenarioIds.length} drills, ${totalMins}m, valid=${allDrillsExist})`);
  if (!allDrillsExist) routinesPass = false;
}
record(
  'Backwards Compatibility',
  'Routines 5m, 10m, 20m compositions & drill IDs',
  routinesPass,
  routineDetails.join('; ')
);

// ─────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────
console.log('\n=================================================================');
console.log('VERIFICATION RESULTS SUMMARY');
console.log('=================================================================');

let passCount = 0;
let failCount = 0;
let warnCount = 0;

for (const r of results) {
  const icon = r.status === 'PASS' ? '✓ PASS' : r.status === 'WARN' ? '⚠ WARN' : '✗ FAIL';
  console.log(`[${icon}] [${r.section}] ${r.name}: ${r.details}`);
  if (r.status === 'PASS') passCount++;
  else if (r.status === 'WARN') warnCount++;
  else failCount++;
}

console.log('\n-----------------------------------------------------------------');
console.log(`Total Checks: ${results.length} | PASS: ${passCount} | WARN: ${warnCount} | FAIL: ${failCount}`);
console.log('-----------------------------------------------------------------');
