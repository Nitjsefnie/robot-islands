// Island render-state classification: pure-logic tests for the three-state
// vision model (visible / discovered / unknown).

import { describe, expect, it } from 'vitest';

import {
  DEMO_ISLANDS,
  findPopulatedIslandAt,
  islandRenderState,
  VISION_PADDING_TILES,
  type IslandSpec,
} from './world.js';

function makeSpec(over: Partial<IslandSpec>): IslandSpec {
  return {
    id: 'test',
    biome: 'plains',
    cx: 0,
    cy: 0,
    majorRadius: 5,
    minorRadius: 5,
    populated: false,
    discovered: false,
    buildings: [],
    modifiers: [],
    ...over,
  };
}

describe('islandRenderState', () => {
  // Plains-like source (14, 14) at origin. Vision ellipse = (14 + 50, 14 + 50)
  // = (64, 64) circle — same shape as the legacy 80-tile fixed radius shrunk
  // down to the source's own footprint + 50 padding.
  const sources: ReadonlyArray<
    Pick<IslandSpec, 'cx' | 'cy' | 'majorRadius' | 'minorRadius'>
  > = [{ cx: 0, cy: 0, majorRadius: 14, minorRadius: 14 }];

  it('classifies a populated island as visible (regardless of `discovered`)', () => {
    const s = makeSpec({ populated: true, discovered: false, cx: 200, cy: 200 });
    // Even far away from any source, populated implies visible — populated
    // islands ARE the vision sources, so they're trivially in vision of self.
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('classifies a discovered island inside vision ellipse as visible', () => {
    // forest-ne-ish: (40, -10) against a (14,14) source → vision a,b = (64,64).
    // 40²/64² + 10²/64² ≈ 0.42 ≤ 1 → visible.
    const s = makeSpec({ populated: false, discovered: true, cx: 40, cy: -10 });
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('classifies a discovered island outside vision ellipse as discovered', () => {
    // desert-far-ish: (80, 60). 80²/64² + 60²/64² ≈ 2.44 > 1 → discovered.
    const s = makeSpec({ populated: false, discovered: true, cx: 80, cy: 60 });
    expect(islandRenderState(s, sources)).toBe('discovered');
  });

  it('classifies an undiscovered island as unknown', () => {
    const s = makeSpec({ populated: false, discovered: false, cx: 40, cy: -10 });
    // Even though it's inside the vision ellipse, undiscovered short-circuits
    // to unknown — the player just doesn't know it's there.
    expect(islandRenderState(s, sources)).toBe('unknown');
  });

  it('handles zero vision sources sanely', () => {
    const s1 = makeSpec({ populated: true });
    const s2 = makeSpec({ populated: false, discovered: true });
    const s3 = makeSpec({ populated: false, discovered: false });
    expect(islandRenderState(s1, [])).toBe('visible');
    expect(islandRenderState(s2, [])).toBe('discovered');
    expect(islandRenderState(s3, [])).toBe('unknown');
  });

  it('treats the vision-ellipse boundary as inclusive', () => {
    // Source (14, 14) → vision semi-axis 64 on the major axis. (64, 0) sits
    // exactly on the ellipse boundary → 64²/64² + 0 = 1 ≤ 1 → visible.
    const s = makeSpec({ populated: false, discovered: true, cx: 64, cy: 0 });
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('uses asymmetric semi-axes for oval (Coast-like) sources — major-axis boundary visible', () => {
    // Coast-like (14, 7) source at origin → vision ellipse semi-axes (64, 57).
    // Test point on the major axis at the boundary: (64, 0) → 1.0 ≤ 1 → visible.
    const ovalSources: ReadonlyArray<
      Pick<IslandSpec, 'cx' | 'cy' | 'majorRadius' | 'minorRadius'>
    > = [{ cx: 0, cy: 0, majorRadius: 14, minorRadius: 7 }];
    const onMajorBoundary = makeSpec({
      populated: false,
      discovered: true,
      cx: 64,
      cy: 0,
    });
    expect(islandRenderState(onMajorBoundary, ovalSources)).toBe('visible');
  });

  it('uses asymmetric semi-axes for oval (Coast-like) sources — minor-axis boundary visible, just outside discovered', () => {
    // Same (14, 7) source → vision (64, 57). Test point on minor axis at
    // boundary: (0, 57) → 57²/57² = 1 → visible. Test point just past it,
    // (0, 60): 60²/57² ≈ 1.108 > 1 → outside vision; with `discovered: true`
    // that classifies as 'discovered'.
    const ovalSources: ReadonlyArray<
      Pick<IslandSpec, 'cx' | 'cy' | 'majorRadius' | 'minorRadius'>
    > = [{ cx: 0, cy: 0, majorRadius: 14, minorRadius: 7 }];
    const onMinorBoundary = makeSpec({
      populated: false,
      discovered: true,
      cx: 0,
      cy: 57,
    });
    const justOutsideMinor = makeSpec({
      populated: false,
      discovered: true,
      cx: 0,
      cy: 60,
    });
    expect(islandRenderState(onMinorBoundary, ovalSources)).toBe('visible');
    expect(islandRenderState(justOutsideMinor, ovalSources)).toBe('discovered');
    // Same point but never discovered → unknown short-circuits regardless of
    // ellipse geometry.
    const undiscovered = makeSpec({
      populated: false,
      discovered: false,
      cx: 0,
      cy: 60,
    });
    expect(islandRenderState(undiscovered, ovalSources)).toBe('unknown');
  });

  it('exposes VISION_PADDING_TILES at the canonical value', () => {
    // Locked-in spec constant: 50 tiles past the island's own ellipse edge.
    // Test asserts the value so a future refactor that re-tunes it has to
    // update this test consciously rather than letting a silent drift land.
    expect(VISION_PADDING_TILES).toBe(50);
  });

  it('matches the demo layout: home visible, forest-ne visible, desert-far discovered, coast-unknown unknown', () => {
    const populated = DEMO_ISLANDS.filter((s) => s.populated);
    const byId = new Map(DEMO_ISLANDS.map((s) => [s.id, s] as const));
    const get = (id: string): IslandSpec => {
      const s = byId.get(id);
      if (!s) throw new Error(`demo missing ${id}`);
      return s;
    };
    // home (14,14) Plains at origin → vision (64,64) circle.
    // forest-ne (40,-10) → 40²/64² + 10²/64² ≈ 0.42 → visible.
    // desert-far (80,60) → 80²/64² + 60²/64² ≈ 2.44 → discovered.
    // coast-unknown (180,0) → discovered=false → unknown short-circuit.
    expect(islandRenderState(get('home'), populated)).toBe('visible');
    expect(islandRenderState(get('forest-ne'), populated)).toBe('visible');
    expect(islandRenderState(get('desert-far'), populated)).toBe('discovered');
    expect(islandRenderState(get('coast-unknown'), populated)).toBe('unknown');
  });
});

describe('findPopulatedIslandAt', () => {
  // Hand-built fixture mirroring a tiny slice of the demo layout: home at
  // origin (r=14), forest-ne at (40, -10) (r=10), desert-far at (80, 60)
  // (r=12, unpopulated/discovered). Active-island selection ignores
  // discovered-but-not-populated islands; only populated count.
  const fixture: IslandSpec[] = [
    {
      id: 'home',
      biome: 'plains',
      cx: 0,
      cy: 0,
      majorRadius: 14,
      minorRadius: 14,
      populated: true,
      discovered: true,
      buildings: [],
      modifiers: [],
    },
    {
      id: 'forest-ne',
      biome: 'forest',
      cx: 40,
      cy: -10,
      majorRadius: 10,
      minorRadius: 10,
      populated: true,
      discovered: true,
      buildings: [],
      modifiers: [],
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
      modifiers: [],
    },
  ];

  it('returns the populated island whose ellipse covers the click point', () => {
    const r = findPopulatedIslandAt(0, 0, fixture);
    expect(r?.id).toBe('home');
  });

  it('matches an off-centre but inscribed click', () => {
    // (40, -10) is forest-ne's centre; (43, -8) is well inside its r=10 disk.
    const r = findPopulatedIslandAt(43, -8, fixture);
    expect(r?.id).toBe('forest-ne');
  });

  it('returns null on open ocean (no island covers the point)', () => {
    const r = findPopulatedIslandAt(200, 200, fixture);
    expect(r).toBeNull();
  });

  it('returns null when the click lands on an unpopulated (but discovered) island', () => {
    // desert-far is discovered but not populated — should be ignored.
    const r = findPopulatedIslandAt(80, 60, fixture);
    expect(r).toBeNull();
  });

  it('rejects a click just outside the ellipse boundary', () => {
    // home has r=14; (15, 0) is one tile outside.
    const r = findPopulatedIslandAt(15, 0, fixture);
    expect(r).toBeNull();
  });

  it('accepts a click on the ellipse boundary (<= 1)', () => {
    // (14, 0) lies exactly on the r=14 ellipse — boundary is inclusive.
    const r = findPopulatedIslandAt(14, 0, fixture);
    expect(r?.id).toBe('home');
  });
});
