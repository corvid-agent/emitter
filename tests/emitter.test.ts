import { describe, test, expect, mock } from "bun:test";
import { Emitter, matchWildcard } from "../src/index";

// -- matchWildcard --------------------------------------------------------

describe("matchWildcard", () => {
  test("exact match", () => {
    expect(matchWildcard("user:login", "user:login")).toBe(true);
    expect(matchWildcard("user:login", "user:logout")).toBe(false);
  });

  test("single wildcard (*) matches one segment", () => {
    expect(matchWildcard("user:*", "user:login")).toBe(true);
    expect(matchWildcard("user:*", "user:logout")).toBe(true);
    expect(matchWildcard("*:login", "user:login")).toBe(true);
  });

  test("single wildcard (*) does not match multiple segments", () => {
    expect(matchWildcard("user:*", "user:a:b")).toBe(false);
  });

  test("double wildcard (**) matches multiple segments", () => {
    expect(matchWildcard("user:**", "user:a")).toBe(true);
    expect(matchWildcard("user:**", "user:a:b")).toBe(true);
    expect(matchWildcard("user:**", "user:a:b:c")).toBe(true);
  });

  test("double wildcard (**) matches everything", () => {
    expect(matchWildcard("**", "anything")).toBe(true);
    expect(matchWildcard("**", "a:b:c")).toBe(true);
  });

  test("dot separator works", () => {
    expect(matchWildcard("user.*", "user.login")).toBe(true);
    expect(matchWildcard("user.**", "user.a.b")).toBe(true);
  });

  test("mixed separators", () => {
    expect(matchWildcard("user:*", "user.login")).toBe(true);
  });
});

// -- Emitter: on / emit --------------------------------------------------

describe("Emitter", () => {
  describe("on / emit", () => {
    test("basic event subscription and emission", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      emitter.on("ping", fn);
      emitter.emit("ping", "hello");

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("hello");
    });

    test("multiple listeners on same event", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn1 = mock(() => {});
      const fn2 = mock(() => {});

      emitter.on("ping", fn1);
      emitter.on("ping", fn2);
      emitter.emit("ping", "hello");

      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    test("emit returns true when listeners exist", () => {
      const emitter = new Emitter<{ ping: string }>();
      emitter.on("ping", () => {});

      expect(emitter.emit("ping", "hello")).toBe(true);
    });

    test("emit returns false when no listeners", () => {
      const emitter = new Emitter<{ ping: string }>();

      expect(emitter.emit("ping", "hello")).toBe(false);
    });
  });

  // -- off / unsubscribe ------------------------------------------------

  describe("off / unsubscribe", () => {
    test("subscription.off() removes listener", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      const sub = emitter.on("ping", fn);
      sub.off();
      emitter.emit("ping", "hello");

      expect(fn).toHaveBeenCalledTimes(0);
    });

    test("off() is idempotent", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      const sub = emitter.on("ping", fn);
      sub.off();
      sub.off(); // should not throw
    });
  });

  // -- once -------------------------------------------------------------

  describe("once", () => {
    test("listener fires only once", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      emitter.once("ping", fn);
      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("a");
    });

    test("on() with once option", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      emitter.on("ping", fn, { once: true });
      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  // -- Priority ---------------------------------------------------------

  describe("priority", () => {
    test("higher priority listeners fire first", () => {
      const emitter = new Emitter<{ ping: string }>();
      const order: number[] = [];

      emitter.on("ping", () => order.push(1), { priority: 1 });
      emitter.on("ping", () => order.push(10), { priority: 10 });
      emitter.on("ping", () => order.push(5), { priority: 5 });

      emitter.emit("ping", "hello");

      expect(order).toEqual([10, 5, 1]);
    });
  });

  // -- Wildcards --------------------------------------------------------

  describe("wildcards", () => {
    test("wildcard listener receives matching events", () => {
      const emitter = new Emitter();
      const fn = mock(() => {});

      emitter.on("user:*", fn);
      emitter.emit("user:login", { id: "1" });
      emitter.emit("user:logout", { id: "1" });
      emitter.emit("system:start", {});

      expect(fn).toHaveBeenCalledTimes(2);
    });

    test("double wildcard matches nested events", () => {
      const emitter = new Emitter();
      const fn = mock(() => {});

      emitter.on("user:**", fn);
      emitter.emit("user:profile:update", { name: "Alice" });

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith({ name: "Alice" });
    });

    test("wildcard listener can be unsubscribed", () => {
      const emitter = new Emitter();
      const fn = mock(() => {});

      const sub = emitter.on("user:*", fn);
      sub.off();
      emitter.emit("user:login", {});

      expect(fn).toHaveBeenCalledTimes(0);
    });

    test("catch-all wildcard", () => {
      const emitter = new Emitter();
      const fn = mock(() => {});

      emitter.on("**", fn);
      emitter.emit("a", 1);
      emitter.emit("b:c", 2);
      emitter.emit("d:e:f", 3);

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  // -- emitAsync --------------------------------------------------------

  describe("emitAsync", () => {
    test("awaits async listeners sequentially", async () => {
      const emitter = new Emitter<{ task: string }>();
      const order: number[] = [];

      emitter.on("task", async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      emitter.on("task", async () => {
        order.push(2);
      });

      await emitter.emitAsync("task", "go");

      expect(order).toEqual([1, 2]);
    });

    test("returns false when no listeners", async () => {
      const emitter = new Emitter();
      expect(await emitter.emitAsync("nope")).toBe(false);
    });
  });

  // -- Pause / Resume ---------------------------------------------------

  describe("pause / resume", () => {
    test("paused emitter buffers events", () => {
      const emitter = new Emitter<{ ping: string }>();
      const fn = mock(() => {});

      emitter.on("ping", fn);
      emitter.pause();
      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      expect(fn).toHaveBeenCalledTimes(0);

      emitter.resume();

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith("a");
      expect(fn).toHaveBeenCalledWith("b");
    });

    test("buffer respects maxBufferSize", () => {
      const emitter = new Emitter<{ ping: number }>();
      const fn = mock(() => {});

      emitter.setMaxBufferSize(2);
      emitter.on("ping", fn);
      emitter.pause();

      emitter.emit("ping", 1);
      emitter.emit("ping", 2);
      emitter.emit("ping", 3); // dropped

      emitter.resume();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    test("resumeAsync awaits listeners", async () => {
      const emitter = new Emitter<{ task: string }>();
      const order: string[] = [];

      emitter.on("task", async (val) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(val);
      });

      emitter.pause();
      emitter.emit("task", "a");
      emitter.emit("task", "b");

      await emitter.resumeAsync();

      expect(order).toEqual(["a", "b"]);
    });
  });

  // -- wait -------------------------------------------------------------

  describe("wait", () => {
    test("resolves on next emit", async () => {
      const emitter = new Emitter<{ ready: { status: string } }>();

      const promise = emitter.wait("ready");
      emitter.emit("ready", { status: "ok" });

      const result = await promise;
      expect(result).toEqual({ status: "ok" });
    });
  });

  // -- Inspect ----------------------------------------------------------

  describe("inspection", () => {
    test("listenerCount returns correct count", () => {
      const emitter = new Emitter<{ a: string; b: string }>();

      emitter.on("a", () => {});
      emitter.on("a", () => {});
      emitter.on("b", () => {});

      expect(emitter.listenerCount("a")).toBe(2);
      expect(emitter.listenerCount("b")).toBe(1);
      expect(emitter.listenerCount("c" as any)).toBe(0);
    });

    test("eventNames returns registered events", () => {
      const emitter = new Emitter<{ a: string; b: string }>();

      emitter.on("a", () => {});
      emitter.on("b", () => {});

      expect(emitter.eventNames().sort()).toEqual(["a", "b"]);
    });
  });

  // -- clear / dispose --------------------------------------------------

  describe("clear / dispose", () => {
    test("clear removes listeners for specific event", () => {
      const emitter = new Emitter<{ a: string; b: string }>();
      const fnA = mock(() => {});
      const fnB = mock(() => {});

      emitter.on("a", fnA);
      emitter.on("b", fnB);
      emitter.clear("a");

      emitter.emit("a", "hello");
      emitter.emit("b", "world");

      expect(fnA).toHaveBeenCalledTimes(0);
      expect(fnB).toHaveBeenCalledTimes(1);
    });

    test("clear with no args removes all listeners", () => {
      const emitter = new Emitter<{ a: string; b: string }>();
      const fn = mock(() => {});

      emitter.on("a", fn);
      emitter.on("b", fn);
      emitter.on("**", fn);
      emitter.clear();

      emitter.emit("a", "hello");
      expect(fn).toHaveBeenCalledTimes(0);
      expect(emitter.eventNames()).toEqual([]);
    });

    test("dispose clears everything including buffer", () => {
      const emitter = new Emitter<{ a: string }>();
      const fn = mock(() => {});

      emitter.on("a", fn);
      emitter.pause();
      emitter.emit("a", "buffered");
      emitter.dispose();
      emitter.resume();

      expect(fn).toHaveBeenCalledTimes(0);
      expect(emitter.eventNames()).toEqual([]);
    });
  });

  // -- setMaxListeners --------------------------------------------------

  describe("setMaxListeners", () => {
    test("returns this for chaining", () => {
      const emitter = new Emitter();
      expect(emitter.setMaxListeners(50)).toBe(emitter);
    });
  });

  // -- onError ----------------------------------------------------------

  describe("onError", () => {
    test("catches listener error and calls onError handler", () => {
      const errors: { err: unknown; event: string }[] = [];
      const emitter = new Emitter<{ ping: string }>({
        onError: (err, event) => errors.push({ err, event }),
      });

      const boom = new Error("boom");
      emitter.on("ping", () => {
        throw boom;
      });
      emitter.emit("ping", "hello");

      expect(errors).toEqual([{ err: boom, event: "ping" }]);
    });

    test("remaining listeners still fire after a listener throws", () => {
      const errors: unknown[] = [];
      const emitter = new Emitter<{ ping: string }>({
        onError: (err) => errors.push(err),
      });

      const order: number[] = [];
      emitter.on("ping", () => order.push(1));
      emitter.on("ping", () => {
        throw new Error("fail");
      });
      emitter.on("ping", () => order.push(3));

      emitter.emit("ping", "hello");

      expect(order).toEqual([1, 3]);
      expect(errors.length).toBe(1);
    });

    test("without onError, listener errors propagate normally", () => {
      const emitter = new Emitter<{ ping: string }>();

      emitter.on("ping", () => {
        throw new Error("boom");
      });

      expect(() => emitter.emit("ping", "hello")).toThrow("boom");
    });

    test("onError works with emitAsync", async () => {
      const errors: { err: unknown; event: string }[] = [];
      const emitter = new Emitter<{ task: string }>({
        onError: (err, event) => errors.push({ err, event }),
      });

      const order: number[] = [];
      emitter.on("task", async () => order.push(1));
      emitter.on("task", async () => {
        throw new Error("async fail");
      });
      emitter.on("task", async () => order.push(3));

      await emitter.emitAsync("task", "go");

      expect(order).toEqual([1, 3]);
      expect(errors.length).toBe(1);
      expect((errors[0].err as Error).message).toBe("async fail");
      expect(errors[0].event).toBe("task");
    });

    test("without onError, emitAsync errors propagate normally", async () => {
      const emitter = new Emitter<{ task: string }>();

      emitter.on("task", async () => {
        throw new Error("async boom");
      });

      await expect(emitter.emitAsync("task", "go")).rejects.toThrow("async boom");
    });

    test("onError isolates errors between multiple listeners", () => {
      const errors: unknown[] = [];
      const emitter = new Emitter<{ ping: string }>({
        onError: (err) => errors.push(err),
      });

      emitter.on("ping", () => {
        throw new Error("first");
      });
      emitter.on("ping", () => {
        throw new Error("second");
      });

      emitter.emit("ping", "hello");

      expect(errors.length).toBe(2);
      expect((errors[0] as Error).message).toBe("first");
      expect((errors[1] as Error).message).toBe("second");
    });

    test("once listeners still get pruned when onError is set", () => {
      const errors: unknown[] = [];
      const emitter = new Emitter<{ ping: string }>({
        onError: (err) => errors.push(err),
      });

      const fn = mock(() => {
        throw new Error("once-error");
      });
      emitter.once("ping", fn);

      emitter.emit("ping", "a");
      emitter.emit("ping", "b");

      // once listener should fire only once even though it threw
      expect(fn).toHaveBeenCalledTimes(1);
      expect(errors.length).toBe(1);
    });
  });
});
