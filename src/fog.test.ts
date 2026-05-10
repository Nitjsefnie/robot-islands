// Vision-alpha curve invariants.

import { describe, expect, it } from 'vitest';

import { visionAlpha } from './fog.js';
import { VISION_EDGE_TILES, VISION_RADIUS_TILES } from './world.js';

describe('visionAlpha', () => {
  it('is 1.0 at the centre', () => {
    expect(visionAlpha(0)).toBe(1);
  });

  it('is 0.0 at the outer radius', () => {
    expect(visionAlpha(VISION_RADIUS_TILES)).toBe(0);
  });

  it('is 0.0 outside the radius', () => {
    expect(visionAlpha(VISION_RADIUS_TILES + 1)).toBe(0);
    expect(visionAlpha(VISION_RADIUS_TILES * 2)).toBe(0);
  });

  it('is 1.0 throughout the inner flat band', () => {
    const inner = VISION_RADIUS_TILES - VISION_EDGE_TILES;
    expect(visionAlpha(inner * 0.5)).toBe(1);
    expect(visionAlpha(inner)).toBe(1);
  });

  it('ramps linearly across the edge band', () => {
    // Mid-edge: alpha should be 0.5 exactly.
    const mid = VISION_RADIUS_TILES - VISION_EDGE_TILES / 2;
    expect(visionAlpha(mid)).toBeCloseTo(0.5);
  });

  it('is monotonically non-increasing in distance', () => {
    let prev = visionAlpha(0);
    for (let d = 0; d <= VISION_RADIUS_TILES + 10; d += 1) {
      const cur = visionAlpha(d);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it('respects custom radius + edge parameters', () => {
    expect(visionAlpha(0, 10, 2)).toBe(1);
    expect(visionAlpha(8, 10, 2)).toBe(1); // at inner edge
    expect(visionAlpha(9, 10, 2)).toBeCloseTo(0.5); // mid-edge
    expect(visionAlpha(10, 10, 2)).toBe(0);
    expect(visionAlpha(11, 10, 2)).toBe(0);
  });
});
