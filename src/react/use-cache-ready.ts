// src/react/use-cache-ready.ts

import * as React from "react";
import type {CacheStore} from "@/cache/types";
import {useCacheStoreOptional} from "./cache-context";

function isCacheStore(x: any): x is CacheStore {
    return (
        !!x &&
        typeof x === "object" &&
        typeof x.isReady === "function" &&
        typeof x.subscribeReady === "function"
    );
}

/**
 * Read hydration readiness as reactive state.
 * - useCacheReady(cache)
 * - useCacheReady() // from context
 */
export function useCacheReady(cacheArg?: CacheStore): boolean {
    // Always read context (Rules of Hooks), but don't throw unless needed.
    const ctx = useCacheStoreOptional();

    const cache = isCacheStore(cacheArg) ? cacheArg : ctx;
    if (!cache) {
        throw new Error(
            "useCacheReady(): no cache provided and no <CacheProvider> found. Pass a cache or wrap your tree in CacheProvider.",
        );
    }

    const subscribe = React.useCallback(
        (onChange: () => void) => cache.subscribeReady(onChange),
        [cache],
    );

    const getSnapshot = React.useCallback(() => cache.isReady(), [cache]);

    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}