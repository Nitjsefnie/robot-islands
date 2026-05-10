// Three-tier ocean colour rendering.
//
// Replaces the old `vision.ts` outline ring. Instead of a stroked boundary
// circle, the boundary IS the colour step between three discrete ocean tiers:
//
//   state a  — vision (full info)        — VISION_BLUE   (lightest)
//   state b  — discovered, no current    — DISCOVERED_BLUE (medium)
//   state c  — unknown                   — UNKNOWN_BLUE  (darkest, =page bg)
//
// Compositing is done by Z-order (no filters, no blend modes):
//
//   1. one big rect filling the world bounds in UNKNOWN_BLUE
//   2. on top of that, filled circles in DISCOVERED_BLUE around every
//      *discovered* island (incl. populated, since populated implies
//      discovered — they get overwritten by state-a anyway)
//   3. on top of that, filled circles in VISION_BLUE around every
//      *populated* island
//
// Islands render on top of all three layers (handled by `main.ts` Z order).
//
// All three fills are at alpha = 1.0. Tiers are discrete; the colour step
// itself communicates the boundary. Per-island alpha/tint dimming for
// 'discovered' islands lives in `world.ts` and is complementary: ocean
// colour shows the *world's* vision state, island dimming shows that
// *island's* known state.

import { Container, Graphics } from 'pixi.js';

import { TILE_PX } from './island.js';
import {
  DISCOVERED_BLUE,
  DISCOVERY_RADIUS_TILES,
  UNKNOWN_BLUE,
  VISION_BLUE,
  VISION_RADIUS_TILES,
} from './world.js';

export interface OceanIsland {
  /** Centre of the island in world-tile coordinates. */
  readonly cx: number;
  readonly cy: number;
  /** Whether the player has discovered this island. (Populated → discovered.) */
  readonly discovered: boolean;
  /** Whether the island is populated (origin of vision). */
  readonly populated: boolean;
}

/**
 * Build the layered ocean container.
 *
 * @param islands       All known islands with discovered/populated flags.
 * @param halfSizeTiles Half-extent of the unknown rectangle, in tiles.
 *                      Pass the same value used for the cell-grid overlay so
 *                      the ocean covers the full reachable area.
 * @returns A `Container` whose children draw, in this order, the unknown
 *          rectangle, then the discovered circles, then the vision circles.
 *          Add it as the first (bottom) child of your world container so
 *          islands render on top.
 */
export function renderOcean(
  islands: ReadonlyArray<OceanIsland>,
  halfSizeTiles: number,
): Container {
  const layer = new Container();
  layer.label = 'ocean';

  const halfPx = halfSizeTiles * TILE_PX;
  const visionRadiusPx = VISION_RADIUS_TILES * TILE_PX;
  const discoveryRadiusPx = DISCOVERY_RADIUS_TILES * TILE_PX;

  const g = new Graphics();

  // Tier C — unknown ocean. Big rect across the world bounds. This is the
  // floor of the entire scene; everything else paints over it.
  g.rect(-halfPx, -halfPx, halfPx * 2, halfPx * 2).fill({
    color: UNKNOWN_BLUE,
    alpha: 1,
  });

  // Tier B — discovered circles. One per discovered island. Populated
  // counts as discovered; tier-A paints over those, so we don't bother
  // filtering them out (simpler code, identical visual result).
  for (const isl of islands) {
    if (!isl.discovered) continue;
    g.circle(isl.cx * TILE_PX, isl.cy * TILE_PX, discoveryRadiusPx).fill({
      color: DISCOVERED_BLUE,
      alpha: 1,
    });
  }

  // Tier A — vision circles. One per populated island. Largest of the
  // three radii (VISION_RADIUS_TILES = 80 tiles) so they reach across to
  // include nearby discovered islands like 'forest-ne'.
  for (const isl of islands) {
    if (!isl.populated) continue;
    g.circle(isl.cx * TILE_PX, isl.cy * TILE_PX, visionRadiusPx).fill({
      color: VISION_BLUE,
      alpha: 1,
    });
  }

  layer.addChild(g);
  return layer;
}
