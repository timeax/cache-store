import type { CacheDriver, CacheEntry, CacheKey } from "@/cache/types";

const isWindow = () => typeof window !== "undefined";

export function createLocalStorageDriver(opts?: { ns?: string }): CacheDriver {
    const ns = opts?.ns ?? "rcs";
    const prefix = `${ns}:`;

    const read = (key: CacheKey): CacheEntry | null => {
        if (!isWindow() || !window.localStorage) return null;
        const raw = window.localStorage.getItem(prefix + key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as CacheEntry;
        } catch {
            return null;
        }
    };

    const write = (key: CacheKey, entry: CacheEntry | null) => {
        if (!isWindow() || !window.localStorage) return;
        if (!entry) {
            window.localStorage.removeItem(prefix + key);
            return;
        }
        try {
            window.localStorage.setItem(prefix + key, JSON.stringify(entry));
        } catch {
            /* ignore quota/serialization */
        }
    };

    const remove = (key: CacheKey) => {
        if (!isWindow() || !window.localStorage) return;
        window.localStorage.removeItem(prefix + key);
    };

    const keys = (p?: string) => {
        if (!isWindow() || !window.localStorage) return [];
        const out: string[] = [];
        const wantPrefix = prefix + (p ?? "");
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k) continue;
            if (!k.startsWith(prefix)) continue;
            if (p && !k.startsWith(wantPrefix)) continue;
            out.push(k.slice(prefix.length));
        }
        return out;
    };

    return {
        async get(key) {
            return read(key);
        },
        async set(key, entry) {
            write(key, entry);
        },
        async remove(key) {
            remove(key);
        },
        async keys(prefixFilter) {
            return keys(prefixFilter);
        },
        async getMany(ks) {
            return ks.map((k) => ({ key: k, entry: read(k) }));
        },
        async removeMany(ks) {
            ks.forEach(remove);
        },
        async clearPrefix(p) {
            keys(p).forEach(remove);
        },
    };
}