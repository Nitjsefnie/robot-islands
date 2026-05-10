// DOM HUD overlay for the live island economy state.
//
// Plain DOM, no framework — matches the styling vocabulary of the existing
// `#info` strip (top-left) and `#ui-overlay` button panel (top-right). The
// HUD sits bottom-right so it doesn't fight either of those for screen
// real estate.
//
// `mountHud` creates and returns the panel + an `update` callback. The
// PixiJS ticker calls `update(state, rates)` once per frame after
// `advanceIsland`; the callback rewrites the panel's textContent. We use
// textContent (not innerHTML) to keep the update fast and avoid any HTML
// parsing per frame — for a 5-line monospace block this is plenty.
//
// Why DOM rather than PixiJS Text: the HUD updates every frame with
// changing strings, and the surrounding game UI (button panel) is already
// DOM. Mixing renderers for a static text overlay adds complexity without
// payoff. DOM text rendering is also crisper at any zoom level than PixiJS
// Text (which would need to be drawn at a fixed device pixel ratio).

import { type IslandState, xpForLevel } from './economy.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';

/**
 * Mounts a fixed-position panel and returns an `update` function. Calling
 * `update(state, rates)` rewrites the panel's contents to match the given
 * state. The `rates` argument carries per-resource net production rate
 * (units/sec) and is rendered alongside each inventory line for at-a-glance
 * "what's flowing" visibility.
 */
export interface HudHandle {
  readonly el: HTMLDivElement;
  update(state: IslandState, net: Record<ResourceId, number>): void;
}

export function mountHud(parentEl: HTMLElement): HudHandle {
  const panel = document.createElement('div');
  panel.id = 'hud-economy';
  panel.style.cssText = [
    'position: fixed',
    'bottom: 8px',
    'right: 8px',
    'min-width: 220px',
    'padding: 8px 10px',
    'background: rgba(20, 24, 32, 0.78)',
    'border: 1px solid #3a4452',
    'border-radius: 4px',
    'color: #cdd6f4',
    'font-family: ui-monospace, monospace',
    'font-size: 12px',
    'line-height: 1.5',
    'z-index: 100',
    'pointer-events: none',
    'white-space: pre',
    // Tabular numerals so digits line up in inventory rows.
    'font-variant-numeric: tabular-nums',
  ].join(';');
  parentEl.appendChild(panel);

  /** Format a number for the HUD. Integers shown without decimal; otherwise
   *  one decimal place. The economy uses fractional inventories internally
   *  (rate × dt) so we round for display. */
  const fmt = (n: number): string => {
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(1);
  };

  /** Format a rate with sign and one decimal — small numbers around 0.1
   *  are typical for this tier. */
  const fmtRate = (n: number): string => {
    if (n === 0) return '   .   ';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}/s`;
  };

  function update(state: IslandState, net: Record<ResourceId, number>): void {
    const need = xpForLevel(state.level + 1);
    const lines: string[] = [];
    lines.push(`Home Island`);
    lines.push(`Level ${state.level}   XP ${fmt(state.xp)} / ${fmt(need)}`);
    lines.push(`Skill points: ${state.unspentSkillPoints}`);
    lines.push(``);
    lines.push(`Inventory`);
    for (const r of ALL_RESOURCES) {
      const have = state.inventory[r] ?? 0;
      const cap = state.storageCaps[r] ?? 0;
      const rate = net[r] ?? 0;
      // Right-align the resource name in a 10-char column for readability.
      const name = (r + ':').padEnd(11, ' ');
      const have5 = fmt(have).padStart(5, ' ');
      const cap5 = fmt(cap).padStart(5, ' ');
      lines.push(`  ${name}${have5} / ${cap5}  ${fmtRate(rate)}`);
    }
    panel.textContent = lines.join('\n');
  }

  return { el: panel, update };
}
