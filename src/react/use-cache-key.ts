import * as React from "react";
import type {CacheStore} from "@/cache/types";
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
export function useCacheKey<T>(
    cache: CacheStore,
    key: string,
    opts?: { defaultValue?: T },
): T | undefined;

// from context
export function useCacheKey<T>(
    key: string,
    opts?: { defaultValue?: T },
): T | undefined;

/* -------------------------------- impl -------------------------------- */

export function useCacheKey<T>(
    a: CacheStore | string,
    b?: string | { defaultValue?: T },
    c?: { defaultValue?: T },
): T | undefined {
    // Always read context (Rules of Hooks), but only require it if cache is not passed.
    const ctx = useCacheStoreOptional();

    const hasExplicitCache = isCacheStore(a);
    const cache: CacheStore | null = hasExplicitCache ? (a as CacheStore) : ctx;

    if (!cache) {
        throw new Error(
            "useCacheKey(): no cache provided and no <CacheProvider> found. Pass a cache or wrap your tree in CacheProvider.",
        );
    }

    const key = (hasExplicitCache ? (b as string) : (a as string)) ?? "";
    const opts = (hasExplicitCache ? (c as any) : (b as any)) as { defaultValue?: T } | undefined;

    const subscribe = React.useCallback(
        (onStoreChange: () => void) => cache.subscribeKey(key, onStoreChange),
        [cache, key],
    );

    const getSnapshot = React.useCallback(() => {
        const v = cache.get<T>(key);
        return (v ?? opts?.defaultValue) as any;
    }, [cache, key, opts?.defaultValue]);

    const getServerSnapshot = React.useCallback(() => {
        const v = cache.get<T>(key);
        return (v ?? opts?.defaultValue) as any;
    }, [cache, key, opts?.defaultValue]);

    const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return (value ?? opts?.defaultValue) as any;
}