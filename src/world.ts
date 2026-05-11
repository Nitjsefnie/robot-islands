// Multi-island world data + render coordination.
//
// Step-1 had a single home island rendered at world origin. Step-2 generalises:
// the world is a flat list of placed islands, each with its own centre in
// world-tile coordinates, its biome ellipse parameters, and any buildings
// sitting on it.
//
// Per SPEC §2.1 the world is partitioned into stratification cells of side R
// (the discovery guarantee radius). We use R=16 tiles as a placeholder cell
// size — enough to space the demo islands out and exercise the cell-grid
// overlay, but small enough that the home island's vision radius of 5 cells =
// 80 tiles spans a few neighbours.
//
// Vision model (three states):
//   - 'visible'    — populated, OR discovered AND inside some populated
//                    island's vision radius. Rendered at full color/alpha.
//   - 'discovered' — discovered but outside all vision radii. Rendered dimmed
//                    (alpha + cool tint) to read as "known, but no current
//                    info".
//   - 'unknown'    — not discovered. Not rendered at all; the dark page
//                    background shows through.

import { Container } from 'pixi.js';

import type { ModifierId } from './biomes.js';
import { terrainAtForBiome } from './biomes.js';
import { BUILDING_DEFS } from './building-defs.js';
import type { PlacedBuilding } from './buildings.js';
import { HOME_ISLAND_BUILDINGS, renderBuildings } from './buildings.js';
import type { IslandState } from './economy.js';
import type { Tile, TerrainKind } from './island.js';
import {
  computeIslandTiles,
  renderIslandTiles,
  TILE_PX,
} from './island.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';
import type { Route } from './routes.js';

/** Stratification cell side length, in tiles. SPEC §2.1 calls this R. */
export const CELL_SIZE_TILES = 16;
/** Vision radius from a populated island, in tiles. Placeholder: 5 cells. */
export const VISION_RADIUS_TILES = 5 * CELL_SIZE_TILES;
/** Discovery aura radius around any discovered island, in tiles. Placeholder:
 *  ~1.5 cells. Drives the medium-blue ocean tier in `renderOcean`. */
export const DISCOVERY_RADIUS_TILES = 24;

// ---------------------------------------------------------------------------
// Ocean-tier palette
// ---------------------------------------------------------------------------
//
// Three discrete blues form the world's vision-state field. The colour step
// itself indicates the boundary between tiers — there is no outline ring.
//
//   VISION_BLUE     — luminous cyan-leaning shallow. Reads as "lit water,
//                     full information." Saturated and cool.
//   DISCOVERED_BLUE — desaturated steel mid-blue. Reads as "we surveyed
//                     this once; the lights are off now." Drops both
//                     lightness and chroma vs vision so the perceptual
//                     gap is two-axis, not just lightness.
//   UNKNOWN_BLUE    — the page background exactly. Unknown ocean fuses
//                     visually with the page void; "unknown" reads as
//                     absence rather than as a competing dark colour.

/** Tier A — vision (full info) ocean. Luminous cyan-tinged shallow. */
export const VISION_BLUE = 0x7dd3e8;
/** Tier B — discovered (no current info) ocean. Desaturated steel blue. */
export const DISCOVERED_BLUE = 0x2d5878;
/** Tier C — unknown ocean. Equals the page background `#0a0e14`. */
export const UNKNOWN_BLUE = 0x0a0e14;

export type Biome = 'plains' | 'forest' | 'coast' | 'volcanic' | 'desert' | 'arctic';

export type IslandRenderState = 'visible' | 'discovered' | 'unknown';

export interface IslandSpec {
  readonly id: string;
  readonly biome: Biome;
  /** Centre of the island in world-tile coordinates. */
  readonly cx: number;
  readonly cy: number;
  /** Ellipse half-axes in tiles. */
  readonly majorRadius: number;
  readonly minorRadius: number;
  /** Whether the island is populated (origin of vision). Implies discovered.
   *  Mutable in step 12: settlement-vehicle arrivals flip this from false →
   *  true on the target island. See `tickVehicles` in `settlement.ts`. */
  populated: boolean;
  /** Whether the player knows this island exists at all. Populated → discovered
   *  by definition (the classification function short-circuits on populated).
   *  Mutable in step 6: drone returns flip this from false→true on revealed
   *  islands. The rest of the spec stays readonly — only this flag changes. */
  discovered: boolean;
  /** Buildings placed on this island, in island-local tile coords. Mutable so
   *  step-2.5 placement can push onto the same array shared with
   *  `IslandState.buildings` (the state field is a live reference, not a
   *  copy — see `makeInitialIslandState`). The dual-array footgun is
   *  intentionally avoided: one array, two consumers, mutation flows to
   *  both. */
  buildings: PlacedBuilding[];
  /** Terrain function in island-local coords. Defaults to grass everywhere. */
  readonly terrainAt?: (x: number, y: number) => TerrainKind;
  /** Active modifiers on this island per §3.5. Step 8 hard-codes the demo
   *  set on `DEMO_ISLANDS`; future steps roll from `rollModifiers` at
   *  generation. Empty array means no modifiers active. */
  readonly modifiers: ReadonlyArray<ModifierId>;
  /** §2.5: islands built via Platform Constructor are flagged so future
   *  systems can deny natural-only content (rare-biome modifiers per §3.5,
   *  biome-locked uniques per §9.5). For step 11 the flag is metadata only —
   *  no current consumer; reserved for step 12. Undefined ≡ false (natural). */
  readonly artificial?: boolean;
}

/** Convenience: world-tile coords → world-pixel coords. */
export function tileToWorldPx(cxTiles: number, cyTiles: number): { x: number; y: number } {
  return { x: cxTiles * TILE_PX, y: cyTiles * TILE_PX };
}

/**
 * Squared world-tile distance from an island's centre to a point. Pure helper
 * for vision-radius checks (avoids sqrt when only comparing to a radius).
 */
export function distSqTiles(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Classify a single island into one of three render states.
 *
 * Logic (the population short-circuit means we don't have to set
 * `discovered: true` redundantly on populated islands — they're discovered
 * by definition):
 *
 *   1. populated                                 → 'visible'
 *   2. !discovered                               → 'unknown'
 *   3. inside any populated island's vision      → 'visible'
 *   4. otherwise                                 → 'discovered'
 */
export function islandRenderState(
  spec: IslandSpec,
  populatedCentres: ReadonlyArray<{ cx: number; cy: number }>,
  radiusTiles: number,
): IslandRenderState {
  if (spec.populated) return 'visible';
  if (!spec.discovered) return 'unknown';
  const r2 = radiusTiles * radiusTiles;
  for (const p of populatedCentres) {
    if (distSqTiles(spec.cx, spec.cy, p.cx, p.cy) <= r2) return 'visible';
  }
  return 'discovered';
}

/**
 * Render a single island's terrain + buildings into a fresh container, with
 * the container positioned at the island's world-pixel centre. The contents
 * are drawn in island-local coordinates (matching `renderIslandTiles` /
 * `renderBuildings` from step 1), and the container translation handles the
 * world placement.
 *
 * The render state only controls *whether* the island is drawn:
 *   - 'visible'    → full colour land
 *   - 'discovered' → full colour land (the surrounding mid-blue ocean tier
 *                    is the sole indicator of "known but no current info")
 *   - 'unknown'    → null (caller skips it; ocean tier C shows through)
 *
 * Earlier versions dimmed discovered islands via alpha + tint, which made
 * the steel-blue ocean tier bleed through the half-transparent land and
 * read as "ocean overlays the island". The ocean colour itself now carries
 * the world's vision-state info; the island stays opaque so it always
 * reads as land.
 */
export function renderIsland(spec: IslandSpec, state: IslandRenderState = 'visible'): Container | null {
  if (state === 'unknown') return null;
  const c = new Container();
  c.label = `island:${spec.id}:${state}`;
  const tiles: Tile[] = computeIslandTiles(
    spec.majorRadius,
    spec.minorRadius,
    spec.terrainAt ?? (() => 'grass'),
  );
  c.addChild(renderIslandTiles(tiles));
  if (spec.buildings.length > 0) c.addChild(renderBuildings(spec.buildings));
  const px = tileToWorldPx(spec.cx, spec.cy);
  c.position.set(px.x, px.y);
  return c;
}

/**
 * Hand-placed demo islands, laid out so the default view shows all three
 * render states AND has a reachable undiscovered island for the step-6 drone
 * demo:
 *
 *   - home plains (0, 0) populated                            → 'visible'  (state a)
 *   - forest-ne (40, -10) discovered, dist≈41 < 80 (vision)   → 'visible'  (state a, via vision)
 *   - desert-far (80, 60) discovered, dist=100 > 80           → 'discovered' (state b)
 *   - coast-unknown (180, 0) !discovered                      → 'unknown'  (out of step-6 drone range)
 *   - hidden-w (-50, 12) !discovered                          → 'unknown'  (within reach: 50 tiles SW)
 *   - hidden-s (35, 70) !discovered                           → 'unknown'  (within reach: ~78 tiles south)
 *
 * The two `hidden-*` islands sit outside vision (>80 tiles from home in at
 * least one), inside drone reach (max outbound 100 tiles at fuelLoaded=50,
 * efficiency 4 — see `drones.ts`). They give the player something concrete
 * to discover.
 */
// Step-8 modifier assignments are hardcoded on each demo island. The
// random `rollModifiers` generator is exported from `biomes.ts` for future-
// step use (artificial islands, persisted seed worlds) but not invoked here.
//
// Per §3.7: home Plains starts with `Stable` and no other modifiers.
// Other demo islands carry one wired modifier each so the visual + UI
// integration is exercisable from step 8 onward.
export const DEMO_ISLANDS: ReadonlyArray<IslandSpec> = [
  {
    id: 'home',
    biome: 'plains',
    cx: 0,
    cy: 0,
    majorRadius: 14,
    minorRadius: 14,
    populated: true,
    discovered: true,
    buildings: HOME_ISLAND_BUILDINGS,
    // Home preserves its hand-placed terrain map exactly — terrainAtForBiome
    // delegates to defaultTerrainAtHome for islandId === 'home'.
    terrainAt: (x, y) => terrainAtForBiome('plains', 'home', x, y),
    // §3.7: Stable trait by default, no other modifiers.
    modifiers: ['stable'],
  },
  // forest-ne is hardcoded as populated for step 7 — it acts as the
  // demo destination for inter-island routes. Settlement vehicles (§12)
  // are deferred to a later step; until then we just flip `populated: true`
  // on this island so it has an IslandState, a building set, and can
  // receive funneled cargo. The buildings are a minimal demo: one Cargo
  // Dock (route endpoint convention) and one Workshop (consumes iron_ore +
  // coal so funneling has something to consume). Both sit inside the
  // 10-tile-radius ellipse: (0,0) is the island centre.
  {
    id: 'forest-ne',
    biome: 'forest',
    cx: 40,
    cy: -10,
    majorRadius: 10,
    minorRadius: 10,
    populated: true,
    discovered: true,
    // Step-9: also adds a Logger so forest-ne has a local wood producer to
    // pair with the demo Biomass Plant chain. 1×1 footprint inside the
    // radius-10 ellipse.
    // Step-11: adds a Platform Constructor (4×4 at (-4,-4)..(-1,-1)) so
    // forest-ne can demonstrate the §2.5 artificial-island construction
    // path. Outermost corner at (-4, -4) sits at distance √32 ≈ 5.66 from
    // the centre — well inside the radius-10 ellipse; no overlap with
    // dock(0,0), workshop(-3,0), or logger(3,3).
    buildings: [
      { id: 'forestne-dock-1',                defId: 'dock',                 x: 0,  y: 0 },
      { id: 'forestne-workshop-1',            defId: 'workshop',             x: -3, y: 0 },
      { id: 'forestne-logger-1',              defId: 'logger',               x: 3,  y: 3 },
      { id: 'forestne-platform-constructor-1', defId: 'platform_constructor', x: -4, y: -4 },
    ],
    terrainAt: (x, y) => terrainAtForBiome('forest', 'forest-ne', x, y),
    modifiers: ['fertile'],
  },
  {
    id: 'desert-far',
    biome: 'desert',
    cx: 80,
    cy: 60,
    majorRadius: 12,
    minorRadius: 12,
    populated: false,
    discovered: true,
    buildings: [],
    terrainAt: (x, y) => terrainAtForBiome('desert', 'desert-far', x, y),
    modifiers: ['mineral_rich'],
  },
  {
    id: 'coast-unknown',
    biome: 'coast',
    cx: 180,
    cy: 0,
    majorRadius: 14,
    minorRadius: 7,
    populated: false,
    discovered: false,
    buildings: [],
    terrainAt: (x, y) => terrainAtForBiome('coast', 'coast-unknown', x, y),
    modifiers: [],
  },
  {
    id: 'hidden-w',
    biome: 'plains',
    cx: -50,
    cy: 12,
    majorRadius: 9,
    minorRadius: 9,
    populated: false,
    discovered: false,
    buildings: [],
    terrainAt: (x, y) => terrainAtForBiome('plains', 'hidden-w', x, y),
    modifiers: [],
  },
  {
    id: 'hidden-s',
    biome: 'forest',
    cx: 35,
    cy: 70,
    majorRadius: 8,
    minorRadius: 8,
    populated: false,
    discovered: false,
    buildings: [],
    terrainAt: (x, y) => terrainAtForBiome('forest', 'hidden-s', x, y),
    modifiers: ['cursed_storms'],
  },
];

/**
 * Top-level world container introduced in step 6. Wraps the spec array (now
 * with mutable `discovered` flags) and the in-flight drone fleet. Built once
 * at startup via `makeInitialWorld`; mutations happen in-place when drones
 * dispatch and return.
 *
 * `IslandState` (in `economy.ts`) is per-island runtime; `WorldState` lives
 * alongside it. Drones live on `WorldState`, not on any single island state.
 */
export interface WorldState {
  /** Mutable: `discovered` flag flips when drones return. The `IslandSpec`
   *  objects themselves are reused — drone-discovery touches one field. */
  islands: IslandSpec[];
  /** Mutable: drones list grows on dispatch, shrinks on return. The
   *  inline-import keeps this a type-only edge so `world.ts` doesn't take a
   *  runtime dependency on `drones.ts` (the dependency goes the other way:
   *  `drones.ts` consumes `WorldState`). */
  drones: import('./drones.js').Drone[];
  /** Mutable: player-created inter-island routes. Each route carries its own
   *  in-flight batch buffer (§2.4 hybrid latency model). Like `drones`, the
   *  module dependency points `routes.ts → world.ts`; the type-only import
   *  keeps the back-edge cycle-free. */
  routes: Route[];
  /** Mutable: §12 settlement vehicles in flight (ships + helicopters). Each
   *  vehicle is consumed on arrival — list grows on dispatch, shrinks on
   *  tick when arrival fires. Same type-only-import discipline as drones
   *  and routes; the runtime dependency is `settlement.ts → world.ts`. */
  vehicles: import('./settlement.js').SettlementVehicle[];
}

/**
 * Build the working world from `DEMO_ISLANDS`. The seed array stays a
 * `ReadonlyArray<IslandSpec>` so it's still safe to import as immutable
 * data; we shallow-spread each spec into a fresh mutable copy here so
 * later `discovered = true` writes don't trip strict-mode "assignment to
 * readonly" errors. References to `buildings` and `terrainAt` stay shared
 * (those are effectively immutable).
 */
export function makeInitialWorld(_nowMs: number): WorldState {
  // Spread each demo spec into a fresh mutable copy AND clone its
  // `buildings` array, so step-2.5 placement onto the live world doesn't
  // mutate the immutable seed in `DEMO_ISLANDS` (multiple sessions in a
  // test runner would otherwise see leaked placements).
  const islands: IslandSpec[] = DEMO_ISLANDS.map((s) => ({
    ...s,
    buildings: [...s.buildings],
  }));
  return { islands, drones: [], routes: [], vehicles: [] };
}

// ---------------------------------------------------------------------------
// Initial economy state
// ---------------------------------------------------------------------------
//
// `IslandSpec` describes the static layout (terrain, ellipse, building
// placements); `IslandState` carries the mutable per-island runtime
// (inventory, level, XP, lastTick). We keep them separated so the spec
// can remain `readonly` and `DEMO_ISLANDS` can stay a frozen literal.
//
// For step 3 we only build state for the home island — the other demo
// islands are unpopulated and have no buildings, so their economies are
// trivially "nothing happens". When colonization lands in a later step,
// `makeInitialIslandState` will be applied to each newly-populated spec.

/**
 * Starting inventory.
 * - Coal seeded at 50 (step 3 pattern): Workshop chain runs immediately;
 *   once coal hits zero the Workshop stalls, demonstrating `inputAvail = 0`
 *   back-propagation. No coal producer in current build — stall is
 *   intentional demo behaviour.
 * - Biofuel seeded at 50 (step 6 pattern, mirrors coal): there is no
 *   biofuel producer yet, but the Drone Pad needs fuel. Player gets enough
 *   for ~5 maximum-fuel drone launches before the chain stalls on biofuel,
 *   at which point a future step's biofuel refinery becomes the unlock.
 */
function startingInventory(): Record<ResourceId, number> {
  const inv = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) inv[r] = 0;
  inv.coal = 50;
  inv.biofuel = 50;
  return inv;
}

/** Baseline cap before any storage building is placed. Per the step-3 demo
 *  every resource started at 100; we keep the same baseline so an island
 *  without any storage building still has minimal headroom for the tick
 *  loop to demonstrate cap-stall behaviour. Storage buildings add on top. */
const BASELINE_STORAGE_CAP = 100;

/**
 * Aggregate placement-time storage caps from a building list. Per §8.4
 * spec, storage buildings carry per-resource specialisation (Silo →
 * dry-goods, Tank → liquids/gases). For step 9 the simplification is
 * "Crate/Silo/Tank apply uniformly to ALL resources" — the categorised
 * routing system is deferred. The result: each resource cap = baseline +
 * sum of every placed storage def's `storageCap`.
 *
 * Pure — no PixiJS, no DOM, no IslandState dependency.
 */
export function aggregateStorageCaps(
  buildings: ReadonlyArray<PlacedBuilding>,
): Record<ResourceId, number> {
  let extra = 0;
  for (const b of buildings) {
    extra += BUILDING_DEFS[b.defId].storageCap ?? 0;
  }
  const caps = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) caps[r] = BASELINE_STORAGE_CAP + extra;
  return caps;
}

/** Empty per-resource funnel-pending map. Every key zeroed so the
 *  `accrueXp` drain never sees `undefined`. */
function startingFunnelPending(): Record<ResourceId, number> {
  const f = {} as Record<ResourceId, number>;
  for (const r of ALL_RESOURCES) f[r] = 0;
  return f;
}

/**
 * Build a fresh `IslandState` for a spec. `nowMs` seeds `lastTick` so the
 * first `advanceIsland` call doesn't replay history from epoch zero.
 */
export function makeInitialIslandState(spec: IslandSpec, nowMs: number): IslandState {
  return {
    id: spec.id,
    buildings: spec.buildings,
    inventory: startingInventory(),
    storageCaps: aggregateStorageCaps(spec.buildings),
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    unlockedNodes: new Set(),
    subPathProgress: new Map(),
    funnelPending: startingFunnelPending(),
    // §9.4 specialization is undeclared at birth — every island starts as
    // a Generalist (no buff, no penalty). Declaration is gated by T3
    // (level ≥ 15) and one-way until §9.7 Tier Reset lands.
    specializationRole: null,
    declaredAt: null,
    // §13.1 T5 access gate. Defaults to false on every fresh island — T5
    // catalog rows stay locked until the player has both reached level 50
    // and crafted at least one AI core. Production-trigger flip deferred
    // to step 14; the step-13 demo seeds this true manually on forest-ne.
    aiCoreCrafted: false,
    lastTick: nowMs,
  };
}
