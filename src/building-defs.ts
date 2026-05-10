// Pure-data building catalog per SPEC §8 and §15.1.
//
// `BuildingDef` is the static per-kind definition (footprint, render style,
// recipe binding, power, tier requirement). `PlacedBuilding` (in
// `buildings.ts`) is the per-instance runtime carrying only id/defId/x/y.
// The split lets the same def back many instances without each instance
// repeating fill/stroke/footprint.
//
// Step-9 catalog: T1 + T2 + T3 buildings sufficient to demonstrate the
// Iron/Steel chain (§7.1) end-to-end. T4/T5/T6 defs are deferred to steps
// 12/13. Heat-source adjacency (§5.2) is not yet implemented — Blast Furnace
// runs without its required heat source; comment flags the deferred constraint.
//
// No PixiJS imports, no DOM — `building-defs.ts` is pure data + the tier
// gate. `buildings.ts` consumes BUILDING_DEFS for rendering; `recipes.ts`
// keys its RECIPES table by `BuildingDefId`.

import { tierForLevel } from './skilltree.js';

/** SPEC §8 building category. Drives the per-category Specialization passive
 *  buff (§9.4) and the Building Catalog UI grouping. */
export type BuildingCategory =
  | 'extraction'
  | 'smelting'
  | 'chemistry'
  | 'manufacturing'
  | 'electronics'
  | 'power'
  | 'storage'
  | 'logistics'
  | 'cooling'
  | 'special';

/** Every defId in the step-9 catalog. New defs require both a literal here
 *  and an entry in BUILDING_DEFS — the indexed access in renderBuildings/
 *  economy would silently break on an undefined lookup otherwise. */
export type BuildingDefId =
  // Existing (step 1-8): T1 buildings on the home island
  | 'mine'
  | 'workshop'
  | 'solar'
  | 'coal_gen'
  | 'dock'
  | 'dronepad'
  // New T1
  | 'logger'
  | 'smelter'
  | 'crate'
  | 'silo'
  | 'biomass_plant'
  // New T2
  | 'coke_oven'
  | 'blast_furnace'
  | 'steel_mill'
  | 'assembler'
  | 'tank'
  // New T3
  | 'electric_arc_furnace'
  | 'platform_constructor';

/**
 * Per-kind static definition. Step 9 fills the fields needed by the
 * economy + render layer; `requiredTile`, `requiredBiomes`, adjacency, and
 * the heat flag stay in SPEC §15.1's BuildingDef shape but are not used yet.
 */
export interface BuildingDef {
  readonly id: BuildingDefId;
  readonly displayName: string;
  readonly category: BuildingCategory;
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6;
  /** Footprint width in tiles (whole tiles only). */
  readonly width: number;
  /** Footprint height in tiles. */
  readonly height: number;
  /** Primary fill colour (PIXI hex). */
  readonly fill: number;
  /** Stroke / outline colour. */
  readonly stroke: number;
  /** Optional storage cap contribution. Per §8.4 spec, Silo is dry-goods-only
   *  and Tank liquids/gases-only; for step 9 we simplify and aggregate
   *  `storageCap` as a uniform "+N to ALL resources" on placement. The
   *  category-routed-storage system is deferred. */
  readonly storageCap?: number;
  /** §5.1 electrical contribution. Either side may be undefined / 0. */
  readonly power?: { readonly produces?: number; readonly consumes?: number };
}

/** Read-only catalog. Keys = BuildingDefId; every defId MUST have an entry. */
export const BUILDING_DEFS: Readonly<Record<BuildingDefId, BuildingDef>> = {
  // -------------------------------------------------------------------------
  // T1 (levels 1-5)
  // -------------------------------------------------------------------------
  mine: {
    id: 'mine',
    displayName: 'Mine',
    category: 'extraction',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0x9a9a9a,
    stroke: 0x222222,
    power: { consumes: 40 },
  },
  workshop: {
    id: 'workshop',
    displayName: 'Workshop',
    category: 'manufacturing',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0xe07b3a,
    stroke: 0x6b2f00,
    power: { consumes: 60 },
  },
  solar: {
    id: 'solar',
    displayName: 'Solar Panel',
    category: 'power',
    tier: 1,
    width: 1,
    height: 1,
    fill: 0xf2c84b,
    stroke: 0x6a4a00,
    power: { produces: 50 },
  },
  coal_gen: {
    id: 'coal_gen',
    displayName: 'Coal Generator',
    category: 'power',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0xd97a18,
    stroke: 0x4a2400,
    power: { produces: 100 },
  },
  dock: {
    id: 'dock',
    displayName: 'Cargo Dock',
    category: 'logistics',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0x3a7bd5,
    stroke: 0x0a2a55,
  },
  // §8.8 lists Drone Pad as T2. Step 6 hardcoded it on the home island
  // (T1) so the drone demo works without a level grind; preserved here as
  // T1 with a deferred-tier comment. Re-tier to T2 when placement +
  // settlement (step 2.5 / §12) land and the demo no longer relies on it.
  dronepad: {
    id: 'dronepad',
    displayName: 'Drone Pad',
    category: 'logistics',
    tier: 1, // §8.8 = T2; demo retains T1 until placement system arrives.
    width: 1,
    height: 1,
    fill: 0x4a6b78,
    stroke: 0x14222a,
  },
  logger: {
    id: 'logger',
    displayName: 'Logger',
    category: 'extraction',
    tier: 1,
    width: 1,
    height: 1,
    fill: 0x2f5e2c,
    stroke: 0x0f2a0c,
    // §8.1: requires a `tree` tile. Placement isn't built (step 2.5) so the
    // tile requirement is unenforced for step 9 — Logger placed on forest-ne
    // produces wood without a `tree` adjacency check.
  },
  smelter: {
    id: 'smelter',
    displayName: 'Smelter',
    category: 'smelting',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0x7a5050,
    stroke: 0x3a1a1a,
    power: { consumes: 50 },
  },
  crate: {
    id: 'crate',
    displayName: 'Crate',
    category: 'storage',
    tier: 1,
    width: 1,
    height: 1,
    fill: 0x8a6a3a,
    stroke: 0x402a10,
    // §8.4: spec says +100 cap on one player-CHOSEN resource. For step 9
    // we simplify to +100 to ALL resources (player choice UI = deferred).
    storageCap: 100,
  },
  silo: {
    id: 'silo',
    displayName: 'Silo',
    category: 'storage',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0xa08a5a,
    stroke: 0x504028,
    // §8.4: spec says +2000 cap, dry-goods-only. Categorised routing is
    // deferred for step 9; we apply uniformly to all resources.
    storageCap: 2000,
  },
  biomass_plant: {
    id: 'biomass_plant',
    displayName: 'Biomass Plant',
    category: 'power',
    tier: 1,
    width: 2,
    height: 2,
    fill: 0x3e7a36,
    stroke: 0x1a3a16,
    power: { produces: 80 },
  },
  // -------------------------------------------------------------------------
  // T2 (levels 5-15)
  // -------------------------------------------------------------------------
  coke_oven: {
    id: 'coke_oven',
    displayName: 'Coke Oven',
    category: 'smelting',
    tier: 2,
    width: 2,
    height: 2,
    fill: 0x6a5a48,
    stroke: 0x2a2014,
    power: { consumes: 60 },
  },
  blast_furnace: {
    id: 'blast_furnace',
    displayName: 'Blast Furnace',
    category: 'smelting',
    tier: 2,
    width: 3,
    height: 3,
    fill: 0x8a2a1a,
    stroke: 0x401005,
    power: { consumes: 100 },
    // §5.2 / §8.2: spec requires an adjacent Heat Source (Coal Furnace,
    // Geothermal Vent, etc.). The heat-adjacency system is not yet built
    // (deferred — heat propagation lands with step 11/12). For step 9 the
    // Blast Furnace runs unconditionally given inputs + power.
  },
  steel_mill: {
    id: 'steel_mill',
    displayName: 'Steel Mill',
    category: 'smelting',
    tier: 2,
    width: 3,
    height: 3,
    fill: 0x6e7480,
    stroke: 0x2a2e36,
    power: { consumes: 120 },
    // §7.1: spec's "Pig iron + Scrap → Steel" includes Scrap as a co-input.
    // Scrap as a substitute/byproduct (§6.7) is deferred. Step 9 recipe is
    // Pig Iron → Steel.
  },
  assembler: {
    id: 'assembler',
    displayName: 'Assembler',
    category: 'manufacturing',
    tier: 2,
    width: 2,
    height: 2,
    fill: 0xff8c2a,
    stroke: 0x6e3500,
    power: { consumes: 80 },
  },
  tank: {
    id: 'tank',
    displayName: 'Tank',
    category: 'storage',
    tier: 2,
    width: 2,
    height: 2,
    fill: 0x2a4078,
    stroke: 0x0a1a3a,
    storageCap: 2000,
    // §8.4: liquids/gases-only. Categorised routing deferred — Tank
    // applies uniformly to all resources for step 9.
  },
  // -------------------------------------------------------------------------
  // T3 (levels 15-30)
  // -------------------------------------------------------------------------
  electric_arc_furnace: {
    id: 'electric_arc_furnace',
    displayName: 'Electric Arc Furnace',
    category: 'smelting',
    tier: 3,
    width: 2,
    height: 3,
    fill: 0x4a8ae0,
    stroke: 0x1a3a78,
    power: { consumes: 200 },
  },
  // §8.9: Platform Constructor (a.k.a. Foundry of Lands). T3 special building
  // — gates artificial-island construction (§2.5). Step 11 only checks for the
  // building's PRESENCE on the founder island; placement/power/heat enforcement
  // is deferred. Power-consumption is declared per §5.1 so a future-step
  // brownout properly throttles construction availability.
  platform_constructor: {
    id: 'platform_constructor',
    displayName: 'Platform Constructor',
    category: 'special',
    tier: 3,
    width: 4,
    height: 4,
    fill: 0x6a4a8c, // dusky violet — "foundry"-coded
    stroke: 0x2a1a40,
    power: { consumes: 200 },
  },
};

/** Whether `defId` is buildable at the given island level. Pure — no DOM,
 *  no PixiJS. Consumers: Building Catalog UI (locks rows above current
 *  tier) and (future, step 2.5) placement validator. */
export function buildingUnlocked(islandLevel: number, defId: BuildingDefId): boolean {
  return tierForLevel(islandLevel) >= BUILDING_DEFS[defId].tier;
}

/** Every def unlocked at the given island level, in catalog declaration order. */
export function unlockedDefs(islandLevel: number): BuildingDefId[] {
  const tier = tierForLevel(islandLevel);
  return (Object.keys(BUILDING_DEFS) as BuildingDefId[]).filter(
    (id) => BUILDING_DEFS[id].tier <= tier,
  );
}

/** Convenience: every defId in declaration order. Pure data — useful for the
 *  Catalog UI which groups by tier. */
export const ALL_BUILDING_DEF_IDS: ReadonlyArray<BuildingDefId> = Object.keys(
  BUILDING_DEFS,
) as BuildingDefId[];
