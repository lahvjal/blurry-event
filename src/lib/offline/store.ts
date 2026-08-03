import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  KeyValueStore,
  MutationStore,
  QueuedMutation,
} from '@/lib/offline/types';
import { isExactRevision } from '@/lib/offline/score-revisions';

/**
 * Native backing. Metro resolves store.web.ts on web, so this file is the
 * iOS/Android implementation.
 *
 * AsyncStorage is durable on device (SQLite-backed on both platforms), so the
 * queue is held as one JSON document rather than per-record rows. The queue is
 * bounded by a round's worth of writes, so rewriting the document per change is
 * cheap and keeps the read path a single await.
 */

const QUEUE_KEY = 'blurry.offline.mutations.v1';
const CACHE_PREFIX = 'blurry.offline.cache.';

const OUTSTANDING: QueuedMutation['syncStatus'][] = ['pending', 'syncing', 'failed'];

let cached: QueuedMutation[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readAll(): Promise<QueuedMutation[]> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    cached = raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

async function writeAll(rows: QueuedMutation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  cached = rows;
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation, operation);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export const mutationStore: MutationStore = {
  async all() {
    return [...(await readAll())];
  },
  async outstanding() {
    const rows = await readAll();
    return rows
      .filter((r) => OUTSTANDING.includes(r.syncStatus))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async get(id) {
    return (await readAll()).find((r) => r.id === id);
  },
  async put(mutation) {
    await serializeWrite(async () => {
      const rows = await readAll();
      const index = rows.findIndex((r) => r.id === mutation.id);
      const next = [...rows];
      if (index === -1) next.push(mutation);
      else next[index] = mutation;
      await writeAll(next);
    });
  },
  async remove(id, generation) {
    return serializeWrite(async () => {
      const rows = await readAll();
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return false;
      if (!isExactRevision(rows[index], id, generation)) return false;
      await writeAll(rows.filter((_, rowIndex) => rowIndex !== index));
      return true;
    });
  },
  async count() {
    return (await mutationStore.outstanding()).length;
  },
  async clear() {
    await serializeWrite(() => writeAll([]));
  },
};

export const cacheStore: KeyValueStore = {
  async get<T>(key: string) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T) {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  },
  async remove(key: string) {
    await AsyncStorage.removeItem(CACHE_PREFIX + key);
  },
};

/** No-op off the web; native storage is already durable. */
export async function requestPersistentStorage(): Promise<boolean> {
  return true;
}
