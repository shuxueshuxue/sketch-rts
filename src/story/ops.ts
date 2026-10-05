import { matches, type EventOf, type Pattern, type StoryEvent, type StoryEventType } from "./events";
import { createContext, ensure, spawn, suspend, type Operation, type Task } from "./kernel";
import { later, type Duration, type Instant } from "./time";

// @@@story-ops - The waits a script is written with, all on the Director's clock (see director): a span of time, a moment,
// a condition coming true, the next event of a kind, a stream of events. Each is a `suspend` on something the Director
// services once a tick, after the sim has stepped.

export type StoryClock = {
  now(): Instant;
  // Each returns how to take the registration back; the kernel does so when the wait ends either way.
  timer(due: Instant, fire: () => void): () => void;
  condition(test: () => boolean, fire: () => void): () => void;
  listen(accept: (event: StoryEvent) => boolean, fire: (event: StoryEvent) => void): () => void;
  // Announces an event of the script's own; it is heard in this same tick's story phase.
  announce(event: StoryEvent): void;
};

export const Clock = createContext<StoryClock>("story clock");

export function* now(): Operation<Instant> {
  return (yield* Clock.expect()).now();
}

export function* wait(span: Duration): Operation<void> {
  const clock = yield* Clock.expect();
  if (span <= 0) return;
  yield* suspend<void>((wake) => clock.timer(later(clock.now(), span), () => wake.resume(undefined)));
}

export function* at(moment: Instant): Operation<void> {
  const clock = yield* Clock.expect();
  if (moment <= clock.now()) return;
  yield* suspend<void>((wake) => clock.timer(moment, () => wake.resume(undefined)));
}

// Waits until `test` holds; it is asked once a tick, after the sim and the events, and not at all if it holds already.
export function* until(test: () => boolean): Operation<void> {
  const clock = yield* Clock.expect();
  if (test()) return;
  yield* suspend<void>((wake) => clock.condition(test, () => wake.resume(undefined)));
}

// The next event of this kind that matches the pattern, from now on.
export function* on<K extends StoryEventType>(type: K, pattern?: Pattern<EventOf<K>>): Operation<EventOf<K>> {
  const clock = yield* Clock.expect();
  return yield* suspend<EventOf<K>>((wake) => clock.listen((event) => event.type === type && matches(event as EventOf<K>, pattern), (event) => wake.resume(event)));
}

export function* signal(name: string, data?: unknown): Operation<void> {
  const clock = yield* Clock.expect();
  clock.announce({ type: "signal", at: clock.now(), name, ...(data !== undefined ? { data } : {}) });
}

// A subscription: every matching event from the moment it is made, kept in order until `next` takes it, for as long as
// the task that made it runs. Unlike `on`, nothing is missed while the reader is busy with the previous one.
export type Subscription<E> = {
  next(): Operation<E>;
  // The events waiting, taken at once (possibly none).
  drain(): E[];
};

export function* subscribe<K extends StoryEventType>(type: K, pattern?: Pattern<EventOf<K>>): Operation<Subscription<EventOf<K>>> {
  const clock = yield* Clock.expect();
  const buffer: EventOf<K>[] = [];
  let reader: ((event: EventOf<K>) => void) | undefined;
  const stop = clock.listen(
    (event) => event.type === type && matches(event as EventOf<K>, pattern),
    (event) => {
      if (reader) {
        const wake = reader;
        reader = undefined;
        wake(event as EventOf<K>);
      } else buffer.push(event as EventOf<K>);
    },
  );
  yield* ensure(stop);
  return {
    *next() {
      const waiting = buffer.shift();
      if (waiting) return waiting;
      return yield* suspend<EventOf<K>>((wake) => {
        reader = (event) => wake.resume(event);
        return () => {
          reader = undefined;
        };
      });
    },
    drain: () => buffer.splice(0),
  };
}

// Runs `handle` for every matching event, one after another, in a child task: the handling lasts as long as the scope that
// started it.
export function* each<K extends StoryEventType>(type: K, pattern: Pattern<EventOf<K>> | undefined, handle: (event: EventOf<K>) => Operation<void>, label = `each:${type}`): Operation<Task<never>> {
  return yield* spawn(function* () {
    const events = yield* subscribe(type, pattern);
    for (;;) yield* handle(yield* events.next());
  }, label);
}

// Runs `body` again every `span` for as long as the scope lives.
export function* every(span: Duration, body: () => Operation<void>, label = "every"): Operation<Task<never>> {
  return yield* spawn(function* () {
    for (;;) {
      yield* body();
      yield* wait(span);
    }
  }, label);
}

// Runs `body`, or gives up on it after `span`: `{ done: true, value }` or `{ done: false }`.
export function* within<T>(span: Duration, body: () => Operation<T>): Operation<{ done: true; value: T } | { done: false }> {
  const task = yield* spawn(body, "within");
  const clock = yield* Clock.expect();
  const deadline = later(clock.now(), span);
  try {
    const finished = yield* suspend<boolean>((wake) => {
      if (task.outcome) {
        wake.resume(true);
        return;
      }
      const joiner = { resume: () => wake.resume(true), fail: (error: unknown) => wake.fail(error) };
      task.joiners.push(joiner);
      const cancel = clock.timer(deadline, () => wake.resume(false));
      return () => {
        cancel();
        const index = task.joiners.indexOf(joiner);
        if (index >= 0) task.joiners.splice(index, 1);
      };
    });
    const outcome = task.outcome;
    if (finished && outcome?.ok) return { done: true, value: outcome.value };
    return { done: false };
  } finally {
    task.halt();
  }
}
