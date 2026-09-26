import { describe, expect, it } from "vitest";
import { all, ensure, HaltedError, Kernel, never, race, scope, spawn, suspend, type Operation, type Wake } from "./kernel";

// A hand-cranked wake, so each test says exactly when things happen.
function gate<T>() {
  const waiting: Wake[] = [];
  return {
    *wait(): Operation<T> {
      return yield* suspend<T>((wake) => {
        waiting.push(wake);
        return () => {
          const index = waiting.indexOf(wake);
          if (index >= 0) waiting.splice(index, 1);
        };
      });
    },
    open(value: T) {
      for (const wake of waiting.splice(0)) wake.resume(value);
    },
    get waiters() {
      return waiting.length;
    },
  };
}

describe("story kernel", () => {
  it("runs a script to its end, one wait at a time", () => {
    const kernel = new Kernel();
    const door = gate<string>();
    const heard: string[] = [];
    const task = kernel.start(function* () {
      heard.push("start");
      heard.push(yield* door.wait());
      heard.push(yield* door.wait());
      return heard.length;
    }, "script");
    kernel.drain();
    expect(heard).toEqual(["start"]);
    door.open("one");
    kernel.drain();
    door.open("two");
    kernel.drain();
    expect(heard).toEqual(["start", "one", "two"]);
    expect(task.outcome).toEqual({ ok: true, value: 3 });
  });

  it("halts the children a task leaves running, running their finally blocks, innermost first", () => {
    const kernel = new Kernel();
    const log: string[] = [];
    const door = gate<void>();
    const task = kernel.start(function* () {
      yield* spawn(function* () {
        yield* spawn(function* () {
          try {
            yield* never();
          } finally {
            log.push("grandchild cleanup");
          }
        });
        try {
          yield* never();
        } finally {
          log.push("child cleanup");
        }
      });
      yield* ensure(() => log.push("parent deferred"));
      yield* door.wait();
      return "done";
    }, "parent");
    kernel.drain();
    door.open();
    kernel.drain();
    expect(task.state).toBe("done");
    expect(log).toEqual(["grandchild cleanup", "child cleanup", "parent deferred"]);
  });

  it("never starts a child whose parent ended before it ran", () => {
    const kernel = new Kernel();
    const log: string[] = [];
    kernel.start(function* () {
      yield* spawn(function* () {
        log.push("ran");
      });
    }, "parent");
    kernel.drain();
    expect(log).toEqual([]);
  });

  it("scopes a background task to a block", () => {
    const kernel = new Kernel();
    const tick = gate<void>();
    const log: string[] = [];
    kernel.start(function* () {
      yield* scope(function* () {
        yield* spawn(function* ambience() {
          try {
            for (;;) {
              yield* tick.wait();
              log.push("bird");
            }
          } finally {
            log.push("quiet");
          }
        });
        yield* tick.wait();
        yield* tick.wait();
      });
      log.push("after");
    }, "story");
    kernel.drain();
    tick.open();
    kernel.drain();
    tick.open();
    kernel.drain();
    expect(log).toEqual(["bird", "quiet", "after"]);
    expect(tick.waiters).toBe(0);
  });

  it("races branches, reports the winner by name and halts the losers", () => {
    const kernel = new Kernel();
    const fast = gate<number>();
    const slow = gate<string>();
    const log: string[] = [];
    const task = kernel.start(function* () {
      const outcome = yield* race({
        arrived: () => fast.wait(),
        ambushed: function* () {
          try {
            return yield* slow.wait();
          } finally {
            log.push("ambush called off");
          }
        },
      });
      if (outcome.kind === "arrived") return outcome.value + 1;
      return -1;
    }, "race");
    kernel.drain();
    fast.open(41);
    kernel.drain();
    expect(task.outcome).toEqual({ ok: true, value: 42 });
    expect(log).toEqual(["ambush called off"]);
    expect(slow.waiters).toBe(0);
  });

  it("throws a child's failure into its parent where it waits", () => {
    const kernel = new Kernel();
    const door = gate<void>();
    const task = kernel.start(function* () {
      yield* spawn(function* broken() {
        yield* door.wait();
        throw new Error("bridge collapsed");
      });
      try {
        yield* never();
      } catch (error) {
        return (error as Error).message;
      }
      return "unreachable";
    }, "story");
    kernel.drain();
    door.open();
    kernel.drain();
    expect(task.outcome).toEqual({ ok: true, value: "bridge collapsed" });
  });

  it("fails a root loudly when nobody catches", () => {
    const kernel = new Kernel();
    const task = kernel.start(function* () {
      yield* spawn(function* () {
        throw new Error("typo in chapter two");
      });
      yield* never();
    }, "story");
    kernel.drain();
    expect(task.state).toBe("failed");
    expect(task.outcome).toMatchObject({ ok: false, error: new Error("typo in chapter two") });
  });

  it("waits for all branches, and halts the rest when one fails", () => {
    const kernel = new Kernel();
    const a = gate<number>();
    const b = gate<number>();
    const task = kernel.start(function* () {
      return yield* all({ a: () => a.wait(), b: () => b.wait() });
    }, "all");
    kernel.drain();
    b.open(2);
    kernel.drain();
    a.open(1);
    kernel.drain();
    expect(task.outcome).toEqual({ ok: true, value: { a: 1, b: 2 } });
  });

  it("joins a halted task with a HaltedError", () => {
    const kernel = new Kernel();
    let caught: unknown;
    kernel.start(function* () {
      const child = yield* spawn(() => never());
      yield* spawn(function* () {
        child.halt();
      });
      try {
        yield* child;
      } catch (error) {
        caught = error;
      }
    }, "story");
    kernel.drain();
    expect(caught).toBeInstanceOf(HaltedError);
  });

  it("lets a task halt its own parent from inside, finishing the halt when it next yields", () => {
    const kernel = new Kernel();
    const log: string[] = [];
    const parent = kernel.start(function* () {
      try {
        yield* spawn(function* () {
          try {
            parent.halt();
            log.push("still running this step");
            yield* never();
          } finally {
            log.push("child cleanup");
          }
        });
        yield* never();
      } finally {
        log.push("parent cleanup");
      }
    }, "parent");
    kernel.drain();
    expect(parent.state).toBe("halted");
    expect(log).toEqual(["parent cleanup", "still running this step", "child cleanup"]);
  });

  it("refuses a cleanup that waits", () => {
    const kernel = new Kernel();
    const door = gate<void>();
    const task = kernel.start(function* () {
      const child = yield* spawn(function* () {
        try {
          yield* never();
        } finally {
          yield* door.wait();
        }
      });
      yield* spawn(function* () {
        child.halt();
      });
      yield* never();
    }, "story");
    kernel.drain();
    expect(task.state).toBe("failed");
  });
});
