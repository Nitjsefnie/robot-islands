// Vision / fog rendering and the pure alpha math behind it.
//
// Vision is a soft-edged disc around each populated island. Inside the disc
// the world is fully visible; outside it is fully covered by a dark fog. The
// transition happens over the last VISION_EDGE_TILES of the radius — a sharp
// step in the middle of the rim would look bad; a flat-then-ramp curve is the
// shape called out in the task and SPEC.
//
// Rendering approach: a dark rectangle covers a generous world area, then a
// child Graphics with blend mode 'erase' cuts a soft hole at each vision
// source. The hole is approximated by a stack of concentric circles at
// progressively increasing erase-alpha from outside (no erase) to inside
// (full erase); the cumulative composition reproduces the flat-then-ramp
// curve closely enough at this scale.
//
// The whole layer is marked isRenderGroup so the eraser blend composites
// against the local fog rect rather than the underlying island layer.
//
// World-space: the fog container lives inside the world container, so it
// pans and zooms with the camera.

import { Container, Graphics } from 'pixi.js';

import { TILE_PX } from './island.js';
import { VISION_EDGE_TILES, VISION_RADIUS_TILES } from './world.js';

/**
 * Pure: visibility alpha at a given world-tile distance from a vision source.
 *
 *   d ≤ R - EDGE          → 1.0 (fully visible)
 *   R - EDGE < d < R      → linear ramp from 1.0 to 0.0
 *   d ≥ R                 → 0.0 (fully fogged)
 *
 * Monotonically non-increasing in d.
 */
export function visionAlpha(
  distanceTiles: number,
  radiusTiles: number = VISION_RADIUS_TILES,
  edgeTiles: number = VISION_EDGE_TILES,
): number {
  if (distanceTiles <= 0) return 1;
  const inner = radiusTiles - edgeTiles;
  if (distanceTiles <= inner) return 1;
  if (distanceTiles >= radiusTiles) return 0;
  return (radiusTiles - distanceTiles) / edgeTiles;
}

/** Tile distance → pixel distance via the renderer's TILE_PX. */
export function tilesToPx(t: number): number {
  return t * TILE_PX;
}

export interface VisionSource {
  /** World-tile centre of the source. */
  readonly cx: number;
  readonly cy: number;
  /** Radius in world-tiles. Defaults to VISION_RADIUS_TILES. */
  readonly radiusTiles?: number;
}

/** Number of concentric rings used to approximate the soft edge. */
const RING_STEPS = 16;

/**
 * Build the fog layer container, ready to be added on top of the island
 * layer inside the world container. `worldHalfSizeTiles` controls the size
 * of the dark base rect — pass a value larger than the player can reasonably
 * pan to.
 */
export function renderFogLayer(
  sources: ReadonlyArray<VisionSource>,
  worldHalfSizeTiles: number,
): Container {
  const layer = new Container();
  layer.label = 'fog';
  // isRenderGroup isolates this subtree to its own render texture, so the
  // 'erase' blend mode below cuts holes in the fog rect rather than in the
  // island layer beneath.
  layer.isRenderGroup = true;

  const halfPx = tilesToPx(worldHalfSizeTiles);
  const edgePx = tilesToPx(VISION_EDGE_TILES);
  const fogColor = 0x0a0e14; // matches index.html body bg

  // Base fog rect — covers a generous world area at full opacity.
  const base = new Graphics();
  base.rect(-halfPx, -halfPx, halfPx * 2, halfPx * 2).fill({ color: fogColor, alpha: 1.0 });
  layer.addChild(base);

  // Eraser: concentric circles at progressively increasing erase coverage.
  // Each ring is a full disc; the layered erase-alpha approximates the soft
  // edge. The math: drawing N discs of decreasing radius at uniform erase-
  // alpha A produces cumulative erase ≈ 1 - (1 - A)^k at the k-th ring from
  // the outside. For RING_STEPS=16, A ≈ 1 - (1 - 1)^(1/16) won't work
  // multiplicatively — but PixiJS 'erase' is destination-out, which IS
  // multiplicative: dst = dst * (1 - src.a). So
  //   final_erase_at_inner = 1 - (1 - A)^N
  // To reach near-1 inside we need A such that (1 - A)^N ≈ 0 — e.g. A=0.25
  // gives (0.75)^16 ≈ 0.01, plenty close to fully clear.
  const eraser = new Graphics();
  eraser.blendMode = 'erase';
  const alphaStep = 0.25;
  for (const src of sources) {
    const cx = src.cx * TILE_PX;
    const cy = src.cy * TILE_PX;
    const srcRadiusPx = tilesToPx(src.radiusTiles ?? VISION_RADIUS_TILES);
    const srcInnerPx = srcRadiusPx - edgePx;
    // Outer rings (in the soft band, between inner and outer radii) at low
    // alphaStep, inner rings (radius ≤ srcInnerPx) all stacked at
    // srcInnerPx so the inside is fully cleared.
    for (let i = 0; i < RING_STEPS; i++) {
      const t = i / (RING_STEPS - 1);
      // Radius interpolates from outer rim (t=0) to inner-flat (t=1).
      const r = srcRadiusPx + (srcInnerPx - srcRadiusPx) * t;
      eraser.circle(cx, cy, r).fill({ color: 0xffffff, alpha: alphaStep });
    }
  }
  layer.addChild(eraser);

  return layer;
}
