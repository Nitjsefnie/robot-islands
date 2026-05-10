// Three-tier ocean colour rendering with soft tier boundaries.
//
// Replaces the old `vision.ts` outline ring. The boundary IS the colour step
// between three discrete tiers — but the step is smoothed by radial-gradient
// alpha at each circle's rim, so the user sees a soft fade rather than a
// hard edge:
//
//   state a  — vision (full info)        — VISION_BLUE     (lightest)
//   state b  — discovered, no current    — DISCOVERED_BLUE (medium)
//   state c  — unknown                   — UNKNOWN_BLUE    (darkest, =page bg)
//
// Compositing is plain alpha layering — no filters, no blend modes:
//
//   1. one big rect filling the world bounds in UNKNOWN_BLUE (alpha 1)
//   2. one radial-gradient sprite per *discovered* island in DISCOVERED_BLUE
//      (~70% solid centre, fades to transparent at the rim, so unknown
//      bleeds through softly at the edge)
//   3. one radial-gradient sprite per *populated* island in VISION_BLUE
//      (same gradient profile, larger radius)
//
// Islands render on top of all three layers (handled by `main.ts` Z order).
//
// The earlier fog attempt used Canvas2D radial gradients combined with
// `blendMode: 'erase'` against an opaque sheet — the erase blend was the
// failing piece. Here we layer straight semi-transparent sprites over a
// solid background, which Just Works.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';

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

/** Fraction of the radius that stays at solid colour before the fade starts.
 *  0.7 = inner 70% solid, outer 30% fades to transparent. Picked so the
 *  inner band is unambiguously "the colour" while still giving a visible,
 *  generous soft edge that reads as a fade rather than a halo. */
const INNER_SOLID_FRACTION = 0.7;

/**
 * Build a radial-gradient texture: a square canvas of side `2 * radiusPx`
 * holding a three-stop radial gradient centred on the canvas:
 *
 *   stop 0           — colour @ alpha 1
 *   stop innerSolid  — colour @ alpha 1   (flat plateau out to this radius)
 *   stop 1           — colour @ alpha 0   (fully transparent at the rim)
 *
 * The colour stays the same across stops; only alpha animates. Drawing as
 * a Sprite anchored at (0.5, 0.5) places the gradient's centre at the
 * sprite's transform position, so the caller just sets `sprite.position`
 * to the island centre in world pixels.
 *
 * The texture's pixel dimensions also bound how soft the fade looks at
 * extreme zoom-in. With `2 * radiusPx` resolution we match the on-screen
 * size at 1:1 zoom; further zoom-in shows the gradient nicely interpolated
 * by the GPU sampler.
 */
function buildRadialGradientTexture(
  radiusPx: number,
  innerSolidFraction: number,
  colorHex: number,
): Texture {
  const size = Math.ceil(radiusPx * 2);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('buildRadialGradientTexture: 2D context unavailable');

  const cx = size / 2;
  const cy = size / 2;
  // Decompose 0xRRGGBB → "rgba(r,g,b,a)" string for canvas gradient stops.
  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  const rgb = (alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, rgb(1));
  grad.addColorStop(innerSolidFraction, rgb(1));
  grad.addColorStop(1, rgb(0));

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

/** Helper: build a centred sprite from a freshly-baked gradient texture. */
function makeGradientSprite(
  centreXTiles: number,
  centreYTiles: number,
  radiusTiles: number,
  colorHex: number,
): Sprite {
  const radiusPx = radiusTiles * TILE_PX;
  const tex = buildRadialGradientTexture(radiusPx, INNER_SOLID_FRACTION, colorHex);
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.position.set(centreXTiles * TILE_PX, centreYTiles * TILE_PX);
  return s;
}

/**
 * Build the layered ocean container.
 *
 * @param islands       All known islands with discovered/populated flags.
 * @param halfSizeTiles Half-extent of the unknown rectangle, in tiles.
 *                      Pass the same value used for the cell-grid overlay so
 *                      the ocean covers the full reachable area.
 * @returns A `Container` whose children draw, in this order, the unknown
 *          rectangle, then the discovery sprites, then the vision sprites.
 *          Add it as the first (bottom) child of your world container so
 *          islands render on top.
 */
export function renderOcean(
  islands: ReadonlyArray<OceanIsland>,
  halfSizeTiles: number,
): Container {
  const layer = new Container();
  layer.label = 'ocean';

  // Tier C — unknown ocean. Solid rect across the world bounds. Floor of
  // the entire scene; everything else paints over it.
  const halfPx = halfSizeTiles * TILE_PX;
  const bg = new Graphics();
  bg.rect(-halfPx, -halfPx, halfPx * 2, halfPx * 2).fill({
    color: UNKNOWN_BLUE,
    alpha: 1,
  });
  layer.addChild(bg);

  // Tier B — discovery sprites. One per discovered island. Populated counts
  // as discovered (per data model); the larger vision sprite paints over
  // those, so we don't bother filtering them out.
  for (const isl of islands) {
    if (!isl.discovered) continue;
    layer.addChild(
      makeGradientSprite(isl.cx, isl.cy, DISCOVERY_RADIUS_TILES, DISCOVERED_BLUE),
    );
  }

  // Tier A — vision sprites. One per populated island. Largest radius, so
  // they reach across to include nearby discovered islands like 'forest-ne'
  // (which sits at distance ~41 inside an 80-tile vision radius).
  for (const isl of islands) {
    if (!isl.populated) continue;
    layer.addChild(
      makeGradientSprite(isl.cx, isl.cy, VISION_RADIUS_TILES, VISION_BLUE),
    );
  }

  return layer;
}
