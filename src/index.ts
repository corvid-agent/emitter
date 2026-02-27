// -- Types ----------------------------------------------------------------

/**
 * A map of event names to their payload types.
 *
 * @example
 * ```ts
 * type Events = {
 *   "user:login": { id: string; name: string };
 *   "user:logout": { id: string };
 *   "error": Error;
 * };
 * ```
 */
export type EventMap = Record<string, unknown>;

/**
 * A listener function for a specific event.
 */
export type Listener<T = unknown> = (payload: T) => void | Promise<void>;

/**
 * Options for subscribing to events.
 */
export interface OnOptions {
  /** If true, the listener is automatically removed after it fires once. */
  once?: boolean;
  /** Listener priority. Higher values fire first. Default: `0`. */
  priority?: number;
}

/**
 * A subscription handle returned by `on()` and `once()`.
 * Call `off()` to unsubscribe.
 */
export interface Subscription {
  /** Remove this listener. */
  off(): void;
}

/** @internal */
interface StoredListener<T = unknown> {
  fn: Listener<T>;
  once: boolean;
  priority: number;
}

// -- Wildcard Matching ----------------------------------------------------

/**
 * Tests whether a pattern matches an event name.
 *
 * - `*` matches a single segment (delimited by `:` or `.`).
 * - `**` matches one or more segments.
 * - Literal segments must match exactly.
 *
 * @example
 * ```ts
 * matchWildcard("user:*", "user:login");   // true
 * matchWildcard("user:*", "user:a:b");     // false
 * matchWildcard("user:**", "user:a:b");    // true
 * matchWildcard("**", "anything:at:all");   // true
 * ```
 */
export function matchWildcard(pattern: string, event: string): boolean {
  const sep = /[:.]/;
  const patternParts = pattern.split(sep);
  const eventParts = event.split(sep);

  let pi = 0;
  let ei = 0;
  let starPi = -1;
  let starEi = -1;

  while (ei < eventParts.length) {
    if (pi < patternParts.length && patternParts[pi] === "**") {
      starPi = pi;
      starEi = ei;
      pi++;
    } else if (
      pi < patternParts.length &&
      (patternParts[pi] === "*" || patternParts[pi] === eventParts[ei])
    ) {
      pi++;
      ei++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starEi++;
      ei = starEi;
    } else {
      return false;
    }
  }

  while (pi < patternParts.length && patternParts[pi] === "**") {
    pi++;
  }

  return pi === patternParts.length;
}

// -- Emitter --------------------------------------------------------------

/**
 * Type-safe event emitter with wildcard patterns and async support.
 *
 * @example
 * ```ts
 * import { Emitter } from "@corvid-agent/emitter";
 *
 * type Events = {
 *   "user:login": { id: string };
 *   "user:logout": { id: string };
 *   "error": Error;
 * };
 *
 * const emitter = new Emitter<Events>();
 *
 * emitter.on("user:login", (payload) => {
 *   console.log(`User ${payload.id} logged in`);
 * });
 *
 * emitter.emit("user:login", { id: "42" });
 * ```
 */
export class Emitter<T extends EventMap = EventMap> {
  /** @internal */
  private listeners = new Map<string, StoredListener<any>[]>();

  /** @internal */
  private wildcardListeners: { pattern: string; stored: StoredListener<any> }[] = [];

  /** @internal */
  private maxListeners = 10;

  /** @internal */
  private paused = false;

  /** @internal */
  private buffer: { event: string; payload: unknown }[] = [];

  /** @internal */
  private maxBufferSize = 1000;

  // -- Configuration ----------------------------------------------------

  /**
   * Set the maximum number of listeners per event before a warning is
   * logged. Set to `0` to disable the warning. Default: `10`.
   *
   * @returns `this` for chaining.
   *
   * @example
   * ```ts
   * emitter.setMaxListeners(50);
   * ```
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  /**
   * Set the maximum buffer size for events emitted while paused.
   * When the buffer is full, new events are silently dropped.
   * Default: `1000`.
   *
   * @returns `this` for chaining.
   */
  setMaxBufferSize(n: number): this {
    this.maxBufferSize = n;
    return this;
  }

  // -- Subscribe --------------------------------------------------------

  /**
   * Subscribe to an event. Returns a `Subscription` handle.
   *
   * Supports wildcard patterns:
   * - `"user:*"` matches `"user:login"`, `"user:logout"`, etc.
   * - `"user:**"` matches `"user:login"`, `"user:a:b:c"`, etc.
   * - `"**"` matches every event.
   *
   * @example
   * ```ts
   * const sub = emitter.on("user:login", (payload) => {
   *   console.log(payload.id);
   * });
   *
   * // Later:
   * sub.off();
   * ```
   *
   * @example
   * ```ts
   * // With options:
   * emitter.on("error", handleError, { priority: 10, once: true });
   * ```
   */
  on<K extends string & keyof T>(
    event: K,
    listener: Listener<T[K]>,
    options?: OnOptions,
  ): Subscription;
  on(event: string, listener: Listener, options?: OnOptions): Subscription;
  on(event: string, listener: Listener<any>, options: OnOptions = {}): Subscription {
    const stored: StoredListener = {
      fn: listener,
      once: options.once ?? false,
      priority: options.priority ?? 0,
    };

    const isWild = event.includes("*");

    if (isWild) {
      this.wildcardListeners.push({ pattern: event, stored });
      this.wildcardListeners.sort((a, b) => b.stored.priority - a.stored.priority);
    } else {
      let list = this.listeners.get(event);
      if (!list) {
        list = [];
        this.listeners.set(event, list);
      }
      list.push(stored);
      list.sort((a, b) => b.priority - a.priority);

      if (this.maxListeners > 0 && list.length > this.maxListeners) {
        console.warn(
          `Emitter: "${event}" has ${list.length} listeners ` +
            `(max: ${this.maxListeners}). Possible memory leak.`,
        );
      }
    }

    return {
      off: () => {
        if (isWild) {
          const idx = this.wildcardListeners.findIndex((w) => w.stored === stored);
          if (idx !== -1) this.wildcardListeners.splice(idx, 1);
        } else {
          const list = this.listeners.get(event);
          if (list) {
            const idx = list.indexOf(stored);
            if (idx !== -1) list.splice(idx, 1);
            if (list.length === 0) this.listeners.delete(event);
          }
        }
      },
    };
  }

  /**
   * Subscribe to an event for a single firing only.
   * Shorthand for `on(event, listener, { once: true })`.
   *
   * @example
   * ```ts
   * emitter.once("ready", () => {
   *   console.log("Ready!");
   * });
   * ```
   */
  once<K extends string & keyof T>(
    event: K,
    listener: Listener<T[K]>,
    options?: Omit<OnOptions, "once">,
  ): Subscription;
  once(event: string, listener: Listener, options?: Omit<OnOptions, "once">): Subscription;
  once(event: string, listener: Listener<any>, options: Omit<OnOptions, "once"> = {}): Subscription {
    return this.on(event, listener, { ...options, once: true });
  }

  // -- Emit -------------------------------------------------------------

  /**
   * Emit an event synchronously. Listeners are called in priority order.
   * If a listener returns a promise, it is **not** awaited — use `emitAsync()`
   * for that.
   *
   * Returns `true` if at least one listener was called.
   *
   * @example
   * ```ts
   * const handled = emitter.emit("user:login", { id: "42" });
   * ```
   */
  emit<K extends string & keyof T>(event: K, payload: T[K]): boolean;
  emit(event: string, payload?: unknown): boolean;
  emit(event: string, payload?: unknown): boolean {
    if (this.paused) {
      if (this.buffer.length < this.maxBufferSize) {
        this.buffer.push({ event, payload });
      }
      return false;
    }
    return this.dispatch(event, payload);
  }

  /**
   * Emit an event and `await` all listener results sequentially.
   * Listeners are called in priority order, one at a time.
   *
   * Returns `true` if at least one listener was called.
   *
   * @example
   * ```ts
   * await emitter.emitAsync("data:save", record);
   * ```
   */
  async emitAsync<K extends string & keyof T>(event: K, payload: T[K]): Promise<boolean>;
  async emitAsync(event: string, payload?: unknown): Promise<boolean>;
  async emitAsync(event: string, payload?: unknown): Promise<boolean> {
    if (this.paused) {
      if (this.buffer.length < this.maxBufferSize) {
        this.buffer.push({ event, payload });
      }
      return false;
    }
    return this.dispatchAsync(event, payload);
  }

  // -- Pause / Resume ---------------------------------------------------

  /**
   * Pause the emitter. Events emitted while paused are buffered and
   * replayed (in order) when `resume()` is called.
   *
   * @example
   * ```ts
   * emitter.pause();
   * emitter.emit("ping", {}); // buffered
   * emitter.resume();         // "ping" fires now
   * ```
   */
  pause(): this {
    this.paused = true;
    return this;
  }

  /**
   * Resume a paused emitter. Buffered events are dispatched in order.
   *
   * @returns `this` for chaining.
   */
  resume(): this {
    this.paused = false;
    const pending = this.buffer.splice(0);
    for (const { event, payload } of pending) {
      this.dispatch(event, payload);
    }
    return this;
  }

  /**
   * Resume a paused emitter asynchronously. Buffered events are dispatched
   * sequentially, awaiting each one.
   *
   * @returns `this` for chaining.
   */
  async resumeAsync(): Promise<this> {
    this.paused = false;
    const pending = this.buffer.splice(0);
    for (const { event, payload } of pending) {
      await this.dispatchAsync(event, payload);
    }
    return this;
  }

  // -- Inspect ----------------------------------------------------------

  /**
   * Return the number of listeners for a given event (excluding wildcards).
   *
   * @example
   * ```ts
   * emitter.listenerCount("user:login"); // 2
   * ```
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * Return an array of event names that have registered listeners
   * (excluding wildcard patterns).
   *
   * @example
   * ```ts
   * emitter.eventNames(); // ["user:login", "user:logout"]
   * ```
   */
  eventNames(): string[] {
    return [...this.listeners.keys()];
  }

  /**
   * Wait for the next occurrence of an event. Returns a promise that
   * resolves with the event payload.
   *
   * @example
   * ```ts
   * const payload = await emitter.wait("user:login");
   * console.log(payload.id);
   * ```
   */
  wait<K extends string & keyof T>(event: K): Promise<T[K]>;
  wait(event: string): Promise<unknown>;
  wait(event: string): Promise<unknown> {
    return new Promise((resolve) => {
      this.once(event, resolve as Listener);
    });
  }

  // -- Cleanup ----------------------------------------------------------

  /**
   * Remove all listeners for a specific event, or all listeners entirely
   * if no event is given.
   *
   * @example
   * ```ts
   * emitter.clear("user:login"); // remove all "user:login" listeners
   * emitter.clear();             // remove everything
   * ```
   */
  clear(event?: string): this {
    if (event !== undefined) {
      this.listeners.delete(event);
      this.wildcardListeners = this.wildcardListeners.filter((w) => w.pattern !== event);
    } else {
      this.listeners.clear();
      this.wildcardListeners = [];
    }
    return this;
  }

  /**
   * Remove all listeners and drain any buffered events.
   * After disposal the emitter can still be reused.
   *
   * @example
   * ```ts
   * emitter.dispose();
   * ```
   */
  dispose(): void {
    this.listeners.clear();
    this.wildcardListeners = [];
    this.buffer = [];
    this.paused = false;
  }

  // -- Internal ---------------------------------------------------------

  /** @internal */
  private dispatch(event: string, payload: unknown): boolean {
    const listeners = this.collectListeners(event);
    if (listeners.length === 0) return false;

    for (const stored of listeners) {
      stored.fn(payload);
    }

    this.pruneOnce(event, listeners);
    return true;
  }

  /** @internal */
  private async dispatchAsync(event: string, payload: unknown): Promise<boolean> {
    const listeners = this.collectListeners(event);
    if (listeners.length === 0) return false;

    for (const stored of listeners) {
      await stored.fn(payload);
    }

    this.pruneOnce(event, listeners);
    return true;
  }

  /** @internal Collect matching listeners sorted by priority. */
  private collectListeners(event: string): StoredListener[] {
    const exact = this.listeners.get(event) ?? [];
    const wild = this.wildcardListeners
      .filter((w) => matchWildcard(w.pattern, event))
      .map((w) => w.stored);

    const all = [...exact, ...wild];
    all.sort((a, b) => b.priority - a.priority);
    return all;
  }

  /** @internal Remove once-listeners after dispatch. */
  private pruneOnce(event: string, fired: StoredListener[]): void {
    const onceFired = fired.filter((s) => s.once);
    if (onceFired.length === 0) return;

    const list = this.listeners.get(event);
    if (list) {
      for (const s of onceFired) {
        const idx = list.indexOf(s);
        if (idx !== -1) list.splice(idx, 1);
      }
      if (list.length === 0) this.listeners.delete(event);
    }

    for (const s of onceFired) {
      const idx = this.wildcardListeners.findIndex((w) => w.stored === s);
      if (idx !== -1) this.wildcardListeners.splice(idx, 1);
    }
  }
}
