import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { difficultyIndexById } from './config.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
const input = new Input();
const game = new Game(renderer, input);

// Testing shortcuts: ?level=6 starts in that level's hangar with everything up
// to it unlocked, &credits=200000 overrides the budget, and ?difficulty=cadet
// picks a setting without going through the select screen.
//
// Anything else opens on the difficulty choice, which is the real first screen
// of a campaign.
const params = new URLSearchParams(location.search);
if (params.has('difficulty')) {
  game.chooseDifficulty(difficultyIndexById(params.get('difficulty')));
}
if (params.has('level')) {
  const level = Number(params.get('level'));
  const credits = params.has('credits') ? Number(params.get('credits')) : null;
  // Levels are 1-based in the UI and in the URL; 0-based internally.
  if (Number.isFinite(level)) game.jumpTo(level - 1, credits);
} else if (!params.has('difficulty')) {
  game.promptDifficulty();
}

window.addEventListener('resize', () => renderer.resize());

let last = performance.now();

function frame(now) {
  // Clamp so an alt-tab pause does not teleport the ship through the ground.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  game.update(dt);
  game.draw(dt);
  input.endFrame();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy from the console:
//   lander.game.jumpTo(6)            -- level 7's hangar (0-based here)
//   lander.game.session.credits = 1e6
window.lander = { game, renderer, input };
