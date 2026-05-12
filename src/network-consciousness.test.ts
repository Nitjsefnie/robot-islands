// Pure tests for `computeNcState` per SPEC §9.6.
//
// Covers the four buff thresholds (3/5/10/20), the no-milestone case, and
// the T3-gate semantics (only level ≥ 15 islands count).

import { describe, expect, it } from 'vitest';

import type { IslandState } from './economy.js';
import { computeNcState } from './network-consciousness.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';

function blankInventory(): Record<ResourceId, number> {
  const inv = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) inv[r] = 0;
  return inv;
}

function blankCaps(value: number): Record<ResourceId, number> {
  const caps = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) caps[r] = value;
  return caps;
}

function blankFunnel(): Record<ResourceId, number> {
  const f = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) f[r] = 0;
  return f;
}

function makeState(id: string, level: number): IslandState {
  return {
    id,
    buildings: [],
    inventory: blankInventory(),
    storageCaps: blankCaps(100),
    xp: 0,
    level,
    unspentSkillPoints: 0,
    unlockedNodes: new Set(),
    subPathProgress: new Map(),
    funnelPending: blankFunnel(),
    genesisTarget: null,
    lastTick: 0,
    specializationRole: null,
    declaredAt: null,
    aiCoreCrafted: false,
    ascendantCoreCrafted: false,
    lastResetAt: null,
    timeLockBankedMin: 0,
    accelerationQueue: [],
    accelerationRemainingMin: 0,
    bankingEnabled: false,
    singularityStoredWs: 0,
  };
}

function mapOf(states: ReadonlyArray<IslandState>): Map<string, IslandState> {
  const m = new Map<string, IslandState>();
  for (const s of states) m.set(s.id, s);
  return m;
}

describe('computeNcState — Network Consciousness thresholds per §9.6', () => {
  it('empty map → milestone 0 / buff 1.0 / count 0', () => {
    const nc = computeNcState(new Map());
    expect(nc.tier3PlusCount).toBe(0);
    expect(nc.milestone).toBe(0);
    expect(nc.globalProductionBuff).toBe(1);
  });

  it('1 island at T3+ → milestone 0 (below threshold)', () => {
    const nc = computeNcState(mapOf([makeState('a', 15)]));
    expect(nc.tier3PlusCount).toBe(1);
    expect(nc.milestone).toBe(0);
    expect(nc.globalProductionBuff).toBe(1);
  });

  it('2 islands at T3+ → milestone 0 (still below threshold)', () => {
    const nc = computeNcState(mapOf([makeState('a', 20), makeState('b', 16)]));
    expect(nc.tier3PlusCount).toBe(2);
    expect(nc.milestone).toBe(0);
    expect(nc.globalProductionBuff).toBe(1);
  });

  it('3 islands at T3+ → milestone 1 / buff 1.05', () => {
    const nc = computeNcState(
      mapOf([makeState('a', 15), makeState('b', 17), makeState('c', 22)]),
    );
    expect(nc.tier3PlusCount).toBe(3);
    expect(nc.milestone).toBe(1);
    expect(nc.globalProductionBuff).toBeCloseTo(1.05, 12);
  });

  it('5 islands at T3+ → milestone 2 / buff 1.10', () => {
    const states: IslandState[] = [];
    for (let i = 0; i < 5; i++) states.push(makeState(`a${i}`, 15));
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(5);
    expect(nc.milestone).toBe(2);
    expect(nc.globalProductionBuff).toBeCloseTo(1.10, 12);
  });

  it('10 islands at T3+ → milestone 3 / buff 1.25', () => {
    const states: IslandState[] = [];
    for (let i = 0; i < 10; i++) states.push(makeState(`a${i}`, 15));
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(10);
    expect(nc.milestone).toBe(3);
    expect(nc.globalProductionBuff).toBeCloseTo(1.25, 12);
  });

  it('20 islands at T3+ → milestone 4 / buff 1.25', () => {
    const states: IslandState[] = [];
    for (let i = 0; i < 20; i++) states.push(makeState(`a${i}`, 15));
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(20);
    expect(nc.milestone).toBe(4);
    expect(nc.globalProductionBuff).toBeCloseTo(1.25, 12);
  });

  it('non-T3 islands are not counted (level 14 just below)', () => {
    const states: IslandState[] = [];
    // 5 islands at level 14 (T2), should produce milestone 0.
    for (let i = 0; i < 5; i++) states.push(makeState(`a${i}`, 14));
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(0);
    expect(nc.milestone).toBe(0);
    expect(nc.globalProductionBuff).toBe(1);
  });

  it('mixed-tier population: only T3+ count toward the milestone', () => {
    const states: IslandState[] = [
      makeState('home', 30),      // T4 → counts
      makeState('a', 15),         // T3 boundary → counts
      makeState('b', 14),         // T2 → does NOT count
      makeState('c', 1),          // T1 → does NOT count
      makeState('d', 17),         // T3 → counts
    ];
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(3);
    expect(nc.milestone).toBe(1);
    expect(nc.globalProductionBuff).toBeCloseTo(1.05, 12);
  });

  it('level 15 is the T3 boundary (inclusive)', () => {
    const states: IslandState[] = [
      makeState('a', 15),
      makeState('b', 15),
      makeState('c', 15),
    ];
    const nc = computeNcState(mapOf(states));
    expect(nc.tier3PlusCount).toBe(3);
    expect(nc.milestone).toBe(1);
  });
});
