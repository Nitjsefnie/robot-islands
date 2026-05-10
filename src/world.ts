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

import { Container } from 'pixi.js';

import type { Building } from './buildings.js';
import { HOME_ISLAND_BUILDINGS, renderBuildings } from './buildings.js';
import type { Tile, TerrainKind } from './island.js';
import {
  computeIslandTiles,
  defaultTerrainAt,
  renderIslandTiles,
  TILE_PX,
} from './island.js';

/** Stratification cell side length, in tiles. SPEC §2.1 calls this R. */
export const CELL_SIZE_TILES = 16;
/** Vision radius from a populated island, in tiles. Placeholder: 5 cells. */
export const VISION_RADIUS_TILES = 5 * CELL_SIZE_TILES;
/** Soft edge: alpha ramps from 1 → 0 over this distance at the rim. */
export const VISION_EDGE_TILES = 2;

export type Biome = 'plains' | 'forest' | 'coast' | 'volcanic' | 'desert' | 'arctic';

export interface IslandSpec {
  readonly id: string;
  readonly biome: Biome;
  /** Centre of the island in world-tile coordinates. */
  readonly cx: number;
  readonly cy: number;
  /** Ellipse half-axes in tiles. */
  readonly majorRadius: number;
  readonly minorRadius: number;
  /** Whether the island is populated (origin of vision). */
  readonly populated: boolean;
  /** Buildings placed on this island, in island-local tile coords. */
  readonly buildings: ReadonlyArray<Building>;
  /** Terrain function in island-local coords. Defaults to grass everywhere. */
  readonly terrainAt?: (x: number, y: number) => TerrainKind;
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
 * Is the island (cx, cy) within `radiusTiles` of any populated island in
 * `populatedCentres`? Used to decide whether to render an island's terrain
 * and buildings.
 */
export function isIslandVisible(
  spec: IslandSpec,
  populatedCentres: ReadonlyArray<{ cx: number; cy: number }>,
  radiusTiles: number,
): boolean {
  const r2 = radiusTiles * radiusTiles;
  for (const p of populatedCentres) {
    if (distSqTiles(spec.cx, spec.cy, p.cx, p.cy) <= r2) return true;
  }
  return false;
}

/**
 * Render a single island's terrain + buildings into a fresh container, with
 * the container positioned at the island's world-pixel centre. The contents
 * are drawn in island-local coordinates (matching `renderIslandTiles` /
 * `renderBuildings` from step 1), and the container translation handles the
 * world placement.
 */
export function renderIsland(spec: IslandSpec): Container {
  const c = new Container();
  c.label = `island:${spec.id}`;
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
 * Hand-placed demo islands. Home is a Plains 14×14 at the origin (preserved
 * from step 1). Neighbours are picked to land inside and outside the home's
 * 80-tile vision radius for visual proof of fog clipping.
 *   - Forest 10×10 at (40, -10)   → distance √(40²+10²) ≈ 41 < 80, visible
 *   - Desert 12×12 at (-50, 30)   → distance √(50²+30²) ≈ 58 < 80, visible
 *   - Coast  14×7  at (180, 0)    → distance 180 > 80, fogged
 */
export const DEMO_ISLANDS: ReadonlyArray<IslandSpec> = [
  {
    id: 'home',
    biome: 'plains',
    cx: 0,
    cy: 0,
    majorRadius: 14,
    minorRadius: 14,
    populated: true,
    buildings: HOME_ISLAND_BUILDINGS,
    terrainAt: defaultTerrainAt,
  },
  {
    id: 'forest-ne',
    biome: 'forest',
    cx: 40,
    cy: -10,
    majorRadius: 10,
    minorRadius: 10,
    populated: false,
    buildings: [],
    terrainAt: () => 'grass',
  },
  {
    id: 'desert-sw',
    biome: 'desert',
    cx: -50,
    cy: 30,
    majorRadius: 12,
    minorRadius: 12,
    populated: false,
    buildings: [],
    terrainAt: () => 'stone',
  },
  {
    id: 'coast-far',
    biome: 'coast',
    cx: 180,
    cy: 0,
    majorRadius: 14,
    minorRadius: 7,
    populated: false,
    buildings: [],
    terrainAt: () => 'water',
  },
];
