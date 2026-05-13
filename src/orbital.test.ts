// Orbital mechanics: satellite launch tests (§14.2 / §14.7).

import { describe, expect, it } from 'vitest';

import { launchSatellite, type SatelliteVariant } from './orbital.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';
import {
  makeInitialWorld,
  type WorldState,
} from './world.js';
import type { IslandState } from './economy.js';

function emptyInv(): Record<ResourceId, number> {
  const inv = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) inv[r] = 0;
  return inv;
}

function makeIslandState(over: Partial<IslandState> = {}): IslandState {
  return {
    id: 'home',
    buildings: [],
    inventory: emptyInv(),
    storageCaps: emptyInv(),
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    unlockedNodes: new Set(),
    subPathProgress: new Map(),
    funnelPending: emptyInv(),
    specializationRole: null,
    declaredAt: null,
    aiCoreCrafted: false,
    ascendantCoreCrafted: false,
    lastResetAt: null,
    timeLockBankedMin: 0,
    accelerationQueue: [],
    accelerationRemainingMin: 0,
    bankingEnabled: false,
    genesisTarget: null,
    singularityStoredWs: 0,
    lastTick: 0,
    ...over,
  };
}

function makeWorld(over: Partial<WorldState> = {}): WorldState {
  const base = makeInitialWorld(0);
  return {
    ...base,
    satellites: [],
    ...over,
  };
}

function addSpaceport(
  state: IslandState,
  tier?: number,
): void {
  state.buildings.push({
    id: 'spaceport-1',
    defId: 'spaceport',
    x: 0,
    y: 0,
    ...(tier !== undefined ? { tier } : {}),
  });
}

function stockLaunchResources(
  state: IslandState,
  variant: SatelliteVariant,
): void {
  state.inventory.scanner_sat = variant === 'scanner' ? 1 : 0;
  state.inventory.sweeper_sat = variant === 'sweeper' ? 1 : 0;
  state.inventory.comm_sat = variant === 'comm' ? 1 : 0;
  state.inventory.orbital_insertion_package = 1;
  state.inventory.antimatter_propellant = 1;
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

describe('satellite launch prerequisites', () => {
  it('rejects when island does not exist', () => {
    const world = makeWorld();
    const result = launchSatellite(world, 'missing', 'scanner', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-island');
  });

  it('rejects when island has no spaceport', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-spaceport');
  });

  it('rejects when ascendant_core has not been crafted', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: false });
    addSpaceport(state);
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-ascendant-core');
  });

  it('rejects when resources are insufficient', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state);
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-resources');
  });
});

// ---------------------------------------------------------------------------
// Success roll
// ---------------------------------------------------------------------------

describe('satellite launch success roll', () => {
  it('succeeds at T1 spaceport with a low roll (nowMs=0 → rng≈0.23)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 1);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(world.satellites).toHaveLength(1);
    expect(result.sat.variant).toBe('scanner');
  });

  it('succeeds at T2 spaceport with a moderate roll (nowMs=3 → rng≈0.32)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 2);
    stockLaunchResources(state, 'comm');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'comm', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(world.satellites).toHaveLength(1);
  });

  it('succeeds at T3 spaceport with a higher roll (nowMs=1 → rng≈0.58)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 3);
    stockLaunchResources(state, 'sweeper');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'sweeper', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(world.satellites).toHaveLength(1);
  });

  it('fails at T1 spaceport with a high roll (nowMs=5 → rng≈0.70)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 1);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('launch-failure');
    expect(world.satellites).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe('satellite launch failure modes', () => {
  it('pad explosion destroys the spaceport (nowMs=5, T1, second roll≈0.20 < 0.30)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 1);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('launch-failure');
    // Resources should NOT be consumed on failure.
    expect(state.inventory.scanner_sat).toBe(1);
    expect(state.inventory.orbital_insertion_package).toBe(1);
    expect(state.inventory.antimatter_propellant).toBe(1);
    // Spaceport should be destroyed.
    expect(state.buildings.some((b) => b.defId === 'spaceport')).toBe(false);
  });

  it('orbit explosion does not destroy the spaceport (nowMs=9, T1, second roll≈0.99 ≥ 0.30)', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 1);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 9);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('launch-failure');
    // Resources should NOT be consumed on failure.
    expect(state.inventory.scanner_sat).toBe(1);
    // Spaceport should survive.
    expect(state.buildings.some((b) => b.defId === 'spaceport')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Satellite stats per variant
// ---------------------------------------------------------------------------

describe('satellite stats per variant', () => {
  it('scanner has coverageRadius 400 and commRange 200', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 3);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sat.coverageRadius).toBe(400);
    expect(result.sat.commRange).toBe(200);
    expect(result.sat.variant).toBe('scanner');
  });

  it('comm has commRange 500 and coverageRadius 0', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 3);
    stockLaunchResources(state, 'comm');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'comm', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sat.commRange).toBe(500);
    expect(result.sat.coverageRadius).toBe(0);
    expect(result.sat.variant).toBe('comm');
  });

  it('sweeper has commRange 200 and coverageRadius 0', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 3);
    stockLaunchResources(state, 'sweeper');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'sweeper', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sat.commRange).toBe(200);
    expect(result.sat.coverageRadius).toBe(0);
    expect(result.sat.variant).toBe('sweeper');
  });
});

// ---------------------------------------------------------------------------
// Resource consumption on success
// ---------------------------------------------------------------------------

describe('satellite launch resource consumption', () => {
  it('deducts payload, insertion package, and propellant on success', () => {
    const world = makeWorld();
    const state = makeIslandState({ id: 'home', ascendantCoreCrafted: true });
    addSpaceport(state, 3);
    stockLaunchResources(state, 'scanner');
    world.islandStates = new Map([['home', state]]);
    const result = launchSatellite(world, 'home', 'scanner', 1);
    expect(result.ok).toBe(true);
    expect(state.inventory.scanner_sat).toBe(0);
    expect(state.inventory.orbital_insertion_package).toBe(0);
    expect(state.inventory.antimatter_propellant).toBe(0);
  });
});
