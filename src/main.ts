// Robot Islands — step 1 bootstrap.
//
// Static single-island scene: compute tile membership for a circular Plains
// island (radius 14), render terrain + 4 hardcoded buildings, center in the
// viewport. No interaction, no animation, no economy.

import { Application, Container } from 'pixi.js';

import {
  computeIslandTiles,
  defaultTerrainAt,
  renderIslandTiles,
} from './island.js';
import { HOME_ISLAND_BUILDINGS, renderBuildings } from './buildings.js';

const HOME_RADIUS = 14;

async function main(): Promise<void> {
  const mountEl = document.getElementById('app');
  if (!mountEl) {
    throw new Error('main: missing #app mount element');
  }

  const app = new Application();
  await app.init({
    background: '#0a0e14',
    resizeTo: window,
    antialias: false,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  mountEl.appendChild(app.canvas);

  // World container is centered in the viewport. Children draw at world-origin-
  // anchored coordinates; the world container's position handles the centering.
  const world = new Container();
  world.label = 'world';
  app.stage.addChild(world);

  const tiles = computeIslandTiles(HOME_RADIUS, HOME_RADIUS, defaultTerrainAt);
  if (import.meta.env.DEV) {
    console.log(`[robot-islands] tile count: ${tiles.length}`);
  }

  world.addChild(renderIslandTiles(tiles));
  world.addChild(renderBuildings(HOME_ISLAND_BUILDINGS));

  const recenter = (): void => {
    world.position.set(app.renderer.width / 2, app.renderer.height / 2);
  };
  recenter();
  // Pixi v8: the renderer fires its own 'resize' event AFTER it has updated
  // app.renderer.width/height, so listening here (rather than on window)
  // guarantees fresh dimensions when recenter runs.
  // step-1 assumption: app lifetime = page lifetime; replace with
  // app.renderer.off('resize', recenter) on teardown if step-N introduces remount.
  app.renderer.on('resize', recenter);
}

main().catch((err: unknown) => {
  console.error('[robot-islands] fatal:', err);
});
