// Island render-state classification: pure-logic tests for the three-state
// vision model (visible / discovered / unknown).

import { describe, expect, it } from 'vitest';

import { computeVisionSources, type VisionSource } from './lighthouse.js';
import {
  DEMO_ISLANDS,
  findPopulatedIslandAt,
  islandRenderState,
  ISLAND_NAME_MAX_LEN,
  renameIsland,
  VISION_PADDING_TILES,
  type IslandSpec,
} from './world.js';

function makeSpec(over: Partial<IslandSpec>): IslandSpec {
  return {
    id: 'test',
    name: 'test',
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

/** Helper: build the VisionSource[] for a single populated source spec.
 *  Mirrors what `main.ts` does each frame — convenient for `islandRenderState`
 *  callers that want to assert against a known fixture without rebuilding the
 *  full demo layout. */
function sourcesFor(specs: ReadonlyArray<IslandSpec>): VisionSource[] {
  return computeVisionSources(specs);
}

describe('islandRenderState', () => {
  // Plains-like source (14, 14) at origin. Padding 10 → baseline ellipse
  // (24, 24). Lighthouse-vision redesign: this is now small enough that
  // forest-ne (40, -10) classifies as `discovered` without a Lighthouse.
  const sourceSpec = makeSpec({
    id: 'src',
    cx: 0,
    cy: 0,
    majorRadius: 14,
    minorRadius: 14,
    populated: true,
    discovered: true,
  });
  const sources: ReadonlyArray<VisionSource> = sourcesFor([sourceSpec]);

  it('classifies a populated island as visible (regardless of `discovered`)', () => {
    const s = makeSpec({ populated: true, discovered: false, cx: 200, cy: 200 });
    // Even far away from any source, populated implies visible — populated
    // islands ARE the vision sources, so they're trivially in vision of self.
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('classifies a discovered island inside the baseline ellipse as visible', () => {
    // A point at (10, 10) against a (14,14) source → baseline (24, 24).
    // 10²/24² + 10²/24² ≈ 0.347 ≤ 1 → visible.
    const s = makeSpec({ populated: false, discovered: true, cx: 10, cy: 10 });
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('classifies a discovered island outside vision ellipse as discovered', () => {
    // forest-ne-ish: (40, -10). 40²/24² + 10²/24² ≈ 2.95 > 1 → discovered.
    const s = makeSpec({ populated: false, discovered: true, cx: 40, cy: -10 });
    expect(islandRenderState(s, sources)).toBe('discovered');
  });

  it('classifies an undiscovered island as unknown', () => {
    const s = makeSpec({ populated: false, discovered: false, cx: 10, cy: 10 });
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
    // Source (14, 14) → vision semi-axis 24 on the major axis. (24, 0) sits
    // exactly on the ellipse boundary → 24²/24² + 0 = 1 ≤ 1 → visible.
    const s = makeSpec({ populated: false, discovered: true, cx: 24, cy: 0 });
    expect(islandRenderState(s, sources)).toBe('visible');
  });

  it('uses asymmetric semi-axes for oval (Coast-like) sources — major-axis boundary visible', () => {
    // Coast-like (14, 7) source at origin → vision ellipse semi-axes (24, 17).
    // Test point on the major axis at the boundary: (24, 0) → 1.0 ≤ 1 → visible.
    const ovalSrc = makeSpec({
      id: 'oval',
      cx: 0,
      cy: 0,
      majorRadius: 14,
      minorRadius: 7,
      populated: true,
      discovered: true,
    });
    const ovalSources = sourcesFor([ovalSrc]);
    const onMajorBoundary = makeSpec({
      populated: false,
      discovered: true,
      cx: 24,
      cy: 0,
    });
    expect(islandRenderState(onMajorBoundary, ovalSources)).toBe('visible');
  });

  it('uses asymmetric semi-axes for oval (Coast-like) sources — minor-axis boundary visible, just outside discovered', () => {
    // Same (14, 7) source → vision (24, 17). Test point on minor axis at
    // boundary: (0, 17) → 17²/17² = 1 → visible. Test point just past it,
    // (0, 20): 20²/17² ≈ 1.384 > 1 → outside vision; with `discovered: true`
    // that classifies as 'discovered'.
    const ovalSrc = makeSpec({
      id: 'oval',
      cx: 0,
      cy: 0,
      majorRadius: 14,
      minorRadius: 7,
      populated: true,
      discovered: true,
    });
    const ovalSources = sourcesFor([ovalSrc]);
    const onMinorBoundary = makeSpec({
      populated: false,
      discovered: true,
      cx: 0,
      cy: 17,
    });
    const justOutsideMinor = makeSpec({
      populated: false,
      discovered: true,
      cx: 0,
      cy: 20,
    });
    expect(islandRenderState(onMinorBoundary, ovalSources)).toBe('visible');
    expect(islandRenderState(justOutsideMinor, ovalSources)).toBe('discovered');
    // Same point but never discovered → unknown short-circuits regardless of
    // ellipse geometry.
    const undiscovered = makeSpec({
      populated: false,
      discovered: false,
      cx: 0,
      cy: 20,
    });
    expect(islandRenderState(undiscovered, ovalSources)).toBe('unknown');
  });

  it('exposes VISION_PADDING_TILES at the canonical value', () => {
    // Locked-in Lighthouse-vision constant: 10 tiles past the island's own
    // ellipse edge for the baseline halo. Distant scouting requires
    // Lighthouse infrastructure. Test asserts the value so a future
    // refactor that re-tunes it has to update this test consciously rather
    // than letting a silent drift land.
    expect(VISION_PADDING_TILES).toBe(10);
  });

  it('matches the demo layout: home visible, forest-ne visible (populated), desert-far discovered, coast-unknown unknown', () => {
    const populated = DEMO_ISLANDS.filter((s) => s.populated);
    const visionSources = computeVisionSources(populated);
    const byId = new Map(DEMO_ISLANDS.map((s) => [s.id, s] as const));
    const get = (id: string): IslandSpec => {
      const s = byId.get(id);
      if (!s) throw new Error(`demo missing ${id}`);
      return s;
    };
    // home (14,14) Plains at origin → baseline (24,24) ellipse.
    // forest-ne is hardcoded populated → 'visible' via the populated
    //   short-circuit, regardless of distance to home.
    // desert-far (80,60) → outside both home's (24,24) AND forest-ne's
    //   (20,20) baselines, but discovered → 'discovered'.
    // coast-unknown (180,0) → discovered=false → 'unknown'.
    expect(islandRenderState(get('home'), visionSources)).toBe('visible');
    expect(islandRenderState(get('forest-ne'), visionSources)).toBe('visible');
    expect(islandRenderState(get('desert-far'), visionSources)).toBe('discovered');
    expect(islandRenderState(get('coast-unknown'), visionSources)).toBe('unknown');
  });

  it('Lighthouse extends vision: a T2 Lighthouse on the source covers an island ~41 tiles away', () => {
    // Forest-ne-style fixture: at (40, -10), 41.2 tiles from home. Without
    // a Lighthouse this sits well outside home's (24, 24) baseline (2.95
    // ratio) → 'discovered'. With a `lighthouse_t2` on home at (0, 0)
    // local → 80-tile circle centred at (0.5, 0.5) → 41.2 < 80 → 'visible'.
    const homeWithLighthouse = makeSpec({
      id: 'home',
      cx: 0,
      cy: 0,
      majorRadius: 14,
      minorRadius: 14,
      populated: true,
      discovered: true,
      buildings: [{ id: 'lh-2', defId: 'lighthouse_t2', x: 0, y: 0 }],
    });
    const sourcesWithLh = computeVisionSources([homeWithLighthouse]);
    const target = makeSpec({
      populated: false,
      discovered: true,
      cx: 40,
      cy: -10,
    });
    expect(islandRenderState(target, sourcesWithLh)).toBe('visible');
    // Sanity: the same target without the Lighthouse classifies as
    // 'discovered' under the new 10-tile baseline.
    const sourcesBaselineOnly = computeVisionSources([
      { ...homeWithLighthouse, buildings: [] },
    ]);
    expect(islandRenderState(target, sourcesBaselineOnly)).toBe('discovered');
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
      name: 'home',
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
      name: 'forest-ne',
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
      name: 'desert-far',
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

// ---------------------------------------------------------------------------
// renameIsland — pure validation + mutation for the player-mutable display
// name. The internal `id` must never change; only `name` is touched.
// ---------------------------------------------------------------------------

describe('renameIsland', () => {
  it('accepts a normal 1-32 char name and mutates spec.name', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const r = renameIsland(s, 'My Cozy Outpost');
    expect(r.ok).toBe(true);
    expect(s.name).toBe('My Cozy Outpost');
    // Internal id must be untouched.
    expect(s.id).toBe('home');
  });

  it('trims surrounding whitespace before applying', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const r = renameIsland(s, '   The Forge   ');
    expect(r.ok).toBe(true);
    expect(s.name).toBe('The Forge');
  });

  it('rejects an empty name (and does not mutate)', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const r = renameIsland(s, '');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
    expect(s.name).toBe('home');
  });

  it('rejects a whitespace-only name as empty (and does not mutate)', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const r = renameIsland(s, '   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
    expect(s.name).toBe('home');
  });

  it('accepts a name at the 32-char boundary', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const exactly32 = 'a'.repeat(ISLAND_NAME_MAX_LEN);
    expect(exactly32.length).toBe(32);
    const r = renameIsland(s, exactly32);
    expect(r.ok).toBe(true);
    expect(s.name).toBe(exactly32);
  });

  it('rejects a 33-char name (one over the cap)', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    const tooLong = 'a'.repeat(ISLAND_NAME_MAX_LEN + 1);
    const r = renameIsland(s, tooLong);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-long');
    expect(s.name).toBe('home');
  });

  it('rejects names containing ascii control characters', () => {
    const s = makeSpec({ id: 'home', name: 'home' });
    // Tab character (0x09) sits inside the control-char range \x00-\x1F.
    const r = renameIsland(s, 'New\tName');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('control-char');
    expect(s.name).toBe('home');
    // Newline / DEL likewise rejected.
    expect(renameIsland(s, 'Line\nBreak').ok).toBe(false);
    expect(renameIsland(s, 'Bell\x07Char').ok).toBe(false);
    expect(renameIsland(s, 'Del\x7FChar').ok).toBe(false);
  });
});
