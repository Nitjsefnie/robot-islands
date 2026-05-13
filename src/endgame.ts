// §13.4 Endgame goals and victory detection.
//
// Pure layer — no PixiJS, no DOM. Leaf consumer of world/economy types.

import type { WorldState } from './world.js';

export type VictoryCondition =
  | 'genesis_cell_crafted'
  | 'omniscient_lattice_active'
  | 'ascendant_core_crafted';

export interface EndgameState {
  /** Conditions achieved so far. */
  achieved: Set<VictoryCondition>;
  /** Timestamp of first achievement (for save-display). */
  firstAchievedMs: number | null;
  /** Displayed to player. */
  victoryBannerShown: boolean;
}

export function makeInitialEndgameState(): EndgameState {
  return {
    achieved: new Set(),
    firstAchievedMs: null,
    victoryBannerShown: false,
  };
}

export function checkVictory(world: WorldState, nowMs: number): VictoryCondition[] {
  const newly: VictoryCondition[] = [];
  const state = world.endgameState;
  if (!state) return newly;

  const islandStates = world.islandStates ? [...world.islandStates.values()] : [];

  // Genesis Cell: any island has crafted one
  if (!state.achieved.has('genesis_cell_crafted')) {
    const crafted = islandStates.some((s) => (s.inventory.genesis_cell ?? 0) > 0);
    if (crafted) newly.push('genesis_cell_crafted');
  }

  // Omniscient Lattice: latticeActive flag
  if (!state.achieved.has('omniscient_lattice_active')) {
    if (world.latticeActive) newly.push('omniscient_lattice_active');
  }

  // Ascendant Core: any island has crafted one
  if (!state.achieved.has('ascendant_core_crafted')) {
    const crafted = islandStates.some((s) => (s.inventory.ascendant_core ?? 0) > 0);
    if (crafted) newly.push('ascendant_core_crafted');
  }

  for (const cond of newly) {
    state.achieved.add(cond);
  }
  if (newly.length > 0 && state.firstAchievedMs === null) {
    state.firstAchievedMs = nowMs;
  }
  return newly;
}
