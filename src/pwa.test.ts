import { describe, expect, it } from 'vitest';
import { shouldReloadNow } from './pwa';

describe('shouldReloadNow', () => {
  it('reloads into a new version only when nothing can be lost', () => {
    expect(shouldReloadNow(3_000, 'visible')).toBe(true); // just opened or brought back
    expect(shouldReloadNow(60_000, 'visible')).toBe(false); // in use: wait until the app is left
    expect(shouldReloadNow(60_000, 'hidden')).toBe(true);
  });
});
