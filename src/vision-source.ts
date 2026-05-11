// Vision-source primitive — the shared leaf module for vision queries.
//
// Pure layer: no PixiJS, no DOM, no module-level side effects. Imports
// nothing from `world.ts` / `lighthouse.ts` / `ocean.ts` so it sits below
// them in the dependency graph. Both `lighthouse.ts` (which builds source
// arrays via `computeVisionSources`) and `world.ts` (which classifies
// islands via `islandRenderState`) consume this module's `pointInVision`
// directly, eliminating the byte-for-byte duplicate that used to live
// inline in `world.ts` as `pointInVisionTest`.
//
// `lighthouse.ts` re-exports both names so existing call sites
// (`import { pointInVision, type VisionSource } from './lighthouse.js'`)
// keep working unchanged.

/** A vision-emitting source in world-tile coordinates.
 *
 *  `ellipse` is the baseline padded per-island vision halo:
 *  axis-aligned, semi-axes `(major, minor)`, centred at `(cx + offsetX,
 *  cy + offsetY)` where `(cx, cy)` is the island centre and `(offsetX,
 *  offsetY)` is the constituent offset (0,0 for a single-ellipse island).
 *
 *  `circle` is a per-Lighthouse vision disc: centred at the Lighthouse's
 *  world-tile position, with the tier-dependent radius. */
export type VisionSource =
  | {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly major: number;
      readonly minor: number;
      readonly offsetX: number;
      readonly offsetY: number;
    }
  | {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
    };

/** Is point (x, y) in world-tile coords inside any vision source? Pure.
 *  Boundary inclusive (≤, not <) so a tile sitting exactly on the rim
 *  of a padded ellipse counts as inside. */
export function pointInVision(
  sources: ReadonlyArray<VisionSource>,
  x: number,
  y: number,
): boolean {
  for (const src of sources) {
    if (src.kind === 'ellipse') {
      const dx = x - (src.cx + src.offsetX);
      const dy = y - (src.cy + src.offsetY);
      if ((dx * dx) / (src.major * src.major) + (dy * dy) / (src.minor * src.minor) <= 1) {
        return true;
      }
    } else {
      const dx = x - src.cx;
      const dy = y - src.cy;
      if (dx * dx + dy * dy <= src.radius * src.radius) return true;
    }
  }
  return false;
}
