import type { CacheStore } from "@/cache/types";

const isWindow = () => typeof window !== "undefined";

export function withBroadcastSync(
    cache: CacheStore,
    opts?: { channel?: string; ns?: string },
): { cache: CacheStore; destroy: () => void } {
    if (!isWindow() || typeof BroadcastChannel === "undefined") {
        return { cache, destroy: () => {} };
    }

    const channelName = opts?.channel ?? "react-cache-store";
    const ns = opts?.ns ?? "";

    const ch = new BroadcastChannel(channelName);

    const onMsg = (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (!msg || msg.t !== "cache:emit") return;
        if ((msg.ns ?? "") !== ns) return;
        if (typeof msg.k !== "string") return;
        cache.emit(msg.k);
    };

    ch.addEventListener("message", onMsg);

    const publish = (key: string) => {
        ch.postMessage({ t: "cache:emit", ns, k: key });
    };

    const wrapped: CacheStore = {
        ...cache,
        set(key, value, ttl) {
            cache.set(key, value as any, ttl);
            publish(key);
        },
        //@ts-ignore
        update(key, updater, ttl) {
            const v = cache.update(key as any, updater as any, ttl);
            publish(key);
            return v;
        },
        remove(key) {
            cache.remove(key);
            publish(key);
        },
    };

    const destroy = () => {
        try {
            ch.removeEventListener("message", onMsg);
            ch.close();
        } catch {
            /* ignore */
        }
    };

    return { cache: wrapped, destroy };
}