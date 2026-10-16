import { describe, expect, it } from 'vitest';
import { shouldReload } from './pwa';

describe('shouldReload', () => {
  it('reloads into a new version only once the app is out of sight and nothing holds it', () => {
    expect(shouldReload({ pending: true, held: 0, visibility: 'hidden' })).toBe(true);
    expect(shouldReload({ pending: true, held: 0, visibility: 'visible' })).toBe(false); // in use: never interrupt
    expect(shouldReload({ pending: true, held: 1, visibility: 'hidden' })).toBe(false); // e.g. reading a reset code
    expect(shouldReload({ pending: false, held: 0, visibility: 'hidden' })).toBe(false);
  });
});
