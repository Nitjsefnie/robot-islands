// Resources, recipes, and xp_weight table.
//
// Per SPEC §6 (Resource Catalog) and §7 (Recipe Chains). Step 9 expands the
// catalog from the step-3 Mine+Workshop chain to the partial §7.1 Iron/Steel
// pipeline plus a forestry/biomass loop:
//
//   T0/T1 raws:   wood, iron_ore, coal, biofuel
//   T1 refined:   iron_ingot, coke, pig_iron, bolt
//   T2 alloy:     steel
//   T2 component: gear
//
// `xp_weight` per SPEC §9.1: T0 raws = 1, T1 = 3, T2 = 10. Higher-tier
// outputs grant proportionally more XP per unit produced, so the progression
// curve rewards climbing the recipe chain rather than just stockpiling raws.

import type { BuildingDefId } from './building-defs.js';

export type ResourceId =
  // T0 raws
  | 'wood'
  | 'iron_ore'
  | 'coal'
  // T1 refined
  | 'biofuel'
  | 'iron_ingot'
  | 'coke'
  | 'pig_iron'
  | 'bolt'
  // T2 alloy / component
  | 'steel'
  | 'gear';

/** All known resources, useful for iterating to initialise inventories. */
export const ALL_RESOURCES: ReadonlyArray<ResourceId> = [
  'wood',
  'iron_ore',
  'coal',
  'biofuel',
  'iron_ingot',
  'coke',
  'pig_iron',
  'bolt',
  'steel',
  'gear',
];

/**
 * XP weight per resource, per SPEC §9.1 (tier-weighted production).
 *   T0 raw       = 1   (wood, iron_ore, coal)
 *   T1 refined   = 3   (biofuel, iron_ingot, coke, pig_iron)
 *   T2 alloy /   = 10  (bolt, steel, gear)
 *      component
 */
export const XP_WEIGHT: Readonly<Record<ResourceId, number>> = {
  // T0 raws
  wood: 1,
  iron_ore: 1,
  coal: 1,
  // T1 refined
  biofuel: 3,
  iron_ingot: 3,
  coke: 3,
  pig_iron: 3,
  // T2 alloy / component
  bolt: 10,
  steel: 10,
  gear: 10,
};

/**
 * Recipe categories per SPEC §7.0 / §9.4. Skill-tree effects and (later)
 * Specialization-passive buffs target recipes by category tag, not by
 * building kind — this keeps edge cases (Cracker is petrochemical, not
 * strictly smelting) consistent. The full catalog in §7 has more tags;
 * step 9 needs the seven listed below.
 */
export type RecipeCategory =
  | 'extraction'
  | 'smelting'
  | 'chemistry'
  | 'manufacturing'
  | 'electronics'
  | 'power'
  | 'logistics';

/** All recipe categories, useful for initialising per-category records to 1.0. */
export const ALL_RECIPE_CATEGORIES: ReadonlyArray<RecipeCategory> = [
  'extraction',
  'smelting',
  'chemistry',
  'manufacturing',
  'electronics',
  'power',
  'logistics',
];

/**
 * A single recipe definition. `cycleSec` is the time for one production
 * cycle at base rate (rate = 1 / cycleSec). `inputs` lists per-cycle input
 * demand; `outputs` lists per-cycle output yield. Both are partial maps:
 * resources not listed are not involved. `category` tags the recipe for
 * skill-tree and specialization effects (§9.3/§9.4).
 */
export interface Recipe {
  readonly cycleSec: number;
  readonly inputs: Partial<Record<ResourceId, number>>;
  readonly outputs: Partial<Record<ResourceId, number>>;
  readonly category: RecipeCategory;
}

/**
 * Recipe binding by building defId. Buildings without a recipe (Solar, Dock,
 * Crate, Silo, Tank, Drone Pad) are absent from the map.
 *
 * Step-9 chain (partial §7.1 Iron/Steel + auxiliaries):
 *
 *   T1 extraction:
 *     mine     -> 1 iron_ore  / 5s   (no inputs)
 *     logger   -> 1 wood      / 4s   (no inputs; tile-req `tree` deferred)
 *
 *   T1 smelting / refining:
 *     smelter  -> 1 iron_ingot / 8s  from 1 iron_ore + 1 coal
 *
 *   T1 manufacturing:
 *     workshop -> 1 bolt      / 10s  from 1 iron_ore + 1 coal
 *
 *   T1 power-burn (no resource output; W on def.power.produces):
 *     coal_gen        -> burns 1 coal / 5s
 *     biomass_plant   -> burns 1 wood / 6s
 *
 *   T2 smelting / refining:
 *     coke_oven       -> 1 coke      / 10s from 1 coal
 *     blast_furnace   -> 1 pig_iron  / 12s from 1 iron_ingot + 1 coke
 *                        (§5.2 heat-source adjacency deferred)
 *     steel_mill      -> 1 steel     / 15s from 1 pig_iron
 *                        (§7.1 scrap co-input deferred)
 *
 *   T2 manufacturing:
 *     assembler       -> 1 gear      /  8s from 1 iron_ingot + 2 bolt
 *
 *   T3 smelting:
 *     electric_arc_furnace -> 1 steel / 6s from 1 pig_iron
 *                              (higher-throughput alternative to Steel Mill)
 */
export const RECIPES: Partial<Record<BuildingDefId, Recipe>> = {
  // T1 extraction
  mine: {
    cycleSec: 5,
    inputs: {},
    outputs: { iron_ore: 1 },
    category: 'extraction',
  },
  logger: {
    cycleSec: 4,
    inputs: {},
    outputs: { wood: 1 },
    category: 'extraction',
  },

  // T1 smelting
  smelter: {
    cycleSec: 8,
    inputs: { iron_ore: 1, coal: 1 },
    outputs: { iron_ingot: 1 },
    category: 'smelting',
  },

  // T1 manufacturing
  workshop: {
    cycleSec: 10,
    inputs: { iron_ore: 1, coal: 1 },
    outputs: { bolt: 1 },
    category: 'manufacturing',
  },

  // T1 power-burn (Coal Gen burns 1 coal/5s; W contribution lives on
  // def.power.produces, not in `outputs`). Empty `outputs` is intentional.
  coal_gen: {
    cycleSec: 5,
    inputs: { coal: 1 },
    outputs: {},
    category: 'power',
  },
  biomass_plant: {
    cycleSec: 6,
    inputs: { wood: 1 },
    outputs: {},
    category: 'power',
  },

  // T2 smelting
  coke_oven: {
    cycleSec: 10,
    inputs: { coal: 1 },
    outputs: { coke: 1 },
    category: 'smelting',
  },
  blast_furnace: {
    cycleSec: 12,
    inputs: { iron_ingot: 1, coke: 1 },
    outputs: { pig_iron: 1 },
    category: 'smelting',
  },
  steel_mill: {
    cycleSec: 15,
    inputs: { pig_iron: 1 },
    outputs: { steel: 1 },
    category: 'smelting',
  },

  // T2 manufacturing
  assembler: {
    cycleSec: 8,
    inputs: { iron_ingot: 1, bolt: 2 },
    outputs: { gear: 1 },
    category: 'manufacturing',
  },

  // T3 smelting (higher-throughput steel alternative)
  electric_arc_furnace: {
    cycleSec: 6,
    inputs: { pig_iron: 1 },
    outputs: { steel: 1 },
    category: 'smelting',
  },
};
