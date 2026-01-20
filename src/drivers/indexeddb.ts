import type { CacheDriver, CacheEntry, CacheKey } from "@/cache/types";

const isWindow = () => typeof window !== "undefined";

type Row = { k: string; e: CacheEntry };

export function createIndexedDBDriver(opts?: {
    dbName?: string;
    storeName?: string;
    ns?: string;
}): CacheDriver {
    const dbName = opts?.dbName ?? "react-cache-store";
    const storeName = opts?.storeName ?? "kv";
    const ns = opts?.ns ?? "rcs";
    const prefix = `${ns}:`;

    if (!isWindow() || !("indexedDB" in window)) {
        // fall back to in-memory-ish behavior via a tiny map (still async API)
        const m = new Map<string, CacheEntry>();
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
            async keys(p) {
                const out: string[] = [];
                for (const k of m.keys()) {
                    if (p && !k.startsWith(p)) continue;
                    out.push(k);
                }
                return out;
            },
        };
    }

    let db: IDBDatabase | null = null;

    const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
            const req = window.indexedDB.open(dbName, 1);

            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains(storeName)) {
                    d.createObjectStore(storeName, { keyPath: "k" });
                }
            };

            req.onsuccess = () => {
                const d = req.result;
                d.onversionchange = () => {
                    try {
                        d.close();
                    } catch {
                        /* ignore */
                    }
                    db = null;
                };
                resolve(d);
            };

            req.onerror = () => reject(req.error);
        });

    const withStore = (mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void) =>
        new Promise<void>(async (resolve, reject) => {
            try {
                if (!db) db = await open();
                const tx = db.transaction(storeName, mode);
                const s = tx.objectStore(storeName);
                fn(s);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error ?? new Error("IDB tx aborted"));
            } catch (e) {
                reject(e);
            }
        });

    const getRow = (fullKey: string) =>
        new Promise<Row | null>(async (resolve, reject) => {
            try {
                if (!db) db = await open();
                const tx = db.transaction(storeName, "readonly");
                const s = tx.objectStore(storeName);
                const req = s.get(fullKey);
                req.onsuccess = () => resolve((req.result as Row) ?? null);
                req.onerror = () => reject(req.error);
            } catch (e) {
                reject(e);
            }
        });

    const getAllRows = () =>
        new Promise<Row[]>(async (resolve, reject) => {
            try {
                if (!db) db = await open();
                const tx = db.transaction(storeName, "readonly");
                const s = tx.objectStore(storeName);
                const req = s.getAll();
                req.onsuccess = () => resolve((req.result as Row[]) ?? []);
                req.onerror = () => reject(req.error);
            } catch (e) {
                reject(e);
            }
        });

    return {
        async get(key: CacheKey) {
            const row = await getRow(prefix + key);
            return row?.e ?? null;
        },

        async set(key: CacheKey, entry: CacheEntry | null) {
            if (!entry) {
                await this.remove(key);
                return;
            }
            await withStore("readwrite", (s) => {
                s.put({ k: prefix + key, e: entry } as Row);
            });
        },

        async remove(key: CacheKey) {
            await withStore("readwrite", (s) => {
                s.delete(prefix + key);
            });
        },

        async keys(p?: string) {
            const rows = await getAllRows();
            const out: string[] = [];
            const want = prefix + (p ?? "");
            for (const r of rows) {
                if (!r.k.startsWith(prefix)) continue;
                if (p && !r.k.startsWith(want)) continue;
                out.push(r.k.slice(prefix.length));
            }
            return out;
        },

        async getMany(keys: CacheKey[]) {
            // Simple: multiple gets. You can optimize later with a cursor if needed.
            const out: Array<{ key: CacheKey; entry: CacheEntry | null }> = [];
            for (const k of keys) out.push({ key: k, entry: await this.get(k) });
            return out;
        },

        async removeMany(keys: CacheKey[]) {
            await withStore("readwrite", (s) => {
                for (const k of keys) s.delete(prefix + k);
            });
        },

        async clearPrefix(p: string) {
            // Cursor delete matching prefix
            const want = prefix + p;
            await withStore("readwrite", (s) => {
                const req = s.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result as IDBCursorWithValue | null;
                    if (!cursor) return;
                    const row = cursor.value as Row;
                    if (typeof row?.k === "string" && row.k.startsWith(want)) {
                        cursor.delete();
                    }
                    cursor.continue();
                };
            });
        },
    };
}