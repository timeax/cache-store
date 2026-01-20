import type {CacheEntry, CacheMeta} from "./types";

export const now = () => Date.now();

export function isAlive(e: CacheEntry | null | undefined): boolean {
    if (!e) return false;
    if (!e.ttlMs) return true;
    return now() - e.createdAt < e.ttlMs;
}

export function computeMeta(e: CacheEntry | null | undefined): CacheMeta | null {
    if (!e) return null;

    const createdAt = e.createdAt;
    const ttlMs = e.ttlMs;

    if (!ttlMs) return {createdAt};

    const expiresAt = createdAt + ttlMs;
    const remainingMs = Math.max(0, expiresAt - now());

    return {createdAt, ttlMs, expiresAt, remainingMs};
}