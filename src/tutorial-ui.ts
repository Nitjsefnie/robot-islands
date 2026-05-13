import { OBJECTIVES, type TutorialState } from './tutorial.js';

export function renderTutorialBanner(state: TutorialState): HTMLElement | null {
  if (!state.current) return null;
  const obj = OBJECTIVES[state.current];
  const banner = document.createElement('div');
  banner.id = 'tutorial-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a2a3a;
    border: 1px solid #7dd3e8;
    padding: 8px 16px;
    border-radius: 4px;
    display: flex;
    gap: 8px;
    align-items: center;
    color: #eee;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    z-index: 200;
  `;
  const title = document.createElement('strong');
  title.textContent = obj.title;
  title.style.color = '#7dd3e8';
  banner.appendChild(title);
  const hint = document.createElement('span');
  hint.textContent = obj.hint;
  banner.appendChild(hint);
  return banner;
}
