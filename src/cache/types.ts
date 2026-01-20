// src/cache/types.ts

export type CacheKey = string;

export interface CacheMeta {
    createdAt: number;
    ttlMs?: number;
    expiresAt?: number;
    remainingMs?: number;
}

export interface CacheEntry<T = unknown> {
    value: T;
    createdAt: number;
    ttlMs?: number;
}

/**
 * Async persistence driver.
 * The cache maintains a sync in-memory mirror; drivers are used for persistence + hydration.
 */
export interface CacheDriver {
    /** Read one persisted entry (or null). */
    get(key: CacheKey): Promise<CacheEntry | null>;

    /** Persist one entry (or delete if null). */
    set(key: CacheKey, entry: CacheEntry | null): Promise<void>;

    /** Remove one key. */
    remove(key: CacheKey): Promise<void>;

    /**
     * List keys (optionally prefix filtered).
     * Used for hydration and clear(prefix).
     */
    keys(prefix?: string): Promise<CacheKey[]>;

    /** Bulk read entries (optional optimization). */
    getMany?(keys: CacheKey[]): Promise<Array<{ key: CacheKey; entry: CacheEntry | null }>>;

    /** Bulk remove keys (optional optimization). */
    removeMany?(keys: CacheKey[]): Promise<void>;

    /** Clear by prefix (optional optimization). */
    clearPrefix?(prefix: string): Promise<void>;
}

export type CacheListener = () => void;
export type CacheKeyListener = (changedKey: CacheKey) => void;

export interface CacheStore {
    // ----- sync reads (from mirror) -----
    get<T = unknown>(key: CacheKey): T | undefined;

    has(key: CacheKey): boolean;

    meta(key: CacheKey): CacheMeta | null;

    // ----- writes (update mirror + persist async) -----
    set<T = unknown>(key: CacheKey, value: T, ttlMs?: number): void;

    update<T = unknown>(
        key: CacheKey,
        updater: (prev: T | undefined) => T,
        ttlMs?: number,
    ): T;

    remove(key: CacheKey): void;

    // ----- utilities -----
    keys(prefix?: string): CacheKey[];

    clear(prefix?: string): void;

    touch(key: CacheKey, ttlMs?: number): void;

    // ----- async helpers -----
    getOrSetAsync<T>(
        key: CacheKey,
        fetcher: () => Promise<T>,
        opts?: { ttlMs?: number; force?: boolean },
    ): Promise<T>;

    // ----- subscriptions -----
    subscribeKey(key: CacheKey, cb: CacheListener): () => void;

    /** Prefix listeners receive the *changed key*. */
    subscribePrefix(prefix: string, cb: CacheKeyListener): () => void;

    /** Global listeners receive the *changed key*. */
    subscribeAll(cb: CacheKeyListener): () => void;

    /** Notify listeners without mutating. Useful for cross-tab bridges. */
    emit(key: CacheKey): void;

    // ----- hydration readiness -----
    isReady(): boolean;

    /**
     * Always returns the same readiness promise:
     * - resolves when hydration completes (or immediately if hydrate=false)
     * - rejects if hydration fails
     */
    readyPromise(): Promise<void>;

    subscribeReady(cb: CacheListener): () => void;

    // ----- batching -----
    batch<T>(fn: () => T): T;
}

export interface CreateCacheOptions {
    driver: CacheDriver;

    /**
     * If true, hydrate mirror from driver at creation time.
     * Default true.
     */
    hydrate?: boolean;

    /**
     * If true, eager-clean expired entries during hydration.
     * Default true.
     */
    cleanupExpiredOnHydrate?: boolean;
}