// DOM HUD overlay for the live island economy state.
//
// Plain DOM, no framework — matches the styling vocabulary of the existing
// `#info` strip (top-left) and `#ui-overlay` button panel (top-right). The
// HUD sits bottom-right so it doesn't fight either of those for screen
// real estate.
//
// `mountHud` creates and returns the panel + an `update` callback. The
// PixiJS ticker calls `update(state, net, power)` once per frame after
// `advanceIsland`. To support a per-frame colour change on the brownout
// factor without HTML reparse cost, the panel holds a stable three-node
// tree: text-node + span + text-node. Each frame writes only the three
// textContents and a single inline-style colour. This is faster than
// rebuilding innerHTML and avoids any node churn for a monospace block.
//
// Why DOM rather than PixiJS Text: the HUD updates every frame with
// changing strings, and the surrounding game UI (button panel) is already
// DOM. Mixing renderers for a static text overlay adds complexity without
// payoff. DOM text rendering is also crisper at any zoom level than PixiJS
// Text (which would need to be drawn at a fixed device pixel ratio).

import { BIOME_DEFS, MODIFIER_DEFS, type ModifierId } from './biomes.js';
import { cap, type IslandState, type PowerBalance, xpForLevel } from './economy.js';
import type { NetworkConsciousnessState } from './network-consciousness.js';
import { ALL_RESOURCES, type ResourceId } from './recipes.js';
import { tierForLevel, type Tier } from './skilltree.js';
import type { IslandSpec } from './world.js';

/**
 * Mounts a fixed-position panel and returns an `update` function. Calling
 * `update(state, net, power)` rewrites the panel's contents to match the
 * given state. The `net` argument carries per-resource net production rate
 * (units/sec), rendered alongside each inventory line. The `power` argument
 * carries the §5.1 electrical balance, rendered as its own line group above
 * Inventory; the `factor` field colour-codes brownout severity.
 */
export interface HudHandle {
  readonly el: HTMLDivElement;
  /** Per-frame refresh. `saveAgeSec` is the integer seconds since the last
   *  successful save (`null` if no save has happened yet this session — the
   *  "Saved" indicator falls back to a placeholder). The wider HUD update
   *  surface comprises every field below; lastSaveAt threading is the only
   *  step-14 polish addition. */
  update(
    state: IslandState,
    net: Record<ResourceId, number>,
    power: PowerBalance,
    spec: IslandSpec,
    ncState: NetworkConsciousnessState,
    saveAgeSec: number | null,
  ): void;
}

// Brownout severity palette. Ramp from neutral text colour through warm
// amber to alert orange-red. Three tiers map to a glanceable engineering
// readout: nominal / marginal / critical.
const POWER_COLOR_NOMINAL = '#cdd6f4'; // factor === 1, matches default text
const POWER_COLOR_MARGINAL = '#f5a742'; // 0.5 ≤ factor < 1, warm amber
const POWER_COLOR_CRITICAL = '#e85d4a'; // factor < 0.5, alert orange-red

function powerColor(factor: number): string {
  if (factor >= 1) return POWER_COLOR_NOMINAL;
  if (factor >= 0.5) return POWER_COLOR_MARGINAL;
  return POWER_COLOR_CRITICAL;
}

// Tier-breakpoint thresholds, mirroring `tierForLevel` in skilltree.ts.
// Defined here as a lookup so the HUD can compute "N levels to next tier"
// without re-deriving from the function. Keys are CURRENT tier; value is
// the first level of the NEXT tier. T5 has no "next" — handled inline.
const NEXT_TIER_LEVEL: Readonly<Record<Tier, number>> = {
  1: 5,
  2: 15,
  3: 30,
  4: 50,
  5: Number.POSITIVE_INFINITY,
  6: Number.POSITIVE_INFINITY,
};

// Tier badge colour palette per the frontend-design pass. ACCENT cyan when
// the player has comfortable headroom; WARN amber when within 2 levels of
// the next breakpoint (urgency cue); FG_DIM at T5 ceiling. The chip uses
// border + text in the same colour ("currentColor" in the inline style).
const TIER_BADGE_ACCENT = '#7dd3e8';
const TIER_BADGE_WARN = '#f5a742';
const TIER_BADGE_MUTED = '#6c7791';

function tierBadgeColor(level: number, tier: Tier): string {
  if (tier >= 5) return TIER_BADGE_MUTED;
  const next = NEXT_TIER_LEVEL[tier];
  if (next - level <= 2) return TIER_BADGE_WARN;
  return TIER_BADGE_ACCENT;
}

// Modifier chip palette. Tied to ModifierDef.category in `biomes.ts`. Each
// category gets a (text, background-wash, border) triple — the wash is a
// 10%-alpha tint over the panel background, the border a 40%-alpha pick of
// the same hue. Stable lands in the muted-neutral bucket because every
// fresh game starts with it; loud styling there would create constant noise.
const CHIP_PALETTE: Readonly<Record<
  'positive' | 'warning' | 'exotic' | 'neutral',
  { readonly fg: string; readonly bg: string; readonly border: string }
>> = {
  positive: {
    fg: '#7dd3a0',
    bg: 'rgba(125, 211, 160, 0.10)',
    border: 'rgba(125, 211, 160, 0.40)',
  },
  warning: {
    fg: '#f5a742',
    bg: 'rgba(245, 167, 66, 0.10)',
    border: 'rgba(245, 167, 66, 0.40)',
  },
  exotic: {
    fg: '#b48cd8',
    bg: 'rgba(180, 140, 216, 0.10)',
    border: 'rgba(180, 140, 216, 0.40)',
  },
  neutral: {
    fg: '#7a8294',
    bg: 'transparent',
    border: 'rgba(122, 130, 148, 0.30)',
  },
};

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

  // Stable DOM layout — three logical sections, each kept rebuild-free at
  // tick time:
  //   1. headerBlock: "Home Island" line + "Level N [Tier badge] · N to TX"
  //      line + "Skill points: N" line. The tier badge is a structured chip
  //      inline with the Level number (one glance answers both questions).
  //   2. siteProfile: a mini-section with the biome line and a flex chip
  //      row. The chips themselves are recreated only when the modifier
  //      list signature changes (cached via a join-key on the prior set).
  //   3. powerNode + factorSpan + tailNode: existing power + inventory block.

  const headerBlock = document.createElement('div');
  headerBlock.style.cssText = [
    'display: flex',
    'flex-direction: column',
    'gap: 1px',
  ].join(';');
  const titleNode = document.createTextNode('');
  const titleLine = document.createElement('div');
  titleLine.appendChild(titleNode);
  headerBlock.appendChild(titleLine);

  // Level + tier line — keeps Level number on the left, tier chip and
  // "N to TX" remainder inline so the row is glanceable.
  const levelLine = document.createElement('div');
  levelLine.style.cssText = [
    'display: flex',
    'align-items: baseline',
    'flex-wrap: wrap',
    'gap: 6px',
  ].join(';');
  const levelText = document.createElement('span');
  const tierBadge = document.createElement('span');
  // Tier badge is a tight letter-spaced caps chip — matches the
  // skill-tree panel's "TIER" stat block typography for cross-panel
  // continuity. Colour swaps each refresh based on proximity to next tier.
  tierBadge.style.cssText = [
    'display: inline-block',
    'padding: 1px 5px',
    'font-size: 10px',
    'letter-spacing: 0.10em',
    'font-weight: 600',
    'border-radius: 2px',
    'border: 1px solid currentColor',
    'line-height: 1.3',
  ].join(';');
  const tierRemainder = document.createElement('span');
  tierRemainder.style.cssText = [
    'color: #7a8294',
    'font-size: 10.5px',
    'letter-spacing: 0.04em',
    'text-transform: uppercase',
  ].join(';');
  levelLine.appendChild(levelText);
  levelLine.appendChild(tierBadge);
  levelLine.appendChild(tierRemainder);
  headerBlock.appendChild(levelLine);

  const pointsNode = document.createTextNode('');
  const pointsLine = document.createElement('div');
  pointsLine.appendChild(pointsNode);
  headerBlock.appendChild(pointsLine);

  panel.appendChild(headerBlock);

  // Site profile — biome line + modifier chip row. Sits as its own block so
  // the chip flex-row doesn't break the monospace alignment of the inventory
  // block below. A thin top/bottom border separates it visually from the
  // header above and the power+inventory block below — matches the panel's
  // existing engineering-readout vibe (cf. the brownout factor colour-band).
  const siteProfile = document.createElement('div');
  siteProfile.style.cssText = [
    'margin: 4px 0',
    'padding: 4px 0',
    'border-top: 1px solid rgba(58, 68, 82, 0.6)',
    'border-bottom: 1px solid rgba(58, 68, 82, 0.6)',
    'display: flex',
    'flex-direction: column',
    'gap: 3px',
  ].join(';');

  // Biome line: label "Site" left, biome display name right, mimicking
  // the column layout the rest of the panel uses ("Power", "Inventory").
  const biomeLine = document.createElement('div');
  biomeLine.style.cssText = [
    'display: flex',
    'justify-content: space-between',
    'align-items: baseline',
    'gap: 8px',
  ].join(';');
  const biomeLabel = document.createElement('span');
  biomeLabel.textContent = 'Site';
  biomeLabel.style.cssText = [
    'color: #7a8294',
    'letter-spacing: 0.06em',
    'text-transform: uppercase',
    'font-size: 10px',
  ].join(';');
  const biomeValue = document.createElement('span');
  biomeValue.style.cssText = ['color: #cdd6f4', 'font-weight: 600'].join(';');
  biomeLine.appendChild(biomeLabel);
  biomeLine.appendChild(biomeValue);
  siteProfile.appendChild(biomeLine);

  // Chip row container.
  const chipRow = document.createElement('div');
  chipRow.style.cssText = [
    'display: flex',
    'flex-wrap: wrap',
    'gap: 4px',
    'align-items: center',
    'min-height: 16px', // keeps the row from collapsing when empty
  ].join(';');
  siteProfile.appendChild(chipRow);
  panel.appendChild(siteProfile);

  // Power + inventory block — preNode/factorSpan/postNode mirrors the
  // pre-step-8 layout so the per-frame update remains a small fixed number
  // of textContent writes.
  const powerNode = document.createTextNode('');
  const factorSpan = document.createElement('span');
  factorSpan.style.fontWeight = '600';
  const powerTailNode = document.createTextNode('\n');
  panel.appendChild(powerNode);
  panel.appendChild(factorSpan);
  panel.appendChild(powerTailNode);

  // Network Consciousness line (§9.6). Sits between the Power line and the
  // Inventory block. Label uses the same FG_DIM/uppercase letter-spaced
  // typography as the Site row; value carries the active milestone summary
  // or an em-dash when no T3+ islands exist yet. The line lives in a flex
  // row so the value can right-align cleanly without monospace padding.
  const networkLine = document.createElement('div');
  networkLine.style.cssText = [
    'display: flex',
    'justify-content: space-between',
    'align-items: baseline',
    'gap: 8px',
    'padding-top: 1px',
  ].join(';');
  const networkLabel = document.createElement('span');
  networkLabel.textContent = 'Network';
  networkLabel.style.cssText = [
    'color: #7a8294',
    'letter-spacing: 0.06em',
    'text-transform: uppercase',
    'font-size: 10px',
  ].join(';');
  const networkValue = document.createElement('span');
  networkValue.style.cssText = [
    'font-size: 11px',
    'font-weight: 600',
    'font-variant-numeric: tabular-nums',
  ].join(';');
  networkLine.appendChild(networkLabel);
  networkLine.appendChild(networkValue);
  panel.appendChild(networkLine);

  // Save indicator (§15.6 persistence). One-line "Saved · Ns ago" status,
  // in FG_DIM grey so it sits under the other engineering readouts without
  // competing for attention. The string is rebuilt once per frame from the
  // integer seconds-since-last-save the ticker threads in. "just now" for
  // anything below 2s.
  const savedLine = document.createElement('div');
  savedLine.style.cssText = [
    'display: flex',
    'justify-content: space-between',
    'align-items: baseline',
    'gap: 8px',
    'padding-top: 1px',
    'color: #6c7791', // FG_DIM
    'font-size: 10.5px',
    'letter-spacing: 0.04em',
    'text-transform: uppercase',
  ].join(';');
  const savedLabel = document.createElement('span');
  savedLabel.textContent = 'Saved';
  const savedValue = document.createElement('span');
  savedValue.style.cssText = ['font-variant-numeric: tabular-nums'].join(';');
  savedLine.appendChild(savedLabel);
  savedLine.appendChild(savedValue);
  panel.appendChild(savedLine);

  const postNode = document.createTextNode('');
  panel.appendChild(postNode);

  /** Last-rendered modifier signature — used to skip chip rebuild when the
   *  set is unchanged. The signature is just the comma-joined ids; cheap
   *  to compute and zero false-positives. */
  let lastModifiersKey = '';
  /** Last-rendered biome id — same skip logic. */
  let lastBiome = '';

  function buildChip(id: ModifierId): HTMLSpanElement {
    const def = MODIFIER_DEFS[id];
    const palette = CHIP_PALETTE[def.category];
    const chip = document.createElement('span');
    chip.textContent = def.displayName;
    chip.title = def.description + (def.placeholder ? ' (placeholder — system pending)' : '');
    chip.style.cssText = [
      'display: inline-block',
      'padding: 1px 6px',
      `color: ${palette.fg}`,
      `background: ${palette.bg}`,
      `border: 1px solid ${palette.border}`,
      'border-radius: 3px',
      'font-size: 10px',
      'letter-spacing: 0.05em',
      'text-transform: uppercase',
      'line-height: 1.4',
      // Placeholder modifiers get a dashed border to flag "this exists in
      // the catalog but doesn't affect the economy yet". Subtle enough not
      // to overwhelm the active-modifier signal but visible on close read.
      def.placeholder ? 'border-style: dashed' : '',
    ].filter(Boolean).join(';');
    return chip;
  }

  /** Rebuild the chip row. Called when `lastModifiersKey` changes. Empty
   *  modifier list shows an em-dash placeholder so the layout stays stable
   *  between "no modifiers" and "1+ modifiers" states. */
  function renderChipRow(modifiers: ReadonlyArray<ModifierId>): void {
    while (chipRow.firstChild) chipRow.removeChild(chipRow.firstChild);
    if (modifiers.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = '—';
      empty.style.cssText = [
        'color: #4d5566',
        'font-size: 11px',
        'letter-spacing: 0.1em',
      ].join(';');
      chipRow.appendChild(empty);
      return;
    }
    for (const id of modifiers) chipRow.appendChild(buildChip(id));
  }

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

  function update(
    state: IslandState,
    net: Record<ResourceId, number>,
    power: PowerBalance,
    spec: IslandSpec,
    ncState: NetworkConsciousnessState,
    saveAgeSec: number | null,
  ): void {
    const need = xpForLevel(state.level + 1);
    titleNode.textContent = 'Home Island';
    levelText.textContent = `Level ${state.level}   XP ${fmt(state.xp)} / ${fmt(need)}`;
    levelText.style.color = '#cdd6f4';

    // Tier indicator: inline chip + "N levels to TX" remainder. Chip
    // colour is amber (WARN) when within 2 levels of the next breakpoint
    // (urgency cue), cyan (ACCENT) mid-tier, muted at the T5 ceiling.
    const tier = tierForLevel(state.level);
    tierBadge.textContent = `T${tier}`;
    const palette = tierBadgeColor(state.level, tier);
    tierBadge.style.color = palette;
    if (tier >= 5) {
      tierRemainder.textContent = '· MAX TIER';
    } else {
      const nextTierLevel = NEXT_TIER_LEVEL[tier];
      const gap = nextTierLevel - state.level;
      tierRemainder.textContent = `· ${gap} to T${tier + 1}`;
    }
    pointsNode.textContent = `Skill points: ${state.unspentSkillPoints}`;

    // Site profile — biome name + chip row. Skip DOM writes when the
    // payload is identical, since the chip row's DOM construction is the
    // most expensive piece of HUD per-frame work.
    if (spec.biome !== lastBiome) {
      biomeValue.textContent = BIOME_DEFS[spec.biome].displayName;
      lastBiome = spec.biome;
    }
    const modifiersKey = spec.modifiers.join(',');
    if (modifiersKey !== lastModifiersKey) {
      renderChipRow(spec.modifiers);
      lastModifiersKey = modifiersKey;
    }

    // Power line group. Format: `Power      <prod> / <con>  factor X.XX`.
    // Numbers right-padded so the columns don't jitter as production swings.
    const prodStr = fmt(power.produced).padStart(4, ' ');
    const conStr = fmt(power.consumed).padStart(4, ' ');
    const factorStr = power.factor.toFixed(2);
    powerNode.textContent = `Power      ${prodStr}W / ${conStr}W  factor `;

    factorSpan.textContent = factorStr;
    factorSpan.style.color = powerColor(power.factor);

    // Network Consciousness line. No T3+ islands → muted em-dash. Active
    // milestone → "{N} at T3+ · NC tier {milestone} · +X%" in ACCENT.
    // The buff percentage rounds to 0 places (1.05 → "+5%") — matches the
    // §9.6 placeholders exactly.
    if (ncState.tier3PlusCount === 0) {
      networkValue.textContent = '—';
      networkValue.style.color = '#4d5566';
    } else {
      const buffPct = Math.round((ncState.globalProductionBuff - 1) * 100);
      networkValue.textContent =
        `${ncState.tier3PlusCount} at T3+ · NC tier ${ncState.milestone} · +${buffPct}%`;
      networkValue.style.color = '#7dd3e8';
    }

    // Save-age indicator. Null when no save has happened yet this session
    // (cold restart with no prior data, the tab is still booting). Below
    // 2s shows "just now" so the just-saved moment doesn't flicker between
    // "0s ago" and "1s ago".
    if (saveAgeSec === null) {
      savedValue.textContent = '—';
    } else if (saveAgeSec < 2) {
      savedValue.textContent = 'just now';
    } else {
      savedValue.textContent = `${saveAgeSec}s ago`;
    }

    const tailLines: string[] = [];
    tailLines.push(``);
    tailLines.push(`Inventory`);
    for (const r of ALL_RESOURCES) {
      const have = state.inventory[r] ?? 0;
      // cap() applies storageCapMul from any unlocked skills; reading
      // state.storageCaps[r] directly would lie about the real cap.
      const capVal = cap(state, r);
      const rate = net[r] ?? 0;
      const name = (r + ':').padEnd(11, ' ');
      const have5 = fmt(have).padStart(5, ' ');
      const cap5 = fmt(capVal).padStart(5, ' ');
      tailLines.push(`  ${name}${have5} / ${cap5}  ${fmtRate(rate)}`);
    }
    postNode.textContent = '\n' + tailLines.join('\n');
  }

  return { el: panel, update };
}
