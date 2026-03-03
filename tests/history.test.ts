import { describe, test, expect, mock } from "bun:test";
import { Emitter, type HistoryEntry } from "../src/index";

describe("Event History / Replay", () => {
  // -- History disabled by default ----------------------------------------

  describe("history disabled by default", () => {
    test("no events stored when history option is not set", () => {
      const emitter = new Emitter<{ ping: string }>();

      emitter.emit("ping", "hello");
      emitter.emit("ping", "world");

      expect(emitter.getHistory()).toEqual([]);
    });

    test("no events stored when history is false", () => {
      const emitter = new Emitter<{ ping: string }>({ history: false });

      emitter.emit("ping", "hello");

      expect(emitter.getHistory()).toEqual([]);
    });

    test("replay() still subscribes for future events when history is disabled", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      emitter.replay("ping", fn);
      emitter.emit("ping", "live");

      // No replay (nothing in history), but future events work
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("live");
    });
  });

  // -- History enabled with unlimited capacity ----------------------------

  describe("history: true (unlimited)", () => {
    test("stores all emitted events", () => {
      const emitter = new Emitter<{ a: string; b: number }>({ history: true });

      emitter.emit("a", "hello");
      emitter.emit("b", 42);
      emitter.emit("a", "world");

      const history = emitter.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].event).toBe("a");
      expect(history[0].data).toBe("hello");
      expect(history[1].event).toBe("b");
      expect(history[1].data).toBe(42);
      expect(history[2].event).toBe("a");
      expect(history[2].data).toBe("world");
    });

    test("stores events from emitAsync", async () => {
      const emitter = new Emitter<{ task: string }>({ history: true });

      await emitter.emitAsync("task", "async-value");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe("task");
      expect(history[0].data).toBe("async-value");
    });

    test("history entries have timestamps", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const before = Date.now();

      emitter.emit("ping", "hello");

      const after = Date.now();
      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });

    test("timestamps are monotonically non-decreasing", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "a");
      emitter.emit("ping", "b");
      emitter.emit("ping", "c");

      const history = emitter.getHistory();
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
      }
    });
  });

  // -- History enabled with fixed capacity --------------------------------

  describe("history: N (fixed capacity)", () => {
    test("respects capacity limit", () => {
      const emitter = new Emitter<{ ping: number }>({ history: 3 });

      emitter.emit("ping", 1);
      emitter.emit("ping", 2);
      emitter.emit("ping", 3);
      emitter.emit("ping", 4);
      emitter.emit("ping", 5);

      const history = emitter.getHistory();
      expect(history).toHaveLength(3);
      expect(history.map((h) => h.data)).toEqual([3, 4, 5]);
    });

    test("capacity of 1 keeps only the latest event", () => {
      const emitter = new Emitter<{ ping: string }>({ history: 1 });

      emitter.emit("ping", "a");
      emitter.emit("ping", "b");
      emitter.emit("ping", "c");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("c");
    });

    test("evicts oldest events first", () => {
      const emitter = new Emitter<{ a: string; b: string }>({ history: 2 });

      emitter.emit("a", "first");
      emitter.emit("b", "second");
      emitter.emit("a", "third");

      const history = emitter.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].event).toBe("b");
      expect(history[0].data).toBe("second");
      expect(history[1].event).toBe("a");
      expect(history[1].data).toBe("third");
    });
  });

  // -- replay() -----------------------------------------------------------

  describe("replay()", () => {
    test("delivers historical events to late subscriber", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const received: string[] = [];

      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      emitter.replay("ping", (val) => received.push(val));

      expect(received).toEqual(["a", "b"]);
    });

    test("replay subscriber also receives future events", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const received: string[] = [];

      emitter.emit("ping", "past");

      emitter.replay("ping", (val) => received.push(val));
      emitter.emit("ping", "future");

      expect(received).toEqual(["past", "future"]);
    });

    test("replay with single wildcard (*)", () => {
      const emitter = new Emitter({ history: true });
      const received: unknown[] = [];

      emitter.emit("user:login", { id: "1" });
      emitter.emit("user:logout", { id: "2" });
      emitter.emit("system:start", {});

      emitter.replay("user:*", (val) => received.push(val));

      expect(received).toEqual([{ id: "1" }, { id: "2" }]);
    });

    test("replay with double wildcard (**)", () => {
      const emitter = new Emitter({ history: true });
      const received: unknown[] = [];

      emitter.emit("user:profile:update", "alice");
      emitter.emit("user:login", "bob");
      emitter.emit("system:boot", "ok");

      emitter.replay("user:**", (val) => received.push(val));

      expect(received).toEqual(["alice", "bob"]);
    });

    test("replay with catch-all wildcard (**) gets everything", () => {
      const emitter = new Emitter({ history: true });
      const received: unknown[] = [];

      emitter.emit("a", 1);
      emitter.emit("b:c", 2);
      emitter.emit("d:e:f", 3);

      emitter.replay("**", (val) => received.push(val));

      expect(received).toEqual([1, 2, 3]);
    });

    test("replay returns a subscription that can be unsubscribed", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const fn = mock(() => {});

      emitter.emit("ping", "past");

      const sub = emitter.replay("ping", fn);

      // Historical event was replayed
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("past");

      // Unsubscribe
      sub.off();
      emitter.emit("ping", "future");

      // No additional calls
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test("replay with no matching history only subscribes", () => {
      const emitter = new Emitter<{ a: string; b: string }>({ history: true });
      const fn = mock(() => {});

      emitter.emit("a", "hello");

      emitter.replay("b", fn);

      // No replay since no "b" events in history
      expect(fn).toHaveBeenCalledTimes(0);

      // But future events work
      emitter.emit("b", "world");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("world");
    });

    test("replay with empty history only subscribes", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const fn = mock(() => {});

      emitter.replay("ping", fn);

      expect(fn).toHaveBeenCalledTimes(0);

      emitter.emit("ping", "hello");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test("replay supports OnOptions (priority)", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const order: string[] = [];

      emitter.on("ping", () => order.push("low"), { priority: 1 });
      emitter.replay("ping", () => order.push("high"), { priority: 10 });

      emitter.emit("ping", "go");

      expect(order).toEqual(["high", "low"]);
    });

    test("replay supports OnOptions (once)", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const fn = mock(() => {});

      emitter.emit("ping", "past");

      emitter.replay("ping", fn, { once: true });

      // Historical replay fires the handler
      // Then the once subscription fires on the first future emit, then auto-removes
      emitter.emit("ping", "first");
      emitter.emit("ping", "second");

      // 1 from replay + 1 from first emit (once) = 2
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  // -- getHistory() -------------------------------------------------------

  describe("getHistory()", () => {
    test("returns all events when called without arguments", () => {
      const emitter = new Emitter<{ a: string; b: number }>({ history: true });

      emitter.emit("a", "hello");
      emitter.emit("b", 42);

      const history = emitter.getHistory();
      expect(history).toHaveLength(2);
    });

    test("filters by exact event name", () => {
      const emitter = new Emitter<{ a: string; b: number }>({ history: true });

      emitter.emit("a", "first");
      emitter.emit("b", 1);
      emitter.emit("a", "second");
      emitter.emit("b", 2);

      const aHistory = emitter.getHistory("a");
      expect(aHistory).toHaveLength(2);
      expect(aHistory[0].data).toBe("first");
      expect(aHistory[1].data).toBe("second");

      const bHistory = emitter.getHistory("b");
      expect(bHistory).toHaveLength(2);
      expect(bHistory[0].data).toBe(1);
      expect(bHistory[1].data).toBe(2);
    });

    test("returns empty array for unknown event", () => {
      const emitter = new Emitter<{ a: string }>({ history: true });

      emitter.emit("a", "hello");

      expect(emitter.getHistory("nonexistent")).toEqual([]);
    });

    test("returns a shallow copy (mutations do not affect internal history)", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "hello");

      const history = emitter.getHistory();
      history.pop();

      expect(emitter.getHistory()).toHaveLength(1);
    });

    test("entries have correct shape", () => {
      const emitter = new Emitter<{ ping: { msg: string } }>({ history: true });

      emitter.emit("ping", { msg: "test" });

      const [entry] = emitter.getHistory();
      expect(entry.event).toBe("ping");
      expect(entry.data).toEqual({ msg: "test" });
      expect(typeof entry.timestamp).toBe("number");
    });
  });

  // -- clearHistory() -----------------------------------------------------

  describe("clearHistory()", () => {
    test("clears all history when called without arguments", () => {
      const emitter = new Emitter<{ a: string; b: number }>({ history: true });

      emitter.emit("a", "hello");
      emitter.emit("b", 42);
      emitter.clearHistory();

      expect(emitter.getHistory()).toEqual([]);
    });

    test("clears history for a specific event", () => {
      const emitter = new Emitter<{ a: string; b: number }>({ history: true });

      emitter.emit("a", "first");
      emitter.emit("b", 1);
      emitter.emit("a", "second");

      emitter.clearHistory("a");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].event).toBe("b");
      expect(history[0].data).toBe(1);
    });

    test("returns this for chaining", () => {
      const emitter = new Emitter({ history: true });
      expect(emitter.clearHistory()).toBe(emitter);
    });

    test("clearing nonexistent event is a no-op", () => {
      const emitter = new Emitter<{ a: string }>({ history: true });

      emitter.emit("a", "hello");
      emitter.clearHistory("nonexistent");

      expect(emitter.getHistory()).toHaveLength(1);
    });

    test("events emitted after clearHistory() are recorded", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "before");
      emitter.clearHistory();
      emitter.emit("ping", "after");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("after");
    });
  });

  // -- History with pause/resume ------------------------------------------

  describe("history with pause/resume", () => {
    test("paused events are recorded in history upon resume", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      emitter.on("ping", () => {});

      emitter.pause();
      emitter.emit("ping", "buffered");
      emitter.resume();

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("buffered");
    });

    test("paused events are recorded in history upon resumeAsync", async () => {
      const emitter = new Emitter<{ task: string }>({ history: true });
      emitter.on("task", async () => {});

      emitter.pause();
      emitter.emit("task", "async-buffered");
      await emitter.resumeAsync();

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("async-buffered");
    });

    test("events not recorded in history while paused (only on dispatch)", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      emitter.on("ping", () => {});

      emitter.pause();
      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      // History is empty while paused (events not dispatched yet)
      expect(emitter.getHistory()).toEqual([]);

      emitter.resume();

      // Now history is populated
      expect(emitter.getHistory()).toHaveLength(2);
    });
  });

  // -- History with dispose -----------------------------------------------

  describe("history with dispose", () => {
    test("dispose() clears history", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "hello");
      emitter.dispose();

      expect(emitter.getHistory()).toEqual([]);
    });

    test("events emitted after dispose() are still recorded", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "before");
      emitter.dispose();
      emitter.on("ping", () => {});
      emitter.emit("ping", "after");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("after");
    });
  });

  // -- History with async handlers in replay ------------------------------

  describe("replay with async handlers", () => {
    test("replay calls handler synchronously for historical events", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const received: string[] = [];

      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      // Even with an async handler, replay invokes it synchronously
      // (returns promises, but doesn't await them in replay)
      emitter.replay("ping", async (val) => {
        received.push(val);
      });

      // Synchronous — both should be received immediately
      expect(received).toEqual(["a", "b"]);
    });
  });

  // -- Edge cases ---------------------------------------------------------

  describe("edge cases", () => {
    test("history: 0 disables history", () => {
      const emitter = new Emitter<{ ping: string }>({ history: 0 });

      emitter.emit("ping", "hello");

      expect(emitter.getHistory()).toEqual([]);
    });

    test("history with no listeners still records", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "nobody-listening");

      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("nobody-listening");
    });

    test("history preserves event order across different event types", () => {
      const emitter = new Emitter({ history: true });

      emitter.emit("a", 1);
      emitter.emit("b", 2);
      emitter.emit("c", 3);
      emitter.emit("a", 4);

      const history = emitter.getHistory();
      expect(history.map((h) => h.event)).toEqual(["a", "b", "c", "a"]);
      expect(history.map((h) => h.data)).toEqual([1, 2, 3, 4]);
    });

    test("clear() does not affect history", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.emit("ping", "hello");
      emitter.clear();

      // History is preserved even though listeners are cleared
      expect(emitter.getHistory()).toHaveLength(1);
    });

    test("history works alongside middleware", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.use((_event, payload, next) => next(`${payload}!`));
      emitter.on("ping", () => {});

      emitter.emit("ping", "hello");

      // History records the original payload, not the transformed one
      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("hello");
    });

    test("history works when middleware swallows event", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });

      emitter.use((_event, _payload, _next) => {
        // swallow
      });
      emitter.on("ping", () => {});

      emitter.emit("ping", "swallowed");

      // History still records the event even though it was swallowed
      const history = emitter.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].data).toBe("swallowed");
    });

    test("getHistory() with event name returns entries in order", () => {
      const emitter = new Emitter<{ a: number; b: number }>({ history: true });

      emitter.emit("a", 1);
      emitter.emit("b", 10);
      emitter.emit("a", 2);
      emitter.emit("b", 20);
      emitter.emit("a", 3);

      const aHistory = emitter.getHistory("a");
      expect(aHistory.map((h) => h.data)).toEqual([1, 2, 3]);
    });

    test("capacity eviction with mixed event types", () => {
      const emitter = new Emitter<{ a: number; b: number }>({ history: 3 });

      emitter.emit("a", 1);
      emitter.emit("b", 2);
      emitter.emit("a", 3);
      emitter.emit("b", 4);

      const history = emitter.getHistory();
      expect(history).toHaveLength(3);
      expect(history.map((h) => ({ event: h.event, data: h.data }))).toEqual([
        { event: "b", data: 2 },
        { event: "a", data: 3 },
        { event: "b", data: 4 },
      ]);
    });

    test("replay after clearHistory sees nothing historical", () => {
      const emitter = new Emitter<{ ping: string }>({ history: true });
      const received: string[] = [];

      emitter.emit("ping", "old");
      emitter.clearHistory();

      emitter.replay("ping", (val) => received.push(val));

      // No replay since history was cleared
      expect(received).toEqual([]);

      // But future events work
      emitter.emit("ping", "new");
      expect(received).toEqual(["new"]);
    });
  });
});
