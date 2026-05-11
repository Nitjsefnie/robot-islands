// Artificial-island Construction modal — DOM overlay per SPEC §2.5.
//
// Sister panel to buildings-ui.ts and skilltree-ui.ts: same centered modal
// shell, same letter-spaced ACCENT caps in the header, same FG_DIM
// secondary text, same engineering-readout vocabulary. The body is a
// small form: founder picker → biome picker → size sliders → position
// inputs → live cost readout → "Construct" CTA.
//
// Aesthetic guards:
//   - Founder rows / biome chips: lock state if eligibility fails. Locked
//     entries render at FG_MUTED, never illegibly grey-on-grey.
//   - Cost readout: each material shows current ÷ required; over-budget
//     materials switch to WARN amber, on-budget stays FG.
//   - "Construct" CTA: disabled style (FG_MUTED border, no hover lift) when
//     validation fails; tooltip surfaces the failure reason.
//
// Wire-up notes:
//   - Toggle via KeyC (`'toggle-construction'`, see input.ts).
//   - ESC dismisses via the shared `'dismiss-modal'` action wired in main.ts.
//   - On a successful construct, the panel calls back into `options.onConstruct`
//     which is responsible for inserting the new spec/state into the live
//     world + rebuilding render layers. The pure construct logic lives in
//     `artificial-island.ts`; this module owns input collection only.

import {
  computeConstructionCost,
  constructIsland,
  maxRadiusForFounderLevel,
  validateConstruction,
  type ConstructionRequirements,
  type ValidationReason,
} from './artificial-island.js';
import { BIOME_DEFS } from './biomes.js';
import type { IslandState } from './economy.js';
import { tierForLevel } from './skilltree.js';
import { distSqTiles, type Biome, type IslandSpec, type WorldState } from './world.js';

export interface ConstructionUi {
  readonly el: HTMLDivElement;
  refresh(): void;
  show(): void;
  hide(): void;
  toggle(): boolean;
  isVisible(): boolean;
}

export interface ConstructionUiOptions {
  /** Live world data. The picker rebuilds its eligible-founder list from
   *  this each open. The reference is captured; mutations flow through. */
  readonly world: WorldState;
  readonly islandStates: Map<string, IslandState>;
  /** Optional: current active-island id. The founder picker prefers this
   *  when it appears in the eligible-founders list, so opening the panel
   *  after clicking a T3+ island defaults to that island. */
  getActiveIslandId?(): string;
  /** Called after a successful construct. The result is the new spec + state,
   *  the founder id (in case the caller wants to render an attribution), and
   *  the now-ms for any animation hooks. Callers are responsible for:
   *    - inserting spec into worldState.islands
   *    - inserting state into islandStates
   *    - rebuilding render layers (rebuildWorldLayers())
   *    - registering the new island in any per-id caches (modifier muls,
   *      specs-by-id map). */
  readonly onConstruct: (
    args: {
      newSpec: IslandSpec;
      newState: IslandState;
      founderId: string;
      nowMs: number;
    },
  ) => void;
}

// ---------------------------------------------------------------------------
// Palette — shared with skilltree-ui / buildings-ui for cross-modal continuity.
// ---------------------------------------------------------------------------
const PANEL_BG = 'rgba(14, 18, 26, 0.92)';
const PANEL_BORDER = '#3a4452';
const PANEL_HEADER_BORDER = '#4a5a72';
const FG = '#cdd6f4';
const FG_DIM = '#6c7791';
const FG_MUTED = '#4a5365';
const ACCENT = '#7dd3e8';
const ACCENT_DIM = '#3d6f7c';
const WARN = '#f5a742';
const STRIP_BG = 'rgba(20, 24, 32, 0.6)';

const BIOME_ORDER: ReadonlyArray<Biome> = [
  'plains',
  'forest',
  'coast',
  'volcanic',
  'desert',
  'arctic',
];

/** Validation-reason → human-readable string for tooltip + footer. */
const REASON_LABEL: Readonly<Record<ValidationReason, string>> = {
  'tier-too-low': 'Founder is below T3 (level 15)',
  'no-platform-constructor': 'Founder has no Platform Constructor',
  'radius-too-large': 'Radius exceeds founder tier cap',
  'insufficient-materials': 'Not enough materials in founder inventory',
  'invalid-biome': 'Unknown biome selection',
};

/** Distance buffer (tiles) added to (major_a + major_b) for overlap check. */
const POSITION_BUFFER_TILES = 4;

function styled(el: HTMLElement, css: string): void {
  el.style.cssText = css;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  styled(
    b,
    [
      'background: #1a1f2a',
      `color: ${FG}`,
      `border: 1px solid ${PANEL_BORDER}`,
      'padding: 3px 9px',
      'cursor: pointer',
      'font-family: ui-monospace, monospace',
      'font-size: 11px',
      'letter-spacing: 0.04em',
      'text-transform: uppercase',
      'transition: background 80ms ease, border-color 80ms ease',
    ].join(';'),
  );
  b.addEventListener('mouseenter', () => {
    b.style.background = '#252b38';
    b.style.borderColor = ACCENT_DIM;
  });
  b.addEventListener('mouseleave', () => {
    b.style.background = '#1a1f2a';
    b.style.borderColor = PANEL_BORDER;
  });
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  return b;
}

/** Check whether a candidate position would overlap any existing island.
 *  Returns true if safe to place, false otherwise. Pure helper kept local
 *  to the UI since the rule is a UX guardrail, not a pure-layer invariant. */
function positionIsFree(
  world: WorldState,
  cx: number,
  cy: number,
  majorRadius: number,
): boolean {
  for (const s of world.islands) {
    const minDist = s.majorRadius + majorRadius + POSITION_BUFFER_TILES;
    if (distSqTiles(s.cx, s.cy, cx, cy) < minDist * minDist) return false;
  }
  return true;
}

/** Tiny stable id generator so multiple constructs in one session get
 *  unique ids without colliding with the demo set. */
let constructionCounter = 0;
/** Next allocated `art-N` id. Exported so persistence tests can verify the
 *  seeder raised the counter past the saved max — mirrors `nextDroneId` /
 *  `nextRouteId` / `nextVehicleId`. The construction UI itself still calls
 *  this directly. */
export function nextArtificialId(): string {
  constructionCounter += 1;
  // `art-1`, `art-2`, ... — short enough for log readability, distinct from
  // the existing demo ids (home, forest-ne, desert-far, …).
  return `art-${constructionCounter}`;
}

/** Seed the construction id counter so the next id is `art-${value + 1}`.
 *  Used by the persistence loader after restoring a save: the loader walks
 *  `world.islands`, finds the highest existing `art-N` suffix, and calls
 *  this with that max. Idempotent: passing a smaller value than the current
 *  counter is a no-op (we only raise). Mirrors the `_seedDroneIdCounter` /
 *  `_seedRouteIdCounter` / `_seedVehicleIdCounter` pattern. */
export function _seedConstructionCounter(value: number): void {
  if (value > constructionCounter) constructionCounter = value;
}

/** Reset the construction id counter. Test-only. */
export function _resetConstructionCounter(): void {
  constructionCounter = 0;
}

export function mountConstructionUi(
  parentEl: HTMLElement,
  options: ConstructionUiOptions,
): ConstructionUi {
  let visible = false;
  /** Selected founder island id. Null = no eligible founder selected
   *  (either none exist, or the player hasn't picked one yet). */
  let selectedFounder: string | null = null;
  let selectedBiome: Biome = 'plains';
  let majorRadius = 4;
  let minorRadius = 4;
  let posX = 100;
  let posY = 100;

  // -------------------------------------------------------------------------
  // Scrim + panel shell
  // -------------------------------------------------------------------------
  const scrim = document.createElement('div');
  scrim.id = 'construction-scrim';
  styled(
    scrim,
    [
      'position: fixed',
      'inset: 0',
      'background: rgba(10, 14, 20, 0.55)',
      'z-index: 200',
      'display: none',
      'pointer-events: none',
      'backdrop-filter: blur(1.5px)',
    ].join(';'),
  );

  const panel = document.createElement('div');
  panel.id = 'construction-panel';
  styled(
    panel,
    [
      'position: fixed',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'width: min(720px, calc(100vw - 32px))',
      'max-height: calc(100vh - 32px)',
      `background: ${PANEL_BG}`,
      `border: 1px solid ${PANEL_BORDER}`,
      'border-radius: 2px',
      'box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(125, 211, 232, 0.05)',
      'z-index: 201',
      'pointer-events: auto',
      `color: ${FG}`,
      'font-family: ui-monospace, monospace',
      'font-size: 12px',
      'line-height: 1.45',
      'font-variant-numeric: tabular-nums',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden',
    ].join(';'),
  );

  // -------------------------------------------------------------------------
  // Header strip
  // -------------------------------------------------------------------------
  const header = document.createElement('div');
  styled(
    header,
    [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'padding: 10px 16px 9px',
      `border-bottom: 1px solid ${PANEL_HEADER_BORDER}`,
      `background: ${STRIP_BG}`,
      'gap: 14px',
    ].join(';'),
  );
  const headerTitle = document.createElement('div');
  styled(headerTitle, 'display: flex; align-items: baseline; gap: 10px; flex: 0 0 auto');
  const title = document.createElement('span');
  title.textContent = 'CONSTRUCT ARTIFICIAL ISLAND';
  styled(
    title,
    [
      `color: ${ACCENT}`,
      'font-size: 12px',
      'font-weight: 600',
      'letter-spacing: 0.22em',
    ].join(';'),
  );
  const subtitle = document.createElement('span');
  subtitle.textContent = '§2.5 / platform constructor';
  styled(
    subtitle,
    [
      `color: ${FG_DIM}`,
      'font-size: 10px',
      'letter-spacing: 0.12em',
      'text-transform: uppercase',
    ].join(';'),
  );
  headerTitle.appendChild(title);
  headerTitle.appendChild(subtitle);
  const closeBtn = makeButton('Close (C)', () => hide());
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);

  // -------------------------------------------------------------------------
  // Body — form sections
  // -------------------------------------------------------------------------
  const body = document.createElement('div');
  styled(
    body,
    [
      'display: flex',
      'flex-direction: column',
      'gap: 10px',
      'padding: 14px 16px 8px',
      'overflow-y: auto',
      'flex: 1 1 auto',
    ].join(';'),
  );

  function sectionLabel(text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = text;
    styled(
      d,
      [
        `color: ${FG_DIM}`,
        'font-size: 10px',
        'letter-spacing: 0.16em',
        'text-transform: uppercase',
        `border-bottom: 1px solid ${FG_MUTED}`,
        'padding-bottom: 2px',
        'margin-bottom: 4px',
      ].join(';'),
    );
    return d;
  }

  // --- Founder picker ------------------------------------------------------
  const founderSection = document.createElement('div');
  founderSection.appendChild(sectionLabel('Founder Island'));
  const founderSelect = document.createElement('select');
  styled(
    founderSelect,
    [
      `background: #1a1f2a`,
      `color: ${FG}`,
      `border: 1px solid ${PANEL_BORDER}`,
      'padding: 4px 6px',
      'font-family: ui-monospace, monospace',
      'font-size: 12px',
      'width: 100%',
    ].join(';'),
  );
  founderSelect.addEventListener('change', () => {
    selectedFounder = founderSelect.value === '' ? null : founderSelect.value;
    refresh();
  });
  founderSection.appendChild(founderSelect);

  // --- Biome picker (chip strip) -------------------------------------------
  const biomeSection = document.createElement('div');
  biomeSection.appendChild(sectionLabel('Biome'));
  const biomeStrip = document.createElement('div');
  styled(biomeStrip, 'display: flex; gap: 6px; flex-wrap: wrap');
  const biomeChips = new Map<Biome, HTMLButtonElement>();
  for (const b of BIOME_ORDER) {
    const chip = document.createElement('button');
    chip.textContent = BIOME_DEFS[b].displayName;
    styled(
      chip,
      [
        'background: transparent',
        `color: ${FG_DIM}`,
        `border: 1px solid ${FG_MUTED}`,
        'padding: 4px 10px',
        'cursor: pointer',
        'font-family: ui-monospace, monospace',
        'font-size: 11px',
        'letter-spacing: 0.08em',
        'text-transform: uppercase',
        'border-radius: 2px',
      ].join(';'),
    );
    chip.addEventListener('click', () => {
      selectedBiome = b;
      refresh();
      chip.blur();
    });
    biomeChips.set(b, chip);
    biomeStrip.appendChild(chip);
  }
  biomeSection.appendChild(biomeStrip);

  // --- Size sliders --------------------------------------------------------
  const sizeSection = document.createElement('div');
  sizeSection.appendChild(sectionLabel('Size (ellipse radii in tiles)'));
  const sizeGrid = document.createElement('div');
  styled(sizeGrid, 'display: grid; grid-template-columns: 90px 1fr 40px; gap: 8px; align-items: center');

  function sliderRow(
    labelText: string,
    initial: number,
    onChange: (v: number) => void,
  ): { rowEls: HTMLElement[]; valueEl: HTMLSpanElement; sliderEl: HTMLInputElement } {
    const label = document.createElement('span');
    label.textContent = labelText;
    styled(label, `color: ${FG_DIM}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase`);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '4';
    slider.max = '8';
    slider.step = '1';
    slider.value = String(initial);
    styled(slider, 'width: 100%; accent-color: ' + ACCENT);
    const valueEl = document.createElement('span');
    valueEl.textContent = String(initial);
    styled(valueEl, `color: ${FG}; font-size: 11px; font-weight: 600; text-align: right`);
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      valueEl.textContent = String(v);
      onChange(v);
      refresh();
    });
    return { rowEls: [label, slider, valueEl], valueEl, sliderEl: slider };
  }
  const majorRow = sliderRow('Major Radius', majorRadius, (v) => {
    majorRadius = v;
  });
  const minorRow = sliderRow('Minor Radius', minorRadius, (v) => {
    minorRadius = v;
  });
  for (const el of majorRow.rowEls) sizeGrid.appendChild(el);
  for (const el of minorRow.rowEls) sizeGrid.appendChild(el);
  sizeSection.appendChild(sizeGrid);

  // --- Position inputs -----------------------------------------------------
  const posSection = document.createElement('div');
  posSection.appendChild(sectionLabel('Position (world-tile coords)'));
  const posGrid = document.createElement('div');
  styled(posGrid, 'display: grid; grid-template-columns: 90px 1fr 90px 1fr; gap: 8px; align-items: center');

  function numberInputRow(
    labelText: string,
    initial: number,
    onChange: (v: number) => void,
  ): HTMLElement[] {
    const label = document.createElement('span');
    label.textContent = labelText;
    styled(label, `color: ${FG_DIM}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase`);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(initial);
    input.step = '1';
    styled(
      input,
      [
        `background: #1a1f2a`,
        `color: ${FG}`,
        `border: 1px solid ${PANEL_BORDER}`,
        'padding: 3px 5px',
        'font-family: ui-monospace, monospace',
        'font-size: 12px',
        'width: 100%',
      ].join(';'),
    );
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v)) {
        onChange(v);
        refresh();
      }
    });
    return [label, input];
  }
  for (const el of numberInputRow('Target X', posX, (v) => {
    posX = v;
  })) posGrid.appendChild(el);
  for (const el of numberInputRow('Target Y', posY, (v) => {
    posY = v;
  })) posGrid.appendChild(el);
  posSection.appendChild(posGrid);

  // --- Cost readout --------------------------------------------------------
  const costSection = document.createElement('div');
  costSection.appendChild(sectionLabel('Materials Required'));
  const costGrid = document.createElement('div');
  styled(costGrid, 'display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px');
  function makeCostRow(label: string): { wrap: HTMLDivElement; valueEl: HTMLSpanElement } {
    const wrap = document.createElement('div');
    styled(
      wrap,
      [
        `border: 1px solid ${PANEL_BORDER}`,
        'padding: 6px 8px',
        'display: flex',
        'flex-direction: column',
        'gap: 2px',
        'background: rgba(20, 24, 32, 0.4)',
      ].join(';'),
    );
    const l = document.createElement('span');
    l.textContent = label;
    styled(l, `color: ${FG_DIM}; font-size: 10px; letter-spacing: 0.10em; text-transform: uppercase`);
    const valueEl = document.createElement('span');
    valueEl.textContent = '—';
    styled(valueEl, `color: ${FG}; font-size: 13px; font-weight: 600`);
    wrap.appendChild(l);
    wrap.appendChild(valueEl);
    return { wrap, valueEl };
  }
  const steelCost = makeCostRow('Steel');
  const ironCost = makeCostRow('Iron Ingot');
  const woodCost = makeCostRow('Wood');
  costGrid.appendChild(steelCost.wrap);
  costGrid.appendChild(ironCost.wrap);
  costGrid.appendChild(woodCost.wrap);
  costSection.appendChild(costGrid);

  body.appendChild(founderSection);
  body.appendChild(biomeSection);
  body.appendChild(sizeSection);
  body.appendChild(posSection);
  body.appendChild(costSection);

  // -------------------------------------------------------------------------
  // Footer — status + Construct CTA
  // -------------------------------------------------------------------------
  const footer = document.createElement('div');
  styled(
    footer,
    [
      'padding: 9px 16px',
      `border-top: 1px solid ${PANEL_HEADER_BORDER}`,
      `background: ${STRIP_BG}`,
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'gap: 12px',
    ].join(';'),
  );
  const statusEl = document.createElement('span');
  styled(
    statusEl,
    [
      `color: ${FG_DIM}`,
      'font-size: 10.5px',
      'letter-spacing: 0.06em',
      'text-transform: uppercase',
      'flex: 1 1 auto',
    ].join(';'),
  );
  const constructBtn = document.createElement('button');
  constructBtn.textContent = '▶ CONSTRUCT';
  styled(
    constructBtn,
    [
      `background: ${ACCENT}`,
      `color: #0a0e14`,
      `border: 1px solid ${ACCENT_DIM}`,
      'padding: 5px 14px',
      'cursor: pointer',
      'font-family: ui-monospace, monospace',
      'font-size: 11px',
      'font-weight: 700',
      'letter-spacing: 0.10em',
      'text-transform: uppercase',
      'transition: background 80ms ease',
    ].join(';'),
  );
  constructBtn.addEventListener('click', () => {
    tryConstruct();
    constructBtn.blur();
  });
  footer.appendChild(statusEl);
  footer.appendChild(constructBtn);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);

  parentEl.appendChild(scrim);
  parentEl.appendChild(panel);
  panel.style.display = 'none';

  // -------------------------------------------------------------------------
  // Refresh — recompute eligibility, cost, validation; repaint UI
  // -------------------------------------------------------------------------

  /** Collect every island state that satisfies "populated + T3+ + has
   *  platform_constructor". Pure read of `options.world` / `options.islandStates`. */
  function eligibleFounders(): Array<{ spec: IslandSpec; state: IslandState }> {
    const out: Array<{ spec: IslandSpec; state: IslandState }> = [];
    for (const spec of options.world.islands) {
      if (!spec.populated) continue;
      const state = options.islandStates.get(spec.id);
      if (!state) continue;
      if (tierForLevel(state.level) < 3) continue;
      if (!spec.buildings.some((b) => b.defId === 'platform_constructor')) continue;
      out.push({ spec, state });
    }
    return out;
  }

  function refresh(): void {
    if (!visible) return;
    // Rebuild founder options — `world.islands` may have grown since last open.
    const eligible = eligibleFounders();
    const prevSelection = selectedFounder;
    while (founderSelect.firstChild) founderSelect.removeChild(founderSelect.firstChild);
    if (eligible.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— no eligible founder (need T3 island with Platform Constructor) —';
      founderSelect.appendChild(opt);
      selectedFounder = null;
    } else {
      for (const { spec, state } of eligible) {
        const opt = document.createElement('option');
        opt.value = spec.id;
        opt.textContent = `${spec.id} (${spec.biome}, L${state.level})`;
        founderSelect.appendChild(opt);
      }
      // Reselect previous if still valid; otherwise prefer the currently
      // active island (if eligible); fall back to the first eligible.
      const stillValid = eligible.find((e) => e.spec.id === prevSelection);
      const activeId = options.getActiveIslandId?.();
      const activeEligible = activeId
        ? eligible.find((e) => e.spec.id === activeId)
        : undefined;
      const target =
        stillValid?.spec.id ??
        activeEligible?.spec.id ??
        eligible[0]?.spec.id ??
        null;
      selectedFounder = target;
      if (target) founderSelect.value = target;
    }

    // Repaint biome chips.
    for (const [b, chip] of biomeChips) {
      const active = b === selectedBiome;
      chip.style.background = active ? 'rgba(125, 211, 232, 0.10)' : 'transparent';
      chip.style.borderColor = active ? ACCENT : FG_MUTED;
      chip.style.color = active ? ACCENT : FG_DIM;
    }

    // Update cost readout.
    const req: ConstructionRequirements = {
      biome: selectedBiome,
      majorRadius,
      minorRadius,
    };
    const cost = computeConstructionCost(req);
    const founder = selectedFounder
      ? eligible.find((e) => e.spec.id === selectedFounder)
      : null;
    paintCostRow(steelCost.valueEl, cost.steel, founder?.state.inventory.steel ?? 0);
    paintCostRow(ironCost.valueEl, cost.iron_ingot, founder?.state.inventory.iron_ingot ?? 0);
    paintCostRow(woodCost.valueEl, cost.wood, founder?.state.inventory.wood ?? 0);

    // Validate.
    let reason: ValidationReason | 'overlap' | null = null;
    if (!founder) {
      reason = 'tier-too-low'; // no eligible founder ≈ tier-too-low UX-wise
    } else {
      const v = validateConstruction(founder.state, founder.spec, req);
      if (!v.ok) {
        reason = v.reason ?? 'invalid-biome';
      } else if (!positionIsFree(options.world, posX, posY, majorRadius)) {
        reason = 'overlap';
      }
    }

    if (reason === null) {
      statusEl.textContent = `Ready — ${selectedBiome} ${majorRadius}×${minorRadius} at (${posX}, ${posY})`;
      statusEl.style.color = ACCENT;
      constructBtn.style.background = ACCENT;
      constructBtn.style.color = '#0a0e14';
      constructBtn.style.borderColor = ACCENT_DIM;
      constructBtn.style.cursor = 'pointer';
      constructBtn.title = '';
      (constructBtn as HTMLButtonElement).disabled = false;
    } else {
      const label = reason === 'overlap'
        ? 'Position overlaps an existing island'
        : REASON_LABEL[reason];
      statusEl.textContent = label.toUpperCase();
      statusEl.style.color = WARN;
      constructBtn.style.background = FG_MUTED;
      constructBtn.style.color = FG_DIM;
      constructBtn.style.borderColor = FG_MUTED;
      constructBtn.style.cursor = 'not-allowed';
      constructBtn.title = label;
      (constructBtn as HTMLButtonElement).disabled = true;
    }

    // The radius cap depends on the founder's tier — surface for clarity.
    if (founder) {
      const cap = maxRadiusForFounderLevel(founder.state.level);
      majorRow.sliderEl.max = String(cap);
      minorRow.sliderEl.max = String(cap);
    }
  }

  function paintCostRow(el: HTMLSpanElement, need: number, have: number): void {
    el.textContent = `${have.toFixed(0)} / ${need}`;
    if (have >= need) {
      el.style.color = FG;
    } else {
      el.style.color = WARN;
      el.title = `Short by ${(need - have).toFixed(0)}`;
    }
    // Reset warn-dim fallback when have meets need.
    if (have >= need) el.title = '';
  }

  function tryConstruct(): void {
    if (!selectedFounder) return;
    const state = options.islandStates.get(selectedFounder);
    const spec = options.world.islands.find((s) => s.id === selectedFounder);
    if (!state || !spec) return;
    const req: ConstructionRequirements = {
      biome: selectedBiome,
      majorRadius,
      minorRadius,
    };
    const v = validateConstruction(state, spec, req);
    if (!v.ok) return;
    if (!positionIsFree(options.world, posX, posY, majorRadius)) return;
    const id = nextArtificialId();
    const nowMs = performance.now();
    const result = constructIsland(state, spec, req, { cx: posX, cy: posY }, id, nowMs);
    options.onConstruct({
      newSpec: result.newSpec,
      newState: result.newState,
      founderId: selectedFounder,
      nowMs,
    });
    // Hide on success so the player sees the new island land on the map.
    hide();
  }

  function show(): void {
    if (visible) return;
    visible = true;
    panel.style.display = 'flex';
    scrim.style.display = 'block';
    refresh();
  }
  function hide(): void {
    if (!visible) return;
    visible = false;
    panel.style.display = 'none';
    scrim.style.display = 'none';
  }
  function toggle(): boolean {
    if (visible) hide();
    else show();
    return visible;
  }

  return {
    el: panel,
    refresh,
    show,
    hide,
    toggle,
    isVisible: () => visible,
  };
}
