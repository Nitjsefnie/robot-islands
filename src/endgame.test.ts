import { describe, expect, it } from 'vitest';
import {
  checkVictory,
  makeInitialEndgameState,
  type VictoryCondition,
} from './endgame.js';
import { makeInitialIslandState, makeInitialWorld } from './world.js';

function makeTestWorld(): ReturnType<typeof makeInitialWorld> & {
  islandStates: NonNullable<ReturnType<typeof makeInitialWorld>['islandStates']>;
} {
  const world = makeInitialWorld(0);
  const map = new Map();
  for (const spec of world.islands) {
    map.set(spec.id, makeInitialIslandState(spec, 0));
  }
  (world as typeof world & { islandStates: typeof map }).islandStates = map;
  return world as typeof world & { islandStates: typeof map };
}

describe('endgame', () => {
  it('makeInitialEndgameState has empty achieved set', () => {
    const s = makeInitialEndgameState();
    expect(s.achieved.size).toBe(0);
    expect(s.firstAchievedMs).toBeNull();
    expect(s.victoryBannerShown).toBe(false);
  });

  it('detects ascendant core craft', () => {
    const world = makeTestWorld();
    world.islandStates.get('home')!.inventory.ascendant_core = 1;
    const newly = checkVictory(world, 0);
    expect(newly).toContain('ascendant_core_crafted');
  });

  it('detects genesis cell craft', () => {
    const world = makeTestWorld();
    world.islandStates.get('home')!.inventory.genesis_cell = 1;
    const newly = checkVictory(world, 0);
    expect(newly).toContain('genesis_cell_crafted');
  });

  it('detects lattice activation', () => {
    const world = makeTestWorld();
    world.latticeActive = true;
    const newly = checkVictory(world, 0);
    expect(newly).toContain('omniscient_lattice_active');
  });

  it('sets firstAchievedMs on first condition', () => {
    const world = makeTestWorld();
    world.latticeActive = true;
    checkVictory(world, 1234);
    expect(world.endgameState.firstAchievedMs).toBe(1234);
  });

  it('does not duplicate already-achieved conditions', () => {
    const world = makeTestWorld();
    world.latticeActive = true;
    checkVictory(world, 1000);
    const newly = checkVictory(world, 2000);
    expect(newly).not.toContain('omniscient_lattice_active');
    expect(world.endgameState.firstAchievedMs).toBe(1000);
  });

  it('returns empty array when nothing new', () => {
    const world = makeTestWorld();
    const newly = checkVictory(world, 0);
    expect(newly).toEqual([]);
  });

  it('handles missing islandStates gracefully', () => {
    const world = makeTestWorld();
    world.islandStates = undefined as unknown as typeof world.islandStates;
    const newly = checkVictory(world, 0);
    expect(newly).toEqual([]);
  });

  it('reports multiple new conditions in one call', () => {
    const world = makeTestWorld();
    world.islandStates.get('home')!.inventory.ascendant_core = 1;
    world.islandStates.get('home')!.inventory.genesis_cell = 1;
    const newly = checkVictory(world, 0);
    expect(new Set(newly)).toEqual(
      new Set<VictoryCondition>(['ascendant_core_crafted', 'genesis_cell_crafted']),
    );
  });
});
