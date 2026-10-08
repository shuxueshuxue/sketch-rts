import { describe, expect, it } from "vitest";
import { createGame } from "../../shared/sim";
import { Stage } from "../../story/stage";
import { instant } from "../../story/time";
import { World } from "../../story/world";
import { mendingRain, wardensRally } from "./powers";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = [];
  const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
  const caster = world.spawn("priest", "player", { x: 1000, y: 1000 });
  const mechanical = ["golem", "ballista", "transport"].map((kind, index) =>
    game.spawnUnit("player", kind as "golem" | "ballista" | "transport", 1200, 1000 + index * 10));
  for (const unit of mechanical) unit.hp = unit.maxHp * .4;
  return { game, world, caster, mechanical };
}

describe("campaign healing target selection", () => {
  it("does not spend either healing cooldown for a group of damaged mechanical allies", () => {
    const { world, caster } = scene();
    expect(wardensRally(() => 1).aim(caster, world)).toBeUndefined();
    expect(mendingRain(() => 1).aim(caster, world)).toBeUndefined();
  });

  it("centers mending rain on wounded non-mechanical allies without pulling the area toward damaged machines", () => {
    const { game, world, caster } = scene();
    for (let index = 0; index < 3; index += 1) {
      const ally = game.spawnUnit("player", "footman", 940 + index * 20, 1000 + index * 10);
      ally.hp = ally.maxHp * .4;
    }
    expect(mendingRain(() => 1).aim(caster, world)).toEqual({ x: 960, y: 1010 });
  });

  it("keeps rally's curse removal on mechanical allies when non-mechanical casualties justify the cast", () => {
    const { game, world, caster, mechanical } = scene();
    for (let index = 0; index < 2; index += 1) {
      const ally = game.spawnUnit("player", "footman", 960 + index * 20, 1000);
      ally.hp = ally.maxHp * .4;
    }
    for (const unit of mechanical) unit.effects.push({ type: "curse", remaining: 100 });
    const before = mechanical.map(unit => unit.hp);
    const power = wardensRally(() => 1);
    const targets = power.aim(caster, world)!;
    expect(targets).toBeDefined();
    power.cast(caster, targets, world).next();
    expect(mechanical.map(unit => unit.hp)).toEqual(before);
    for (const unit of mechanical) expect(unit.effects.some(effect => effect.type === "curse")).toBe(false);
  });
});
