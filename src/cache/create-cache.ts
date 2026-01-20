// src/cache/create-cache.ts

import type {
    CacheDriver,
    CacheEntry,
    CacheKey,
    CacheKeyListener,
    CacheListener,
    CacheMeta,
    CacheStore,
    CreateCacheOptions,
} from "./types";
import {computeMeta, isAlive, now} from "./ttl";

type KeySet = Set<CacheKey>;

function makeEntry<T>(value: T, ttlMs?: number): CacheEntry<T> {
    return {value, createdAt: now(), ttlMs};
}

type KeyListCache = {
    keys: CacheKey[]; // stable reference while valid
    valid: boolean;
};

export function createCache(opts: CreateCacheOptions): CacheStore {
    const driver: CacheDriver = opts.driver;
    const hydrate = opts.hydrate ?? true;
    const cleanupExpiredOnHydrate = opts.cleanupExpiredOnHydrate ?? true;

    // ---- in-memory mirror (sync source of truth for reads) ----
    const mirror = new Map<CacheKey, CacheEntry>();

    // ---- listeners ----
    const keyListeners = new Map<CacheKey, Set<CacheListener>>();
    const prefixListeners = new Map<string, Set<CacheKeyListener>>();
    const allListeners = new Set<CacheKeyListener>();
    const readyListeners = new Set<CacheListener>();

    // ---- batching ----
    let batchDepth = 0;
    const pendingKeys: KeySet = new Set();
    let pendingReadyEmit = false;

    // ---- readiness ----
    let ready = false;

    let _resolve!: () => void;
    let _reject!: (e: unknown) => void;

    const readyP = new Promise<void>((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
    });

    // ---- in-flight async de-dup ----
    const inFlight = new Map<CacheKey, Promise<any>>();

    // ---- keys() caching ----
    const allKeysCache: KeyListCache = {keys: [], valid: false};
    const prefixKeysCache = new Map<string, KeyListCache>();

    const safeCall = (cb: () => void) => {
        try {
            cb();
        } catch {
            /* ignore listener errors */
        }
    };

    const invalidateAllKeysCache = () => {
        allKeysCache.valid = false;
    };

    const invalidatePrefixCachesForKey = (key: CacheKey) => {
        // Any cached prefix that matches this key becomes invalid.
        for (const [prefix, c] of Array.from(prefixKeysCache.entries())) {
            if (key.startsWith(prefix)) c.valid = false;
        }
    };

    const invalidatePrefixCache = (prefix: string) => {
        const c = prefixKeysCache.get(prefix);
        if (c) c.valid = false;
    };

    const invalidateKeyCachesForMutation = (key: CacheKey) => {
        invalidateAllKeysCache();
        invalidatePrefixCachesForKey(key);
    };

    const emitNow = (key: CacheKey) => {
        // key listeners (no args)
        const ls = keyListeners.get(key);
        if (ls) for (const cb of Array.from(ls)) safeCall(cb);

        // prefix listeners (receive changed key)
        for (const [prefix, set] of Array.from(prefixListeners.entries())) {
            if (!key.startsWith(prefix)) continue;
            for (const cb of Array.from(set)) safeCall(() => cb(key));
        }

        // all listeners (receive changed key)
        for (const cb of Array.from(allListeners)) safeCall(() => cb(key));
    };

    const emitReadyNow = () => {
        for (const cb of Array.from(readyListeners)) safeCall(cb);
    };

    const queueEmitKey = (key: CacheKey) => {
        if (batchDepth > 0) {
            pendingKeys.add(key);
            return;
        }
        emitNow(key);
    };

    const queueEmitReady = () => {
        if (batchDepth > 0) {
            pendingReadyEmit = true;
            return;
        }
        emitReadyNow();
    };

    const dropKey = (key: CacheKey) => {
        // Keep behavior consistent with your previous version:
        // - auto TTL prune does NOT emit; it just removes.
        mirror.delete(key);
        driver.remove(key).catch(() => {
        });
        invalidateKeyCachesForMutation(key);
    };

    const pruneIfDead = (key: CacheKey, e: CacheEntry | undefined): boolean => {
        if (!e) return true;
        if (isAlive(e)) return false;

        dropKey(key);
        return true;
    };

    const setInternal = (key: CacheKey, entry: CacheEntry | null) => {
        if (!entry) {
            mirror.delete(key);
            driver.remove(key).catch(() => {
            });
            invalidateKeyCachesForMutation(key);
            queueEmitKey(key);
            return;
        }

        if (entry.ttlMs !== undefined && entry.ttlMs <= 0) {
            mirror.delete(key);
            driver.remove(key).catch(() => {
            });
            invalidateKeyCachesForMutation(key);
            queueEmitKey(key);
            return;
        }

        mirror.set(key, entry);
        driver.set(key, entry).catch(() => {
        });
        invalidateKeyCachesForMutation(key);
        queueEmitKey(key);
    };

    const getEntry = (key: CacheKey): CacheEntry | undefined => {
        const e = mirror.get(key);
        if (!e) return undefined;
        if (pruneIfDead(key, e)) return undefined;
        return e;
    };

    const pruneListInPlace = (list: CacheKey[]) => {
        // Remove dead keys from a cached list by scanning the list only (O(m)).
        let write = 0;

        for (let read = 0; read < list.length; read++) {
            const k = list[read];
            const e = mirror.get(k);

            if (!e || !isAlive(e)) {
                // remove from mirror + persistence (no emit) and invalidate caches
                if (e) dropKey(k);
                else {
                    // if mirror doesn't have it, still keep caches consistent
                    invalidateKeyCachesForMutation(k);
                }
                continue;
            }

            list[write++] = k;
        }

        if (write !== list.length) list.length = write;
    };

    const computeKeysForPrefix = (prefix?: string): CacheKey[] => {
        const out: CacheKey[] = [];

        for (const [k, e] of Array.from(mirror.entries())) {
            if (prefix && !k.startsWith(prefix)) continue;

            if (!isAlive(e)) {
                dropKey(k);
                continue;
            }

            out.push(k);
        }

        return out;
    };

    const getCachedKeys = (prefix?: string): CacheKey[] => {
        if (!prefix) {
            if (!allKeysCache.valid) {
                allKeysCache.keys = computeKeysForPrefix(undefined);
                allKeysCache.valid = true;
            } else {
                pruneListInPlace(allKeysCache.keys);
            }
            return allKeysCache.keys;
        }

        let c = prefixKeysCache.get(prefix);
        if (!c) {
            c = {keys: [], valid: false};
            prefixKeysCache.set(prefix, c);
        }

        if (!c.valid) {
            c.keys = computeKeysForPrefix(prefix);
            c.valid = true;
        } else {
            pruneListInPlace(c.keys);
        }

        return c.keys;
    };

    const store: CacheStore = {
        get<T = unknown>(key: CacheKey): T | undefined {
            const e = getEntry(key);
            return e ? (e.value as T) : undefined;
        },

        has(key: CacheKey): boolean {
            return !!getEntry(key);
        },

        meta(key: CacheKey): CacheMeta | null {
            const e = getEntry(key);
            return computeMeta(e);
        },

        set<T = unknown>(key: CacheKey, value: T, ttlMs?: number): void {
            setInternal(key, makeEntry(value, ttlMs));
        },

        update<T = unknown>(
            key: CacheKey,
            updater: (prev: T | undefined) => T,
            ttlMs?: number,
        ): T {
            const prev = this.get<T>(key);
            const next = updater(prev);
            this.set(key, next, ttlMs);
            return next;
        },

        remove(key: CacheKey): void {
            setInternal(key, null);
        },

        keys(prefix?: string): CacheKey[] {
            // Returns a stable array reference while valid.
            // If you need a copy: [...cache.keys(prefix)]
            return getCachedKeys(prefix);
        },

        clear(prefix?: string): void {
            if (!prefix) {
                const ks = this.keys(); // cached list (alive only)
                if (driver.removeMany) driver.removeMany(ks).catch(() => {
                });
                else ks.forEach((k) => driver.remove(k).catch(() => {
                }));

                for (const k of ks) mirror.delete(k);

                // invalidate *everything*
                allKeysCache.valid = false;
                for (const c of Array.from(prefixKeysCache.values())) c.valid = false;

                for (const k of ks) queueEmitKey(k);
                return;
            }

            const ks = this.keys(prefix);
            for (const k of ks) mirror.delete(k);

            if (driver.clearPrefix) driver.clearPrefix(prefix).catch(() => {
            });
            else if (driver.removeMany) driver.removeMany(ks).catch(() => {
            });
            else ks.forEach((k) => driver.remove(k).catch(() => {
                }));

            invalidateAllKeysCache();
            invalidatePrefixCache(prefix);
            // other cached prefixes that include these keys also become invalid
            for (const k of ks) invalidatePrefixCachesForKey(k);

            for (const k of ks) queueEmitKey(k);
        },

        touch(key: CacheKey, ttlMs?: number): void {
            const e = getEntry(key);
            if (!e) return;

            const ne: CacheEntry = {
                value: e.value,
                createdAt: now(),
                ttlMs: ttlMs === undefined ? e.ttlMs : ttlMs,
            };

            setInternal(key, ne);
        },

        async getOrSetAsync<T>(
            key: CacheKey,
            fetcher: () => Promise<T>,
            opts?: { ttlMs?: number; force?: boolean },
        ): Promise<T> {
            const force = opts?.force ?? false;

            if (!force) {
                const cached = this.get<T>(key);
                if (cached !== undefined) return cached;
            }

            const existing = inFlight.get(key);
            if (existing) return existing as Promise<T>;

            const p = (async () => {
                try {
                    const v = await fetcher();
                    this.set(key, v, opts?.ttlMs);
                    return v;
                } finally {
                    inFlight.delete(key);
                }
            })();

            inFlight.set(key, p);
            return p;
        },

        subscribeKey(key: CacheKey, cb: CacheListener): () => void {
            let set = keyListeners.get(key);
            if (!set) {
                set = new Set();
                keyListeners.set(key, set);
            }
            set.add(cb);

            return () => {
                const s = keyListeners.get(key);
                if (!s) return;
                s.delete(cb);
                if (s.size === 0) keyListeners.delete(key);
            };
        },

        subscribePrefix(prefix: string, cb: CacheKeyListener): () => void {
            let set = prefixListeners.get(prefix);
            if (!set) {
                set = new Set();
                prefixListeners.set(prefix, set);
            }
            set.add(cb);

            return () => {
                const s = prefixListeners.get(prefix);
                if (!s) return;
                s.delete(cb);
                if (s.size === 0) prefixListeners.delete(prefix);
            };
        },

        subscribeAll(cb: CacheKeyListener): () => void {
            allListeners.add(cb);
            return () => {
                allListeners.delete(cb);
            };
        },

        emit(key: CacheKey): void {
            queueEmitKey(key);
        },

        isReady(): boolean {
            return ready;
        },

        readyPromise(): Promise<void> {
            return readyP;
        },

        subscribeReady(cb: CacheListener): () => void {
            readyListeners.add(cb);
            return () => {
                readyListeners.delete(cb);
            };
        },

        batch<T>(fn: () => T): T {
            batchDepth++;
            try {
                return fn();
            } finally {
                batchDepth--;
                if (batchDepth === 0) {
                    const keys = Array.from(pendingKeys);
                    pendingKeys.clear();
                    for (const k of keys) emitNow(k);

                    if (pendingReadyEmit) {
                        pendingReadyEmit = false;
                        emitReadyNow();
                    }
                }
            }
        },
    };

    // ---- hydrate or resolve immediately ----
    if (!hydrate) {
        ready = true;
        _resolve();
        queueEmitReady();
        return store;
    }

    (async () => {
        try {
            const keys = await driver.keys();
            const rows = driver.getMany
                ? await driver.getMany(keys)
                : await Promise.all(keys.map(async (k) => ({key: k, entry: await driver.get(k)})));

            const toDelete: CacheKey[] = [];

            store.batch(() => {
                for (const row of rows) {
                    if (!row.entry) continue;

                    if (cleanupExpiredOnHydrate && !isAlive(row.entry)) {
                        toDelete.push(row.key);
                        continue;
                    }

                    mirror.set(row.key, row.entry);
                }
            });

            if (cleanupExpiredOnHydrate && toDelete.length) {
                if (driver.removeMany) driver.removeMany(toDelete).catch(() => {
                });
                else toDelete.forEach((k) => driver.remove(k).catch(() => {
                }));
            }

            // caches are invalid until computed
            allKeysCache.valid = false;
            prefixKeysCache.forEach((c) => (c.valid = false));

            ready = true;
            _resolve();
            queueEmitReady();
        } catch (e) {
            ready = true; // still “ready” from React POV; mirror may be empty
            _reject(e);
            queueEmitReady();
        }
    })();

    return store;
}