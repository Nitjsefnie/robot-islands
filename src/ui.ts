// Minimal DOM UI overlay — plain elements, no framework.
//
// A small fixed-position panel in the corner of the page holds buttons that
// dispatch actions through the same `InputRegistry` used for keyboard input.
// This is the explicit goal of point 7 in the task: one source of truth for
// every action, two input modalities (keyboard + DOM click) feeding it.

import { dispatchAction, type InputRegistry } from './input.js';

export interface UiButtonSpec {
  readonly label: string;
  readonly action: string;
}

/**
 * Mount a fixed-position floating panel of action buttons onto `parentEl`.
 * Buttons are styled inline to match the dark monospace theme from
 * index.html; the styling is kept here rather than in CSS so this module is
 * self-contained.
 */
export function mountUi(
  parentEl: HTMLElement,
  reg: InputRegistry,
  buttons: ReadonlyArray<UiButtonSpec>,
): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'ui-overlay';
  panel.style.cssText = [
    'position: fixed',
    'top: 8px',
    'right: 8px',
    'display: flex',
    'flex-direction: column',
    'gap: 4px',
    'z-index: 100',
    'font-family: ui-monospace, monospace',
    'font-size: 12px',
    'opacity: 0.85',
  ].join(';');

  for (const spec of buttons) {
    const b = document.createElement('button');
    b.textContent = spec.label;
    b.dataset['action'] = spec.action;
    b.style.cssText = [
      'background: #1a1f2a',
      'color: #cdd6f4',
      'border: 1px solid #3a4452',
      'padding: 4px 10px',
      'cursor: pointer',
      'font-family: ui-monospace, monospace',
      'font-size: 12px',
    ].join(';');
    b.addEventListener('click', () => {
      dispatchAction(reg, spec.action);
      // Drop focus so subsequent Space/Enter keys aren't swallowed by the
      // re-firing of the button click handler.
      b.blur();
    });
    panel.appendChild(b);
  }

  parentEl.appendChild(panel);
  return panel;
}
