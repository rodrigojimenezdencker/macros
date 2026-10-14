import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { MacrosDB, importAll, rememberFood, saveSettings, wipeData } from '../db';
import { SyncEngine, type Remote, type RemoteRecord } from './engine';
import type { Food } from '../types';

/** In-memory stand-in for the server: same rules as the SQL function (newer client stamp wins, strictly). */
class FakeServer {
  rows = new Map<string, Map<string, RemoteRecord & { server_updated_at: string }>>();
  private clock = 0;
  pushes = 0;
  failNext = false;
  /** Runs during a push, before it is stored (to simulate edits racing an upload). */
  onPush?: () => Promise<void>;

  remote(userId: string): Remote {
    return {
      push: async (records) => {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('Failed to fetch');
        }
        await this.onPush?.();
        this.pushes++;
        const table = this.rows.get(userId) ?? new Map();
        this.rows.set(userId, table);
        const ts = new Date(Date.UTC(2026, 9, 14) + ++this.clock * 1000).toISOString();
        for (const r of records) {
          const k = `${r.kind}:${r.key}`;
          const prev = table.get(k);
          if (!prev || prev.client_updated_at < r.client_updated_at) table.set(k, { ...structuredClone(r), server_updated_at: ts });
        }
      },
      pull: async (since) => {
        const all = [...(this.rows.get(userId)?.values() ?? [])]
          .filter((r) => !since || Date.parse(r.server_updated_at) > Date.parse(since))
          .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at));
        return { records: structuredClone(all), cursor: all.at(-1)?.server_updated_at ?? null };
      },
    };
  }

  live(userId: string) {
    return [...(this.rows.get(userId)?.values() ?? [])].filter((r) => !r.deleted);
  }
}

const open: { db: MacrosDB; engine: SyncEngine }[] = [];

async function device(server: FakeServer, userId = 'user-1', db = new MacrosDB(`dev-${Math.random()}`)) {
  await db.open();
  const engine = new SyncEngine(db, server.remote(userId), userId);
  await engine.start();
  open.push({ db, engine });
  return { db, engine };
}

afterEach(() => {
  for (const { engine, db } of open.splice(0)) {
    engine.dispose();
    db.close();
  }
});

const rice: Food = { name: 'Arroz', source: 'custom', unit: 'g', per100: { kcal: 350, protein: 7, carbs: 78, fat: 1 }, createdAt: 1 };

async function logRice(db: MacrosDB, amount = 100) {
  const foodId = await rememberFood(rice, db);
  return db.entries.add({
    date: '2026-10-14',
    meal: 'lunch',
    name: 'Arroz',
    amount,
    nutrients: { kcal: 3.5 * amount, protein: 0.07 * amount, carbs: 0.78 * amount, fat: 0.01 * amount },
    food: { foodId, name: 'Arroz', unit: 'g', per100: rice.per100 },
    createdAt: 2,
  }) as Promise<number>;
}

describe('SyncEngine', () => {
  it('uploads local changes without device-only fields and marks them clean', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await logRice(a.db);
    await a.db.weights.put({ date: '2026-10-14', kg: 80.2 });
    await saveSettings({ offCountry: 'es' }, a.db);
    await a.engine.sync();

    const live = server.live('user-1');
    expect(live.map((r) => r.kind).sort()).toEqual(['entry', 'food', 'settings', 'weight']);
    for (const r of live) {
      expect(r.data).not.toHaveProperty('id');
      expect(r.data).not.toHaveProperty('dirty');
      expect(r.data).not.toHaveProperty('updatedAt');
    }
    expect(live.find((r) => r.kind === 'entry')!.data!.food).not.toHaveProperty('foodId');
    expect(await a.db.entries.where('dirty').equals(1).count()).toBe(0);
    expect(a.engine.getState()).toMatchObject({ status: 'idle', pending: 0, hasPulled: true });
  });

  it('brings a second device up to date, with its own local ids', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await logRice(a.db);
    await a.engine.sync();

    const b = await device(server);
    await b.engine.sync();
    const [entry] = await b.db.entries.toArray();
    expect(entry).toMatchObject({ name: 'Arroz', amount: 100, dirty: 0 });
    expect(entry.uid).toBe((await a.db.entries.toArray())[0].uid);
    expect(await b.db.foods.count()).toBe(1);
    // Pulling again changes nothing and creates no new local work.
    await b.engine.sync();
    expect(await b.db.entries.count()).toBe(1);
    expect(b.engine.getState().pending).toBe(0);
  });

  it('propagates edits and deletions both ways', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const id = await logRice(a.db);
    await a.engine.sync();
    const b = await device(server);
    await b.engine.sync();

    const bEntry = (await b.db.entries.toArray())[0];
    await b.db.entries.update(bEntry.id!, { amount: 150 });
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.db.entries.get(id))?.amount).toBe(150);

    await a.db.entries.delete(id);
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.db.entries.count()).toBe(0);
    expect(await a.db.tombstones.count()).toBe(0);
  });

  it('resolves conflicting offline edits by the latest change, whatever the sync order', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const id = await logRice(a.db);
    await a.engine.sync();
    const b = await device(server);
    await b.engine.sync();
    const bId = (await b.db.entries.toArray())[0].id!;

    await a.db.entries.update(id, { amount: 120 }); // older edit
    await new Promise((r) => setTimeout(r, 5));
    await b.db.entries.update(bId, { amount: 200 }); // newer edit
    await b.engine.sync(); // newer one reaches the server first
    await a.engine.sync(); // older one must not overwrite it, and A must adopt the newer one
    await b.engine.sync();
    expect((await a.db.entries.get(id))?.amount).toBe(200);
    expect((await b.db.entries.get(bId))?.amount).toBe(200);
  });

  it('keeps a newer local change that has not been uploaded yet', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.db.weights.put({ date: '2026-10-14', kg: 80 });
    await a.engine.sync();
    const b = await device(server);
    await b.engine.sync();

    await a.db.weights.put({ date: '2026-10-14', kg: 79 });
    await a.engine.sync();
    await new Promise((r) => setTimeout(r, 5));
    await b.db.weights.put({ date: '2026-10-14', kg: 78.5 }); // newer, still pending
    server.failNext = true; // upload fails, download would bring the older 79
    await b.engine.sync();
    expect(b.engine.getState().status).toBe('offline');
    expect((await b.db.weights.get('2026-10-14'))?.kg).toBe(78.5);
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.db.weights.get('2026-10-14'))?.kg).toBe(78.5);
  });

  it('uploads data from before the first sign-in, and clears it when another account signs in', async () => {
    const server = new FakeServer();
    const db = new MacrosDB(`dev-${Math.random()}`);
    await db.open();
    await logRice(db); // used without an account
    const first = await device(server, 'user-1', db);
    await first.engine.sync();
    expect(server.live('user-1')).toHaveLength(2);
    first.engine.dispose();

    const other = new SyncEngine(db, server.remote('user-2'), 'user-2');
    await other.start();
    open.push({ db, engine: other });
    expect(await db.entries.count()).toBe(0);
    await other.sync();
    expect(server.live('user-2')).toHaveLength(0);
  });

  it('undoing a delete keeps the row on the server', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const id = await logRice(a.db);
    await a.engine.sync();
    const entry = (await a.db.entries.get(id))!;
    await a.db.entries.delete(id);
    await new Promise((r) => setTimeout(r, 5)); // tombstone is written after the delete commits
    await a.db.entries.add(entry); // "Deshacer"
    await a.engine.sync();
    expect(server.live('user-1').filter((r) => r.kind === 'entry')).toHaveLength(1);
    expect(await a.db.entries.count()).toBe(1);
  });

  it('does not lose an edit made while an upload is in flight', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const id = await logRice(a.db);
    server.onPush = async () => {
      server.onPush = undefined;
      await a.db.entries.update(id, { amount: 300 });
    };
    await a.engine.sync();
    expect((await a.db.entries.get(id))?.dirty).toBe(1);
    await a.engine.sync();
    const remote = server.live('user-1').find((r) => r.kind === 'entry')!;
    expect(remote.data!.amount).toBe(300);
  });

  it('importing or wiping replaces the account data too', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await logRice(a.db);
    await a.db.weights.put({ date: '2026-10-13', kg: 81 });
    await a.engine.sync();

    await importAll({ foods: [], entries: [], weights: [{ date: '2026-10-14', kg: 80 }], settings: { goals: { kcal: 2100, protein: 150, carbs: 200, fat: 77 }, offCountry: 'es' } }, a.db);
    await a.engine.sync();
    expect(server.live('user-1').map((r) => `${r.kind}:${r.key}`).sort()).toEqual(['settings:settings', 'weight:2026-10-14']);

    await wipeData(a.db);
    await a.engine.sync();
    expect(server.live('user-1')).toHaveLength(0);
  });
});
