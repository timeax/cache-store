// src/react/use-sync-store.ts

import * as React from "react";

export function useSyncStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    compute: () => T,
    isEqual?: (a: T, b: T) => boolean,
): T {
    const lastRef = React.useRef<T | null>(null);

    const getSnapshot = React.useCallback(() => {
        const next = compute();
        const prev = lastRef.current;
        if (prev !== null && isEqual && isEqual(prev, next)) {
            return prev;
        }
        lastRef.current = next;
        return next;
    }, [compute, isEqual]);

    const getServerSnapshot = React.useCallback(() => compute(), [compute]);

    const value = React.useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );

    if (lastRef.current === null) {
        lastRef.current = value;
    }

    return value;
}
