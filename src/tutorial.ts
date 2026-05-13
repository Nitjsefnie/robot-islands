import type { WorldState } from './world.js';

export type ObjectiveId =
  | 'place_solar'
  | 'place_mine'
  | 'place_workshop'
  | 'reach_level_5'
  | 'build_dronepad'
  | 'dispatch_first_drone'
  | 'settle_first_island'
  | 'build_antenna';

export interface TutorialState {
  completed: Set<ObjectiveId>;
  current: ObjectiveId | null;
}

export const OBJECTIVES: Record<ObjectiveId, { title: string; hint: string; check: (world: WorldState) => boolean }> = {
  place_solar: {
    title: 'Power Up',
    hint: 'Place a Solar Panel on any grass tile.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.buildings.some(b => b.defId === 'solar')),
  },
  place_mine: {
    title: 'Extract Resources',
    hint: 'Place a Mine on an ore vein.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.buildings.some(b => b.defId === 'mine')),
  },
  place_workshop: {
    title: 'Craft Materials',
    hint: 'Place a Workshop to craft iron ingots.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.buildings.some(b => b.defId === 'workshop')),
  },
  reach_level_5: {
    title: 'Grow',
    hint: 'Reach level 5 to unlock Tier 2.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.level >= 5),
  },
  build_dronepad: {
    title: 'Take Flight',
    hint: 'Build a Drone Pad to scout the world.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.buildings.some(b => b.defId === 'dronepad')),
  },
  dispatch_first_drone: {
    title: 'Explore',
    hint: 'Dispatch your first drone.',
    check: (w) => w.drones.length > 0,
  },
  settle_first_island: {
    title: 'Expand',
    hint: 'Send a ship to settle a new island.',
    check: (w) => w.islands.filter(i => i.populated).length >= 2,
  },
  build_antenna: {
    title: 'Stay Connected',
    hint: 'Build an Antenna so drones can transmit data.',
    check: (w) => Array.from(w.islandStates?.values() ?? []).some(s => s.buildings.some(b => b.defId.startsWith('antenna_'))),
  },
};

export function checkObjectives(state: TutorialState, world: WorldState): ObjectiveId[] {
  const newlyCompleted: ObjectiveId[] = [];
  for (const [id, obj] of Object.entries(OBJECTIVES)) {
    if (state.completed.has(id as ObjectiveId)) continue;
    if (obj.check(world)) {
      state.completed.add(id as ObjectiveId);
      newlyCompleted.push(id as ObjectiveId);
    }
  }
  const order = Object.keys(OBJECTIVES) as ObjectiveId[];
  state.current = order.find(id => !state.completed.has(id)) ?? null;
  return newlyCompleted;
}
