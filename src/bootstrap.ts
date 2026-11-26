import { LoadingScreen, WebGLUnavailableError } from './ui/loading';

/** Made for computers: a touch screen with no mouse or trackpad gets a note instead of the game. */
const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

if (touchOnly) new LoadingScreen().fail('Outsmart the Pathfinder is made for computers. Open it on a Mac or PC with a mouse or trackpad.');
else void import('./main').catch((err: unknown) => {
  console.error('Could not start Outsmart the Pathfinder.', err);
  new LoadingScreen().fail(err instanceof WebGLUnavailableError
    ? 'WebGL 2 is unavailable. Enable graphics acceleration or try a current browser, then reload.'
    : 'The game could not start. Reload the page to try again.');
});
