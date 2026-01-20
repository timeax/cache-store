# @timeax/cache-store

A small, driver-based **cache store** with a synchronous in-memory mirror, async persistence drivers, TTL, hydration readiness, subscriptions, and React hooks.

This is a **cache for any kind of data**, not an app state manager. It’s great for caching:

* API responses (and deduping in-flight requests)
* “workspace” blobs (snapshots, service maps, capability maps)
* derived/computed results (expensive transforms)
* UI-backed caches (filters, drafts, schemas)

---

## Install

```bash
pnpm add @timeax/cache-store
# or
npm i @timeax/cache-store
# or
yarn add @timeax/cache-store
```

---

## What you get

### Core

* `createCache()` – creates a cache instance
* TTL / expiry utilities baked into the store
* Hydration readiness (`isReady`, `readyPromise`, `subscribeReady`)
* Subscription primitives (key, prefix, all)
* `getOrSetAsync` – async cache fill with **in-flight de-dup**

### Drivers

* `createMemoryDriver()`
* `createLocalStorageDriver()`
* `createIndexedDBDriver()`

### React

* `useCache()` – unified hook (key / selector / prefix)
* `useCacheKey()`
* `useCacheSelector()`
* `useCachePrefix()`
* `useCacheReady()`

### Sync

* `withBroadcastSync()` – optional cross-tab sync layer

---

## Exports

Your package exports exactly:

```ts
export { createCache } from "./cache/create-cache";

export type {
  CacheDriver,
  CacheEntry,
  CacheKey,
  CacheKeyListener,
  CacheListener,
  CacheMeta,
  CacheStore,
  CreateCacheOptions,
} from "./cache/types";

export { shallowArrayEqual, shallowEqual } from "./cache/shallow";

export { createMemoryDriver } from "./drivers/memory";
export { createLocalStorageDriver } from "./drivers/local-storage";
export { createIndexedDBDriver } from "./drivers/indexeddb";

export { useCache } from "./react/use-cache";
export { useCacheKey } from "./react/use-cache-key";
export { useCacheSelector } from "./react/use-cache-selector";
export { useCacheReady } from "./react/use-cache-ready";
export { useCachePrefix } from "./react/use-cache-prefix";

export { withBroadcastSync } from "./sync/broadcast";
```

---

## Core concepts (in plain terms)

### CacheStore = sync reads + async persistence

The cache is designed so **reads are always synchronous**:

* Components and code can call `cache.get(key)` and get a value immediately.
* The “real” persistence layer is async (drivers), but it never blocks reads.

How?

* The cache maintains an **in-memory mirror** (`Map`) as the source of truth for reads.
* Drivers exist for hydration + best-effort persistence.

### CacheDriver = async storage backend

A driver is an async storage adapter. It powers:

* hydration: loading persisted values into the in-memory mirror on startup
* persistence: storing writes so the cache survives reloads

---

## Types (quick reference)

### CacheKey

```ts
export type CacheKey = string;
```

### CacheEntry

```ts
export interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  ttlMs?: number;
}
```

### CacheMeta

Computed at runtime from an entry.

```ts
export interface CacheMeta {
  createdAt: number;
  ttlMs?: number;
  expiresAt?: number;
  remainingMs?: number;
}
```

### CacheStore (important methods)

```ts
export interface CacheStore {
  // sync reads
  get<T = unknown>(key: CacheKey): T | undefined;
  has(key: CacheKey): boolean;
  meta(key: CacheKey): CacheMeta | null;

  // writes (mirror updates immediately; persistence is async)
  set<T = unknown>(key: CacheKey, value: T, ttlMs?: number): void;
  update<T = unknown>(
    key: CacheKey,
    updater: (prev: T | undefined) => T,
    ttlMs?: number,
  ): T;
  remove(key: CacheKey): void;

  // key utilities
  keys(prefix?: string): CacheKey[];
  clear(prefix?: string): void;
  touch(key: CacheKey, ttlMs?: number): void;

  // async helper (with in-flight de-dup)
  getOrSetAsync<T>(
    key: CacheKey,
    fetcher: () => Promise<T>,
    opts?: { ttlMs?: number; force?: boolean },
  ): Promise<T>;

  // subscriptions
  subscribeKey(key: CacheKey, cb: CacheListener): () => void;
  subscribePrefix(prefix: string, cb: CacheKeyListener): () => void;
  subscribeAll(cb: (changedKey: CacheKey) => void): () => void;
  emit(key: CacheKey): void;

  // hydration readiness
  isReady(): boolean;
  readyPromise(): Promise<void>;
  subscribeReady(cb: CacheListener): () => void;

  // batching
  batch<T>(fn: () => T): T;
}
```

---

## Creating a cache

### Memory cache (no persistence)

```ts
import { createCache, createMemoryDriver } from "@timeax/cache-store";

export const cache = createCache({
  driver: createMemoryDriver(),
  hydrate: false, // memory has nothing to hydrate
});
```

### localStorage cache (small & critical values)

```ts
import { createCache, createLocalStorageDriver } from "@timeax/cache-store";

export const cache = createCache({
  driver: createLocalStorageDriver({ ns: "app" }),
});
```

### IndexedDB cache (large payloads)

```ts
import { createCache, createIndexedDBDriver } from "@timeax/cache-store";

export const cache = createCache({
  driver: createIndexedDBDriver({ dbName: "dgp-cache", storeName: "kv", ns: "app" }),
});
```

> Driver option names depend on your driver implementations; the above shows the intended usage pattern.

---

## Basic operations

### Reading and writing

```ts
// Set a value (persists asynchronously)
cache.set("theme", "dark");

// Get a value (synchronous)
const theme = cache.get<string>("theme"); // "dark" | undefined

// Check existence
if (cache.has("theme")) { ... }

// Remove
cache.remove("theme");
```

### Updating

Atomically update a value based on its previous state:

```ts
cache.update<number>("counter", (prev) => (prev ?? 0) + 1);
```

### Clearing

```ts
// Clear all keys
cache.clear();

// Clear keys starting with "auth."
cache.clear("auth.");
```

---

## TTL / expiry behavior

* If `ttlMs` is **not** provided: entry does not expire.
* If `ttlMs` is provided: entry expires when `Date.now() - createdAt >= ttlMs`.

Expiry is enforced lazily:

* on reads (`get`, `has`, `keys`, etc.)
* optionally during hydration (`cleanupExpiredOnHydrate`)

### Example

```ts
cache.set("auth.token", "abc", 60_000); // 1 minute

const token = cache.get<string>("auth.token");

const meta = cache.meta("auth.token");
// meta.remainingMs, meta.expiresAt, ...
```

### Touch

Refreshes the entry’s `createdAt` (and optionally TTL), keeping the same value:

```ts
cache.touch("auth.token");
cache.touch("auth.token", 5 * 60_000); // set/override ttl
```

---

## Hydration readiness

If `hydrate` is enabled (default), the cache will load driver data into memory. Readiness is exposed as:

* `cache.isReady()`
* `cache.readyPromise()`
* `cache.subscribeReady(cb)`

Typical UI flow:

* Render a loader until ready, or allow rendering and rely on cache updates.

```ts
await cache.readyPromise().catch(() => {
  // hydration failed (driver error), but cache still works with an empty mirror
});
```

---

## Subscriptions (non-React)

Subscriptions are the foundation used by React hooks.

### Key subscription

```ts
const unsub = cache.subscribeKey("auth.user", () => {
  // runs whenever auth.user changes
});
```

### Prefix subscription

```ts
const unsub = cache.subscribePrefix("workspace:", (changedKey) => {
  console.log("changed:", changedKey);
});
```

### Global subscription

```ts
const unsub = cache.subscribeAll((changedKey) => {
  // runs for any change
});
```

### emit(key)

Notify listeners without changing data. Useful for cross-tab sync bridges or manual invalidation.

```ts
cache.emit("workspace:123:snapshot");
```

### batch(fn)

Coalesces emissions until the batch ends.

```ts
cache.batch(() => {
  cache.set("a", 1);
  cache.set("b", 2);
  cache.remove("c");
});
```

---

## React: hook usage (in depth)

All hooks support **two calling styles**:

1. **Explicit cache**

```ts
useCacheKey(cache, "auth.user")
```

2. **Context cache** (no cache arg)

```tsx
// (requires provider)
useCacheKey("auth.user")
```

If you use the context style, wrap your tree:

```tsx
import { CacheProvider } from "@timeax/cache-store";

<CacheProvider cache={cache}>
  <App />
</CacheProvider>
```

If you **don’t** want a Provider, pass the cache explicitly.

---

# 1) useCacheReady

### Purpose

Reactively tracks cache hydration readiness.

### Types

```ts
export function useCacheReady(cache?: CacheStore): boolean;
```

### Example (context)

```tsx
import { useCacheReady } from "@timeax/cache-store";

function BootGate({ children }: { children: React.ReactNode }) {
  const ready = useCacheReady();
  if (!ready) return <div>Hydrating cache…</div>;
  return <>{children}</>;
}
```

### Example (explicit)

```tsx
const ready = useCacheReady(cache);
```

---

# 2) useCacheKey

### Purpose

Subscribe to a **single key** and re-render when that key changes.

### Types

```ts
export function useCacheKey<T>(
  cache: CacheStore,
  key: string,
  opts?: { defaultValue?: T },
): T | undefined;

export function useCacheKey<T>(
  key: string,
  opts?: { defaultValue?: T },
): T | undefined;
```

### Example: typed read

```tsx
import { useCacheKey } from "@timeax/cache-store";

type User = { id: string; name: string };

function Profile() {
  const user = useCacheKey<User>("auth.user");
  return <div>{user ? user.name : "Guest"}</div>;
}
```

### Example: defaultValue

```tsx
const token = useCacheKey<string>("auth.token", { defaultValue: "" });
```

### When to use

* You care about exactly one key.
* You want minimal re-renders.

---

# 3) useCacheSelector

### Purpose

Subscribe to a **fixed list of keys** and compute a derived value.

This gives you “selector” behavior without subscribing to the entire cache.

### Types

```ts
type ReadFn = <V = unknown>(key: string) => V | undefined;

export function useCacheSelector<T>(
  cache: CacheStore,
  keys: readonly string[],
  selector: (read: ReadFn) => T,
  opts?: { isEqual?: (a: T, b: T) => boolean },
): T;

export function useCacheSelector<T>(
  keys: readonly string[],
  selector: (read: ReadFn) => T,
  opts?: { isEqual?: (a: T, b: T) => boolean },
): T;
```

### Example: combine a few keys

```tsx
import { useCacheSelector } from "@timeax/cache-store";

type User = { id: string; name: string };

function SessionBadge() {
  const session = useCacheSelector(
    ["auth.token", "auth.user"],
    (read) => ({
      token: read<string>("auth.token"),
      user: read<User>("auth.user"),
    }),
  );

  if (!session.token) return <span>Guest</span>;
  return <span>Hi {session.user?.name ?? "…"}</span>;
}
```

### Example: isEqual to reduce rerenders

If your selector returns objects/arrays, you may want an equality function.

```tsx
const v = useCacheSelector(
  ["a", "b"],
  (read) => ({ a: read<number>("a"), b: read<number>("b") }),
  { isEqual: (x, y) => x.a === y.a && x.b === y.b },
);
```

### When to use

* You know the dependency keys.
* You want a derived value.

---

# 4) useCachePrefix

### Purpose

Subscribe to **all changes under a prefix** and compute a derived “namespace view”.

Use this when the set of keys is dynamic.

### Types

```ts
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

export function useCachePrefix<T>(
  prefix: string,
  selector: (args: {
    keys: CacheKey[];
    read: <V = unknown>(key: CacheKey) => V | undefined;
    changedKey?: CacheKey;
  }) => T,
  opts?: { isEqual?: (a: T, b: T) => boolean },
): T;
```

### Example: build a list from a prefix

```tsx
import { useCachePrefix } from "@timeax/cache-store";

type Snapshot = { id: string; updatedAt: number };

function WorkspaceList() {
  const view = useCachePrefix(
    "workspace:",
    ({ keys, read, changedKey }) => {
      const snapshots = keys
        .filter((k) => k.endsWith(":snapshot"))
        .map((k) => read<Snapshot>(k))
        .filter(Boolean) as Snapshot[];

      snapshots.sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        changedKey,
        count: snapshots.length,
        snapshots,
      };
    },
  );

  return (
    <div>
      <div>Count: {view.count}</div>
      {view.changedKey ? <div>Last change: {view.changedKey}</div> : null}
    </div>
  );
}
```

### When to use

* A namespace of keys can grow/shrink.
* You need to compute a prefix “view”.

---

# 5) useCache (unified)

### Purpose

A single hook that supports:

* key usage (like `useCacheKey`)
* selector usage (like `useCacheSelector` / store-wide selector)
* prefix usage (like `useCachePrefix`)

Exactly which call signatures you support depend on your `useCache` implementation, but the intended patterns are:

### Key form

```tsx
const token = useCache<string>("auth.token");
// or
const token = useCache<string>(cache, "auth.token");
```

### Selector form

```tsx
const session = useCache(
  (read) => ({ token: read<string>("auth.token"), user: read("auth.user") }),
  { keys: ["auth.token", "auth.user"] },
);
```

### Prefix form

```tsx
const view = useCache({
  prefix: "workspace:",
  selector: ({ keys, read }) => keys.map((k) => read(k)),
});
```

If you prefer explicit hooks for clarity, you can ignore `useCache` entirely.

---

## Patterns and best practices

### Key naming

Adopt stable prefixes; it makes `clear(prefix)` and `useCachePrefix(prefix)` extremely powerful.

Examples:

* `auth.token`, `auth.user`
* `workspace:123:snapshot`, `workspace:123:serviceMap`
* `provider:meta:<id>`

### Async caching with getOrSetAsync

A common React pattern:

1. `useCacheKey` to read
2. `useEffect` that calls `getOrSetAsync` if missing

```tsx
import * as React from "react";
import { useCacheKey } from "@timeax/cache-store";

type User = { id: string; name: string };

function Users({ cache }: { cache: any }) {
  const users = useCacheKey<User[]>(cache, "users:list");

  React.useEffect(() => {
    if (users !== undefined) return;

    cache.getOrSetAsync<User[]>(
      "users:list",
      async () => {
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error("Failed");
        return res.json();
      },
      { ttlMs: 30_000 },
    ).catch(() => {});
  }, [cache, users]);

  if (users === undefined) return <div>Loading…</div>;
  return <pre>{JSON.stringify(users, null, 2)}</pre>;
}
```

Because `getOrSetAsync` dedupes in-flight work, multiple components can request the same key safely.

### Equality helpers

For selectors, your package exports:

* `shallowEqual`
* `shallowArrayEqual`

Use them to reduce re-renders:

```tsx
import { shallowEqual, useCacheSelector } from "@timeax/cache-store";

const session = useCacheSelector(
  ["auth.token", "auth.user"],
  (read) => ({ token: read("auth.token"), user: read("auth.user") }),
  { isEqual: shallowEqual },
);
```

---

## Cross-tab sync (optional)

`withBroadcastSync(cache, opts)` wraps your cache instance to enable cross-tab synchronization using `BroadcastChannel`.

**Note:** You must use the returned `cache` wrapper for writes (`set`, `update`, `remove`) to be broadcasted to other tabs.

```ts
import { createCache, withBroadcastSync } from "@timeax/cache-store";

const originalCache = createCache({ ... });

const { cache, destroy } = withBroadcastSync(originalCache, { 
  channel: "my-app-cache" 
});

// Use 'cache' in your app / provider
// cache.set("foo", "bar") -> broadcasts "foo" to other tabs
```

Incoming messages from other tabs will trigger `emit(key)` on the underlying cache, notifying all local listeners.

---

## License

MIT
