/** @vitest-environment jsdom */
/** The actual React race fallback remains usable when metadata vanishes after preflight. */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@/test/utils/componentTestUtils';
import GameNotFound from '../not-found';

afterEach(cleanup);

it('announces the unavailable game and exposes a native home link in the React fallback', () => {
  render(<GameNotFound />);
  const alert = screen.getByRole('alert');
  expect(alert).toContainElement(screen.getByRole('heading', { name: 'Game Not Found' }));
  expect(alert).toHaveTextContent('This game does not exist or is not currently published.');
  const home = screen.getByRole('link', { name: 'Back to SpawnForge' });
  expect(home).toHaveAttribute('href', '/');
  expect(alert).toContainElement(home);
  home.focus();
  expect(home).toHaveFocus();
});
