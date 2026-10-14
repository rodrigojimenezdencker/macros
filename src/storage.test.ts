import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStorageError } from './storage';

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

  it('survives cyclic wrappers', () => {
    const a: Record<string, unknown> = { name: 'A' };
    const b: Record<string, unknown> = { name: 'B', inner: a };
    a.inner = b;
    expect(isStorageError(a)).toBe(false);
  });
});

describe('reportStorageError', () => {
  const store = new Map<string, string>();
  const reload = vi.fn();
  const err = { name: 'UnknownError', message: 'lost' };

  /** A fresh module instance is a fresh page load. */
  const load = async () => {
    vi.resetModules();
    return import('./storage');
  };

  beforeEach(() => {
    store.clear();
    reload.mockReset();
    vi.stubGlobal('window', {
      location: { reload },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reloads once when a working connection is lost', async () => {
    const s = await load();
    s.noteStorageWorks();
    s.reportStorageError(err, 1_000_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again if storage never worked after the reload', async () => {
    let s = await load();
    s.reportStorageError(err, 1_000_000);
    s = await load(); // the reload
    s.reportStorageError(err, 1_100_000);
    s.reportStorageError(err, 9_000_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads for a new loss once storage worked again', async () => {
    let s = await load();
    s.reportStorageError(err, 1_000_000);
    s = await load(); // the reload fixed it
    s.noteStorageWorks();
    s.reportStorageError(err, 1_000_000 + 60_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('keeps a minimum gap even if storage flaps', async () => {
    let s = await load();
    s.reportStorageError(err, 1_000_000);
    s = await load();
    s.noteStorageWorks();
    s.reportStorageError(err, 1_005_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when it cannot remember having done so', async () => {
    vi.stubGlobal('window', {
      location: { reload },
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    });
    const s = await load();
    s.noteStorageWorks();
    s.reportStorageError(err, 5_000_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
