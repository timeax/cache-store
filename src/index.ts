// src/index.ts

export {createCache} from "./cache/create-cache";

export type {
    CacheDriver,
    CacheEntry,
    CacheKey,
    CacheKeyListener,
    CacheListener,
    CacheMeta,
    CacheStore,
    CreateCacheOptions,
} from "./cache/types";

export {shallowArrayEqual, shallowEqual} from "./cache/shallow";

export {createMemoryDriver} from "./drivers/memory";
export {createLocalStorageDriver} from "./drivers/local-storage";
export {createIndexedDBDriver} from "./drivers/indexeddb";

export {useCache} from "./react/use-cache";
export {useCacheKey} from "./react/use-cache-key";
export {useCacheSelector} from "./react/use-cache-selector";
export {useCacheReady} from "./react/use-cache-ready";
export {useCachePrefix} from "./react/use-cache-prefix";

export {withBroadcastSync} from "./sync/broadcast";