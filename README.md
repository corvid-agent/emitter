# @corvid-agent/emitter

[![CI](https://github.com/corvid-agent/emitter/actions/workflows/ci.yml/badge.svg)](https://github.com/corvid-agent/emitter/actions/workflows/ci.yml)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Type-safe event emitter with wildcards, async support, and backpressure. Zero deps. TypeScript-first.

## Install

```bash
npm install @corvid-agent/emitter
```

## Usage

### Basic Events

```ts
import { Emitter } from "@corvid-agent/emitter";

type Events = {
  "user:login": { id: string; name: string };
  "user:logout": { id: string };
  "error": Error;
};

const emitter = new Emitter<Events>();

// Subscribe — fully typed payload
emitter.on("user:login", (payload) => {
  console.log(`${payload.name} logged in`);
});

// Emit
emitter.emit("user:login", { id: "42", name: "Alice" });
```

### Unsubscribe

```ts
const sub = emitter.on("user:login", handler);

// Later:
sub.off();
```

### Once

```ts
emitter.once("ready", (payload) => {
  console.log("Fired once, then auto-removed");
});
```

### Wildcard Patterns

`*` matches a single segment. `**` matches one or more segments. Segments are delimited by `:` or `.`.

```ts
// Matches "user:login", "user:logout", etc.
emitter.on("user:*", (payload) => { ... });

// Matches "user:profile:update", "user:a:b:c", etc.
emitter.on("user:**", (payload) => { ... });

// Catch-all — matches every event
emitter.on("**", (payload) => { ... });
```

### Priority

Higher priority listeners fire first. Default priority is `0`.

```ts
emitter.on("save", backupHandler, { priority: 10 });
emitter.on("save", logHandler, { priority: 1 });
// backupHandler fires before logHandler
```

### Async Emission

`emitAsync()` awaits each listener sequentially in priority order.

```ts
emitter.on("data:save", async (record) => {
  await db.insert(record);
});

emitter.on("data:save", async (record) => {
  await cache.invalidate(record.id);
});

// Both complete before emitAsync resolves
await emitter.emitAsync("data:save", record);
```

### Pause & Resume

Buffer events while paused, replay them on resume.

```ts
emitter.pause();

emitter.emit("tick", 1); // buffered
emitter.emit("tick", 2); // buffered

emitter.resume(); // both fire now, in order
```

Use `resumeAsync()` to await async listeners during replay.

### Wait for an Event

```ts
const payload = await emitter.wait("user:login");
console.log(payload.id);
```

### Pipe (Event Forwarding)

Compose emitters by piping events from one to another.

```ts
const source = new Emitter<Events>();
const sink = new Emitter<Events>();

// Forward all events
const sub = source.pipe(sink);

// Forward specific events only
source.pipe(sink, ["user:login", "user:logout"]);

// Forward by wildcard pattern
source.pipe(sink, "user:*");

// Disconnect the pipe
sub.off();
```

Pipes can be chained: `a.pipe(b)` then `b.pipe(c)` forwards events from `a` through `b` to `c`.

## API Reference

### `new Emitter<T>()`

Create a new emitter. `T` is an `EventMap` — a record of event names to payload types.

### `.on(event, listener, options?): Subscription`

Subscribe to an event. Returns a `Subscription` with an `off()` method.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `once` | `boolean` | `false` | Auto-remove after first firing |
| `priority` | `number` | `0` | Higher values fire first |

### `.once(event, listener, options?): Subscription`

Shorthand for `.on(event, listener, { once: true })`.

### `.emit(event, payload): boolean`

Emit synchronously. Returns `true` if any listener was called.

### `.emitAsync(event, payload): Promise<boolean>`

Emit and await all listeners sequentially.

### `.pause(): this`

Pause emission. Events are buffered until `resume()`.

### `.resume(): this`

Resume and replay buffered events synchronously.

### `.resumeAsync(): Promise<this>`

Resume and replay buffered events, awaiting each.

### `.wait(event): Promise<T[K]>`

Returns a promise that resolves on the next emission of `event`.

### `.listenerCount(event): number`

Number of listeners for a specific event (excludes wildcards).

### `.eventNames(): string[]`

Array of event names with registered listeners (excludes wildcards).

### `.pipe(target, filter?): Subscription`

Forward events to another emitter. `filter` can be:
- omitted — forward all events
- `string[]` — forward only the listed event names
- `string` — forward events matching a wildcard pattern

Returns a `Subscription` whose `off()` disconnects the pipe.

### `.clear(event?): this`

Remove listeners for a specific event, or all listeners if no event given.

### `.dispose(): void`

Remove all listeners, drain buffers, unpause.

### `.setMaxListeners(n): this`

Set max listeners per event before a warning is logged. Default: `10`. Set to `0` to disable.

### `.setMaxBufferSize(n): this`

Set max buffer size for paused events. Default: `1000`.

### `matchWildcard(pattern, event): boolean`

Standalone utility. Test if a wildcard pattern matches an event name.

## License

MIT
