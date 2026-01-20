import * as React from "react";
import type {CacheStore} from "@/cache/types";
import {useCacheStoreOptional} from "@/react/cache-context"; // adjust path if needed

type ReadFn = <V = unknown>(key: string) => V | undefined;

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
export function useCacheSelector<T>(
    cache: CacheStore,
    keys: readonly string[],
    selector: (read: ReadFn) => T,
    opts?: { isEqual?: (a: T, b: T) => boolean },
): T;

// from context
export function useCacheSelector<T>(
    keys: readonly string[],
    selector: (read: ReadFn) => T,
    opts?: { isEqual?: (a: T, b: T) => boolean },
): T;

/* -------------------------------- impl -------------------------------- */

export function useCacheSelector<T>(
    a: CacheStore | readonly string[],
    b: readonly string[] | ((read: ReadFn) => T),
    c?: ((read: ReadFn) => T) | { isEqual?: (a: T, b: T) => boolean },
    d?: { isEqual?: (a: T, b: T) => boolean },
): T {
    // Always read context (Rules of Hooks) but only require it if cache is not passed.
    const ctx = useCacheStoreOptional();

    const hasExplicitCache = isCacheStore(a);
    const cache: CacheStore | null = hasExplicitCache ? (a as CacheStore) : ctx;

    if (!cache) {
        throw new Error(
            "useCacheSelector(): no cache provided and no <CacheProvider> found. Pass a cache or wrap your tree in CacheProvider.",
        );
    }

    const keys = (hasExplicitCache ? (b as readonly string[]) : (a as readonly string[])) ?? [];
    const selector = (hasExplicitCache ? (c as (read: ReadFn) => T) : (b as (read: ReadFn) => T)) as (
        read: ReadFn,
    ) => T;
    const opts = (hasExplicitCache ? (d as any) : (c as any)) as { isEqual?: (a: T, b: T) => boolean } | undefined;

    const keysKey = React.useMemo(() => keys.join("\u0000"), [keys]);

    const read = React.useCallback(<V, >(k: string) => cache.get<V>(k), [cache]);

    const compute = React.useCallback(() => selector(read), [selector, read]);

    const lastRef = React.useRef<T | null>(null);
    const isEqual = opts?.isEqual;

    const getSnapshot = React.useCallback(() => {
        const next = compute();
        const prev = lastRef.current;
        if (prev !== null && isEqual && isEqual(prev, next)) return prev;
        lastRef.current = next;
        return next;
    }, [compute, isEqual]);

    const subscribe = React.useCallback(
        (onStoreChange: () => void) => {
            const unsubs = keys.map((k) => cache.subscribeKey(k, onStoreChange));
            return () => unsubs.forEach((u) => u());
        },
        [cache, keysKey],
    );

    const getServerSnapshot = React.useCallback(() => compute(), [compute]);

    const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    if (lastRef.current === null) lastRef.current = value;
    return value;
}