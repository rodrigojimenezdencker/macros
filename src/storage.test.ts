import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStorageError, reportStorageError } from './storage';

describe('isStorageError', () => {
  it('recognises IndexedDB failures, directly or wrapped by Dexie', () => {
    expect(isStorageError({ name: 'UnknownError', message: 'Connection to Indexed Database server lost' })).toBe(true);
    expect(isStorageError({ name: 'InvalidStateError' })).toBe(true);
    expect(isStorageError({ name: 'OpenFailedError', inner: { name: 'UnknownError' } })).toBe(true);
    expect(isStorageError({ name: 'DexieError', inner: { name: 'InvalidStateError' } })).toBe(true);
  });

  it('leaves programming errors alone', () => {
    expect(isStorageError(new TypeError("Cannot read properties of null (reading 'x')"))).toBe(false);
    expect(isStorageError({ name: 'ConstraintError' })).toBe(false);
    expect(isStorageError(null)).toBe(false);
    expect(isStorageError('UnknownError')).toBe(false);
  });
});

describe('reportStorageError', () => {
  const store = new Map<string, string>();
  const reload = vi.fn();

  beforeEach(() => {
    store.clear();
    reload.mockReset();
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reloads once to reconnect, then stops reloading within the cooldown', () => {
    const err = { name: 'UnknownError', message: 'lost' };
    reportStorageError(err, 1_000_000);
    expect(reload).toHaveBeenCalledTimes(1);
    reportStorageError(err, 1_010_000);
    expect(reload).toHaveBeenCalledTimes(1);
    reportStorageError(err, 1_000_000 + 61_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads when it cannot remember having done so', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    });
    reportStorageError({ name: 'UnknownError', message: 'lost' }, 5_000_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
