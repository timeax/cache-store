// src/react/cache-context.tsx

import * as React from "react";
import type { CacheStore } from "@/cache/types";

const CacheStoreContext = React.createContext<CacheStore | null>(null);

export interface CacheProviderProps {
    cache: CacheStore;
    children: React.ReactNode;
}

export function CacheProvider({ cache, children }: CacheProviderProps) {
    return <CacheStoreContext.Provider value={cache}>{children}</CacheStoreContext.Provider>;
}

/**
 * Optional context accessor (never throws).
 * Useful for hooks that accept an explicit cache OR context.
 */
export function useCacheStoreOptional(): CacheStore | null {
    return React.useContext(CacheStoreContext);
}

/**
 * Strict context accessor (throws if missing).
 * Useful when you want to enforce that a Provider exists.
 */
export function useCacheStore(): CacheStore {
    const cache = React.useContext(CacheStoreContext);
    if (!cache) {
        throw new Error(
            "CacheStoreContext is missing. Wrap your tree in <CacheProvider cache={...} /> or pass the cache explicitly.",
        );
    }
    return cache;
}