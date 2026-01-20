// src/react/use-cache-prefix.ts

import * as React from "react";
import type {CacheKey, CacheStore} from "@/cache/types";
import {useSyncStore} from "./use-sync-store";
import {useCacheStoreOptional} from "@/react/cache-context"; // adjust if your path differs

function isCacheStore(x: any): x is CacheStore {
    return (
        !!x &&
        typeof x === "object" &&
        typeof x.get === "function" &&
        typeof x.set === "function" &&
        typeof x.subscribeKey === "function" &&
        typeof x.subscribeAll === "function"
    );
}

/* ------------------------------ overloads ------------------------------ */

// explicit cache
export function useCachePrefix<T>(
    cache: CacheStore,
    prefix: string,
    selector: (args: {
        keys: CacheKey[];
        read: <V = unknown>(key: CacheKey) => V | undefined;
        changedKey?: CacheKey;
    }) => T,
    opts?: { isEqual?: (a: T, b: T) => boolean },
): T;

// from context
export function useCachePrefix<T>(
    prefix: string,
    selector: (args: {
        keys: CacheKey[];
        read: <V = unknown>(key: CacheKey) => V | undefined;
        changedKey?: CacheKey;
    }) => T,
    opts?: { isEqual?: (a: T, b: T) => boolean },
): T;

/* -------------------------------- impl -------------------------------- */

export function useCachePrefix<T>(
    a: CacheStore | string,
    b: string | ((args: any) => T),
    c?: ((args: any) => T) | { isEqual?: (a: T, b: T) => boolean },
    d?: { isEqual?: (a: T, b: T) => boolean },
): T {
    // Always read context (Rules of Hooks), but only require it if cache is not passed.
    const ctx = useCacheStoreOptional();

    const hasExplicitCache = isCacheStore(a);
    const cache: CacheStore | null = hasExplicitCache ? (a as CacheStore) : ctx;

    if (!cache) {
        throw new Error(
            "useCachePrefix(): no cache provided and no <CacheProvider> found. Pass a cache or wrap your tree in CacheProvider.",
        );
    }

    const prefix = (hasExplicitCache ? (b as string) : (a as string)) ?? "";
    const selector = (hasExplicitCache ? (c as any) : (b as any)) as (args: {
        keys: CacheKey[];
        read: <V = unknown>(key: CacheKey) => V | undefined;
        changedKey?: CacheKey;
    }) => T;
    const opts = (hasExplicitCache ? (d as any) : (c as any)) as { isEqual?: (a: T, b: T) => boolean } | undefined;

    const read = React.useCallback(<V, >(k: CacheKey) => cache.get<V>(k), [cache]);

    const lastChangedRef = React.useRef<CacheKey | undefined>(undefined);
    const isEqual = opts?.isEqual;

    const compute = React.useCallback(() => {
        const keys = cache.keys(prefix);
        return selector({
            keys,
            read,
            changedKey: lastChangedRef.current,
        });
    }, [cache, prefix, selector, read]);

    const subscribe = React.useCallback(
        (onStoreChange: () => void) =>
            cache.subscribePrefix(prefix, (changedKey) => {
                lastChangedRef.current = changedKey;
                onStoreChange();
            }),
        [cache, prefix],
    );

    return useSyncStore(subscribe, compute, isEqual);
}