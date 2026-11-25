import { LoadingScreen, WebGLUnavailableError } from './ui/loading';

void import('./main').catch((err: unknown) => {
  console.error('Could not start Outsmart the Pathfinder.', err);
  new LoadingScreen().fail(err instanceof WebGLUnavailableError
    ? 'WebGL 2 is unavailable. Enable graphics acceleration or try a current browser, then reload.'
    : 'The game could not start. Reload the page to try again.');
});
