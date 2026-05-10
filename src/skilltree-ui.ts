// Skill-tree panel — DOM overlay rendering §9.3 as three branch columns.
//
// Aesthetic: a refinement of the existing HUD/ui-overlay industrial-readout
// vocabulary (dark monospace, `#0a0e14` page void, `#cdd6f4` foreground,
// `#3a4452` borders, `rgba(20,24,32,0.78)` panel fill). The skill panel
// pushes that vocabulary toward an engineering-blueprint feel: branch
// columns separated by thin double rules, each sub-path framed by a
// vertical depth-rail with tick marks at each depth, node rows that read
// like a printed datasheet with cost / magnitude / tier columns aligned to
// tabular-nums, and a single accent colour (`#7dd3e8` — the vision-blue
// already in the world palette) for unlocked nodes. Locked nodes are
// rendered at half-saturation but full legibility, never greyed-out
// illegibly.
//
// Rationale: the HUD has already established the visual contract. A major
// panel that breaks it (CRT terminal, brutalist data-table, editorial
// blueprint) would feel like a different app glued on. Refinement-not-
// departure preserves continuity while raising hierarchy density.
//
// The panel is fixed-position, centered, dismissable by KeyK (registered in
// input.ts) or its close button. Pointer events on the panel intercept
// canvas pan/zoom — clicks outside the panel still reach the canvas.

import {
  BRANCH_LABEL,
  BRANCH_SUBPATHS,
  NODE_CATALOG,
  SUBPATH_LABEL,
  canSpend,
  nodeRequiredTier,
  spendPoint,
  tierForLevel,
  type BranchId,
  type SkillNode,
  type SubPathId,
} from './skilltree.js';
import { type IslandState, xpForLevel } from './economy.js';

export interface SkillTreeUi {
  readonly el: HTMLDivElement;
  /** Repaint the panel to match the current state. No-op while hidden so it's
   *  cheap to call every frame from the ticker. */
  refresh(): void;
  /** Show the panel. Idempotent. */
  show(): void;
  /** Hide the panel. Idempotent. */
  hide(): void;
  /** Toggle visibility; returns the new visible state. */
  toggle(): boolean;
  /** Whether the panel is currently visible. */
  isVisible(): boolean;
}

// Palette — derived from the world ocean palette + HUD foreground.
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

interface NodeRowRef {
  readonly row: HTMLDivElement;
  readonly statusDot: HTMLSpanElement;
  readonly tierTag: HTMLSpanElement;
  readonly costTag: HTMLSpanElement;
  readonly descEl: HTMLDivElement;
  readonly titleEl: HTMLDivElement;
}

export function mountSkillTreeUi(parentEl: HTMLElement, state: IslandState): SkillTreeUi {
  // Forward-declared so the closures inside `nodeRow` can capture them. They
  // are populated before any `refresh()` call (which is itself bound at the
  // end of this function via the returned object).
  const nodeRefs = new Map<string, NodeRowRef>();
  const subStatusRefs = new Map<SubPathId, HTMLSpanElement>();

  // Mutable forward ref to `refresh` so click handlers can re-render after a
  // purchase. Assigned at the bottom of this function.
  let refresh: () => void = () => undefined;
  // Visibility flag — referenced by `refresh` to no-op while hidden.
  let visible = false;

  // Backdrop scrim — semi-transparent to dim the underlying canvas while the
  // panel is open. pointer-events: none so canvas pan/zoom outside the panel
  // still works as advertised.
  const scrim = document.createElement('div');
  scrim.id = 'skill-tree-scrim';
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
  panel.id = 'skill-tree-panel';
  styled(
    panel,
    [
      'position: fixed',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'width: min(960px, calc(100vw - 32px))',
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
  // Header strip — level / xp / unspent points + close button
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
  styled(
    headerTitle,
    [
      'display: flex',
      'align-items: baseline',
      'gap: 10px',
      'flex: 0 0 auto',
    ].join(';'),
  );
  const title = document.createElement('span');
  title.textContent = 'SKILL TREE';
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
  subtitle.textContent = '§9.3 / home island';
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

  const headerStats = document.createElement('div');
  styled(
    headerStats,
    [
      'flex: 1 1 auto',
      'display: flex',
      'justify-content: center',
      'gap: 22px',
      'font-size: 11px',
      'letter-spacing: 0.08em',
      'text-transform: uppercase',
    ].join(';'),
  );

  function statBlock(label: string, valueEl: HTMLElement): HTMLDivElement {
    const wrap = document.createElement('div');
    styled(wrap, 'display: flex; align-items: baseline; gap: 6px');
    const l = document.createElement('span');
    l.textContent = label;
    styled(l, `color: ${FG_DIM}; font-size: 10px`);
    wrap.appendChild(l);
    wrap.appendChild(valueEl);
    return wrap;
  }

  const levelVal = document.createElement('span');
  styled(levelVal, `color: ${FG}; font-weight: 600`);
  const xpVal = document.createElement('span');
  styled(xpVal, `color: ${FG}`);
  const tierVal = document.createElement('span');
  styled(tierVal, `color: ${ACCENT}; font-weight: 600`);
  const pointsVal = document.createElement('span');
  styled(pointsVal, `color: ${WARN}; font-weight: 600; font-size: 13px`);

  headerStats.appendChild(statBlock('LEVEL', levelVal));
  headerStats.appendChild(statBlock('TIER', tierVal));
  headerStats.appendChild(statBlock('XP', xpVal));
  headerStats.appendChild(statBlock('UNSPENT', pointsVal));

  const closeBtn = makeButton('Close (K)', () => hide());
  styled(closeBtn,
    [
      closeBtn.style.cssText,
      'flex: 0 0 auto',
    ].join(';'),
  );

  header.appendChild(headerTitle);
  header.appendChild(headerStats);
  header.appendChild(closeBtn);

  // -------------------------------------------------------------------------
  // Body — three branch columns
  // -------------------------------------------------------------------------
  const body = document.createElement('div');
  styled(
    body,
    [
      'display: grid',
      'grid-template-columns: 1fr 1fr 1fr',
      'gap: 1px',
      'background: #2a3140',
      'overflow-y: auto',
      'flex: 1 1 auto',
    ].join(';'),
  );

  function nodeRow(node: SkillNode, branch: BranchId): HTMLDivElement {
    const row = document.createElement('div');
    styled(
      row,
      [
        'display: grid',
        'grid-template-columns: 14px 1fr auto auto',
        'align-items: baseline',
        'gap: 9px',
        'padding: 5px 9px 5px 6px',
        `border-left: 2px solid ${FG_MUTED}`,
        'margin-left: 8px',
        'transition: background 100ms ease, border-color 100ms ease',
        'cursor: default',
      ].join(';'),
    );

    // Depth tick — a small monospaced indicator on the depth-rail.
    const tick = document.createElement('span');
    tick.textContent = String(node.depth).padStart(1, '0') + '.';
    styled(tick, `color: ${FG_MUTED}; font-size: 10px; letter-spacing: 0`);

    const main = document.createElement('div');
    styled(main, 'display: flex; flex-direction: column; gap: 1px; min-width: 0');

    const titleRow = document.createElement('div');
    styled(titleRow, 'display: flex; align-items: baseline; gap: 7px');
    const statusDot = document.createElement('span');
    statusDot.textContent = '○';
    styled(statusDot, `color: ${FG_MUTED}; font-size: 11px`);
    const titleEl = document.createElement('div');
    titleEl.textContent = `${SUBPATH_LABEL[node.subPath]} ${node.depth}`;
    styled(titleEl, `color: ${FG}; font-size: 12px; font-weight: 500`);
    titleRow.appendChild(statusDot);
    titleRow.appendChild(titleEl);
    main.appendChild(titleRow);

    const descEl = document.createElement('div');
    descEl.textContent = node.description;
    styled(descEl, `color: ${FG_DIM}; font-size: 10.5px`);
    main.appendChild(descEl);

    const tierTag = document.createElement('span');
    tierTag.textContent = `T${nodeRequiredTier(node)}`;
    styled(
      tierTag,
      [
        `color: ${FG_DIM}`,
        'font-size: 10px',
        'letter-spacing: 0.08em',
        `border: 1px solid ${FG_MUTED}`,
        'padding: 1px 5px',
        'border-radius: 2px',
      ].join(';'),
    );

    const costTag = document.createElement('span');
    costTag.textContent = `${node.cost} SP`;
    styled(
      costTag,
      [
        `color: ${WARN}`,
        'font-size: 10.5px',
        'letter-spacing: 0.04em',
        'font-weight: 600',
        'min-width: 38px',
        'text-align: right',
      ].join(';'),
    );

    row.appendChild(tick);
    row.appendChild(main);
    row.appendChild(tierTag);
    row.appendChild(costTag);

    // Click → attempt purchase. If allowed, mutate state and refresh.
    row.addEventListener('click', () => {
      const r = canSpend(state, node.id);
      if (!r.ok) return;
      spendPoint(state, node.id);
      refresh();
      // Bounce flash to confirm the purchase visually.
      row.animate(
        [
          { backgroundColor: 'rgba(125, 211, 232, 0.18)' },
          { backgroundColor: 'rgba(125, 211, 232, 0)' },
        ],
        { duration: 380, easing: 'ease-out' },
      );
    });
    row.addEventListener('mouseenter', () => {
      const r = canSpend(state, node.id);
      if (r.ok) {
        row.style.background = 'rgba(125, 211, 232, 0.08)';
        row.style.borderLeftColor = ACCENT;
        row.style.cursor = 'pointer';
      }
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
      // Reset border colour based on current node state; refresh handles it.
      const ref = nodeRefs.get(node.id);
      if (ref) applyState(node, ref);
      row.style.cursor = 'default';
    });

    void branch; // reserved for future per-branch accent if needed
    nodeRefs.set(node.id, { row, statusDot, tierTag, costTag, descEl, titleEl });
    return row;
  }

  for (const branch of ['extraction', 'refinement', 'logistics'] as const) {
    const col = document.createElement('div');
    styled(
      col,
      [
        `background: ${PANEL_BG}`,
        'padding: 14px 12px 18px',
        'display: flex',
        'flex-direction: column',
        'gap: 14px',
      ].join(';'),
    );

    const colHeader = document.createElement('div');
    styled(
      colHeader,
      [
        'display: flex',
        'align-items: baseline',
        'gap: 8px',
        `border-bottom: 1px solid ${PANEL_BORDER}`,
        'padding-bottom: 6px',
      ].join(';'),
    );
    const branchName = document.createElement('span');
    branchName.textContent = BRANCH_LABEL[branch].toUpperCase();
    styled(
      branchName,
      [
        `color: ${ACCENT}`,
        'font-size: 11px',
        'font-weight: 600',
        'letter-spacing: 0.2em',
      ].join(';'),
    );
    const branchSub = document.createElement('span');
    branchSub.textContent = '/ branch';
    styled(branchSub, `color: ${FG_DIM}; font-size: 9.5px; letter-spacing: 0.1em`);
    colHeader.appendChild(branchName);
    colHeader.appendChild(branchSub);
    col.appendChild(colHeader);

    for (const subPath of BRANCH_SUBPATHS[branch]) {
      const sub = document.createElement('div');
      styled(sub, 'display: flex; flex-direction: column; gap: 2px');

      const subHeader = document.createElement('div');
      styled(
        subHeader,
        [
          'display: flex',
          'align-items: baseline',
          'justify-content: space-between',
          'padding: 1px 0 3px',
        ].join(';'),
      );
      const subName = document.createElement('span');
      subName.textContent = SUBPATH_LABEL[subPath];
      styled(
        subName,
        [
          `color: ${FG}`,
          'font-size: 11.5px',
          'font-weight: 600',
          'letter-spacing: 0.03em',
        ].join(';'),
      );
      const subStatus = document.createElement('span');
      styled(
        subStatus,
        [
          `color: ${FG_DIM}`,
          'font-size: 9.5px',
          'letter-spacing: 0.06em',
          'text-transform: uppercase',
        ].join(';'),
      );
      subHeader.appendChild(subName);
      subHeader.appendChild(subStatus);
      sub.appendChild(subHeader);

      const subPathNodes = NODE_CATALOG
        .filter((n) => n.subPath === subPath)
        .slice()
        .sort((a, b) => a.depth - b.depth);
      for (const node of subPathNodes) {
        sub.appendChild(nodeRow(node, branch));
      }
      col.appendChild(sub);

      // Stash sub-status element for refresh.
      subStatusRefs.set(subPath, subStatus);
    }
    body.appendChild(col);
  }

  // -------------------------------------------------------------------------
  // Footer hint strip
  // -------------------------------------------------------------------------
  const footer = document.createElement('div');
  styled(
    footer,
    [
      'padding: 7px 16px',
      `border-top: 1px solid ${PANEL_HEADER_BORDER}`,
      `background: ${STRIP_BG}`,
      `color: ${FG_DIM}`,
      'font-size: 10px',
      'letter-spacing: 0.06em',
      'display: flex',
      'justify-content: space-between',
      'text-transform: uppercase',
    ].join(';'),
  );
  const footerL = document.createElement('span');
  footerL.textContent = 'click a node to spend a skill point';
  const footerR = document.createElement('span');
  footerR.textContent = 'depth 1-2 require T2 · costs grow 2^(depth-1)';
  footer.appendChild(footerL);
  footer.appendChild(footerR);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);

  parentEl.appendChild(scrim);
  parentEl.appendChild(panel);
  panel.style.display = 'none';

  function applyState(node: SkillNode, ref: NodeRowRef): void {
    const owned = state.unlockedNodes.has(node.id);
    const r = canSpend(state, node.id);
    if (owned) {
      ref.statusDot.textContent = '●';
      ref.statusDot.style.color = ACCENT;
      ref.titleEl.style.color = ACCENT;
      ref.descEl.style.color = FG_DIM;
      ref.row.style.borderLeftColor = ACCENT;
      ref.costTag.style.color = ACCENT_DIM;
      ref.costTag.style.textDecoration = 'line-through';
      ref.tierTag.style.borderColor = ACCENT_DIM;
      ref.tierTag.style.color = ACCENT_DIM;
      ref.row.style.opacity = '1';
    } else if (r.ok) {
      ref.statusDot.textContent = '◇';
      ref.statusDot.style.color = WARN;
      ref.titleEl.style.color = FG;
      ref.descEl.style.color = FG_DIM;
      ref.row.style.borderLeftColor = WARN;
      ref.costTag.style.color = WARN;
      ref.costTag.style.textDecoration = 'none';
      ref.tierTag.style.borderColor = FG_MUTED;
      ref.tierTag.style.color = FG_DIM;
      ref.row.style.opacity = '1';
    } else {
      ref.statusDot.textContent = '○';
      ref.statusDot.style.color = FG_MUTED;
      ref.titleEl.style.color = FG_DIM;
      ref.descEl.style.color = FG_MUTED;
      ref.row.style.borderLeftColor = FG_MUTED;
      ref.costTag.style.color = FG_MUTED;
      ref.costTag.style.textDecoration = 'none';
      ref.tierTag.style.borderColor = FG_MUTED;
      ref.tierTag.style.color = FG_MUTED;
      // Tier-locked deserves visual emphasis to communicate "can't spend yet,
      // come back at level N". Other locks (depth-prereq, branch-lock,
      // insufficient-points) stay dim but legible.
      ref.row.style.opacity = r.reason === 'tier-locked' ? '0.55' : '0.78';
    }
  }

  refresh = (): void => {
    // Skip work while hidden — the ticker calls this every frame.
    if (!visible) return;
    const need = xpForLevel(state.level + 1);
    levelVal.textContent = String(state.level);
    xpVal.textContent = `${state.xp.toFixed(0)} / ${need.toFixed(0)}`;
    tierVal.textContent = `T${tierForLevel(state.level)}`;
    pointsVal.textContent = String(state.unspentSkillPoints);

    for (const node of NODE_CATALOG) {
      const ref = nodeRefs.get(node.id);
      if (!ref) continue;
      applyState(node, ref);
    }

    // Sub-path summary status: "committed", "complete", "locked", "open".
    for (const branch of ['extraction', 'refinement', 'logistics'] as const) {
      for (const sp of BRANCH_SUBPATHS[branch]) {
        const subEl = subStatusRefs.get(sp);
        if (!subEl) continue;
        const prog = state.subPathProgress.get(sp);
        if (prog?.complete) {
          subEl.textContent = '◉ complete';
          subEl.style.color = ACCENT;
        } else if (prog && prog.spent >= 3) {
          subEl.textContent = '◐ committed';
          subEl.style.color = WARN;
        } else if (prog && prog.spent > 0) {
          subEl.textContent = `◑ ${prog.spent} pt`;
          subEl.style.color = FG_DIM;
        } else {
          subEl.textContent = '◇ open';
          subEl.style.color = FG_MUTED;
        }
      }
    }
  };

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

  // No initial paint — `refresh()` no-ops while hidden, and `show()` calls
  // it on transition. Nodes are built with neutral defaults; the first
  // `show()` recolors them correctly.
  return {
    el: panel,
    refresh,
    show,
    hide,
    toggle,
    isVisible: () => visible,
  };
}
