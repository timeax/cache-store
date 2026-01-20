import type { CacheDriver, CacheEntry, CacheKey } from "@/cache/types";

export function createMemoryDriver(): CacheDriver {
    const m = new Map<CacheKey, CacheEntry>();

    return {
        async get(key) {
            return m.get(key) ?? null;
        },
        async set(key, entry) {
            if (!entry) m.delete(key);
            else m.set(key, entry);
        },
        async remove(key) {
            m.delete(key);
        },
        async keys(prefix) {
            const out: string[] = [];
            for (const k of m.keys()) {
                if (prefix && !k.startsWith(prefix)) continue;
                out.push(k);
            }
            return out;
        },
        async getMany(keys) {
            return keys.map((k) => ({ key: k, entry: m.get(k) ?? null }));
        },
        async removeMany(keys) {
            for (const k of keys) m.delete(k);
        },
        async clearPrefix(prefix) {
            for (const k of Array.from(m.keys())) {
                if (k.startsWith(prefix)) m.delete(k);
            }
        },
    };
}