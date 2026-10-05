import type { Unit } from "../shared/types";
import type { Operation } from "./kernel";
import { wait } from "./ops";
import type { Text } from "./stage";
import { seconds, type Duration } from "./time";
import type { World } from "./world";

// @@@story-powers - A campaign's own abilities are scripts, not rows in the catalog: a power says when it is worth using
// (`aim`, asked while it is ready) and what using it does (`cast`, an operation, so a power can wind up, channel, rain
// fire over three seconds or call reinforcements and wait for them). A unit's powers run in its life (see World.life):
// when the caster falls, the cast it was in the middle of is halted with it, and nothing of it lingers.

export type Power<Target = unknown> = {
  id: string;
  name: Text;
  cooldown: Duration;
  // Whether now is the moment, and at what: undefined while there is nothing worth it.
  aim(caster: Unit, world: World): Target | undefined;
  cast(caster: Unit, target: Target, world: World): Operation<void>;
};

export function definePower<Target>(power: Power<Target>): Power<Target> {
  return power;
}

export type Empowered = {
  readonly unitId: string;
  // 1 when ready, rising from 0 as it cools down.
  readiness(powerId: string): number;
  readonly powers: readonly Power<unknown>[];
  teach(power: Power<unknown>): void;
  // The power being cast right now, if any.
  casting: string | undefined;
  // Takes the powers away (the brain stops; a cast in progress is halted).
  stop(): void;
};

export function* empower(world: World, unit: Unit, powers: readonly Power<any>[], options: { think?: Duration; willing?: () => boolean } = {}): Operation<Empowered> {
  const ready = new Map<string, number>();
  const known = [...powers] as Power<unknown>[];
  const think = options.think ?? seconds(0.25);
  const handle: Empowered = {
    unitId: unit.id,
    powers: known,
    casting: undefined,
    readiness(powerId) {
      const power = known.find((candidate) => candidate.id === powerId);
      if (!power) return 0;
      const due = ready.get(powerId) ?? 0;
      if (world.tick >= due) return 1;
      return 1 - (due - world.tick) / Math.max(1, power.cooldown);
    },
    teach(power) {
      if (!known.some((candidate) => candidate.id === power.id)) known.push(power);
    },
    stop: () => life.halt(),
  };
  const life = yield* world.life(unit, function* powersOf(caster) {
    for (;;) {
      yield* wait(think);
      if (options.willing && !options.willing()) continue;
      for (const power of known) {
        if (world.tick < (ready.get(power.id) ?? 0)) continue;
        const target = power.aim(caster, world);
        if (target === undefined) continue;
        ready.set(power.id, world.tick + power.cooldown);
        handle.casting = power.id;
        try {
          yield* power.cast(caster, target, world);
        } finally {
          handle.casting = undefined;
        }
        break;
      }
    }
  }, `powers:${unit.id}`);
  return handle;
}
