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
//      (solid centre with a small EDGE_FADE_PX anti-aliasing band at the
//      rim — reads as a crisp tier circle, not a wash)
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
import type { VisionSource } from './lighthouse.js';
import {
  DISCOVERED_BLUE,
  DISCOVERY_RADIUS_TILES,
  UNKNOWN_BLUE,
  VISION_BLUE,
} from './world.js';

/** Shape consumed by the discovery-aura layer. Only the medium-blue per-
 *  discovered-island halo reads from this; the vision tier is rendered from
 *  the separate `VisionSource[]` list (post-Lighthouse redesign). */
export interface OceanIsland {
  /** Centre of the island in world-tile coordinates. */
  readonly cx: number;
  readonly cy: number;
  /** Whether the player has discovered this island. (Populated → discovered.) */
  readonly discovered: boolean;
}

/** Width of the soft fade band at the rim, in pixels. The inner
 *  `radius - EDGE_FADE_PX` is solid colour; the outer EDGE_FADE_PX fades
 *  to transparent. Sized as an anti-aliasing band, not a visible gradient
 *  — the tier boundary should read as a crisp circle with the rim softened
 *  just enough to avoid pixel staircase. */
const EDGE_FADE_PX = 24;

/**
 * Build a radial-gradient texture: a square canvas of side `2 * radiusPx`
 * holding a three-stop radial gradient centred on the canvas:
 *
 *   stop 0           — colour @ alpha 1
 *   stop innerSolid  — colour @ alpha 1   (flat plateau out to this radius)
 *   stop 1           — colour @ alpha 0   (fully transparent at the rim)
 *
 * `edgePx` is the absolute pixel width of the fade band; `innerSolid` is
 * computed as `(radiusPx - edgePx) / radiusPx`. Using an absolute pixel
 * width (rather than a fraction) keeps the fade looking the same on every
 * sprite regardless of radius — a tiny soft AA edge on both the 24-tile
 * discovery halo and the 80-tile vision halo, instead of a fraction-based
 * fade that scales up dramatically on the larger sprite.
 *
 * The colour stays the same across stops; only alpha animates. Drawing as
 * a Sprite anchored at (0.5, 0.5) places the gradient's centre at the
 * sprite's transform position, so the caller just sets `sprite.position`
 * to the island centre in world pixels.
 */
function buildRadialGradientTexture(
  radiusPx: number,
  edgePx: number,
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

  // Clamp innerStop to a valid range. If edgePx >= radiusPx the whole
  // sprite is fade with no solid centre; if edgePx <= 0 there's no fade
  // at all. Neither is expected in normal use but we guard anyway so
  // canvas doesn't throw on out-of-order stops.
  const innerStop = Math.max(0, Math.min(1, (radiusPx - edgePx) / radiusPx));

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, rgb(1));
  grad.addColorStop(innerStop, rgb(1));
  grad.addColorStop(1, rgb(0));

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

/** Helper: build a centred sprite from a freshly-baked CIRCULAR gradient
 *  texture. Used by the discovery aura (which stays a true circle).
 */
function makeGradientSprite(
  centreXTiles: number,
  centreYTiles: number,
  radiusTiles: number,
  colorHex: number,
): Sprite {
  const radiusPx = radiusTiles * TILE_PX;
  const tex = buildRadialGradientTexture(radiusPx, EDGE_FADE_PX, colorHex);
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.position.set(centreXTiles * TILE_PX, centreYTiles * TILE_PX);
  return s;
}

/** Helper: build a centred sprite shaped as an axis-aligned ellipse with
 *  semi-axes `(majorTiles, minorTiles)`. The underlying texture is a circular
 *  radial gradient sized for the LARGER axis, then non-uniformly scaled so
 *  the shorter axis squashes the circle into an ellipse. Circular biomes
 *  (`major === minor`) stay perfectly circular (scale 1, 1).
 *
 *  Trade-off: `EDGE_FADE_PX` is in screen pixels of the baked texture, so it
 *  also gets squashed by the non-uniform scale on the shorter axis. For
 *  shapes like Coast (14, 7) → vision (64, 57) the minor-axis fade band
 *  reads as ~21px instead of 24px — within AA-band tolerance, no visible
 *  staircase. Worth accepting versus the cost of baking a dedicated
 *  ellipse-shaped gradient texture per source island.
 */
function makeEllipseGradientSprite(
  centreXTiles: number,
  centreYTiles: number,
  majorTiles: number,
  minorTiles: number,
  colorHex: number,
): Sprite {
  const maxAxisTiles = Math.max(majorTiles, minorTiles);
  const radiusPx = maxAxisTiles * TILE_PX;
  const tex = buildRadialGradientTexture(radiusPx, EDGE_FADE_PX, colorHex);
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.position.set(centreXTiles * TILE_PX, centreYTiles * TILE_PX);
  s.scale.set(majorTiles / maxAxisTiles, minorTiles / maxAxisTiles);
  return s;
}

/**
 * Build the layered ocean container.
 *
 * @param islands        All known islands with their discovered flag — drives
 *                       the steel-blue per-discovered-island aura. Populated
 *                       counts as discovered (per data model); the vision
 *                       sprites paint over those so we don't filter them.
 * @param visionSources  The world's vision sources — baseline padded ellipses
 *                       AND Lighthouse circles, pre-computed by
 *                       `lighthouse.ts → computeVisionSources`. One gradient
 *                       sprite is emitted per source; overpaint in
 *                       overlapping regions is harmless (soft edge fade) and
 *                       yields the union vision area without computing the
 *                       union silhouette explicitly.
 * @param halfSizeTiles  Half-extent of the unknown rectangle, in tiles.
 *                       Pass the same value used for the cell-grid overlay
 *                       so the ocean covers the full reachable area.
 * @returns A `Container` whose children draw, in this order, the unknown
 *          rectangle, then the discovery sprites, then the vision sprites.
 *          Add it as the first (bottom) child of your world container so
 *          islands render on top.
 */
export function renderOcean(
  islands: ReadonlyArray<OceanIsland>,
  visionSources: ReadonlyArray<VisionSource>,
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

  // Tier A — vision sprites. One per VisionSource. Baseline ellipses bake
  // an elliptical gradient (axis-aligned); Lighthouse circles bake a true
  // circle. Overpaint where sources overlap is harmless — the soft edge
  // fade keeps tier boundaries crisp visually while the union semantics
  // are exact.
  for (const src of visionSources) {
    if (src.kind === 'ellipse') {
      layer.addChild(
        makeEllipseGradientSprite(
          src.cx + src.offsetX,
          src.cy + src.offsetY,
          src.major,
          src.minor,
          VISION_BLUE,
        ),
      );
    } else {
      layer.addChild(
        makeGradientSprite(src.cx, src.cy, src.radius, VISION_BLUE),
      );
    }
  }

  return layer;
}
