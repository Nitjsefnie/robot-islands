// Per-island skill tree per SPEC §9.3. Pure logic — no PixiJS, no DOM.
//
// Three branches × sub-paths × depth-graded nodes. Players spend skill points
// (granted on level-up, §9.1) to unlock nodes, which compose multiplicatively
// into rate, cap, and power multipliers consumed by `computeRates` in
// `economy.ts`.
//
// Step 5 implements only depth 1 and depth 2 nodes (11 sub-paths × 2 = 22
// total). Deeper nodes are deferred per §9.3's per-node enumeration
// deferment to Appendix A. The data model supports arbitrary depth — adding
// depth-3+ entries to NODE_CATALOG is a future-step exercise.
//
// Several depth-1 effects are `placeholder` because step 5 has no economic
// surface to express them yet: Robotics (construction speed; placement
// isn't built), Transport (route capacity; routes aren't built), Network
// (teleporter; deferred). They consume points and unlock their depth-2
// successors normally; their `kind: 'placeholder'` effect is a no-op in
// `effectiveSkillMultipliers`. Later steps activate them.

import type { IslandState } from './economy.js';
import type { RecipeCategory } from './recipes.js';
import { ALL_RECIPE_CATEGORIES } from './recipes.js';

export type BranchId = 'extraction' | 'refinement' | 'logistics';

export type SubPathId =
  // Extraction branch
  | 'mining'
  | 'forestry'
  | 'drilling'
  | 'robotics'
  // Refinement branch
  | 'smelting'
  | 'chemistry'
  | 'electronics'
  | 'power_systems'
  // Logistics branch
  | 'storage'
  | 'transport'
  | 'network';

/** Node id is `<subPath>.<depth>`, e.g. `mining.1`. */
export type NodeId = string;

/**
 * Tagged effect union for skill nodes. The economy reads only the resolved
 * multipliers from `effectiveSkillMultipliers`, so adding a new effect kind
 * requires both a case here and a fold in that function.
 *
 *   - `recipeRateMul`: multiplies the rate of every recipe matching `category`.
 *   - `storageCapMul`: multiplies every storage cap uniformly.
 *   - `powerProductionMul`: multiplies `building.power.produces`.
 *   - `powerConsumptionMul`: divides `building.power.consumes` (reduce = true
 *     means "lower consumption = good"; multiplier > 1 reduces draw).
 *   - `placeholder`: no economic effect in step 5; reserves the node slot
 *     for a future activation (construction speed, route capacity, etc.).
 */
export type SkillEffect =
  | { readonly kind: 'recipeRateMul'; readonly category: RecipeCategory }
  | { readonly kind: 'storageCapMul' }
  | { readonly kind: 'powerProductionMul' }
  | { readonly kind: 'powerConsumptionMul'; readonly reduce: true }
  | { readonly kind: 'placeholder' };

export interface SkillNode {
  readonly id: NodeId;
  readonly subPath: SubPathId;
  readonly depth: number;
  /** Skill-point cost. Per §9.3: `cost(depth) = 2^(depth - 1)`. */
  readonly cost: number;
  /** Magnitude of the effect (e.g. 0.05 = +5%). Per §9.3 doubles with depth
   *  through depth 5. Stored as the +bonus, not the multiplier (0.05 not 1.05). */
  readonly magnitude: number;
  readonly effect: SkillEffect;
  readonly description: string;
}

/** Tier required to purchase a node at the given depth, per §9.3. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

/** Branch each sub-path belongs to, for the sequential-sub-path lock (§9.3). */
export const SUBPATH_BRANCH: Readonly<Record<SubPathId, BranchId>> = {
  mining: 'extraction',
  forestry: 'extraction',
  drilling: 'extraction',
  robotics: 'extraction',
  smelting: 'refinement',
  chemistry: 'refinement',
  electronics: 'refinement',
  power_systems: 'refinement',
  storage: 'logistics',
  transport: 'logistics',
  network: 'logistics',
};

/** Sub-paths grouped by branch. Order is the order the UI displays them in. */
export const BRANCH_SUBPATHS: Readonly<Record<BranchId, ReadonlyArray<SubPathId>>> = {
  extraction: ['mining', 'forestry', 'drilling', 'robotics'],
  refinement: ['smelting', 'chemistry', 'electronics', 'power_systems'],
  logistics: ['storage', 'transport', 'network'],
};

/** Display labels for sub-paths. Pure data; UI imports these to render. */
export const SUBPATH_LABEL: Readonly<Record<SubPathId, string>> = {
  mining: 'Mining',
  forestry: 'Forestry',
  drilling: 'Drilling',
  robotics: 'Robotics',
  smelting: 'Smelting',
  chemistry: 'Chemistry',
  electronics: 'Electronics',
  power_systems: 'Power Systems',
  storage: 'Storage',
  transport: 'Transport',
  network: 'Network',
};

export const BRANCH_LABEL: Readonly<Record<BranchId, string>> = {
  extraction: 'Extraction',
  refinement: 'Refinement',
  logistics: 'Logistics',
};

/**
 * Map an island level to its tier per §9.2. Spec ranges overlap at the
 * breakpoint values; the "crossing N unlocks Tier" parentheticals resolve
 * the boundaries: level=5 IS T2, level=15 IS T3, level=30 IS T4, level=50 IS T5.
 *
 * Simplification for step 5: T5 requires "level 50 + AI core crafted" per
 * §9.2, and T6 requires "Ascendant Core crafted + Spaceport". Neither AI
 * core nor Ascendant Core/Spaceport exist yet, so this function returns 5
 * at level ≥ 50 (treating the AI-core gate as satisfied) and never 6. The
 * caller in step 5 only uses tiers 2 and below.
 */
export function tierForLevel(level: number): Tier {
  if (level >= 50) return 5;
  if (level >= 30) return 4;
  if (level >= 15) return 3;
  if (level >= 5) return 2;
  return 1;
}

/**
 * Required tier for a node at a given depth per §9.3:
 *   depth 1-2 → T2, depth 3 → T3, depth 4 → T4, depth 5-7 → T5, depth 8+ → T6.
 * §9.3's Drilling "T2+" annotation is subsumed by depth-1 → T2 uniformly.
 */
export function nodeRequiredTier(node: SkillNode): Tier {
  const d = node.depth;
  if (d >= 8) return 6;
  if (d >= 5) return 5;
  if (d >= 4) return 4;
  if (d >= 3) return 3;
  return 2;
}

// ---------------------------------------------------------------------------
// Node catalog
// ---------------------------------------------------------------------------
//
// Depth 1 and depth 2 only for step 5 (22 nodes). Magnitudes per §9.3:
// depth 1 = +5%, depth 2 = +10%. Costs: depth 1 = 1, depth 2 = 2.
//
// Effects:
//   Mining/Forestry/Drilling: recipe-rate multiplier on `extraction` recipes.
//     (Forestry/Drilling have no distinct recipes yet — the tag is shared
//      across the sub-paths until the Logger/Drilling Rig recipes land.)
//   Robotics: placeholder (construction speed — no placement system yet).
//   Smelting/Chemistry/Electronics: recipe-rate multiplier on the matching
//     category. No step-5 recipes use these tags, so the multiplier is a
//     latent buff with no current effect.
//   Power Systems: multiplies producers' `power.produces` (Solar, Coal Gen).
//   Storage: multiplies every storage cap.
//   Transport/Network: placeholder until routes/teleporters exist.

function rate(category: RecipeCategory): SkillEffect {
  return { kind: 'recipeRateMul', category };
}

const DEPTH1_MAG = 0.05;
const DEPTH2_MAG = 0.10;

function depth1(
  subPath: SubPathId,
  effect: SkillEffect,
  description: string,
): SkillNode {
  return {
    id: `${subPath}.1`,
    subPath,
    depth: 1,
    cost: 1,
    magnitude: DEPTH1_MAG,
    effect,
    description,
  };
}

function depth2(
  subPath: SubPathId,
  effect: SkillEffect,
  description: string,
): SkillNode {
  return {
    id: `${subPath}.2`,
    subPath,
    depth: 2,
    cost: 2,
    magnitude: DEPTH2_MAG,
    effect,
    description,
  };
}

export const NODE_CATALOG: ReadonlyArray<SkillNode> = [
  // Extraction branch
  depth1('mining', rate('extraction'), 'Ore output +5%'),
  depth2('mining', rate('extraction'), 'Ore output +10%'),
  depth1('forestry', rate('extraction'), 'Wood output +5% (latent — Logger pending)'),
  depth2('forestry', rate('extraction'), 'Wood output +10% (latent — Logger pending)'),
  depth1('drilling', rate('extraction'), 'Deep extraction +5% (latent — Drilling Rig pending)'),
  depth2('drilling', rate('extraction'), 'Deep extraction +10% (latent — Drilling Rig pending)'),
  depth1('robotics', { kind: 'placeholder' }, 'Construction speed +5% (placement pending)'),
  depth2('robotics', { kind: 'placeholder' }, 'Construction speed +10% (placement pending)'),

  // Refinement branch
  depth1('smelting', rate('smelting'), 'Smelter rate +5% (latent — Smelter pending)'),
  depth2('smelting', rate('smelting'), 'Smelter rate +10% (latent — Smelter pending)'),
  depth1('chemistry', rate('chemistry'), 'Chem rate +5% (latent — Reactor pending)'),
  depth2('chemistry', rate('chemistry'), 'Chem rate +10% (latent — Reactor pending)'),
  depth1('electronics', rate('electronics'), 'Electronics rate +5% (latent)'),
  depth2('electronics', rate('electronics'), 'Electronics rate +10% (latent)'),
  depth1('power_systems', { kind: 'powerProductionMul' }, 'Power production +5%'),
  depth2('power_systems', { kind: 'powerProductionMul' }, 'Power production +10%'),

  // Logistics branch
  depth1('storage', { kind: 'storageCapMul' }, 'Storage caps +5%'),
  depth2('storage', { kind: 'storageCapMul' }, 'Storage caps +10%'),
  depth1('transport', { kind: 'placeholder' }, 'Route capacity +5% (routes pending)'),
  depth2('transport', { kind: 'placeholder' }, 'Route capacity +10% (routes pending)'),
  depth1('network', { kind: 'placeholder' }, 'Network reach +5% (teleporters pending)'),
  depth2('network', { kind: 'placeholder' }, 'Network reach +10% (teleporters pending)'),
];

// ---------------------------------------------------------------------------
// Validation + spending
// ---------------------------------------------------------------------------

/** Threshold of points at which a sub-path becomes COMMITTED per §9.3 (placeholder N=3). */
export const SUBPATH_COMMIT_THRESHOLD = 3;

export type CanSpendReason =
  | 'unknown-node'
  | 'already-unlocked'
  | 'insufficient-points'
  | 'tier-locked'
  | 'depth-prereq'
  | 'branch-locked';

export interface CanSpendResult {
  readonly ok: boolean;
  readonly reason?: CanSpendReason;
}

interface Catalog {
  readonly nodes: ReadonlyArray<SkillNode>;
  readonly byId: ReadonlyMap<NodeId, SkillNode>;
  readonly bySubPath: ReadonlyMap<SubPathId, ReadonlyArray<SkillNode>>;
}

function buildCatalog(nodes: ReadonlyArray<SkillNode>): Catalog {
  const byId = new Map<NodeId, SkillNode>();
  const bySubPathMut = new Map<SubPathId, SkillNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const arr = bySubPathMut.get(n.subPath) ?? [];
    arr.push(n);
    bySubPathMut.set(n.subPath, arr);
  }
  // Sort each sub-path's nodes by ascending depth for prereq lookup.
  const bySubPath = new Map<SubPathId, ReadonlyArray<SkillNode>>();
  for (const [sp, arr] of bySubPathMut) {
    bySubPath.set(sp, arr.slice().sort((a, b) => a.depth - b.depth));
  }
  return { nodes, byId, bySubPath };
}

const DEFAULT_CATALOG: Catalog = buildCatalog(NODE_CATALOG);

/**
 * Decide whether `state` can spend a skill point on `nodeId`. Pure: does not
 * mutate state. Test code may pass a custom catalog to exercise edge cases
 * (e.g. a 3-node sub-path to verify the branch lock fires before completion).
 */
export function canSpend(
  state: IslandState,
  nodeId: NodeId,
  catalog: ReadonlyArray<SkillNode> = NODE_CATALOG,
): CanSpendResult {
  const cat = catalog === NODE_CATALOG ? DEFAULT_CATALOG : buildCatalog(catalog);
  const node = cat.byId.get(nodeId);
  if (!node) return { ok: false, reason: 'unknown-node' };
  if (state.unlockedNodes.has(nodeId)) {
    return { ok: false, reason: 'already-unlocked' };
  }
  if (state.unspentSkillPoints < node.cost) {
    return { ok: false, reason: 'insufficient-points' };
  }
  if (tierForLevel(state.level) < nodeRequiredTier(node)) {
    return { ok: false, reason: 'tier-locked' };
  }
  // Depth prereq: every node at lower depth in the same sub-path must be owned.
  const sub = cat.bySubPath.get(node.subPath) ?? [];
  for (const n of sub) {
    if (n.depth >= node.depth) break;
    if (!state.unlockedNodes.has(n.id)) {
      return { ok: false, reason: 'depth-prereq' };
    }
  }
  // Branch lock (§9.3 "Sequential sub-path unlocking"): if any OTHER sub-path
  // in the same branch is committed-but-incomplete, this purchase is blocked
  // — unless the target is exactly that in-progress sub-path.
  //
  // With only depth-1 + depth-2 in the step-5 catalog, completing depth-2 of
  // a sub-path simultaneously commits AND completes it (3 points spent). The
  // branch lock thus never engages through normal step-5 play; it exists for
  // forward-compat once depth-3+ nodes land and for the synthetic-catalog
  // test that verifies the rule's correctness.
  const targetBranch = SUBPATH_BRANCH[node.subPath];
  for (const [sp, progress] of state.subPathProgress) {
    if (sp === node.subPath) continue;
    if (SUBPATH_BRANCH[sp] !== targetBranch) continue;
    if (progress.complete) continue;
    if (progress.spent >= SUBPATH_COMMIT_THRESHOLD) {
      return { ok: false, reason: 'branch-locked' };
    }
  }
  return { ok: true };
}

/**
 * Apply a purchase. Caller must have verified `canSpend(state, nodeId).ok`.
 * Mutates `state.unspentSkillPoints`, `state.unlockedNodes`, and
 * `state.subPathProgress`.
 *
 * Sub-path completion semantics: a sub-path is `complete` when every node in
 * the catalog belonging to that sub-path has been unlocked. With the step-5
 * catalog defining only depth-1 + depth-2, "complete" means "depth-1 AND
 * depth-2 owned". When depth-3+ nodes land in later steps, the same rule
 * still holds: complete = all defined nodes purchased. A sub-path that was
 * "complete" at one node-catalog version may revert to "in-progress" if new
 * nodes are added — that's by design.
 */
export function spendPoint(
  state: IslandState,
  nodeId: NodeId,
  catalog: ReadonlyArray<SkillNode> = NODE_CATALOG,
): void {
  const cat = catalog === NODE_CATALOG ? DEFAULT_CATALOG : buildCatalog(catalog);
  const node = cat.byId.get(nodeId);
  if (!node) throw new Error(`spendPoint: unknown node ${nodeId}`);
  state.unspentSkillPoints -= node.cost;
  state.unlockedNodes.add(nodeId);
  const sub = cat.bySubPath.get(node.subPath) ?? [];
  const prev = state.subPathProgress.get(node.subPath) ?? { spent: 0, complete: false };
  const nextSpent = prev.spent + node.cost;
  const allOwned = sub.every((n) => state.unlockedNodes.has(n.id));
  state.subPathProgress.set(node.subPath, { spent: nextSpent, complete: allOwned });
}

// ---------------------------------------------------------------------------
// Effect aggregation
// ---------------------------------------------------------------------------

export interface SkillMultipliers {
  /** Per-category recipe rate multiplier. All categories present, default 1. */
  readonly recipeRate: Record<RecipeCategory, number>;
  /** Uniform storage-cap multiplier. */
  readonly storageCap: number;
  /** Multiplier applied to building.power.produces. */
  readonly powerProduction: number;
  /** Reduction multiplier applied to building.power.consumes — values > 1
   *  reduce draw (divide consumes by this). */
  readonly powerConsumption: number;
}

function blankMultipliers(): SkillMultipliers {
  const recipeRate = {} as Record<RecipeCategory, number>;
  for (const c of ALL_RECIPE_CATEGORIES) recipeRate[c] = 1;
  return {
    recipeRate,
    storageCap: 1,
    powerProduction: 1,
    powerConsumption: 1,
  };
}

/**
 * Fold every unlocked node's effect into a single `SkillMultipliers` bundle.
 * Multiple nodes targeting the same axis compose multiplicatively:
 *   mining.1 (+5%) × mining.2 (+10%) → 1.05 × 1.10 = 1.155×.
 */
export function effectiveSkillMultipliers(
  state: IslandState,
  catalog: ReadonlyArray<SkillNode> = NODE_CATALOG,
): SkillMultipliers {
  const cat = catalog === NODE_CATALOG ? DEFAULT_CATALOG : buildCatalog(catalog);
  const out = blankMultipliers();
  // Mutate-in-place pattern; readonly types on the returned object describe
  // the consumer contract, not the local builder.
  const recipeRate = out.recipeRate as Record<RecipeCategory, number>;
  let storageCap = 1;
  let powerProduction = 1;
  let powerConsumption = 1;
  for (const nodeId of state.unlockedNodes) {
    const node = cat.byId.get(nodeId);
    if (!node) continue;
    const m = 1 + node.magnitude;
    switch (node.effect.kind) {
      case 'recipeRateMul': {
        const cur = recipeRate[node.effect.category] ?? 1;
        recipeRate[node.effect.category] = cur * m;
        break;
      }
      case 'storageCapMul':
        storageCap *= m;
        break;
      case 'powerProductionMul':
        powerProduction *= m;
        break;
      case 'powerConsumptionMul':
        powerConsumption *= m;
        break;
      case 'placeholder':
        break;
    }
  }
  return {
    recipeRate,
    storageCap,
    powerProduction,
    powerConsumption,
  };
}

/** Look up a node by id from the default catalog. Returns undefined if unknown. */
export function nodeById(id: NodeId): SkillNode | undefined {
  return DEFAULT_CATALOG.byId.get(id);
}
