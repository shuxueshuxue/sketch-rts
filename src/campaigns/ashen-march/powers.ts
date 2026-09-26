import type { Unit } from "../../shared/types";
import { ensure, scope, spawn, type Operation } from "../../story/kernel";
import { wait } from "../../story/ops";
import { definePower, type Power } from "../../story/powers";
import { centerOf, distance, ring, toward, type Point } from "../../story/region";
import { seconds } from "../../story/time";
import type { World } from "../../story/world";
import { CAST } from "./cast";

// The powers of the Ashen March, each a script: when it is worth it (aim) and what it does (cast). Numbers grow with
// the caster's level where a hero casts them (`level` reads the party's record).

type Level = () => number;

// The densest knot of foes within reach: where a blow over an area does the most.
function knot(world: World, caster: Unit, reach: number, radius: number, least: number): Point | undefined {
  const foes = world.foesOf(caster, reach);
  let best: { at: Point; count: number } | undefined;
  for (const foe of foes) {
    const around = foes.filter((other) => distance(other, foe) <= radius);
    if (around.length >= least && (!best || around.length > best.count)) best = { at: centerOf(around), count: around.length };
  }
  return best?.at;
}

// The red circle where a blow is about to fall, for as long as the wind-up lasts (and not a moment longer if the caster
// falls first: the circle belongs to the cast's scope).
function* telegraph(world: World, at: Point, radius: number, span: number): Operation<void> {
  yield* scope(function* warning() {
    const mark = world.stage.mark("danger", at, { radius });
    yield* ensure(mark.remove);
    yield* wait(seconds(span));
  }, "telegraph");
}

function burnArea(world: World, source: Unit | { id: string; owner: string; x: number; y: number }, at: Point, radius: number, damage: number) {
  const owner = source.owner;
  for (const unit of damage > 0 ? world.game.units : []) {
    if (unit.hp <= 0 || !world.hostile(owner, unit.owner) || distance(unit, at) > radius) continue;
    world.strike(source as never, unit, damage, "spell");
  }
  for (const [index, spot] of Array.from({ length: 5 }, (_, i) => ring(at, radius * 0.8, i, 5)).entries()) world.effect("flameBurn", spot, seconds(0.9 + index * 0.1));
  world.effect("storm", at, seconds(1.2), { radius, owner: owner as never });
}

// ---- Lynn.

export const piercingShot = (level: Level): Power<Unit> =>
  definePower({
    id: "piercingShot",
    name: { zh: "穿云箭", en: "Piercing shot" },
    cooldown: seconds(9),
    aim(caster, world) {
      const foes = world.foesOf(caster, caster.attackRange + 40);
      return foes.sort((a, b) => b.attackDamage * (b.variant ? 2 : 1) - a.attackDamage * (a.variant ? 2 : 1) || distance(caster, a) - distance(caster, b))[0];
    },
    *cast(caster, target, world) {
      world.stage.bark(caster, { zh: "穿云！", en: "Through!" }, { span: seconds(1.2) });
      yield* wait(seconds(0.4));
      if (!world.alive(target)) return;
      world.effect("projectile", target, seconds(0.4), { fromX: caster.x, fromY: caster.y - 20, toX: target.x, toY: target.y, sourceKind: "archer" });
      yield* wait(seconds(0.3));
      world.strike(caster, target, 55 + level() * 9, "spell");
      world.effect("chargeImpact", target, seconds(0.6), { fromX: caster.x, fromY: caster.y, toX: target.x, toY: target.y, owner: caster.owner });
    },
  });

export const volley = (level: Level): Power<Point> =>
  definePower({
    id: "volley",
    name: { zh: "齐射", en: "Volley" },
    cooldown: seconds(16),
    aim: (caster, world) => knot(world, caster, 440, 120, 3),
    *cast(caster, at, world) {
      world.stage.bark(caster, { zh: "放箭——！", en: "Loose!" }, { span: seconds(1.2) });
      for (let wave = 0; wave < 3; wave += 1) {
        for (let arrow = 0; arrow < 6; arrow += 1) {
          const spot = ring(at, 110, arrow + wave * 6, 18);
          world.effect("projectile", spot, seconds(0.5), { fromX: caster.x, fromY: caster.y - 20, toX: spot.x, toY: spot.y, sourceKind: "archer" });
        }
        yield* wait(seconds(0.45));
        for (const foe of world.foesOf(caster, 125, at)) world.strike(caster, foe, 14 + level() * 3, "ranged");
      }
    },
  });

export const wardensRally = (level: Level): Power<Unit[]> =>
  definePower({
    id: "rally",
    name: { zh: "守望号令", en: "Warden's rally" },
    cooldown: seconds(26),
    aim(caster, world) {
      const hurt = world.alliesOf(caster, 280).filter((ally) => ally.hp < ally.maxHp * 0.6);
      return hurt.length >= 2 ? [caster, ...world.alliesOf(caster, 280)] : undefined;
    },
    *cast(caster, allies, world) {
      world.stage.bark(caster, { zh: "守望者，站稳！", en: "Wardens, hold!" });
      world.effect("guardianField", caster, seconds(1.4), { radius: 280 });
      for (const ally of allies) {
        world.heal(ally, 40 + level() * 6);
        const unit = world.unit(ally);
        if (unit) unit.effects = unit.effects.filter((effect) => effect.type !== "curse");
      }
      yield* wait(seconds(0.2));
    },
  });

// ---- Old Du.

export const shieldWall = (): Power<true> =>
  definePower({
    id: "shieldWall",
    name: { zh: "盾墙", en: "Shield wall" },
    cooldown: seconds(18),
    aim: (caster, world) => (world.foesOf(caster, 150).length >= 3 || caster.hp < caster.maxHp * 0.45 ? true : undefined),
    *cast(caster, _target, world) {
      world.stage.bark(caster, { zh: "盾墙！", en: "Shields!" }, { tone: "shout", span: seconds(1.4) });
      world.afflict(caster, "guardian", seconds(2.6));
      world.effect("guardianField", caster, seconds(2.6), { radius: 60 });
      yield* wait(seconds(0.2));
    },
  });

export const stomp = (level: Level): Power<true> =>
  definePower({
    id: "stomp",
    name: { zh: "震地", en: "Stomp" },
    cooldown: seconds(11),
    aim: (caster, world) => (world.foesOf(caster, 110).length >= 2 ? true : undefined),
    *cast(caster, _target, world) {
      yield* wait(seconds(0.3));
      world.stage.quake(3, seconds(0.4));
      world.effect("chargeImpact", caster, seconds(0.6), { fromX: caster.x - 40, fromY: caster.y, toX: caster.x, toY: caster.y, owner: caster.owner });
      for (const foe of world.foesOf(caster, 130)) world.strike(caster, foe, 36 + level() * 5, "melee");
    },
  });

export const taunt = (): Power<Unit[]> =>
  definePower({
    id: "taunt",
    name: { zh: "挑衅", en: "Taunt" },
    cooldown: seconds(16),
    aim(caster, world) {
      const pressed = world.alliesOf(caster, 320).find((ally) => ally.variant !== CAST.du.id && world.foesOf(ally, 90).length >= 2);
      return pressed ? world.foesOf(caster, 280, pressed).slice(0, 6) : undefined;
    },
    *cast(caster, foes, world) {
      world.stage.bark(caster, { zh: "冲我来，小崽子们！", en: "Come on then, whelps!" }, { tone: "shout" });
      world.attack(foes.filter((foe) => world.alive(foe)), caster);
      yield* wait(seconds(0.2));
    },
  });

// ---- Tess.

export const thornSnare = (): Power<Unit> =>
  definePower({
    id: "thornSnare",
    name: { zh: "荆棘缠绕", en: "Thorn snare" },
    cooldown: seconds(14),
    aim(caster, world) {
      const foes = world.foesOf(caster, 320).filter((foe) => foe.speed > 0 && foe.attackRange < 100);
      return foes.sort((a, b) => b.attackDamage - a.attackDamage)[0];
    },
    *cast(caster, target, world) {
      world.stage.bark(caster, { zh: "别动。", en: "Stay." }, { tone: "whisper", span: seconds(1.2) });
      // The root holds the unit's speed at nothing, and gives it back however the snare ends: even if Tess falls.
      yield* scope(function* rooted() {
        const speed = target.speed;
        const mark = world.stage.mark("snare", target, { radius: 26 });
        yield* ensure(() => {
          mark.remove();
          const unit = world.unit(target);
          if (unit && unit.speed === 0) unit.speed = speed;
        });
        target.speed = 0;
        world.strike(caster, target, 20, "spell");
        yield* wait(seconds(3.5));
      }, "thornSnare");
    },
  });

export const mendingRain = (level: Level): Power<Point> =>
  definePower({
    id: "mendingRain",
    name: { zh: "愈合之雨", en: "Mending rain" },
    cooldown: seconds(24),
    aim(caster, world) {
      const hurt = [caster, ...world.alliesOf(caster, 260)].filter((ally) => ally.hp < ally.maxHp * 0.75);
      return hurt.length >= 3 ? centerOf(hurt) : undefined;
    },
    *cast(caster, at, world) {
      world.stage.bark(caster, { zh: "雨来了，别乱跑。", en: "Rain's coming. Stand in it." });
      for (let pulse = 0; pulse < 5; pulse += 1) {
        world.effect("heal", at, seconds(1), { radius: 220 });
        for (const ally of [caster, ...world.alliesOf(caster, 220, at)]) world.heal(ally, 14 + level() * 3, { effect: pulse === 0 });
        yield* wait(seconds(1));
      }
    },
  });

// ---- Ig.

export const fireFlask = (level: Level): Power<Point> =>
  definePower({
    id: "fireFlask",
    name: { zh: "火罐", en: "Fire flask" },
    cooldown: seconds(12),
    aim: (caster, world) => knot(world, caster, 300, 100, 2),
    *cast(caster, at, world) {
      world.effect("projectile", at, seconds(0.5), { fromX: caster.x, fromY: caster.y - 16, toX: at.x, toY: at.y, sourceKind: "pyreCaller" });
      yield* wait(seconds(0.5));
      burnArea(world, caster, at, 100, 30 + level() * 5);
      for (const foe of world.foesOf(caster, 100, at)) world.afflict(foe, "scorch", seconds(6));
    },
  });

export const shadowstep = (level: Level): Power<Unit> =>
  definePower({
    id: "shadowstep",
    name: { zh: "潜袭", en: "Shadowstep" },
    cooldown: seconds(15),
    aim(caster, world) {
      return world.foesOf(caster, 360).filter((foe) => foe.attackRange > 150).sort((a, b) => a.hp - b.hp)[0];
    },
    *cast(caster, target, world) {
      world.effect("chargeTrail", caster, seconds(0.3), { fromX: caster.x, fromY: caster.y, toX: target.x, toY: target.y, owner: caster.owner, unitId: caster.id });
      const behind = toward(target, { x: target.x + (target.x - caster.x), y: target.y + (target.y - caster.y) }, 36);
      caster.x = behind.x;
      caster.y = behind.y;
      world.strike(caster, target, caster.attackDamage * 2.5 + level() * 4, "melee");
      world.attack([caster], target);
      yield* wait(seconds(0.2));
    },
  });

// ---- The Ember host.

export const fireRain = (options: { radius: number; damage: number; windUp: number; least: number; reach?: number }): Power<Point> =>
  definePower({
    id: "fireRain",
    name: { zh: "火雨", en: "Fire rain" },
    cooldown: seconds(13),
    aim: (caster, world) => knot(world, caster, options.reach ?? 330, options.radius, options.least),
    *cast(caster, at, world) {
      const source = { id: caster.id, owner: caster.owner as string, x: caster.x, y: caster.y };
      yield* telegraph(world, at, options.radius, options.windUp);
      burnArea(world, source, at, options.radius, options.damage);
    },
  });

export const cleave = (): Power<true> =>
  definePower({
    id: "cleave",
    name: { zh: "烙斩", en: "Brand cleave" },
    cooldown: seconds(8),
    aim: (caster, world) => (world.foesOf(caster, 95).length >= 2 ? true : undefined),
    *cast(caster, _target, world) {
      world.stage.bark(caster, { zh: "都给我烧！", en: "Burn, all of you!" }, { tone: "shout", span: seconds(1.3) });
      yield* wait(seconds(0.35));
      world.effect("chargeImpact", caster, seconds(0.5), { fromX: caster.x - 30, fromY: caster.y, toX: caster.x + 30, toY: caster.y, owner: caster.owner });
      for (const foe of world.foesOf(caster, 105)) {
        world.strike(caster, foe, 34, "melee");
        world.afflict(foe, "scorch", seconds(5));
      }
    },
  });

export const houndCall = (count: number, cooldown = 24): Power<true> =>
  definePower({
    id: "houndCall",
    name: { zh: "唤犬", en: "Hound call" },
    cooldown: seconds(cooldown),
    aim: (caster, world) => (world.foesOf(caster, 450).length > 0 ? true : undefined),
    *cast(caster, _target, world) {
      world.stage.bark(caster, { zh: "吃吧，我的孩子们。", en: "Feed, my children." }, { tone: "whisper" });
      world.effect("summon", caster, seconds(1.2));
      yield* wait(seconds(0.6));
      const hounds = world.spawnGroup(CAST.cinderHound, caster.owner, { x: caster.x + 40, y: caster.y + 20 }, count, { spread: 50 });
      world.attackMove(hounds, world.foesOf(caster, 600)[0] ?? caster);
    },
  });

export const magmaSlam = (): Power<true> =>
  definePower({
    id: "magmaSlam",
    name: { zh: "熔岩重击", en: "Magma slam" },
    cooldown: seconds(10),
    aim: (caster, world) => (world.foesOf(caster, 190).length >= 2 ? true : undefined),
    *cast(caster, _target, world) {
      const at = { x: caster.x, y: caster.y };
      yield* telegraph(world, at, 190, 1.8);
      world.stage.quake(9, seconds(0.8));
      world.effect("chargeImpact", at, seconds(0.8), { fromX: at.x, fromY: at.y - 60, toX: at.x, toY: at.y, owner: caster.owner });
      burnArea(world, caster, at, 190, 95);
    },
  });

export const emberBrood = (): Power<true> =>
  definePower({
    id: "emberBrood",
    name: { zh: "余烬孵化", en: "Ember brood" },
    cooldown: seconds(22),
    aim: (caster, world) => (world.foesOf(caster, 600).length > 0 ? true : undefined),
    *cast(caster, _target, world) {
      world.stage.quake(4, seconds(0.5));
      for (const [index, spot] of Array.from({ length: 3 }, (_, i) => ring(caster, 90, i, 3)).entries()) {
        world.effect("summon", spot, seconds(1));
        const hound = world.spawn(CAST.cinderHound, caster.owner, spot);
        world.attackMove([hound], world.foesOf(caster, 700)[index % 2] ?? caster);
      }
      yield* wait(seconds(0.3));
    },
  });

export const flameWave = (): Power<Unit> =>
  definePower({
    id: "flameWave",
    name: { zh: "焚誓之浪", en: "Oathflame wave" },
    cooldown: seconds(9),
    aim: (caster, world) => world.foesOf(caster, 260).sort((a, b) => distance(caster, a) - distance(caster, b))[0],
    *cast(caster, target, world) {
      const at = toward(caster, target, 120);
      world.stage.bark(caster, { zh: "跪下！", en: "Kneel!" }, { tone: "shout", span: seconds(1.2) });
      yield* telegraph(world, at, 130, 1.1);
      burnArea(world, caster, at, 130, 70);
    },
  });

// A bolt from above, at every foe near the point, for a while: the colossus's eruption and Oru's storm.
export function* eruption(world: World, source: Unit, center: Point, spread: number, bolts: number, damage: number): Operation<void> {
  const origin = { id: source.id, owner: source.owner as string, x: source.x, y: source.y };
  for (let bolt = 0; bolt < bolts; bolt += 1) {
    const at = ring(center, spread, Math.floor(world.roll() * 97), 97);
    yield* spawn(function* bolt(): Operation<void> {
      yield* telegraph(world, at, 90, 1.3);
      burnArea(world, origin, at, 90, damage);
    }, "eruption:bolt");
    yield* wait(seconds(0.35));
  }
  yield* wait(seconds(1.4));
}
