// Tests for the event-driven economy tick loop.
//
// These are the hard correctness tests for §15.3 piecewise integration:
//
//   - Cap stall: Mine fills iron_ore to exactly cap, not beyond. Demonstrates
//     `findNextCapEvent` honesty: a naive dt×rate over the full interval
//     would overshoot.
//   - Input-depletion back-propagation: Workshop stops consuming when coal
//     runs out at t=500s — does NOT keep eating iron_ore for the remaining
//     100s. Demonstrates `inputAvail = 0` cuts both output AND consumption.
//   - XP accrual proportional to PRODUCTION × xp_weight, not net flow.
//   - Level up when threshold crossed; skill points granted.

import { describe, expect, it } from 'vitest';

import type { Building } from './buildings.js';
import {
  advanceIsland,
  computeRates,
  xpForLevel,
  type IslandState,
} from './economy.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';

const MINE: Building = {
  kind: 'mine',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  fill: 0,
  stroke: 0,
  label: 'Mine',
};
const WORKSHOP: Building = {
  kind: 'workshop',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  fill: 0,
  stroke: 0,
  label: 'Workshop',
};

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

function makeState(over: Partial<IslandState> = {}): IslandState {
  return {
    id: 'test',
    buildings: [],
    inventory: blankInventory(),
    storageCaps: blankCaps(100),
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    lastTick: 0,
    ...over,
  };
}

describe('advanceIsland — event-driven piecewise integration', () => {
  it('fills iron_ore to cap exactly, not beyond, with cap event at t=5s', () => {
    // Mine produces 1 iron_ore / 5s = 0.2/s. Start iron_ore = 99, cap = 100.
    // Headroom = 1, time to fill = 1 / 0.2 = 5s. After 10s the Mine should
    // have produced 1 unit then stalled for 5s.
    const state = makeState({
      buildings: [MINE],
      inventory: { ...blankInventory(), iron_ore: 99 },
    });
    advanceIsland(state, 10_000);
    expect(state.inventory.iron_ore).toBeCloseTo(100, 9);
    // Cap is a hard ceiling, not just an integer floor — verify no overshoot.
    expect(state.inventory.iron_ore).toBeLessThanOrEqual(100);
    expect(state.lastTick).toBe(10_000);
  });

  it('Mine alone over 10s starting at 0 produces 2 iron_ore (rate 0.2/s, no cap)', () => {
    // Sanity check on the base rate without cap interference.
    const state = makeState({
      buildings: [MINE],
      inventory: { ...blankInventory() },
    });
    advanceIsland(state, 10_000);
    expect(state.inventory.iron_ore).toBeCloseTo(2, 9);
  });

  it('back-propagates input depletion: Workshop stops eating iron_ore when coal hits 0', () => {
    // Mine: +0.2 iron_ore/s. Workshop: -0.1 iron_ore/s, -0.1 coal/s, +0.1 bolt/s.
    // Net iron_ore: +0.1/s. Net coal: -0.1/s. Coal starts at 50, hits 0 at t=500s.
    // From t=500s, Workshop stalls (inputAvail=0). Mine keeps running.
    //
    // Over 600s total:
    //   t=0..500s: Mine + Workshop, iron_ore += 0.1 * 500 = 50, bolt += 0.1*500 = 50,
    //              coal -= 0.1*500 = 50 (= 0)
    //   t=500..600s: Workshop stalled, Mine alone, iron_ore += 0.2 * 100 = 20
    //   final: iron_ore = 70, coal = 0, bolt = 50.
    const state = makeState({
      buildings: [MINE, WORKSHOP],
      inventory: { ...blankInventory(), coal: 50 },
    });
    advanceIsland(state, 600_000);
    expect(state.inventory.iron_ore).toBeCloseTo(70, 6);
    expect(state.inventory.coal).toBeCloseTo(0, 6);
    expect(state.inventory.bolt).toBeCloseTo(50, 6);
  });

  it('cap-stalled building also stops consuming inputs (back-propagation per §4.6)', () => {
    // Workshop produces bolt. Start bolt at cap (100). Workshop should be
    // fully stalled: outputAvail = 0 → effective rate = 0 → iron_ore and
    // coal are NOT consumed.
    const state = makeState({
      buildings: [WORKSHOP],
      inventory: {
        ...blankInventory(),
        iron_ore: 50,
        coal: 50,
        bolt: 100, // at cap
      },
    });
    advanceIsland(state, 10_000);
    expect(state.inventory.iron_ore).toBe(50); // untouched
    expect(state.inventory.coal).toBe(50); // untouched
    expect(state.inventory.bolt).toBe(100); // still at cap
    // No production → no XP
    expect(state.xp).toBe(0);
  });

  it('Workshop stalls immediately when iron_ore is 0 and coal is plentiful', () => {
    // inputAvail = 0 even with one missing input.
    const state = makeState({
      buildings: [WORKSHOP],
      inventory: { ...blankInventory(), coal: 50, iron_ore: 0 },
    });
    advanceIsland(state, 10_000);
    expect(state.inventory.coal).toBe(50); // not eaten
    expect(state.inventory.bolt).toBe(0); // none produced
  });
});

describe('XP accrual', () => {
  it('accrues XP proportional to production × xp_weight × time', () => {
    // Mine produces 0.2 iron_ore/s. iron_ore xp_weight = 1.
    // Over 10s: 0.2 * 1 * 10 = 2 XP.
    const state = makeState({
      buildings: [MINE],
      inventory: blankInventory(),
    });
    advanceIsland(state, 10_000);
    expect(state.xp).toBeCloseTo(2, 9);
  });

  it('weights bolt production at 10× iron_ore (xp_weight: bolt=10, iron_ore=1)', () => {
    // Mine + Workshop, plenty of coal. Over 10s:
    //   gross iron_ore production: 0.2/s × 10 = 2 units, xp_weight 1 → 2 XP
    //   gross bolt production: 0.1/s × 10 = 1 unit, xp_weight 10 → 10 XP
    //   total = 12 XP
    // Note: Workshop CONSUMES 1 unit iron_ore (Mine produces 2, net iron_ore
    // = 1). XP weighs GROSS production = 2, not net = 1.
    const state = makeState({
      buildings: [MINE, WORKSHOP],
      inventory: { ...blankInventory(), coal: 50 },
    });
    advanceIsland(state, 10_000);
    expect(state.xp).toBeCloseTo(12, 6);
    // And verify the inventory looks right: iron_ore net = +0.1/s × 10 = 1
    expect(state.inventory.iron_ore).toBeCloseTo(1, 6);
    expect(state.inventory.bolt).toBeCloseTo(1, 6);
    expect(state.inventory.coal).toBeCloseTo(49, 6);
  });

  it('stalled buildings earn zero XP', () => {
    const state = makeState({
      buildings: [WORKSHOP],
      inventory: { ...blankInventory(), iron_ore: 0, coal: 50 }, // workshop stalls
    });
    advanceIsland(state, 10_000);
    expect(state.xp).toBe(0);
  });
});

describe('Level up', () => {
  it('levels up when XP threshold is crossed and grants a skill point', () => {
    // xp_for_level_2 = 100 * 2^2.2 ≈ 459.48 (placeholder per §9.1).
    const threshold = xpForLevel(2);
    expect(threshold).toBeCloseTo(459.48, 0);
    // Mine alone earns 0.2 XP/s. We can't easily run a Mine that long in a
    // test without coupling to the time formula, so jam XP in directly via
    // a state that's pre-loaded — the levelUp routine runs inside
    // advanceIsland, so we trigger it with one tick that produces > threshold.
    //
    // Easier: 200 Workshops (which we can't actually build) wouldn't be
    // realistic. Use a fast hack: start xp just under threshold and advance
    // 5s with the Mine. Mine gain: 0.2 × 5 = 1 XP → push over threshold.
    const state = makeState({
      buildings: [MINE],
      inventory: blankInventory(),
      xp: threshold - 0.5,
    });
    advanceIsland(state, 5_000);
    expect(state.level).toBe(2);
    expect(state.unspentSkillPoints).toBe(1);
    expect(state.xp).toBeGreaterThanOrEqual(0);
    expect(state.xp).toBeLessThan(xpForLevel(3));
  });

  it('handles multiple level-ups in one segment (XP cascade)', () => {
    // Pre-load enough XP to skip several levels at once. The loop should
    // unwind them all without re-running advanceIsland.
    const need = xpForLevel(2) + xpForLevel(3) + xpForLevel(4);
    const state = makeState({
      buildings: [],
      inventory: blankInventory(),
      xp: need,
    });
    advanceIsland(state, 1);
    expect(state.level).toBe(4);
    expect(state.unspentSkillPoints).toBe(3);
    expect(state.xp).toBeCloseTo(0, 6);
  });
});

describe('computeRates', () => {
  it('returns gross production and net rates correctly', () => {
    const state = makeState({
      buildings: [MINE, WORKSHOP],
      inventory: { ...blankInventory(), coal: 50 },
    });
    const { production, net } = computeRates(state);
    expect(production.iron_ore).toBeCloseTo(0.2, 9);
    expect(production.bolt).toBeCloseTo(0.1, 9);
    expect(net.iron_ore).toBeCloseTo(0.1, 9); // +0.2 - 0.1
    expect(net.coal).toBeCloseTo(-0.1, 9);
    expect(net.bolt).toBeCloseTo(0.1, 9);
  });

  it('zeroes building rate when inputAvail = 0', () => {
    const state = makeState({
      buildings: [WORKSHOP],
      inventory: { ...blankInventory(), iron_ore: 0, coal: 50 },
    });
    const { byBuilding } = computeRates(state);
    expect(byBuilding[0]?.effectiveRate).toBe(0);
  });

  it('zeroes building rate when outputAvail = 0', () => {
    const state = makeState({
      buildings: [MINE],
      inventory: { ...blankInventory(), iron_ore: 100 }, // at cap
    });
    const { byBuilding } = computeRates(state);
    expect(byBuilding[0]?.effectiveRate).toBe(0);
  });
});
