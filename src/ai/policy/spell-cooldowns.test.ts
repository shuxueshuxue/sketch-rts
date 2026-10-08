import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../../shared/sim";
import { checkCommandLegality } from "../../shared/sim/command-validation";
import { planAbilityCommands } from "./spell-tactics";
import { planAbilityCommands as planFrozenAbilityCommands } from "../policy-v2prod/spell-tactics";

const groveCasters = [
  { kind: "priest", ability: "heal" },
  { kind: "summoner", ability: "summon" },
  { kind: "witch", ability: "curse" },
] as const;
const emberCasters = [
  { kind: "emberAcolyte", ability: "emberMend" },
  { kind: "pyreCaller", ability: "cinderSoul" },
  { kind: "ashHexer", ability: "ashCurse" },
] as const;

describe.each([
  { name: "current", plan: planAbilityCommands, casters: [...groveCasters, ...emberCasters] },
  { name: "frozen v2", plan: planFrozenAbilityCommands, casters: [...groveCasters] },
])("$name AI spell cooldowns", ({ plan, casters }) => {
  it.each(casters)("checks $ability independently of the veteran skill cooldown", ({ kind, ability }) => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = [];
    const caster = game.spawnUnit("player", kind, 800, 800);
    const wounded = game.spawnUnit("player", "footman", 840, 800);
    game.spawnUnit("enemy", "footman", 900, 800);
    wounded.hp = 20;
    caster.level = 3;
    caster.veteranSkill = "veteranRally";
    caster.abilityCooldowns = { [ability]: 200 };

    expect(plan(snapshotGame(game), "player", { version: "v2" })).toEqual([]);

    caster.abilityCooldowns = { veteranRally: 200 };
    const commands = plan(snapshotGame(game), "player", { version: "v2" });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "cast", unitId: caster.id, ability });
    expect(checkCommandLegality(game, "player", commands[0]!)).toBeUndefined();
  });
});
