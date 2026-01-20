// src/react/use-cache.ts

import * as React from "react";
import type { CacheKey, CacheStore } from "@/cache/types";
import { useCacheStoreOptional } from "./cache-context";
import { useSyncStore } from "./use-sync-store";

type ReadFn = <V = unknown>(key: CacheKey) => V | undefined;

export type UseCacheKeyOptions<T> = {
    defaultValue?: T;
};

export type UseCacheSelectorOptions<T> = {
    keys?: readonly CacheKey[];
    isEqual?: (a: T, b: T) => boolean;
};

export type UseCachePrefixOptions<T> = {
    prefix: string;
    selector: (args: {
        keys: CacheKey[];
        read: ReadFn;
        changedKey?: CacheKey;
    }) => T;
    isEqual?: (a: T, b: T) => boolean;
};

function joinKeys(keys: readonly string[]): string {
    return keys.join("\u0000");
}

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
/* explicit cache */
export function useCache<T>(cache: CacheStore, key: CacheKey, opts?: UseCacheKeyOptions<T>): T | undefined;
export function useCache<T>(cache: CacheStore, selector: (read: ReadFn) => T, opts?: UseCacheSelectorOptions<T>): T;
export function useCache<T>(cache: CacheStore, opts: UseCachePrefixOptions<T>): T;

/* from context */
export function useCache<T>(key: CacheKey, opts?: UseCacheKeyOptions<T>): T | undefined;
export function useCache<T>(selector: (read: ReadFn) => T, opts?: UseCacheSelectorOptions<T>): T;
export function useCache<T>(opts: UseCachePrefixOptions<T>): T;

export function useCache<T>(a: any, b?: any, c?: any): any {
    // Always read context (Rules of Hooks), but only require it if no explicit cache is passed.
    const ctx = useCacheStoreOptional();

    const hasExplicitCache = isCacheStore(a);
    const cache: CacheStore | null = hasExplicitCache ? (a as CacheStore) : ctx;

    if (!cache) {
        throw new Error(
            "useCache(): no cache provided and no <CacheProvider> found. Pass a cache or wrap your tree in CacheProvider.",
        );
    }

    const arg2 = hasExplicitCache ? b : a;
    const arg3 = hasExplicitCache ? c : b;

    const read = React.useCallback(<V,>(k: CacheKey) => cache.get<V>(k), [cache]);

    // ---------------- key mode ----------------
    if (typeof arg2 === "string") {
        const key = arg2 as CacheKey;
        const opts = (arg3 as UseCacheKeyOptions<T> | undefined) ?? {};
        const defaultValue = opts.defaultValue;

        const subscribe = React.useCallback(
            (onChange: () => void) => cache.subscribeKey(key, onChange),
            [cache, key],
        );

        const getSnapshot = React.useCallback(() => {
            const v = cache.get<T>(key);
            return (v ?? defaultValue) as any;
        }, [cache, key, defaultValue]);

        const getServerSnapshot = React.useCallback(() => {
            const v = cache.get<T>(key);
            return (v ?? defaultValue) as any;
        }, [cache, key, defaultValue]);

        return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    }

    // ---------------- prefix mode ----------------
    if (typeof arg2 === "object" && arg2 && "prefix" in arg2) {
        const { prefix, selector } = arg2 as UseCachePrefixOptions<T>;
        const isEqual = (arg2 as UseCachePrefixOptions<T>).isEqual;

        const lastChangedRef = React.useRef<CacheKey | undefined>(undefined);

        const compute = React.useCallback(() => {
            const keys = cache.keys(prefix);
            return selector({
                keys,
                read,
                changedKey: lastChangedRef.current,
            });
        }, [cache, prefix, selector, read]);

        const subscribe = React.useCallback(
            (onChange: () => void) =>
                cache.subscribePrefix(prefix, (changedKey) => {
                    lastChangedRef.current = changedKey;
                    onChange();
                }),
            [cache, prefix],
        );

        return useSyncStore(subscribe, compute, isEqual);
    }

    // ---------------- selector mode ----------------
    const selector = arg2 as (read: ReadFn) => T;
    const opts = (arg3 as UseCacheSelectorOptions<T> | undefined) ?? {};
    const isEqual = opts.isEqual;

    const compute = React.useCallback(() => selector(read), [selector, read]);

    const keysDep = React.useMemo(() => (opts.keys ? joinKeys(opts.keys) : ""), [opts.keys]);

    const subscribe = React.useCallback(
        (onChange: () => void) => {
            if (opts.keys && opts.keys.length) {
                const unsubs = opts.keys.map((k) => cache.subscribeKey(k, onChange));
                return () => unsubs.forEach((u) => u());
            }
            return cache.subscribeAll(() => onChange());
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cache, keysDep],
    );

    return useSyncStore(subscribe, compute, isEqual);
}
