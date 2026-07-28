import Dexie, { Table } from 'dexie';

import {
  KeyValueStore,
  MutationStore,
  QueuedMutation,
} from '@/lib/offline/types';

/**
 * IndexedDB backing for the PWA.
 *
 * AsyncStorage on web is localStorage: synchronous, ~5MB, and evictable under
 * storage pressure. A round of scores must survive a phone being closed in a
 * pocket for four hours, so the queue lives in IndexedDB instead.
 *
 * The schema is deliberately open-ended — `cache` is a key/value table so
 * additional offline features can be added without a migration.
 */
class BlurryOfflineDb extends Dexie {
  mutations!: Table<QueuedMutation, string>;
  cache!: Table<{ key: string; value: unknown; updatedAt: string }, string>;

  constructor() {
    super('blurry-offline');
    this.version(1).stores({
      // Indexed on dedupeKey so an edit can find and replace its predecessor,
      // and on syncStatus + createdAt to pull the outstanding queue in order.
      mutations: 'id, dedupeKey, syncStatus, createdAt',
      cache: 'key',
    });
  }
}

const db = new BlurryOfflineDb();

/** Anything the server hasn't confirmed yet. */
const OUTSTANDING: QueuedMutation['syncStatus'][] = ['pending', 'syncing', 'failed'];

export const mutationStore: MutationStore = {
  async outstanding() {
    const rows = await db.mutations
      .where('syncStatus')
      .anyOf(OUTSTANDING)
      .toArray();
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async get(id) {
    return db.mutations.get(id);
  },
  async findByDedupeKey(key) {
    const rows = await db.mutations.where('dedupeKey').equals(key).toArray();
    return rows.find((r) => OUTSTANDING.includes(r.syncStatus));
  },
  async put(mutation) {
    await db.mutations.put(mutation);
  },
  async remove(id) {
    await db.mutations.delete(id);
  },
  async count() {
    return db.mutations.where('syncStatus').anyOf(OUTSTANDING).count();
  },
  async clear() {
    await db.mutations.clear();
  },
};

export const cacheStore: KeyValueStore = {
  async get<T>(key: string) {
    const row = await db.cache.get(key);
    return row ? (row.value as T) : null;
  },
  async set<T>(key: string, value: T) {
    await db.cache.put({ key, value, updatedAt: new Date().toISOString() });
  },
  async remove(key: string) {
    await db.cache.delete(key);
  },
};

/**
 * Asks the browser to keep our data through storage pressure. Without this,
 * IndexedDB is "best effort" and can be evicted; granted persistence makes it
 * durable until the user clears it. Safari grants it for installed PWAs.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
