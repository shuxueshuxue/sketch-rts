// @@@story-kernel - The machine campaign scripts run on. A script is an ordinary TypeScript generator function: its local
// variables are the scene's state, the line it stands on is where the story is, and every `yield*` is a point where it
// waits for the world (a moment, an event, a line spoken, a choice made). The kernel knows only three instructions:
//
//   suspend  - wait until something wakes the task (a timer, an event, another task finishing);
//   spawn    - start a child task, which runs alongside its parent and can never outlive it;
//   current  - the task itself (for its context and its cleanups).
//
// Everything else (time, events, races, the stage) is built from these, so the kernel stays small enough to reason
// about. Three properties the campaign relies on:
//
// - Structured concurrency. Tasks form a tree. A task that finishes halts the children it left running; halting a task
//   halts its subtree first; a halted generator is returned from, so its `finally` blocks run (a scene's cleanup is its
//   `finally`, not a trigger someone must remember to disable). A child's failure is thrown into its parent where it
//   waits, and climbs until someone catches it: no error is lost in a background trigger.
// - Determinism. There is no event loop but the kernel's own FIFO run queue, drained by the caller (the Director) at a
//   fixed point of each simulation tick, and wakes are queued in the order they happen. Given the same wakes, a script
//   runs the same way every time, which is what lets a save be restored by replaying it (see director).
// - Context is dynamically scoped along the task tree: a child sees what its ancestors provided (the clock, the world),
//   so a helper called anywhere in a scene reaches them without having them passed down by hand.

export type Operation<T> = Generator<Instruction, T, unknown>;

export type Instruction =
  | { readonly type: "suspend"; readonly wait: Wait }
  | { readonly type: "spawn"; readonly body: () => Operation<unknown>; readonly label: string }
  | { readonly type: "current" };

// Arms a wait: `wake` settles it, once. Returns how to disarm it; the kernel disarms every wait exactly once, whether it
// was woken or the task was halted while it waited.
export type Wait = (wake: Wake) => (() => void) | void;
export type Wake = { resume(value: unknown): void; fail(error: unknown): void };

export type TaskState = "running" | "done" | "failed" | "halted";

type Input = { ok: true; value: unknown } | { ok: false; error: unknown };
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

// Thrown into whoever joins a task that was halted before it finished.
export class HaltedError extends Error {
  constructor(readonly task: Task) {
    super(`${task.label} was halted`);
  }
}

export class Task<T = unknown> implements Iterable<Instruction, T, unknown> {
  state: TaskState = "running";
  readonly children: Task[] = [];
  readonly context = new Map<symbol, unknown>();
  outcome?: Settled<T>;
  // Set by the kernel: the wait the task is parked on, an error to throw into it before its next input, whether a halt
  // came while it was running, its cleanups and the joiners to wake when it settles.
  wait?: { disarm(): void };
  interrupt?: { error: unknown };
  haltRequested = false;
  readonly cleanups: (() => void)[] = [];
  readonly joiners: Wake[] = [];

  constructor(
    readonly kernel: Kernel,
    readonly id: number,
    readonly label: string,
    readonly parent: Task | undefined,
    readonly generator: Operation<T>,
  ) {}

  // `yield* task` waits for the task and returns its result (or throws its error).
  [Symbol.iterator](): Operation<T> {
    return join(this);
  }

  halt() {
    this.kernel.halt(this);
  }

  // The nearest value an ancestor (or the task itself) provided for the context.
  lookup<V>(key: symbol): V | undefined {
    for (let task: Task | undefined = this; task; task = task.parent) {
      if (task.context.has(key)) return task.context.get(key) as V;
    }
    return undefined;
  }
}

export class Kernel {
  private nextTaskId = 1;
  private readonly queue: { task: Task; input: Input }[] = [];
  private running: Task | undefined;
  private draining = false;

  // A root task. It runs on the next drain.
  start<T>(body: () => Operation<T>, label: string): Task<T> {
    const task = this.createTask(body, label, undefined);
    this.enqueue(task, { ok: true, value: undefined });
    return task;
  }

  get idle() {
    return this.queue.length === 0;
  }

  // Runs every queued task until each waits again or ends. A task woken while the queue drains runs in the same drain.
  drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let entry = this.queue.shift(); entry; entry = this.queue.shift()) this.step(entry.task, entry.input);
    } finally {
      this.draining = false;
    }
  }

  halt(task: Task) {
    if (task.state !== "running") return;
    // A task cannot be returned from while its own generator runs; it is halted the moment it next yields.
    if (task === this.running) {
      task.haltRequested = true;
      return;
    }
    const failures: unknown[] = [];
    for (const child of [...task.children].reverse()) {
      try {
        this.halt(child);
      } catch (error) {
        failures.push(error);
      }
    }
    this.disarm(task);
    try {
      const after = task.generator.return(undefined);
      if (!after.done) failures.push(new Error(`${task.label} waited while it was being halted: cleanup must finish at once`));
    } catch (error) {
      failures.push(error);
    }
    failures.push(...this.runCleanups(task));
    task.state = "halted";
    this.detach(task);
    for (const joiner of task.joiners.splice(0)) joiner.fail(new HaltedError(task));
    if (failures.length > 0) throw failures[0];
  }

  private createTask<T>(body: () => Operation<T>, label: string, parent: Task | undefined): Task<T> {
    const task = new Task<T>(this, this.nextTaskId++, label, parent, body());
    parent?.children.push(task);
    return task;
  }

  private enqueue(task: Task, input: Input) {
    this.queue.push({ task, input });
  }

  private step(task: Task, input: Input) {
    if (task.state !== "running") return;
    let next: Input = input;
    if (task.interrupt) {
      next = { ok: false, error: task.interrupt.error };
      delete task.interrupt;
    }
    const outer = this.running;
    this.running = task;
    try {
      for (;;) {
        let result: IteratorResult<Instruction, unknown>;
        try {
          result = next.ok ? task.generator.next(next.value) : task.generator.throw(next.error);
        } catch (error) {
          this.running = outer;
          this.fail(task, error);
          return;
        }
        if (task.haltRequested) {
          this.running = outer;
          task.haltRequested = false;
          this.haltOrFail(task);
          return;
        }
        if (result.done) {
          this.running = outer;
          this.complete(task, result.value);
          return;
        }
        const instruction = result.value;
        if (instruction.type === "current") {
          next = { ok: true, value: task };
        } else if (instruction.type === "spawn") {
          const child = this.createTask(instruction.body, instruction.label, task);
          this.enqueue(child, { ok: true, value: undefined });
          next = { ok: true, value: child };
        } else {
          this.running = outer;
          this.arm(task, instruction.wait);
          return;
        }
      }
    } finally {
      this.running = outer;
    }
  }

  private haltOrFail(task: Task) {
    try {
      this.halt(task);
    } catch (error) {
      this.propagate(task, error);
    }
  }

  private arm(task: Task, wait: Wait) {
    let pending = true;
    let disarm: (() => void) | void;
    const settle = (input: Input) => {
      if (!pending) return;
      pending = false;
      delete task.wait;
      disarm?.();
      if (task.state === "running") this.enqueue(task, input);
    };
    task.wait = {
      disarm: () => {
        if (!pending) return;
        pending = false;
        delete task.wait;
        disarm?.();
      },
    };
    disarm = wait({ resume: (value) => settle({ ok: true, value }), fail: (error) => settle({ ok: false, error }) });
    // Woken while arming (the thing waited for had already happened): the wait is over before it began.
    if (!pending) disarm?.();
  }

  private disarm(task: Task) {
    task.wait?.disarm();
  }

  private complete(task: Task, value: unknown) {
    const failures = this.closeChildren(task);
    failures.push(...this.runCleanups(task));
    if (failures.length > 0) {
      this.settleFailed(task, failures[0]);
      return;
    }
    task.state = "done";
    task.outcome = { ok: true, value };
    this.detach(task);
    for (const joiner of task.joiners.splice(0)) joiner.resume(value);
  }

  private fail(task: Task, error: unknown) {
    this.closeChildren(task);
    this.runCleanups(task);
    this.settleFailed(task, error);
  }

  private settleFailed(task: Task, error: unknown) {
    task.state = "failed";
    task.outcome = { ok: false, error };
    this.detach(task);
    const joiners = task.joiners.splice(0);
    for (const joiner of joiners) joiner.fail(error);
    this.propagate(task, error);
  }

  // A child's failure is its parent's: thrown into the parent where it waits (or before its next step, if it is already
  // queued), unless the parent is itself gone. A root's failure is kept for whoever started it.
  private propagate(task: Task, error: unknown) {
    const parent = task.parent;
    if (!parent || parent.state !== "running" || parent.interrupt) return;
    parent.interrupt = { error };
    if (parent.wait) {
      parent.wait.disarm();
      this.enqueue(parent, { ok: true, value: undefined });
    }
  }

  private closeChildren(task: Task): unknown[] {
    const failures: unknown[] = [];
    for (const child of [...task.children].reverse()) {
      try {
        this.halt(child);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  private runCleanups(task: Task): unknown[] {
    const failures: unknown[] = [];
    for (const cleanup of task.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  private detach(task: Task) {
    const siblings = task.parent?.children;
    if (!siblings) return;
    const index = siblings.indexOf(task);
    if (index >= 0) siblings.splice(index, 1);
  }
}

// ---- The three instructions.

export function* suspend<T>(wait: Wait): Operation<T> {
  return (yield { type: "suspend", wait }) as T;
}

// Starts `body` as a child of the current task and returns its handle at once; `yield* handle` joins it.
export function* spawn<T>(body: () => Operation<T>, label = body.name || "task"): Operation<Task<T>> {
  return (yield { type: "spawn", body, label }) as Task<T>;
}

export function* current(): Operation<Task> {
  return (yield { type: "current" }) as Task;
}

// ---- Built from them.

export function* join<T>(task: Task<T>): Operation<T> {
  return yield* suspend<T>((wake) => {
    const outcome = task.outcome;
    if (outcome) {
      if (outcome.ok) wake.resume(outcome.value);
      else wake.fail(outcome.error);
      return;
    }
    if (task.state === "halted") {
      wake.fail(new HaltedError(task));
      return;
    }
    task.joiners.push(wake);
    return () => {
      const index = task.joiners.indexOf(wake);
      if (index >= 0) task.joiners.splice(index, 1);
    };
  });
}

// Waits forever (until halted): what a background behaviour does once it has nothing left to do.
export function* never(): Operation<never> {
  return yield* suspend<never>(() => undefined);
}

// Runs `body` as a child and waits for it: whatever it spawned is halted when it returns. The lexical block of
// structured concurrency: `yield* scope(function* () { yield* spawn(ambience); yield* battle(); })` ends the ambience with
// the battle.
export function* scope<T>(body: () => Operation<T>, label = body.name || "scope"): Operation<T> {
  const task = yield* spawn(body, label);
  return yield* join(task);
}

// Runs `cleanup` when the current task ends, however it ends (last registered, first run): Go's defer, at task scope.
export function* ensure(cleanup: () => void): Operation<void> {
  (yield* current()).cleanups.push(cleanup);
}

export type RaceBranches = Record<string, () => Operation<unknown>>;
export type RaceResult<B extends RaceBranches> = { [K in keyof B]: { kind: K; value: B[K] extends () => Operation<infer V> ? V : never } }[keyof B];

// Runs the branches side by side; the first to finish wins and the others are halted. The result says which won:
// `switch (outcome.kind)` narrows `outcome.value` to that branch's type.
export function* race<B extends RaceBranches>(branches: B): Operation<RaceResult<B>> {
  const entries = Object.entries(branches);
  const tasks: Task[] = [];
  try {
    for (const [kind, body] of entries) tasks.push(yield* spawn(body, `race:${kind}`));
    const winner = yield* suspend<number>((wake) => {
      const disarms = tasks.map((task, index) => {
        const joiner: Wake = { resume: () => wake.resume(index), fail: (error) => wake.fail(error) };
        if (task.outcome) {
          if (task.outcome.ok) wake.resume(index);
          else wake.fail(task.outcome.error);
          return () => undefined;
        }
        task.joiners.push(joiner);
        return () => {
          const at = task.joiners.indexOf(joiner);
          if (at >= 0) task.joiners.splice(at, 1);
        };
      });
      return () => disarms.forEach((disarm) => disarm());
    });
    const outcome = tasks[winner]!.outcome;
    return { kind: entries[winner]![0], value: outcome?.ok ? outcome.value : undefined } as RaceResult<B>;
  } finally {
    for (const task of tasks) task.halt();
  }
}

export type AllResult<B extends RaceBranches> = { [K in keyof B]: B[K] extends () => Operation<infer V> ? V : never };

// Runs the branches side by side and waits for every one; if one fails the rest are halted and the error is thrown.
export function* all<B extends RaceBranches>(branches: B): Operation<AllResult<B>> {
  const entries = Object.entries(branches);
  const tasks: Task[] = [];
  try {
    for (const [kind, body] of entries) tasks.push(yield* spawn(body, `all:${kind}`));
    const results: Record<string, unknown> = {};
    for (const [index, task] of tasks.entries()) results[entries[index]![0]] = yield* join(task);
    return results as AllResult<B>;
  } finally {
    for (const task of tasks) task.halt();
  }
}

// ---- Context: a value an ancestor provides and every descendant can read.

export type Context<T> = {
  readonly key: symbol;
  readonly name: string;
  // The value, or a loud failure when no ancestor provided one.
  expect(): Operation<T>;
  find(): Operation<T | undefined>;
  // Provides the value to the current task and everything it spawns from now on.
  provide(value: T): Operation<void>;
};

export function createContext<T>(name: string): Context<T> {
  const key = Symbol(name);
  return {
    key,
    name,
    *expect() {
      const value = (yield* current()).lookup<T>(key);
      if (value === undefined) throw new Error(`No ${name} here: run this inside a story that provides one`);
      return value;
    },
    *find() {
      return (yield* current()).lookup<T>(key);
    },
    *provide(value: T) {
      (yield* current()).context.set(key, value);
    },
  };
}
