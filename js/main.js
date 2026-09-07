import { Renderer } from './render.js';
import { Input } from './input.js';
import { Game } from './game.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
const input = new Input();
const game = new Game(renderer, input);

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

// Handy for tuning from the console: `lander.game.session.credits = 99999`.
window.lander = { game, renderer, input };
