// Building catalog completeness + tier-gating tests per SPEC §9.2.
//
// Every BuildingDefId in the type literal MUST have a corresponding entry
// in BUILDING_DEFS — otherwise indexed access `BUILDING_DEFS[b.defId]`
// returns undefined at runtime and rendering / economy lookups silently
// break. `noUncheckedIndexedAccess` only catches array reads; Record
// reads are fine until the runtime lookup fails.

import { describe, expect, it } from 'vitest';

import {
  ALL_BUILDING_DEF_IDS,
  BUILDING_DEFS,
  buildingUnlocked,
  unlockedDefs,
  type BuildingDefId,
} from './building-defs.js';

// Hand-mirrored list of every id in the union. If a new id is added to
// BuildingDefId, both this list AND BUILDING_DEFS must grow together —
// the completeness test below catches drift.
const KNOWN_DEF_IDS: ReadonlyArray<BuildingDefId> = [
  'mine',
  'workshop',
  'solar',
  'coal_gen',
  'dock',
  'dronepad',
  'logger',
  'smelter',
  'crate',
  'silo',
  'biomass_plant',
  'coke_oven',
  'blast_furnace',
  'steel_mill',
  'assembler',
  'tank',
  'electric_arc_furnace',
  'platform_constructor',
];

describe('BUILDING_DEFS catalog', () => {
  it('every BuildingDefId in the union has a def entry', () => {
    for (const id of KNOWN_DEF_IDS) {
      const def = BUILDING_DEFS[id];
      expect(def, `missing def for ${id}`).toBeDefined();
      expect(def.id).toBe(id);
    }
  });

  it('ALL_BUILDING_DEF_IDS matches the BUILDING_DEFS keyset', () => {
    const keys = Object.keys(BUILDING_DEFS).sort();
    const list = [...ALL_BUILDING_DEF_IDS].sort();
    expect(list).toEqual(keys);
  });

  it('every def declares positive integer footprint dimensions', () => {
    for (const id of KNOWN_DEF_IDS) {
      const def = BUILDING_DEFS[id];
      expect(def.width).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);
      expect(Number.isInteger(def.width)).toBe(true);
      expect(Number.isInteger(def.height)).toBe(true);
    }
  });

  it('tier is within 1..6', () => {
    for (const id of KNOWN_DEF_IDS) {
      const tier = BUILDING_DEFS[id].tier;
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(6);
    }
  });

  it('storage defs declare storageCap; others do not', () => {
    expect(BUILDING_DEFS.crate.storageCap).toBe(100);
    expect(BUILDING_DEFS.silo.storageCap).toBe(2000);
    expect(BUILDING_DEFS.tank.storageCap).toBe(2000);
    // Non-storage defs must not declare storageCap (would silently
    // contribute to aggregateStorageCaps otherwise).
    expect(BUILDING_DEFS.mine.storageCap).toBeUndefined();
    expect(BUILDING_DEFS.workshop.storageCap).toBeUndefined();
    expect(BUILDING_DEFS.solar.storageCap).toBeUndefined();
  });
});

describe('buildingUnlocked / tier gating (§9.2)', () => {
  it('T1 buildings unlock at level 1', () => {
    expect(buildingUnlocked(1, 'mine')).toBe(true);
    expect(buildingUnlocked(1, 'workshop')).toBe(true);
    expect(buildingUnlocked(1, 'logger')).toBe(true);
    expect(buildingUnlocked(1, 'smelter')).toBe(true);
    expect(buildingUnlocked(1, 'crate')).toBe(true);
    expect(buildingUnlocked(1, 'silo')).toBe(true);
  });

  it('T2 buildings stay locked at level 4 and unlock at level 5', () => {
    // tierForLevel(4) = 1, tierForLevel(5) = 2.
    expect(buildingUnlocked(4, 'coke_oven')).toBe(false);
    expect(buildingUnlocked(4, 'blast_furnace')).toBe(false);
    expect(buildingUnlocked(4, 'steel_mill')).toBe(false);
    expect(buildingUnlocked(4, 'assembler')).toBe(false);
    expect(buildingUnlocked(4, 'tank')).toBe(false);

    expect(buildingUnlocked(5, 'coke_oven')).toBe(true);
    expect(buildingUnlocked(5, 'blast_furnace')).toBe(true);
    expect(buildingUnlocked(5, 'steel_mill')).toBe(true);
    expect(buildingUnlocked(5, 'assembler')).toBe(true);
    expect(buildingUnlocked(5, 'tank')).toBe(true);
  });

  it('T3 buildings stay locked at level 14 and unlock at level 15', () => {
    expect(buildingUnlocked(14, 'electric_arc_furnace')).toBe(false);
    expect(buildingUnlocked(15, 'electric_arc_furnace')).toBe(true);
  });

  it('T1 buildings remain unlocked at higher tiers', () => {
    expect(buildingUnlocked(15, 'mine')).toBe(true);
    expect(buildingUnlocked(30, 'mine')).toBe(true);
    expect(buildingUnlocked(50, 'smelter')).toBe(true);
  });
});

describe('unlockedDefs', () => {
  it('returns every T1 id at level 1', () => {
    const list = unlockedDefs(1);
    // T1 defs in the catalog: mine, workshop, solar, coal_gen, dock,
    // dronepad, logger, smelter, crate, silo, biomass_plant. (Drone Pad
    // currently sits at T1 for the demo — see building-defs.ts.)
    expect(list).toContain('mine');
    expect(list).toContain('workshop');
    expect(list).toContain('logger');
    expect(list).toContain('smelter');
    expect(list).toContain('silo');
    expect(list).not.toContain('coke_oven');
    expect(list).not.toContain('blast_furnace');
    expect(list).not.toContain('electric_arc_furnace');
  });

  it('returns T1 + T2 ids at level 5', () => {
    const list = unlockedDefs(5);
    expect(list).toContain('mine');
    expect(list).toContain('coke_oven');
    expect(list).toContain('blast_furnace');
    expect(list).toContain('steel_mill');
    expect(list).toContain('assembler');
    expect(list).toContain('tank');
    expect(list).not.toContain('electric_arc_furnace');
  });

  it('returns T1 + T2 + T3 ids at level 15', () => {
    const list = unlockedDefs(15);
    expect(list).toContain('electric_arc_furnace');
    expect(list).toContain('blast_furnace');
    expect(list).toContain('mine');
  });
});
