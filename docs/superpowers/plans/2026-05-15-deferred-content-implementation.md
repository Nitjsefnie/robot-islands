# Deferred Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is sized to fit comfortably in a single Kimi K2.6 dispatch (250K context) without dumping the whole spec in. All commits on `master`; no worktrees per project policy.

**Goal:** Bring code to parity with SPEC.md §6 / §7 / §8 deferred content (resources, recipes, buildings the spec mentions but code never shipped), then have 3 parallel opus agents review balance and apply one rebalance round.

**Architecture:** Tier-bottom-up: each phase ships resources + buildings + recipes for one rung of the dependency chain, so each new recipe's inputs are already producible by the time it lands. Every new ResourceId must be added to six registries in lockstep (`ResourceId` union, `ALL_RESOURCES`, `XP_WEIGHT`, `RESOURCE_STORAGE_CATEGORY` in `storage-categories.ts`, `RESOURCE_CATEGORY` in `inventory-ui.ts`, and the relevant exemption set in `balance.test.ts`). Every new building must add a `BuildingDefId` entry, a `BUILDING_DEFS` entry, AND a matching `RECIPES` entry; tests in `building-defs.test.ts` enforce both.

**Tech Stack:** Vite 5 + TypeScript strict + PixiJS 8 + vitest. Branch is `master`. Co-author trailer is `Kimi K2.6 <noreply@kimi.com>` for implementer commits, `Claude Opus 4.7 (1M context) <noreply@anthropic.com>` for plan/review commits.

**Spec sections referenced:** §6.1 T0 Raw, §6.2 T1 Refined, §6.3 T2 Alloys, §6.4 T3 Advanced, §6.5 T4, §6.6 T5, §6.7 Byproducts, §7.1-§7.12 Recipe Chains, §8.x Building Catalog, §11.5 Drones, §12.3 Foundation Kit, §14.10 Satellite Recipes.

**Out of scope:** Appendix B (prestige, mechanical/steam, blueprints, sync, localization). SPEC.md edits — spec is locked. Appendix A tuning placeholders (need playthrough data, only the agent-flagged ones get adjusted in the rebalance round).

**Hard constraints (every task):**
- Each new ResourceId appears in ALL six registries in the same commit (avoid balance-test regressions).
- Each new building has a `requiredTile` only if its extractor concept needs one; refiners take `requiredTile: undefined`.
- `npm test` and `npm run build` pass before the task's commit lands.
- TDD: failing test first, run it, implement, run it green, commit.
- Co-author trailer present on every commit.

---

# Phase 1 — T0 mineral raws + tile gating + bootstrap fix

Each task ships 1-3 new ResourceIds + matching TerrainKind entries + extractor buildings + recipes. The bootstrap fix runs first so home becomes lubricant-reachable.

### Task 1.1: Bootstrap fix — home Plains gets `oil_well` and `limestone` tiles

**Spec rationale:** User flagged that lubricant is unreachable in 12h because home has no `oil_well` (so `crude_oil` requires off-island migration). Adding seeded tiles mirrors the §3.7 / §8.1 bootstrap pattern used in commit `b3859b9` (tree + 2x2 stone cluster).

**Files:**
- Modify: `src/island.ts:200-240` (`defaultTerrainAt`)
- Test: `src/island.test.ts` (add to existing `describe('defaultTerrainAt — bootstrap seeds')`)

**NOTE:** This task adds the `limestone` TerrainKind reference WITHOUT a producer — that's fine because Task 1.2 immediately ships the matching tile+building+recipe. Order: 1.1 → 1.2 → … strictly sequential.

- [ ] **Step 1: Write failing test**

In `src/island.test.ts`, find the existing `describe('defaultTerrainAt — bootstrap seeds')` block (added in commit `b3859b9`). Append two `it` blocks:

```ts
it('home has an oil_well tile (Pump Jack requirement, §6.1 / §7.4 fuel chain)', () => {
  let found = false;
  for (let x = -14; x <= 14 && !found; x++) {
    for (let y = -14; y <= 14 && !found; y++) {
      if (defaultTerrainAt(x, y) === 'oil_well') found = true;
    }
  }
  expect(found).toBe(true);
});

it('home has a limestone tile (Limekiln requirement, §7.5 chemistry chain)', () => {
  let found = false;
  for (let x = -14; x <= 14 && !found; x++) {
    for (let y = -14; y <= 14 && !found; y++) {
      if (defaultTerrainAt(x, y) === 'limestone') found = true;
    }
  }
  expect(found).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/island.test.ts -t "defaultTerrainAt — bootstrap seeds" --reporter=verbose
```

Expected: both new tests FAIL with `expected false to be true`.

- [ ] **Step 3: Add the seed tiles in `defaultTerrainAt`**

In `src/island.ts` near the existing tile cluster lists, add:

```ts
// §7.4 / §11.5 fuel chain bootstrap: oil_well tile so the player can extract
// crude_oil on home without inter-island migration. Single tile is enough —
// a Pump Jack is 2x2 but only one footprint tile needs to satisfy the
// requiredTile gate per §4.3.
const oilWellTiles: ReadonlyArray<readonly [number, number]> = [
  [-4, 8],
];
// §7.5 chemistry chain bootstrap: limestone tile so a Limekiln can place.
const limestoneTiles: ReadonlyArray<readonly [number, number]> = [
  [-9, 7],
];
```

Add the matching lookups (immediately before `return 'grass';`):

```ts
for (const t of oilWellTiles) if (t[0] === x && t[1] === y) return 'oil_well';
for (const t of limestoneTiles) if (t[0] === x && t[1] === y) return 'limestone';
```

`oil_well` already exists in the `TerrainKind` union (line 27). `limestone` does NOT yet — add it to the union now (line 22 area):

```ts
  | 'limestone'
```

And add a tile-fill entry in the `TERRAIN_FILL` map for `limestone`:

```ts
limestone: 0xc8c0a8,    // pale calcareous beige
```

- [ ] **Step 4: Run test to verify pass + full suite**

```bash
npx vitest run src/island.test.ts -t "defaultTerrainAt — bootstrap seeds"
npm test
npm run build
```

Expected: both new tests PASS; 1199 → 1201 tests passing; build clean.

- [ ] **Step 5: Commit**

```bash
git add src/island.ts src/island.test.ts
git commit -m "$(cat <<'EOF'
fix(§3.7 bootstrap): seed oil_well + limestone tiles on home Plains

Address the user-flagged 12h-lubricant-unreachable issue: home Plains
previously had no oil_well tile, forcing inter-island migration before
the §7.4 petrochemical chain could run. Now seeds one oil_well at
(-4, 8) and one limestone at (-9, 7), both south-west of the existing
home layout and clear of every placed home building. Limestone unlocks
the §7.5 chemistry chain (limekiln coming in Task 1.2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Add `limestone` TerrainKind + `limestone_quarry` building + recipe

**Spec rationale:** §6.1 lists Limestone as a T0 raw. §7.5 chemistry chain consumes it (Limestone + heat → Quicklime). The home Plains seed lands in 1.1; this task ships the extractor.

**Files:**
- Modify: `src/island.ts` — `TerrainKind` union (already added `limestone` in 1.1) + tile-fill (done)
- Modify: `src/recipes.ts` — `ResourceId` union, `ALL_RESOURCES`, `XP_WEIGHT`, `RECIPES`
- Modify: `src/storage-categories.ts` — `RESOURCE_STORAGE_CATEGORY`
- Modify: `src/inventory-ui.ts` — `RESOURCE_CATEGORY`
- Modify: `src/building-defs.ts` — `BuildingDefId` union + `BUILDING_DEFS` entry
- Modify: `src/balance.test.ts` — `STARTER_TERRAIN` exemption set
- Modify: `src/biomes.ts` — Plains rareTerrain (procedural islands also get limestone)
- Test: `src/recipes.test.ts` + `src/building-defs.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/recipes.test.ts`, append a new `describe` block:

```ts
describe('§6.1 T0 raws — limestone', () => {
  it('limestone is in ALL_RESOURCES with xp_weight 1', () => {
    expect(ALL_RESOURCES).toContain('limestone' as ResourceId);
    expect(XP_WEIGHT.limestone).toBe(1);
  });
});
```

In `src/building-defs.test.ts`, append `'limestone_quarry'` to the `KNOWN_DEF_IDS` array and add a small describe:

```ts
describe('§8.1 limestone_quarry (T1 limestone extractor)', () => {
  it('ships as a T1 extraction def gated to limestone tile', () => {
    const def = BUILDING_DEFS.limestone_quarry;
    expect(def).toBeDefined();
    expect(def.tier).toBe(1);
    expect(def.category).toBe('extraction');
    expect(def.requiredTile).toEqual(['limestone']);
  });
  it('produces 1 limestone per cycle', () => {
    expect(RECIPES.limestone_quarry).toBeDefined();
    expect(RECIPES.limestone_quarry.outputs).toEqual({ limestone: 1 });
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run src/recipes.test.ts src/building-defs.test.ts
```

Expected: 3 new failures (limestone in ALL_RESOURCES, def shape, recipe).

- [ ] **Step 3: Add `limestone` to recipes.ts**

In `src/recipes.ts`:
- `ResourceId` union — add `| 'limestone'` in the T0 raws block (near `| 'stone'`).
- `ALL_RESOURCES` array — add `'limestone',` in same position.
- `XP_WEIGHT` record — add `limestone: 1,` near the other T0 raws.

In `src/storage-categories.ts` `RESOURCE_STORAGE_CATEGORY`:
- Add `limestone: 'dry_goods',` near the other T0 raws.

In `src/inventory-ui.ts` `RESOURCE_CATEGORY`:
- Add `limestone: 'raw',` near the other T0 raws.

In `src/balance.test.ts` `STARTER_TERRAIN` set:
- Add `'limestone',` to the array.

- [ ] **Step 4: Add `limestone_quarry` def + recipe**

In `src/building-defs.ts`:
- `BuildingDefId` union — add `| 'limestone_quarry'` near other T1 extractors.
- `BUILDING_DEFS` — add (mirror existing `mine` / `coastal_pump` style):

```ts
limestone_quarry: {
  id: 'limestone_quarry',
  displayName: 'Limestone Quarry',
  category: 'extraction',
  tier: 1,
  footprint: SHAPES.square2,
  fill: 0xc8c0a8,        // pale calcareous beige
  stroke: 0x60584a,
  power: { consumes: 30 },
  requiredTile: ['limestone'],
  placementCost: { stone: 30, wood: 15 },
  glyph: '⛏',
},
```

In `src/recipes.ts` `RECIPES`:

```ts
limestone_quarry: {
  cycleSec: 60,          // slightly slower than iron Mine (50s) — limestone is bulk industrial
  inputs: {},
  outputs: { limestone: 1 },
  category: 'extraction',
},
```

In `src/biomes.ts` Plains `rareTerrain` array, append `'limestone'` so procedural Plains islands also have access.

- [ ] **Step 5: Run tests + build**

```bash
npm test
npm run build
```

Expected: full suite green (1201 → 1204 tests); build clean.

- [ ] **Step 6: Commit**

```bash
git add src/recipes.ts src/storage-categories.ts src/inventory-ui.ts src/balance.test.ts src/building-defs.ts src/biomes.ts src/recipes.test.ts src/building-defs.test.ts
git commit -m "$(cat <<'EOF'
feat(§6.1/§8.1): limestone T0 raw + limestone_quarry extractor

Adds the limestone ResourceId across all six registries and ships
the T1 Limestone Quarry extractor (2x2, requires `limestone` tile,
60s cycle, outputs 1 limestone). Plains biome rareTerrain extended
to include limestone so procedural Plains islands also have access.
Unblocks §7.5 chemistry chain (Limekiln in Task 2.1 consumes
limestone).

Co-Authored-By: Kimi K2.6 <noreply@kimi.com>
EOF
)"
```

---

### Task 1.3: `clay` T0 raw + `clay_pit` tile + `clay_pit_extractor` building

Same pattern as 1.2. Spec ref: §6.1 lists Clay. §7.6 Glass / Ceramics chain consumes it (clay + heat → ceramic insulator, brick, etc.).

**Files:** Same six registries + biomes + tests. Forest + Coast biomes get clay_pit added to rareTerrain.

**Concrete values:**
- `ResourceId`: `'clay'`
- `TerrainKind`: `'clay_pit'`
- `XP_WEIGHT.clay = 1`
- `RESOURCE_STORAGE_CATEGORY.clay = 'dry_goods'`
- `RESOURCE_CATEGORY.clay = 'raw'`
- Tile fill in island.ts: `clay_pit: 0xa67555,    // earthen red`
- Building `clay_pit_extractor`: tier 1, 2x2, `requiredTile: ['clay_pit']`, cycleSec 60, output `{clay: 1}`, placement cost `{stone: 30, wood: 15}`, glyph `⛏`.

Mirror Task 1.2's 5 steps. Commit message:

```
feat(§6.1/§8.1): clay T0 raw + clay_pit_extractor

Adds clay ResourceId + clay_pit TerrainKind + extractor. Forest and
Coast biomes get clay_pit in rareTerrain. Unblocks §7.6 ceramics
chain (Brick Kiln + Ceramic Kiln consume clay).
```

---

### Task 1.4: `sulfur` + `sulfur_vein` + `sulfur_mine`

§6.1 lists Sulfur. §7.5 chemistry chain (sulfur + water → sulfuric acid).

**Concrete values:**
- `ResourceId`: `'sulfur'`, `XP_WEIGHT 1`, storage `dry_goods`, filter `raw`.
- `TerrainKind`: `'sulfur_vein'`, fill `0xd0c020   // pale sulfur-yellow`.
- Building `sulfur_mine`: T1, 2x2, `requiredTile: ['sulfur_vein']`, cycleSec 60, output `{sulfur: 1}`, cost `{stone: 30, wood: 15}`.
- Biomes: Volcanic + Desert get sulfur_vein in rareTerrain.

Five steps as 1.2. Commit message:

```
feat(§6.1/§8.1): sulfur T0 raw + sulfur_mine extractor

Volcanic + Desert biomes gain sulfur_vein in rareTerrain. Unblocks
§7.5 sulfuric acid synthesis (Task 5.1).
```

---

### Task 1.5: `phosphate` + `phosphate_deposit` tile + `phosphate_mine`

§6.1 lists Phosphate. §7.5 chemistry chain (phosphate + acid → phosphor).

**Concrete values:**
- `ResourceId`: `'phosphate'`, weight 1, `dry_goods`, `raw`.
- `TerrainKind`: `'phosphate_deposit'`, fill `0xd5b04a   // mustard-tan`.
- Building `phosphate_mine`: T1, 2x2, `requiredTile: ['phosphate_deposit']`, cycleSec 60, output `{phosphate: 1}`.
- Biomes: Coast + Desert add phosphate_deposit.

Five-step pattern. Commit message follows 1.4's template.

---

### Task 1.6: `graphite` + `graphite_vein` + `graphite_mine`

§6.1 lists Graphite. §7.7 electronics chain (Quartz → Silica → Silicon; graphite is electrode for the doping/lithography process — used in T3 wafer chain).

**Concrete values:**
- `ResourceId`: `'graphite'`, weight 1, `dry_goods`, `raw`.
- `TerrainKind`: `'graphite_vein'`, fill `0x2a2a2e   // anthracite gray`.
- Building `graphite_mine`: T1, 2x2, cycleSec 60, output `{graphite: 1}`.
- Biomes: Forest + Desert + Coast add graphite_vein.

---

### Task 1.7: Copper line — `copper_ore` + `tin_ore` + `lead_ore` + their mines

§6.1 / §7.2 copper/brass chain raws. Three resources + three mines in one commit because they're conceptually a single chain step (raws for §7.2).

**Concrete values:**
- Three `ResourceId`s: `'copper_ore'`, `'tin_ore'`, `'lead_ore'`. All weight 1, `dry_goods`, `raw`.
- Three `TerrainKind`s: `'copper_vein'` (fill `0xb87333`), `'tin_vein'` (`0xc0c4cb`), `'lead_vein'` (`0x4a4a52`).
- Three buildings `copper_mine` / `tin_mine` / `lead_mine`: each T1, 2x2, cycleSec 60, output `{X_ore: 1}`, cost `{stone: 30, wood: 15}`.
- Biomes: Volcanic + Desert + Forest get copper_vein/tin_vein/lead_vein distributed.

Single commit message:

```
feat(§6.1/§8.1): copper/tin/lead T0 ores + extractors

Three new T0 raws (copper_ore, tin_ore, lead_ore) with matching
TerrainKinds and T1 extractors. Distributed across Volcanic/Desert/
Forest biomes. Unblocks §7.2 copper/brass chain and §6.2 solder
recipe (Task 2.7).
```

---

### Task 1.8: `bauxite` + `bauxite_vein` + `bauxite_mine`

§6.1 / §7.3 aluminum chain raw.

**Concrete values:**
- `ResourceId`: `'bauxite'`, weight 1, `dry_goods`, `raw`.
- `TerrainKind`: `'bauxite_vein'`, fill `0xd07845   // bauxite ochre`.
- Building `bauxite_mine`: T1, 2x2, cycleSec 60, output `{bauxite: 1}`.
- Biomes: Coast + Desert add bauxite_vein.

---

# Phase 2 — T1 refined chains (construction + copper + plank)

Each task ships one chain step. Inputs already exist by the time the task runs (Phase 1 ordering enforces this).

### Task 2.1: `quicklime` + `slaked_lime` + `limekiln` + `lime_slaker`

§6.2 / §7.5. Limekiln: limestone + heat → quicklime. Slaker: quicklime + fresh_water → slaked_lime. Both T1 buildings.

**Two ResourceIds + two buildings + two recipes** in one commit.

**Concrete values:**
- `ResourceId.quicklime`: weight 3, `dry_goods`, `refined`.
- `ResourceId.slaked_lime`: weight 3, `dry_goods`, `refined`.
- Building `limekiln`: T1, 2x2, `requiresHeat: true`, `gates: [{ matchType: 'heat_source', hard: true }]`, power.consumes 60, cost `{stone: 40, iron_ingot: 10, wood: 10}`, fill `0xb0a890`.
- Building `lime_slaker`: T1, 2x2, power.consumes 30, cost `{stone: 30, wood: 10}`, fill `0xc4c0b0`, NO requiresHeat.
- Recipe `limekiln`: cycleSec 120, inputs `{limestone: 1}`, outputs `{quicklime: 1}`.
- Recipe `lime_slaker`: cycleSec 120, inputs `{quicklime: 1, fresh_water: 1}`, outputs `{slaked_lime: 1}`.

Standard 6-step pattern (failing tests → run → implement → run → build → commit).

---

### Task 2.2: `brick` + `brick_kiln`

§6.2 / §7.6 brick output. Clay + heat → brick.

**Concrete values:**
- `ResourceId.brick`: weight 3, `dry_goods`, `refined`.
- Building `brick_kiln`: T1, 2x2, `requiresHeat: true`, gates heat_source hard, power.consumes 50, cost `{stone: 40, wood: 10}`, fill `0xa05030` (terracotta).
- Recipe: cycleSec 120, inputs `{clay: 2}`, outputs `{brick: 1}`.

---

### Task 2.3: `mortar` + `cement` + `concrete` chain (3 ResourceIds, 3 buildings)

§6.2 / §7.8 construction chain.

**Concrete values:**
- `ResourceId`s: `mortar`, `cement`, `concrete`. All weight 3, `dry_goods`, `refined`.
- Building `mortar_mixer`: T1, 2x2, cycleSec 120, inputs `{sand: 1, quicklime: 1}`, outputs `{mortar: 1}`, power 30, cost `{stone: 30, wood: 10}`.
- Building `cement_mill`: T1, 2x2, `requiresHeat: true` heat-source hard, cycleSec 200, inputs `{quicklime: 1, sand: 1, clay: 1}`, outputs `{cement: 1}`, power 80, cost `{stone: 60, iron_ingot: 10, wood: 15}`.
- Building `concrete_plant`: T1, 2x2, cycleSec 200, inputs `{cement: 1, sand: 2, fresh_water: 1}`, outputs `{concrete: 1}`, power 60, cost `{stone: 50, wood: 15}`.

Single commit: three buildings + three resources at once.

---

### Task 2.4: `charcoal` + `charcoal_kiln`

§6.2 charcoal. Wood + heat → charcoal. Used as alt-fuel substitute in some smelting recipes (defer that substitution; just ship the output here).

**Concrete values:**
- `ResourceId.charcoal`: weight 3, `dry_goods`, `refined`.
- Building `charcoal_kiln`: T1, 2x2, `requiresHeat: true` heat-source hard, cycleSec 100, inputs `{wood: 2}`, outputs `{charcoal: 1}`, power 40, cost `{stone: 30, wood: 10}`, fill `0x1a1a1a` (anthracite).

---

### Task 2.5: `plank` + `plank_mill`

§6.2 plank. Wood → plank. Distinct from `lumber` (which exists) — `plank` is a more refined cut.

**Concrete values:**
- `ResourceId.plank`: weight 3, `dry_goods`, `refined`.
- Building `plank_mill`: T1, 2x2, cycleSec 80, inputs `{lumber: 1}`, outputs `{plank: 2}`, power 30, cost `{stone: 20, wood: 10}`.

---

### Task 2.6: Copper / tin / lead ingot smelting (3 ResourceIds, recipes share existing `smelter` def via tile-aware lookup)

§6.2 / §7.2. The existing `smelter` def takes `iron_ore + coal → iron_ingot`. For tier-bottom-up consistency, ship NEW per-metal smelters rather than fan out a single def's recipe set (engine is 1:1 def→recipe).

**Concrete values:**
- Three `ResourceId`s: `copper_ingot`, `tin_ingot`, `lead_ingot`. Weight 3, `dry_goods`, `refined`.
- Building `copper_smelter`: T1, 2x2, cycleSec 80, inputs `{copper_ore: 1, coal: 1}`, outputs `{copper_ingot: 1}`, power 50, cost `{stone: 30, iron_ingot: 10, wood: 10}`, fill `0xb87333`. **Important:** `requiresHeat` undefined (it's a closed smelter, not a blast furnace).
- Building `tin_smelter`: same pattern, fill `0xc0c4cb`.
- Building `lead_smelter`: same pattern, fill `0x4a4a52`.

Single commit: three pairs.

---

### Task 2.7: `solder` + `solder_alloyer`

§6.2 / §7.2 solder (Pb + Sn → solder).

**Concrete values:**
- `ResourceId.solder`: weight 10 (T2 component), `components`, `refined` (it's a refined assembly, not raw).
- Building `solder_alloyer`: T2, 2x2, cycleSec 200, inputs `{tin_ingot: 1, lead_ingot: 1}`, outputs `{solder: 2}`, power 80, cost `{stone: 50, iron_ingot: 15, wood: 10}`.

---

# Phase 3 — Steel alloy chain (carbon / galvanized / stainless / tool)

Each task adds one alloy + its required ore raw + ingot smelter. Order matters: galvanized + carbon are T2, stainless + tool are T3.

### Task 3.1: `manganese_ore` + `manganese_ingot` + `manganese_smelter` + `carbon_steel` + `carbon_steel_mill`

§6.1 / §7.1 carbon steel.

Resources: `manganese_ore` (weight 1, raw, dry_goods), `manganese_ingot` (weight 3, refined, dry_goods), `carbon_steel` (weight 10, components, refined).

TerrainKind: `manganese_vein`, fill `0x7e4d6f`. Volcanic + Desert biomes.

Buildings:
- `manganese_mine` (T1, 2x2, `requiredTile: ['manganese_vein']`, cycleSec 60, output `{manganese_ore: 1}`).
- `manganese_smelter` (T1, 2x2, cycleSec 80, inputs `{manganese_ore: 1, coal: 1}`, outputs `{manganese_ingot: 1}`).
- `carbon_steel_mill` (T2, 3x3, cycleSec 250, inputs `{steel: 1, manganese_ingot: 1}`, outputs `{carbon_steel: 1}`, power 150, cost `{stone: 150, iron_ingot: 50, wood: 20}`).

Single commit. Mirror task 1.7's "three-resources-one-commit" pattern.

---

### Task 3.2: `zinc_ore` + `zinc_ingot` + `zinc_smelter` + `galvanized_steel` + `galvanizing_bath`

§6.1 / §7.1 galvanized.

Resources: `zinc_ore`, `zinc_ingot`, `galvanized_steel`.

TerrainKind: `zinc_vein`, fill `0x8c93a0`. Volcanic + Coast biomes.

Buildings: zinc_mine, zinc_smelter, galvanizing_bath. Galvanizing bath T2, cycleSec 250, inputs `{steel: 1, zinc_ingot: 1}`, outputs `{galvanized_steel: 1}`.

---

### Task 3.3: `chromium_ore` + `nickel_ore` + ingots + `stainless_steel` + `stainless_steel_mill`

§6.4 / §7.1 stainless (T3 per §6.4 listing).

Resources: `chromium_ore`, `nickel_ore` (T0, weight 1), `chromium_ingot`, `nickel_ingot` (T3 actually — but for consistency keep as weight 30 T3 refined since they feed T3 outputs), `stainless_steel` (T3, weight 30).

TerrainKinds: `chromium_vein`, `nickel_vein`. Volcanic + Arctic biomes.

Buildings: chromium_mine, nickel_mine, chromium_smelter, nickel_smelter, stainless_steel_mill (T3, 3x3, cycleSec 400, inputs `{steel: 1, chromium_ingot: 1, nickel_ingot: 1}`, outputs `{stainless_steel: 1}`, requiresHeat true, power 250, cost `{stone: 200, iron_ingot: 80, wood: 30}`).

---

### Task 3.4: `tungsten_ore` + `tungsten_ingot` + `tool_steel` + `tool_steel_mill`

§6.4 / §7.1 tool steel.

Resources: `tungsten_ore` (T0 raw, weight 1), `tungsten_ingot` (T3 refined, weight 30), `tool_steel` (T3, weight 30).

TerrainKind: `tungsten_vein`, fill `0x4a5060`. Volcanic + Arctic biomes.

Buildings: tungsten_mine, tungsten_smelter, tool_steel_mill (T3, 3x3, cycleSec 400, inputs `{steel: 1, tungsten_ingot: 1}`, outputs `{tool_steel: 1}`, requiresHeat true).

---

# Phase 4 — Petrochemical chain (§7.4)

### Task 4.1: `heavy_oil` + `tar` + `asphalt` via `naphtha_cracker_v2`

§7.4 spec: Crude oil cracking → Naphtha + Diesel + Heavy oil + Asphalt + Tar.

The existing `naphtha_cracker` only outputs `naphtha`. Add a parallel `crude_oil_cracker` (deeper-fraction cracking) with multi-output.

**Concrete values:**
- Three new `ResourceId`s: `heavy_oil`, `tar`, `asphalt`. All T2 weight 10, `liquid_gas`, `liquid` filter.
- Building `crude_oil_cracker` (T2, 3x3, cycleSec 600, inputs `{crude_oil: 3}`, outputs `{heavy_oil: 1, tar: 1, asphalt: 1}`, power 250, cost `{stone: 200, iron_ingot: 60, wood: 20}`, fill `0x2a1a14`).

---

### Task 4.2: `plastic_precursor` + `plastic_polymerizer`

§7.4. Naphtha → plastic precursor.

**Concrete values:**
- `ResourceId.plastic_precursor`: weight 10, `liquid_gas`, `liquid`.
- Building `plastic_polymerizer_a` (T2, 2x2, cycleSec 400, inputs `{naphtha: 1}`, outputs `{plastic_precursor: 1}`, power 120, cost `{stone: 100, iron_ingot: 30, wood: 10}`).

---

### Task 4.3: `rigid_plastic` + `flexible_plastic` + `synthetic_rubber` + 3 buildings

§7.4. Plastic precursor → rigid/flexible/synthetic_rubber via three split buildings.

**Concrete values:**
- Three `ResourceId`s: `rigid_plastic`, `flexible_plastic`, `synthetic_rubber`. All weight 10, `components`, `components` filter.
- Three buildings: `rigid_plastic_press`, `flexible_plastic_press`, `rubber_synthesizer`. Each T2, 2x2, cycleSec 300, inputs `{plastic_precursor: 1}`, outputs `{<respective>: 1}`, power 100.

---

# Phase 5 — Chemistry chain (§7.5)

### Task 5.1: `sulfuric_acid` + `sulfuric_acid_plant` + `hydrochloric_acid` + `hcl_plant`

§7.5: Sulfur + water → sulfuric acid. (HCl is a separate process; spec says salt + power chain co-output, but for simplicity ship its own building.)

**Concrete values:**
- Two new `ResourceId`s: `sulfuric_acid`, `hydrochloric_acid`. Both weight 10, `liquid_gas`, `liquid`.
- Building `sulfuric_acid_plant`: T2, 2x2, cycleSec 400, inputs `{sulfur: 1, fresh_water: 2}`, outputs `{sulfuric_acid: 1}`, power 120.
- Building `hcl_plant`: T2, 2x2, cycleSec 400, inputs `{salt: 1, sulfuric_acid: 1}`, outputs `{hydrochloric_acid: 1}`, power 80. (Spec gives chlor-alkali route; HCl-from-salt-via-acid is also industrially standard.)

---

### Task 5.2: `sodium_hydroxide` — promote chlor-alkali co-output

§7.5 explicit: salt + power → chlorine + sodium hydroxide. Currently `chlor_alkali_plant` drops NaOH. Make it a real output.

**Concrete values:**
- `ResourceId.sodium_hydroxide`: weight 10, `liquid_gas`, `liquid`.
- Modify existing `chlor_alkali_plant` recipe: outputs `{chlorine: 1, sodium_hydroxide: 1}`. (Update the comment in `src/recipes.ts` that currently calls this out as "deferred".)

---

### Task 5.3: `phosphor` + `phosphor_plant`

§7.5: phosphate + acid → phosphor.

**Concrete values:**
- `ResourceId.phosphor`: weight 30 (T3 listed in §6.4), `rare`, `rare` filter.
- Building `phosphor_plant`: T3, 2x2, cycleSec 600, inputs `{phosphate: 1, sulfuric_acid: 1}`, outputs `{phosphor: 1}`, power 200.

---

### Task 5.4: `liquid_nitrogen` via existing Air Separator real recipe

§7.5 air separation. Air Separator (T3 building exists at `air_separator`) currently produces `nitrogen + oxygen + argon`. Add `liquid_nitrogen` as a refined output via a second building `cryo_air_separator` (T3, fed by nitrogen + power).

**Concrete values:**
- `ResourceId.liquid_nitrogen`: weight 30, `temp_sensitive`, `liquid`.
- Building `cryo_air_separator`: T3, 3x3, cycleSec 400, inputs `{nitrogen: 1}`, outputs `{liquid_nitrogen: 1}`, power 400 (cryo is power-heavy).

---

# Phase 6 — Mechanical components (§6.3)

### Task 6.1: `sheet_metal` + `pipe` + `steel_beam` + 3 rolling-mill variants

§6.3 / §7.1 rolling outputs (Steel rolling → sheet, beam, pipe, etc.).

**Concrete values:**
- Three `ResourceId`s: `sheet_metal`, `pipe`, `steel_beam`. All weight 10, `components`, `components` filter.
- Three buildings `sheet_metal_mill`, `pipe_mill`, `beam_mill`. Each T2, 2x2, cycleSec 200, inputs `{steel: 1}`, outputs `{<respective>: 2}`, power 100.

---

### Task 6.2: `bearing` + `bearing_press` + `spring` + `spring_winder`

§6.3 mechanical fasteners/bearings.

**Concrete values:**
- Two `ResourceId`s: `bearing`, `spring`. Both weight 10, `components`, `components`.
- Two buildings `bearing_press` (T2, 2x2, cycleSec 200, inputs `{steel: 1, lubricant: 1}`, outputs `{bearing: 2}`, power 80) and `spring_winder` (T2, 2x2, cycleSec 200, inputs `{steel: 1}`, outputs `{spring: 3}`, power 60).

---

### Task 6.3: `heavy_cable` + `cable_drawer`

§6.3. Wire → heavy_cable via drawing.

**Concrete values:**
- `ResourceId.heavy_cable`: weight 10, `components`, `components`.
- Building `cable_drawer`: T2, 2x2, cycleSec 200, inputs `{wire: 3}`, outputs `{heavy_cable: 1}`, power 80.

---

### Task 6.4: `battery` + `battery_factory`

§6.3 / §7.9.

**Concrete values:**
- `ResourceId.battery`: weight 30 (T3 component), `components`, `components`.
- Building `battery_factory`: T3, 3x3, cycleSec 300, inputs `{lithium: 1, rigid_plastic: 1, wire: 2}`, outputs `{battery: 1}`, power 200, cost `{steel: 80, microchip: 5, glass: 10}`.

---

### Task 6.5: `glass_panel` + `glass_panel_press`

§6.3. Glass → glass_panel.

**Concrete values:**
- `ResourceId.glass_panel`: weight 10, `components`, `components`.
- Building `glass_panel_press`: T2, 2x2, cycleSec 200, inputs `{glass: 2}`, outputs `{glass_panel: 1}`, power 60.

---

### Task 6.6: `coolant` + `ceramic_insulator` + 2 buildings

§6.3.

**Concrete values:**
- `ResourceId.coolant`: weight 10, `liquid_gas`, `liquid`.
- `ResourceId.ceramic_insulator`: weight 10, `components`, `components`.
- Building `coolant_synthesizer`: T2, 2x2, cycleSec 300, inputs `{fresh_water: 2, salt: 1, naphtha: 1}`, outputs `{coolant: 2}`, power 100.
- Building `ceramic_kiln`: T2, 2x2, `requiresHeat: true` heat-source hard, cycleSec 250, inputs `{clay: 2, sand: 1}`, outputs `{ceramic_insulator: 1}`, power 80.

---

# Phase 7 — Bronze + Brass

### Task 7.1: `bronze` + `bronze_alloyer`

§7.2.

**Concrete values:**
- `ResourceId.bronze`: weight 10, `components`, `refined`.
- Building `bronze_alloyer`: T2, 2x2, cycleSec 250, inputs `{copper_ingot: 1, tin_ingot: 1}`, outputs `{bronze: 2}`, power 80.

---

### Task 7.2: `brass` + `brass_alloyer`

§7.2.

**Concrete values:**
- `ResourceId.brass`: weight 10, `components`, `refined`.
- Building `brass_alloyer`: T2, 2x2, cycleSec 250, inputs `{copper_ingot: 1, zinc_ingot: 1}`, outputs `{brass: 2}`, power 80.

---

# Phase 8 — Aluminum chain (§7.3)

### Task 8.1: `alumina` + `alumina_refinery`

Bauxite + chemistry → alumina. Spec calls out the chemistry step uses Chemical Reactor, but engine is 1:1 def→recipe so ship a separate building.

**Concrete values:**
- `ResourceId.alumina`: weight 10, `components`, `refined`.
- Building `alumina_refinery`: T2, 2x2, cycleSec 300, inputs `{bauxite: 1, sodium_hydroxide: 1}`, outputs `{alumina: 1}`, power 150.

---

### Task 8.2: `aluminum` + `aluminum_smelter` (electrolysis)

§7.3 Alumina + power → Aluminum (electrolyzer, very high power).

**Concrete values:**
- `ResourceId.aluminum`: weight 10, `components`, `refined`.
- Building `aluminum_smelter`: T3, 2x3, cycleSec 300, inputs `{alumina: 1}`, outputs `{aluminum: 1}`, power 500 (high — matches "very high power" spec), cost `{steel: 80, microchip: 5}`.

---

# Phase 9 — Electronics chain (§7.7) — high-purity silicon → memory

### Task 9.1: `silicon_wafer` + `wafer_lab` (high-purity silicon → wafer)

The existing `silicon` ResourceId is the high-purity silicon. Add wafer + lab.

**Concrete values:**
- `ResourceId.silicon_wafer`: weight 30, `components`, `components`.
- Building `wafer_lab`: T3, 3x3, cycleSec 400, inputs `{silicon: 1}`, outputs `{silicon_wafer: 1}`, power 250.

---

### Task 9.2: `transistor` + `capacitor` + `resistor` + 3 doping-chamber variants

§7.7. Wafer + doping → transistor/capacitor/resistor.

**Concrete values:**
- Three `ResourceId`s: `transistor`, `capacitor`, `resistor`. All weight 30, `components`, `components`.
- Three buildings `transistor_doping`, `capacitor_doping`, `resistor_doping`. Each T3, 2x2, cycleSec 200, inputs `{silicon_wafer: 1, graphite: 1}`, outputs `{<respective>: 4}`, power 150.

---

### Task 9.3: `memory_module` + `memory_lab`

§7.7. PCB + transistor + cap + resistor + solder → memory module (analogous to circuit board step but a different output).

**Concrete values:**
- `ResourceId.memory_module`: weight 30, `components`, `components`.
- Building `memory_lab`: T3, 3x3, cycleSec 500, inputs `{pcb: 1, transistor: 4, capacitor: 4, resistor: 4, solder: 1}`, outputs `{memory_module: 1}`, power 250.

---

# Phase 10 — Power components + minerals (§7.9 / §6.4)

### Task 10.1: `mercury` + `mercury_pit` + `mercury_well`

§6.4 T3 raw.

**Concrete values:**
- `ResourceId.mercury`: weight 30, `liquid_gas`, `liquid`.
- TerrainKind: `mercury_pit`, fill `0xc0c0c8` (mercury-silver).
- Building `mercury_well`: T3, 2x2, `requiredTile: ['mercury_pit']`, cycleSec 200, outputs `{mercury: 1}`, power 80.
- Biomes: Volcanic + Desert add mercury_pit.

---

### Task 10.2: `diamond_ore` + `diamond_quarry`

§6.4 T3 raw.

**Concrete values:**
- `ResourceId.diamond_ore`: weight 30, `rare`, `rare`.
- TerrainKind: `diamond_vein`, fill `0xd0e8f5`.
- Building `diamond_quarry`: T3, 2x2, cycleSec 300 (rare so slow), outputs `{diamond_ore: 1}`, power 100.
- Biomes: Volcanic + Arctic add diamond_vein.

---

### Task 10.3: `cryogenic_compound` + `cryo_compound_lab`

§6.4 T3.

**Concrete values:**
- `ResourceId.cryogenic_compound`: weight 30, `temp_sensitive`, `liquid`.
- Building `cryo_compound_lab`: T3, 3x3, cycleSec 400, inputs `{liquid_nitrogen: 1, cryo_coolant: 1}`, outputs `{cryogenic_compound: 1}`, power 300.

---

### Task 10.4: `magnetic_alloy` + `mag_alloyer`

§6.4 T3.

**Concrete values:**
- `ResourceId.magnetic_alloy`: weight 30, `components`, `refined`.
- Building `mag_alloyer`: T3, 2x2, cycleSec 300, inputs `{iron_ingot: 2, rare_earth: 1}`, outputs `{magnetic_alloy: 1}`, power 150.

---

### Task 10.5: `magnet` + `mag_forge`

§7.9.

**Concrete values:**
- `ResourceId.magnet`: weight 30, `components`, `components`.
- Building `mag_forge`: T3, 2x2, cycleSec 250, inputs `{magnetic_alloy: 1, wire: 2}`, outputs `{magnet: 1}`, power 200.

---

### Task 10.6: `electric_motor` + `motor_assembly`

§7.9 / §7.10. Motor = magnet + wire + steel core.

**Concrete values:**
- `ResourceId.electric_motor`: weight 30, `components`, `components`.
- Building `motor_assembly`: T3, 2x2, cycleSec 300, inputs `{magnet: 1, wire: 4, steel: 1}`, outputs `{electric_motor: 1}`, power 150.

---

### Task 10.7: `generator` + `generator_lab`

§7.9 / §7.10. Generator = magnet + wire + turbine blade — simplify to `magnet + wire + steel + bearing`.

**Concrete values:**
- `ResourceId.generator`: weight 30, `components`, `components`.
- Building `generator_lab`: T3, 2x2, cycleSec 350, inputs `{magnet: 1, wire: 5, steel: 1, bearing: 2}`, outputs `{generator: 1}`, power 180.

---

### Task 10.8: `pump` + `hydraulic_actuator` + `pneumatic_actuator` + 3 mechanical-assembly buildings

§7.10.

**Concrete values:**
- Three `ResourceId`s: `pump`, `hydraulic_actuator`, `pneumatic_actuator`. All weight 30, `components`, `components`.
- Three buildings:
  - `pump_assembly`: T3, 2x2, cycleSec 300, inputs `{electric_motor: 1, pipe: 2, bearing: 1}`, outputs `{pump: 1}`, power 150.
  - `hydraulic_assembly`: T3, 2x2, cycleSec 300, inputs `{pipe: 2, lubricant: 2, bearing: 1, spring: 1}`, outputs `{hydraulic_actuator: 1}`, power 100.
  - `pneumatic_assembly`: T3, 2x2, cycleSec 300, inputs `{pipe: 2, bearing: 1, spring: 1}`, outputs `{pneumatic_actuator: 1}`, power 100.

---

### Task 10.9: `solar_cell` + `solar_cell_lab`

§7.9. Doped silicon + glass + aluminum frame → solar cell.

**Concrete values:**
- `ResourceId.solar_cell`: weight 30, `components`, `components`.
- Building `solar_cell_lab`: T3, 2x2, cycleSec 400, inputs `{silicon_wafer: 1, glass: 2, aluminum: 1}`, outputs `{solar_cell: 1}`, power 200.

---

### Task 10.10: `fuel_cell` + `fuel_cell_lab`

§7.9. Hydrogen + catalyst + polymer membrane → fuel cell. Substitute platinum→rare_earth and polymer membrane→flexible_plastic.

**Concrete values:**
- `ResourceId.fuel_cell`: weight 30, `components`, `components`.
- Building `fuel_cell_lab`: T3, 2x2, cycleSec 400, inputs `{hydrogen: 2, rare_earth: 1, flexible_plastic: 1}`, outputs `{fuel_cell: 1}`, power 200.

---

### Task 10.11: `optical_glass` + `optical_glass_kiln`

§6.4 / §7.6. Quartz (high purity) + heat → optical glass.

**Concrete values:**
- `ResourceId.optical_glass`: weight 30, `components`, `components`.
- Building `optical_glass_kiln`: T3, 2x2, `requiresHeat: true`, cycleSec 300, inputs `{quartz: 2}`, outputs `{optical_glass: 1}`, power 200.

---

### Task 10.12: `glass_fiber` + `optical_fiber` + 2 fiber-spinner buildings

§7.6. Glass + extreme heat → glass fiber, optical fiber.

**Concrete values:**
- Two `ResourceId`s: `glass_fiber`, `optical_fiber`. Both weight 30, `components`, `components`.
- Two buildings:
  - `glass_fiber_spinner`: T3, 2x2, `requiresHeat: true`, cycleSec 300, inputs `{glass: 2}`, outputs `{glass_fiber: 3}`, power 150.
  - `optical_fiber_drawer`: T3, 2x2, `requiresHeat: true`, cycleSec 400, inputs `{optical_glass: 1}`, outputs `{optical_fiber: 2}`, power 200.

---

# Phase 11 — T4 endgame chains

### Task 11.1: `time_crystal` + `quantum_manipulator`

§6.5 listed indirectly via §7.11 "Lab quantum manipulation → Time crystal". Pin as a T4 raw artifact.

**Concrete values:**
- `ResourceId.time_crystal`: weight 100, `rare`, `rare`.
- Building `quantum_manipulator`: T4, 3x3, cycleSec 1800 (30 min — extreme), inputs `{helium_3: 1, exotic_alloy: 1}`, outputs `{time_crystal: 1}`, power 1000.

---

### Task 11.2: `antimatter_capsule` + recipe in existing `particle_accelerator`

§7.11. Particle accelerator + electromagnetic containment → antimatter capsule. The `particle_accelerator` building exists with empty outputs; add the recipe.

**Concrete values:**
- `ResourceId.antimatter_capsule`: weight 100, `rare`, `rare`.
- Modify existing `particle_accelerator` recipe: cycleSec 1800, inputs `{hydrogen: 10, exotic_alloy: 1, microchip: 5}`, outputs `{antimatter_capsule: 1}`.

---

### Task 11.3: `nuclear_fuel_rod` + `fuel_rod_assembler`

§6.5. Uranium-based fuel rod.

**Concrete values:**
- `ResourceId.nuclear_fuel_rod`: weight 100, `rare`, `rare`.
- Building `fuel_rod_assembler`: T4, 2x2, cycleSec 1200, inputs `{uranium_ore: 5, stainless_steel: 2, coolant: 2}`, outputs `{nuclear_fuel_rod: 1}`, power 400.

Also: update existing `nuclear_reactor` recipe to consume `nuclear_fuel_rod` instead of the `coal: 5` placeholder (replace input). Bump cycleSec to 600 for the real-fuel variant since fuel rods are slow burn.

---

### Task 11.4: `plasma_containment_vessel` + `singularity_sensor` + `cryo_containment_unit` + `particle_accelerator_core` + `self_replication_module` + 5 assembler buildings

§6.5 T4 endgame components. Each is its own recipe; group in one commit because they're conceptually a "T4 components" batch.

**Concrete values:**
- Five `ResourceId`s: all weight 100, `rare`, `rare`.
- Five buildings, all T4:
  - `plasma_containment_assembler`: 2x2, cycleSec 1500, inputs `{exotic_alloy: 1, magnet: 4, steel: 5}`, outputs `{plasma_containment_vessel: 1}`, power 600.
  - `singularity_sensor_lab`: 2x2, cycleSec 1500, inputs `{quantum_chip: 1, optical_fiber: 4, magnet: 2}`, outputs `{singularity_sensor: 1}`, power 500.
  - `cryo_containment_assembler`: 2x2, cycleSec 1500, inputs `{cryogenic_compound: 1, stainless_steel: 2, glass_fiber: 4}`, outputs `{cryo_containment_unit: 1}`, power 500.
  - `accelerator_core_lab`: 2x2, cycleSec 1500, inputs `{magnet: 8, exotic_alloy: 1, optical_fiber: 4}`, outputs `{particle_accelerator_core: 1}`, power 800.
  - `self_replication_lab`: 3x3, cycleSec 1800, inputs `{ai_core: 1, microchip: 8, electric_motor: 4, computing_module: 2}`, outputs `{self_replication_module: 1}`, power 700.

---

# Phase 12 — T5 transcendent chains

### Task 12.1: `zero_point_flux` + `neutronium` + 2 T5 extractors via Casimir Tap variants

§6.6 T5 raws. Add to the §8.10 T5 extractor rotation set.

**Concrete values:**
- Two `ResourceId`s: `zero_point_flux`, `neutronium`. Both weight 300, `rare`, `rare`.
- Modify `casimir_tap` (or ship `zero_point_extractor` / `neutronium_extractor` as separate T5 extractor defs) to produce these on its rotation cycle. Simplest path: ship two new defs each with `tier: 5`, `requiredTile: undefined` (T5 raws are field-level, not tile-locked per §8.10), cycleSec 1800 (matches existing T5 extractors), output one unit per cycle.

---

### Task 12.2: `probability_calculator` + `dimensional_fold` + `causal_regulator` + 3 T5 component labs

§6.6 T5 components.

**Concrete values:**
- Three `ResourceId`s: all weight 300, `rare`, `rare`.
- Three buildings, all T5, 3x3:
  - `probability_calculator_lab`: cycleSec 1800, inputs `{quantum_chip: 4, casimir_energy: 1, ai_core: 1}`, outputs `{probability_calculator: 1}`, power 1500.
  - `dimensional_fold_lab`: cycleSec 1800, inputs `{spacetime_fragment: 1, exotic_alloy: 2, eldritch_processor: 1}`, outputs `{dimensional_fold: 1}`, power 1500.
  - `causal_regulator_lab`: cycleSec 1800, inputs `{time_crystal: 1, phase_converter: 2, reality_anchor: 1}`, outputs `{causal_regulator: 1}`, power 1500.

---

### Task 12.3: `tachyonic_transmitter` + `aether_beacon` + `reality_engine` + `singularity_battery_unit` + 4 T5 labs

§6.6 endgame artifacts (NOT the buildings; the building `singularity_battery` exists — this is the resource form used in higher-tier crafts).

**Concrete values:**
- Four `ResourceId`s: `tachyonic_transmitter`, `aether_beacon`, `reality_engine`, `singularity_battery_unit`. All weight 300, `rare`, `rare`.
- Four buildings, all T5, 3x3, cycleSec 1800, power 1500. Recipes use the available T5 components — pick T5 raws as inputs where applicable.

---

### Task 12.4: `lattice_node_recipe` + `universe_editor_recipe` (recipes for existing buildings)

The `lattice_node` and `universe_editor` BUILDING DEFS exist; their RECIPES don't. Add recipes per §7.12:

- `lattice_node` recipe: cycleSec 43200 (12h), inputs `{reality_anchor: 2, causal_regulator: 4, memetic_core: 1}`, outputs `{}` (the building itself IS the output; recipe consumes inputs to "activate" the node placement).

Actually re-reading spec: lattice_node is placed first, then needs N=20 across networked T5 islands to ignite Lattice. The crafting recipe is the Reality-Forge-level cost to place one. Treat the recipe as the placement consumer (already handled by `placementCost`?) — verify with the existing build.

- `universe_editor` recipe: cycleSec 21600 (6h reuse interval), inputs `{reality_anchor: 4, dimensional_fold: 1, causal_regulator: 2}`. Outputs flag the biome-reroll event (currently the building has the EFFECT but no recipe — verify and add if missing).

If both buildings already have working recipes/effects, this task becomes a no-op consolidation — verify and adjust.

---

# Phase 13 — Satellite assembly + Foundation Kit variants + Scrap substitution

### Task 13.1: §14.10 satellite assembly real recipes

The `scanner_sat`, `comm_sat`, `sweeper_sat`, `repair_drone`, `orbital_insertion_package`, `repair_pack` ResourceIds exist but have no producing recipes in `RECIPES`. Spec gives them concrete recipes:

- `scanner_sat` = 4 exotic_alloy + 2 ai_core + 1 spacetime_fragment + 50 aluminum + 1 orbital_insertion_package
- `sweeper_sat` = 4 exotic_alloy + 1 ai_core + 100 carbon_steel + 20 magnet + 1 orbital_insertion_package
- `comm_sat` (relay sat) = 6 exotic_alloy + 1 ai_core + 200 optical_fiber + 1 orbital_insertion_package
- `repair_drone` = 2 exotic_alloy + 50 carbon_steel + 1 foundation_kit
- `orbital_insertion_package` = 100 iron_ingot + 30 brick + 20 glass + 10 carbon_fiber + 5 ai_core
- `repair_pack` = 1 exotic_alloy + 5 lubricant + 5 tier-matching parts

Add a new T6 building `satellite_factory` (or reuse the existing `spaceport`) that runs these recipes. Since engine is 1:1 def→recipe, fan out into per-payload buildings:
- `scanner_sat_assembly`, `sweeper_sat_assembly`, `comm_sat_assembly`, `repair_drone_assembly`, `oip_assembly`, `repair_pack_assembly`. All T6, 3x3, cycleSec 1800 (30 min), power 600.

---

### Task 13.2: §12.3 Foundation Kit Enriched + Refined variants

Spec §12.3: three variants Standard / Enriched / Refined with per-tier scaling.

**Concrete values:**
- Two new `ResourceId`s: `foundation_kit_enriched`, `foundation_kit_refined`. Both weight 30 / 100 (T3 / T4 component), `dry_goods`, `refined`.
- Two new building defs: `kit_assembler_enriched` (T3, 2x2, cycleSec 600, inputs `{steel: 5, microchip: 1, wire: 5, gear: 5}`, outputs `{foundation_kit_enriched: 1}`), `kit_assembler_refined` (T4, 3x3, cycleSec 1200, inputs `{stainless_steel: 5, quantum_chip: 1, fuel_cell: 1, computing_module: 1}`, outputs `{foundation_kit_refined: 1}`).

---

### Task 13.3: §6.7 Scrap → Pig Iron substitution

Spec §6.7: "Steel recipes accept Scrap as a substitute for fresh Pig iron at a 2:1 ratio". Implement via a new variant building `steel_mill_scrap` that takes scrap instead of pig_iron at 2x ratio.

**Concrete values:**
- Building `steel_mill_scrap`: T2, 3x3, cycleSec 200, inputs `{scrap: 2}`, outputs `{steel: 1, slag: 1}`. (Mirrors `steel_mill`'s output shape; spec's "2 scrap = 1 pig iron's worth" applied at recipe level — so 2 scrap → 1 steel + 1 slag, parallel to the iron-ingot path.)

---

# Phase 14 — DEFERRED-marker cleanup

### Task 14.1: Sweep `DEFERRED` and `deferred` markers — update or remove

Walk every code comment marked DEFERRED / deferred and either:
1. Update it to reflect the now-implemented state (most should), OR
2. If the deferral still applies, prepend `STILL-` to the marker (e.g. `STILL-DEFERRED`) so the next sweep can quickly find them.

Concrete pattern per marker:
```bash
grep -nE "DEFERRED|deferred" src/recipes.ts src/building-defs.ts src/maintenance.ts
```

For each: read the surrounding comment, check whether the referenced item is now in the code (after Phases 1-13), and update or relocate.

Single commit for the whole sweep.

---

# Phase 15 — Balance review (3 parallel opus agents)

### Task 15.1: Dispatch 3 opus agents in parallel

**Files:** No code changes — agents produce findings reports.

**Approach:** Single message with three `Agent` tool calls (general-purpose, model override `opus`). Each agent gets a DISTINCT lens; their reports get unioned.

- [ ] **Agent A — Progression pacing:**

> Review whether a fresh L1 player can reach lubricant in 12h, T3 in a day, T4 in a week, T5 in a month, T6 in 2-3 months under the new chains added in commits since `1237695`. Read SPEC.md §9 (progression), §4.7 (maintenance), and trace the dependency graph from home Plains starter state. Output: list of progression bottlenecks with file:line refs and recommended cycleSec or recipe-ratio changes.

- [ ] **Agent B — Resource-graph audit:**

> For every ResourceId in `src/recipes.ts`, verify: (a) has at least one producer recipe OR is a starter terrain raw OR is a §6.7 byproduct, (b) has at least one consumer recipe OR is a terminal endgame artifact. Build a producer-consumer graph; flag dead-end nodes, infinite-loop cycles (resource A → B → A with positive net), and orphan terrain types (TerrainKind that no biome includes). Output: list of issues with concrete fix recommendations.

- [ ] **Agent C — Cost-tuning sanity:**

> For every recipe, evaluate the input/output ratio against the cycleSec. Flag recipes where (a) the value-per-second of outputs is grossly disproportionate to inputs (e.g. 1 wood → 100 gold), (b) the chain has a high-variance bottleneck (one slow step that gates a whole tier), (c) placementCost is trivial relative to power consumption or recipe value. Output: list of cycleSec or recipe-ratio adjustments.

Each agent returns a markdown report. Aggregate findings into `docs/superpowers/specs/2026-05-15-balance-findings.md` and commit.

---

# Phase 16 — Rebalance round 1

### Task 16.1: Apply union of findings; re-run agents once

Apply each agent's findings. Re-dispatch the 3 agents on the new HEAD. If round 2 finds new issues: ship as-is and add the residual concerns to `docs/superpowers/specs/2026-05-15-balance-residual.md`.

Hard rule: ONE rebalance round only. Loops past this are forbidden by the goal text.

---

## Self-review checklist

- ✅ Every new resource appears in 6 registries (per-task instruction).
- ✅ Every new building has both a `BUILDING_DEFS` entry AND a `RECIPES` entry.
- ✅ Recipes consume only resources already producible by an earlier-tier task.
- ✅ Bootstrap-pacing fix (Task 1.1) lands first.
- ✅ All commits land on `master`.
- ✅ Balance review runs AFTER all content is shipped, not before.
- ✅ One rebalance round only — termination defined.
