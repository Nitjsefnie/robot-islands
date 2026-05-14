// Orbital mechanics: satellite data model, launch logic, and dispatch.
//
// Pure layer — no PixiJS, no DOM. All state mutations go through explicit
// functions so the simulation is testable without a renderer.
//
// §14.2 Spaceport + §14.7 launch success rolls with failure modes + upgrade lifecycle.

import { tileToCell } from './discovery.js';
import { inv } from './economy.js';
import { makeSeededRng } from './rng.js';
import type { ResourceId } from './recipes.js';
import type { WorldState } from './world.js';

export const SAT_BUFFER_CAP = 100;

/** §14.2 Orbital Tracking Station detection radius. Placeholder — Appendix A.
 *  Chosen to cover a meaningful slice of the orbital arena (multi-cell)
 *  while leaving room for multi-station networks to extend reach. */
export const ORBITAL_TRACKING_DETECTION_RADIUS_TILES = 1500;

export type SatelliteVariant = 'scanner' | 'sweeper' | 'comm';

export interface SatBufferEntry {
  readonly type: 'discovery' | 'weather' | 'debris';
  readonly payload: unknown;
}

export interface Satellite {
  readonly id: string;
  readonly variant: SatelliteVariant;
  readonly spaceportIslandId: string;
  /** Current lock position in world tiles. */
  x: number;
  y: number;
  /** Onboard comm range in tiles. */
  commRange: number;
  /** Scanner coverage radius in tiles (scanner only). */
  coverageRadius: number;
  /** Remaining maneuvering fuel for relocation. */
  fuel: number;
  /** Lodged debris slowdowns: [scan, weather, comm] each 0-1. */
  lodges: { scan: number; weather: number; comm: number };
  /** Locked (parked) vs in transit. */
  locked: boolean;
  /** If pending repair, the incoming repair drone id. */
  pendingRepairDroneId: string | null;
  /** Store-and-forward buffer for disconnected satellites. */
  buffer: SatBufferEntry[];
  /** §14.6 in-flight move target. When set, the satellite is in transit and
   *  unlocked (`locked === false`); on arrival, position is updated and
   *  `movingTo` is cleared. Missing/undefined ≡ stationary. */
  movingTo?: { x: number; y: number; arrivalMs: number };
}

export interface RepairDrone {
  readonly id: string;
  readonly targetSatId: string;
  readonly launchTime: number;
  readonly expectedArrivalTime: number;
}

/** §14.8 debris field anchored to one stratification cell. Multiple fields
 *  exist as separate entries in `world.debrisFields`. */
export interface DebrisField {
  readonly cellX: number;
  readonly cellY: number;
  /** Discrete fragment count. Reduced by Sweeper Sat cleanup (§14.8 / Task
   *  6.7); never decays over real time. Field is removed when this hits 0. */
  fragments: number;
}

export const DEBRIS_HIT_CONSTANT = 0.0005; // Appendix A placeholder
export const DEBRIS_LODGE_PROBABILITY = 0.9; // §14.8 "high chance"
export const DEBRIS_LODGE_MAGNITUDE = 0.05; // 5% slowdown per lodge
export const ORBIT_EXPLOSION_FRAGMENTS = 20; // §14.8 placeholder
export const SAT_DESTRUCTION_FRAGMENTS = 10; // §14.8 placeholder
export const SAT_CROSS_SECTION: Record<SatelliteVariant, number> = {
  scanner: 1.2, // larger optics
  sweeper: 1.0,
  comm: 0.8, // sleeker
};

/** §14.6 / Appendix A placeholders for satellite maneuvering. */
export const SAT_FUEL_PER_TILE = 0.05; // fuel units per tile of relocation
export const SAT_MOVE_SPEED_TILES_PER_SEC = 5; // travel speed
export const SAT_MOVE_FAILURE_PROBABILITY = 0.02; // §14.6 "low probability"
export const SAT_MOVE_FAILURE_DEBRIS = 10; // fragments seeded on in-transit loss

/** Per-variant payload resource id consumed at launch time. */
const PAYLOAD_RESOURCE: Record<SatelliteVariant, ResourceId> = {
  scanner: 'scanner_sat',
  sweeper: 'sweeper_sat',
  comm: 'comm_sat',
};

/**
 * Launch a satellite from a Spaceport.
 *
 * Prerequisites (§14.1 T6 gate):
 *   - The island must have `ascendantCoreCrafted === true`
 *   - The island must have at least one `spaceport` building
 *
 * Consumables (deducted from the island's inventory on success):
 *   - 1 × variant-specific satellite payload (`scanner_sat`, `sweeper_sat`, or `comm_sat`)
 *   - 1 × `orbital_insertion_package`
 *   - 1 × `antimatter_propellant`
 *
 * Success roll:
 *   - Base success rate depends on Spaceport tier: T1 = 30%, T2 = 50%, T3+ = 70%
 *   - Capped at 99% so there is always a small chance of failure
 *   - Deterministic RNG seeded from `${world.seed}_launch_${nowMs}`
 *
 * Failure modes:
 *   - Pad explosion (30% of failures): the Spaceport building is destroyed
 *   - Orbit explosion (70% of failures): satellite is lost; full debris
 *     mechanics are deferred to a later step
 */
export function launchSatellite(
  world: WorldState,
  spaceportIslandId: string,
  variant: SatelliteVariant,
  nowMs: number,
): { ok: true; sat: Satellite } | { ok: false; reason: string } {
  const state = world.islandStates?.get(spaceportIslandId);
  const spec = world.islands.find((i) => i.id === spaceportIslandId);
  if (!state || !spec) return { ok: false, reason: 'no-island' };
  if (!state.buildings.some((b) => b.defId === 'spaceport')) {
    return { ok: false, reason: 'no-spaceport' };
  }
  if (!state.ascendantCoreCrafted) {
    return { ok: false, reason: 'no-ascendant-core' };
  }

  // Verify consumables.
  const payload = PAYLOAD_RESOURCE[variant];
  const needed: Partial<Record<ResourceId, number>> = {
    [payload]: 1,
    orbital_insertion_package: 1,
    antimatter_propellant: 1,
  };
  for (const [res, qty] of Object.entries(needed)) {
    const have = state.inventory[res as ResourceId] ?? 0;
    if (have < (qty ?? 0)) {
      return { ok: false, reason: 'insufficient-resources' };
    }
  }

  // Roll launch success.
  const spaceport = state.buildings.find((b) => b.defId === 'spaceport')!;
  const spaceportTier = spaceport.tier ?? 1;
  const baseSuccess =
    spaceportTier === 1 ? 0.30 : spaceportTier === 2 ? 0.50 : 0.70;
  const successRate = Math.min(0.99, baseSuccess);
  const rng = makeSeededRng(`${world.seed}_launch_${nowMs}`);
  if (rng() > successRate) {
    // Failure: pad explosion (30%) or orbit explosion (70%).
    if (rng() < 0.30) {
      // Pad explosion: destroy spaceport.
      state.buildings = state.buildings.filter((b) => b.defId !== 'spaceport');
    } else {
      // Orbit explosion: §14.8 — debris field forms at the failed lock cell.
      const failedLockX = spec.cx + 100;
      const failedLockY = spec.cy + 100;
      const { cellX, cellY } = tileToCell(failedLockX, failedLockY);
      addDebrisFragments(world, cellX, cellY, ORBIT_EXPLOSION_FRAGMENTS);
    }
    return { ok: false, reason: 'launch-failure' };
  }

  // Deduct consumables.
  for (const [res, qty] of Object.entries(needed)) {
    state.inventory[res as ResourceId] -= qty ?? 0;
  }

  const sat: Satellite = {
    id: `sat_${nowMs}`,
    variant,
    spaceportIslandId,
    x: spec.cx + 100,
    y: spec.cy + 100,
    commRange: variant === 'comm' ? 500 : 200,
    coverageRadius: variant === 'scanner' ? 400 : 0,
    fuel: 100,
    lodges: { scan: 0, weather: 0, comm: 0 },
    locked: true,
    pendingRepairDroneId: null,
    buffer: [],
  };

  world.satellites.push(sat);
  return { ok: true, sat };
}

// ---------------------------------------------------------------------------
// Comm graph BFS
// ---------------------------------------------------------------------------

function groundStationCommRange(world: WorldState, islandId: string): number {
  const state = world.islandStates?.get(islandId);
  const sp = state?.buildings.find((b) => b.defId === 'spaceport');
  const tier = sp?.tier ?? 1;
  return tier === 1 ? 200 : tier === 2 ? 300 : 400;
}

function getEntityById(
  world: WorldState,
  id: string,
): { x: number; y: number; commRange: number } | null {
  const island = world.islands.find((i) => i.id === id);
  if (island) {
    return { x: island.cx, y: island.cy, commRange: groundStationCommRange(world, id) };
  }
  const sat = world.satellites.find((s) => s.id === id);
  if (sat) return { x: sat.x, y: sat.y, commRange: sat.commRange };
  return null;
}

export function connectedSatellites(world: WorldState): Satellite[] {
  const connected = new Set<string>();
  const queue: string[] = [];

  // Seed with all Spaceports on populated islands
  for (const spec of world.islands) {
    if (!spec.populated) continue;
    const state = world.islandStates?.get(spec.id);
    if (state?.buildings.some((b) => b.defId === 'spaceport')) {
      connected.add(spec.id);
      queue.push(spec.id);
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentEntity = getEntityById(world, currentId);
    if (!currentEntity) continue;

    for (const sat of world.satellites) {
      if (connected.has(sat.id)) continue;
      if (!sat.locked) continue; // in-transit satellites are unreachable
      const dist = Math.hypot(sat.x - currentEntity.x, sat.y - currentEntity.y);
      if (dist <= Math.max(currentEntity.commRange, sat.commRange)) {
        connected.add(sat.id);
        queue.push(sat.id);
      }
    }
  }

  return world.satellites.filter((s) => connected.has(s.id));
}

/** §14.2: per-island debris detection radius. Returns
 *  ORBITAL_TRACKING_DETECTION_RADIUS_TILES when the island has at least one
 *  orbital_tracking_station; returns 0 otherwise (no coverage = debris is
 *  invisible). */
export function debrisDetectionRangeForIsland(
  world: WorldState,
  islandId: string,
): number {
  const state = world.islandStates?.get(islandId);
  if (!state) return 0;
  if (!state.buildings.some((b) => b.defId === 'orbital_tracking_station')) {
    return 0;
  }
  return ORBITAL_TRACKING_DETECTION_RADIUS_TILES;
}

// ---------------------------------------------------------------------------
// Store-and-forward buffering
// ---------------------------------------------------------------------------

export function appendSatBuffer(sat: Satellite, entry: SatBufferEntry): void {
  if (sat.buffer.length >= SAT_BUFFER_CAP) {
    sat.buffer.shift();
  }
  sat.buffer.push(entry);
}

export function flushSatBuffer(sat: Satellite): SatBufferEntry[] {
  const entries = [...sat.buffer];
  sat.buffer = [];
  return entries;
}

export function dispatchRepairDrone(
  world: WorldState,
  spaceportIslandId: string,
  targetSatId: string,
  nowMs: number,
): { ok: true; drone: RepairDrone } | { ok: false; reason: string } {
  const sat = world.satellites.find((s) => s.id === targetSatId);
  if (!sat) return { ok: false, reason: 'no-satellite' };
  if (sat.pendingRepairDroneId) return { ok: false, reason: 'repair-pending' };

  const state = world.islandStates?.get(spaceportIslandId);
  if (!state) return { ok: false, reason: 'no-island' };
  if (!state.buildings.some((b) => b.defId === 'spaceport')) {
    return { ok: false, reason: 'no-spaceport' };
  }
  if (!state.ascendantCoreCrafted) {
    return { ok: false, reason: 'no-ascendant-core' };
  }

  // TODO(§14.12): proportional fuel load by distance
  // Consume 1 repair_pack + 1 antimatter_propellant
  if (inv(state, 'repair_pack') < 1) return { ok: false, reason: 'insufficient-repair-pack' };
  if (inv(state, 'antimatter_propellant') < 1) return { ok: false, reason: 'insufficient-fuel' };

  state.inventory.repair_pack = inv(state, 'repair_pack') - 1;
  state.inventory.antimatter_propellant = inv(state, 'antimatter_propellant') - 1;

  const travelTimeSec = 100; // placeholder: 100 seconds
  const drone: RepairDrone = {
    id: `repair_${nowMs}`,
    targetSatId,
    launchTime: nowMs,
    expectedArrivalTime: nowMs + travelTimeSec * 1000,
  };

  sat.pendingRepairDroneId = drone.id;
  world.repairDrones.push(drone);
  return { ok: true, drone };
}

export function tickRepairDrones(world: WorldState, nowMs: number): void {
  const remaining: RepairDrone[] = [];
  for (const drone of world.repairDrones) {
    if (nowMs < drone.expectedArrivalTime) {
      remaining.push(drone);
      continue;
    }

    const sat = world.satellites.find((s) => s.id === drone.targetSatId);
    if (!sat) {
      // Target destroyed before arrival — drone lost
      continue;
    }

    // 5% mechanical failure roll
    const rng = makeSeededRng(`${world.seed}_repair_${drone.id}`);
    if (rng() < 0.05) {
      // Lost in transit
      sat.pendingRepairDroneId = null;
      continue;
    }

    // Success: clear all lodges, refuel to full
    sat.lodges = { scan: 0, weather: 0, comm: 0 };
    sat.fuel = 100;
    sat.pendingRepairDroneId = null;
  }
  world.repairDrones = remaining;
}

/**
 * Upgrade the Spaceport on an island to the next tier.
 *
 * Cost table (§14.2 spec literal):
 *   - Tier 1 → 2: 5 phase_converter, 2 memetic_core, 50 cryogenic_hydrogen
 *   - Tier 2 → 3: 10 reality_anchor, 5 memetic_core, 100 antimatter_propellant
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, reason }` when the island
 * or spaceport is missing, the tier is already maxed, or resources are insufficient.
 */
/** Find or create the debris field anchored to a stratification cell.
 *  Adds `fragments` to the existing count or creates a new field. */
export function requestSatMove(
  world: WorldState,
  satId: string,
  targetX: number,
  targetY: number,
  nowMs: number,
): { ok: true; eta: number } | { ok: false; reason: string } {
  const sat = world.satellites.find((s) => s.id === satId);
  if (!sat) return { ok: false, reason: 'no-satellite' };
  if (sat.movingTo) return { ok: false, reason: 'already-moving' };
  if (sat.pendingRepairDroneId) return { ok: false, reason: 'pending-repair' };
  if (!sat.locked) return { ok: false, reason: 'not-locked' };
  const dx = targetX - sat.x;
  const dy = targetY - sat.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { ok: false, reason: 'no-distance' };
  const fuelCost = dist * SAT_FUEL_PER_TILE;
  if (sat.fuel < fuelCost) return { ok: false, reason: 'insufficient-fuel' };
  // Spend fuel up-front (committed at command time, mirroring drone fuel
  // semantics in dispatchDrone).
  sat.fuel -= fuelCost;
  const travelSec = dist / SAT_MOVE_SPEED_TILES_PER_SEC;
  sat.movingTo = { x: targetX, y: targetY, arrivalMs: nowMs + travelSec * 1000 };
  sat.locked = false;
  return { ok: true, eta: sat.movingTo.arrivalMs };
}

export function tickSatMovement(world: WorldState, nowMs: number): void {
  if (world.satellites.length === 0) return;
  const survivors: Satellite[] = [];
  for (const sat of world.satellites) {
    if (!sat.movingTo) {
      survivors.push(sat);
      continue;
    }
    if (nowMs < sat.movingTo.arrivalMs) {
      survivors.push(sat);
      continue;
    }
    // Arrival window — roll mechanical-failure.
    const rng = makeSeededRng(`${world.seed}_satmove_${sat.id}_${sat.movingTo.arrivalMs}`);
    if (rng() < SAT_MOVE_FAILURE_PROBABILITY) {
      // Lost in transit — seed debris at the loss cell.
      const { cellX, cellY } = tileToCell(sat.movingTo.x, sat.movingTo.y);
      addDebrisFragments(world, cellX, cellY, SAT_MOVE_FAILURE_DEBRIS);
      // sat is omitted from survivors → destroyed.
      continue;
    }
    // Success: update position, re-lock, clear movingTo.
    sat.x = sat.movingTo.x;
    sat.y = sat.movingTo.y;
    sat.locked = true;
    sat.movingTo = undefined;
    survivors.push(sat);
  }
  world.satellites = survivors;
}

export function addDebrisFragments(
  world: WorldState,
  cellX: number,
  cellY: number,
  fragments: number,
): DebrisField {
  let field = world.debrisFields.find(
    (f) => f.cellX === cellX && f.cellY === cellY,
  );
  if (field) {
    field.fragments += fragments;
    return field;
  }
  field = { cellX, cellY, fragments };
  world.debrisFields.push(field);
  return field;
}

/** Hit probability per tick for one satellite inside a debris field. */
export function debrisHitProbability(
  field: DebrisField,
  sat: Satellite,
): number {
  return Math.min(
    0.99,
    field.fragments * DEBRIS_HIT_CONSTANT * (SAT_CROSS_SECTION[sat.variant] ?? 1),
  );
}

/** Tick debris-field interactions for one frame.
 *
 * For each satellite inside a debris field, rolls hit probability. On hit,
 * rolls lodge (high) vs destruction (low). Lodge: bumps a random sub-stat.
 * Destruction: removes the satellite and seeds SAT_DESTRUCTION_FRAGMENTS
 * into the cell — Kessler cascade emerges naturally.
 *
 * Deterministic — RNG seeded from `${world.seed}_debris_${nowMs}_${sat.id}`. */
export function tickDebris(world: WorldState, nowMs: number): void {
  if (world.debrisFields.length === 0 || world.satellites.length === 0) return;
  const survivors: Satellite[] = [];
  for (const sat of world.satellites) {
    if (!sat.locked) {
      survivors.push(sat);
      continue;
    }
    const { cellX, cellY } = tileToCell(sat.x, sat.y);
    const field = world.debrisFields.find(
      (f) => f.cellX === cellX && f.cellY === cellY,
    );
    if (!field || field.fragments <= 0) {
      survivors.push(sat);
      continue;
    }
    const hitP = debrisHitProbability(field, sat);
    const rng = makeSeededRng(`${world.seed}_debris_${nowMs}_${sat.id}`);
    if (rng() >= hitP) {
      survivors.push(sat);
      continue;
    }
    // HIT — split into lodge vs destruction.
    if (rng() < DEBRIS_LODGE_PROBABILITY) {
      // Lodge — pick a random sub-stat and slow it by DEBRIS_LODGE_MAGNITUDE.
      const which = rng();
      const subStat: 'scan' | 'weather' | 'comm' =
        which < 1 / 3 ? 'scan' : which < 2 / 3 ? 'weather' : 'comm';
      sat.lodges[subStat] = Math.min(
        1,
        sat.lodges[subStat] + DEBRIS_LODGE_MAGNITUDE,
      );
      survivors.push(sat);
    } else {
      // Destruction — sat lost, fragments added to cell.
      addDebrisFragments(world, cellX, cellY, SAT_DESTRUCTION_FRAGMENTS);
      // Note: `sat` does NOT make it into `survivors` — destroyed.
    }
  }
  world.satellites = survivors;
  // Cleanup: drop fields with zero fragments.
  world.debrisFields = world.debrisFields.filter((f) => f.fragments > 0);
}

export function upgradeSpaceport(
  world: WorldState,
  islandId: string
): { ok: true } | { ok: false; reason: string } {
  const state = world.islandStates?.get(islandId);
  if (!state) return { ok: false, reason: 'no-island' };
  const sp = state.buildings.find(b => b.defId === 'spaceport');
  if (!sp) return { ok: false, reason: 'no-spaceport' };
  const currentTier = sp.tier ?? 1;
  if (currentTier >= 3) return { ok: false, reason: 'max-tier' };

  const costs = currentTier === 1
    ? { phase_converter: 5, memetic_core: 2, cryogenic_hydrogen: 50 }
    : { reality_anchor: 10, memetic_core: 5, antimatter_propellant: 100 };

  // Check inventory
  for (const [r, amt] of Object.entries(costs)) {
    if (inv(state, r as ResourceId) < amt) return { ok: false, reason: 'insufficient-resources' };
  }
  // Consume
  for (const [r, amt] of Object.entries(costs)) {
    state.inventory[r as ResourceId] = inv(state, r as ResourceId) - amt;
  }
  sp.tier = currentTier + 1;
  return { ok: true };
}
