import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { createGame, issuePlayerCommand, refreshUnitStats, removeUnit, snapshotGame, stepGame } from "./sim";
import { createRoom } from "./rooms";
import { createSaveGameRecord, restoreGameFromSave } from "./savegame";
import { createDebugReplayTrace, recordReplayFrame, replayTraceToTick } from "./replay";
import { checksumGame } from "./sim/checksum";
import { advanceCommandFrameTick } from "./sim/command-frame-runtime";
import type { CommandEnvelope, CommandFrame } from "./net/types";
import { installedWeapons, mountedWeaponPose, SHIP_WEAPONS } from "./ship-equipment";
import { seconds } from "./time";
import { xpStarThresholds } from "./unit-value";
import type { Unit } from "./types";
import type { VeteranSkillId } from "./veteran-skills";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

function run(game: ReturnType<typeof scene>, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

/** A fixed offered skill isolates its effect; other tests exercise the natural XP/draft path. */
function learn(game: ReturnType<typeof scene>, unit: Unit, skill: VeteranSkillId) {
  unit.level = 3;
  unit.xp = xpStarThresholds(UNIT_DEFS[unit.kind])[2]!;
  unit.veteranSkillChoices = ["veteranResilience", "veteranMobility", skill];
  refreshUnitStats(game, unit);
  issuePlayerCommand(game, unit.owner, { type: "learnVeteranSkill", unitId: unit.id, skill });
}

const formation = [[-80, -50], [0, -80], [80, -50], [-80, 50], [0, 80], [80, 50]] as const;
const room = { ...createRoom({ id: "veteran-continuation", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };

describe("veteran progression in the shared simulation", () => {
  it("keeps identical weapons at every star while increasing health and offers a stable third-star choice", () => {
    const scenario = {
      replaceDefaultUnits: true,
      addUnits: [0, ...xpStarThresholds(UNIT_DEFS.footman)].map((xp, level) => ({
        id: `star-${level}`, owner: "player", kind: "footman" as const, x: 800 + level * 80, y: 800, xp,
      })),
    };
    const game = createGame("bareDuel", { aiPlayers: [], scenario });
    expect(game.units.map(unit => unit.level)).toEqual([0, 1, 2, 3]);
    expect(game.units.map(unit => unit.maxHp)).toEqual([145, 193, 242, 290]);
    expect(game.units.map(unit => unit.attackDamage)).toEqual([16, 16, 16, 16]);
    expect(game.units.slice(0, 3).every(unit => unit.veteranSkillChoices === undefined)).toBe(true);
    const veteran = game.units[3]!;
    const offered = [...veteran.veteranSkillChoices!];
    expect(offered).toHaveLength(3);
    expect(new Set(offered).size).toBe(3);
    const duplicate = createGame("bareDuel", { aiPlayers: [], scenario });
    expect(duplicate.units[3]!.veteranSkillChoices).toEqual(offered);
    run(game, seconds(2));
    expect(veteran.veteranSkillChoices).toEqual(offered);
    expect(snapshotGame(game).units.find(unit => unit.id === veteran.id)!.veteranSkillChoices).toEqual(offered);
  });

  it("removes and restores movement aura bonuses as a commanded unit walks across the boundary", () => {
    const game = scene();
    const leader = game.spawnUnit("player", "raider", 800, 800);
    const follower = game.spawnUnit("player", "footman", 850, 800);
    learn(game, leader, "veteranMarch");
    stepGame(game);
    expect(follower.speed).toBeCloseTo(68.2);
    issuePlayerCommand(game, "player", { type: "move", unitIds: [follower.id], x: 1200, y: 800 });
    for (let tick = 0; tick < seconds(5) && follower.x < 1000; tick += 1) stepGame(game);
    expect(Math.hypot(follower.x - leader.x, follower.y - leader.y)).toBeGreaterThan(160);
    stepGame(game);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed);
    issuePlayerCommand(game, "player", { type: "move", unitIds: [follower.id], x: 850, y: 800 });
    for (let tick = 0; tick < seconds(5) && follower.x > 930; tick += 1) stepGame(game);
    stepGame(game);
    expect(Math.hypot(follower.x - leader.x, follower.y - leader.y)).toBeLessThan(160);
    expect(follower.speed).toBeCloseTo(68.2);
    leader.hp = 0;
    stepGame(game);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed);
  });

  it.each([1, 3, 6])("restores 1.2 health per second to each of %i nearby wounded allies", count => {
    const game = scene();
    const leader = game.spawnUnit("player", "priest", 800, 800);
    leader.autocast = { heal: false };
    learn(game, leader, "veteranRenewal");
    const allies = formation.slice(0, count).map(([dx, dy]) => {
      const unit = game.spawnUnit("player", "footman", 800 + dx, 800 + dy);
      unit.hp -= 60;
      return unit;
    });
    const before = allies.reduce((sum, unit) => sum + unit.hp, 0);
    run(game, seconds(1));
    expect(allies.reduce((sum, unit) => sum + unit.hp, 0) - before).toBeCloseTo(1.2 * count, 6);
  });

  it("caps a real healing wave at five times thirty and preserves the separate 55-health base heal", () => {
    const game = scene();
    const priest = game.spawnUnit("player", "priest", 800, 800);
    priest.autocast = { heal: false, veteranHealingWave: false };
    learn(game, priest, "veteranHealingWave");
    const allies = formation.map(([dx, dy]) => {
      const unit = game.spawnUnit("player", "footman", 800 + dx, 800 + dy);
      unit.hp -= 70;
      return unit;
    });
    const before = allies.reduce((sum, unit) => sum + unit.hp, 0);
    issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "veteranHealingWave" });
    expect(allies.reduce((sum, unit) => sum + unit.hp, 0) - before).toBe(150);
    expect(allies.filter(unit => unit.hp === 105)).toHaveLength(5);
    expect(priest.abilityCooldowns?.veteranHealingWave).toBe(seconds(24));
    const untreated = allies.find(unit => unit.hp === 75)!;
    issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: untreated.id });
    expect(untreated.hp).toBe(130);
    expect(priest.abilityCooldowns?.heal).toBe(seconds(12));
    expect(priest.abilityCooldowns?.veteranHealingWave).toBe(seconds(24));
    expect(() => issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "veteranHealingWave" })).toThrow(/cooldown/);
    run(game, seconds(24));
    expect(priest.abilityCooldowns?.veteranHealingWave ?? 0).toBe(0);
  });

  it("extends an installed cannon's real firing range beyond its ordinary boundary", () => {
    const fire = (specialist: boolean, rangeShare: number) => {
      const game = scene();
      const ship = game.spawnUnit("player", "warship", 800, 800);
      if (specialist) learn(game, ship, "veteranSiegeDrill");
      const cannon = installedWeapons(game, ship)[0]!;
      const pivot = mountedWeaponPose(ship, cannon)!.pivot;
      const target = game.spawnUnit("enemy", "worker", pivot.x + SHIP_WEAPONS.shipCannon.range * rangeShare, pivot.y);
      issuePlayerCommand(game, "player", { type: "holdPosition", unitIds: [ship.id] });
      issuePlayerCommand(game, "enemy", { type: "holdPosition", unitIds: [target.id] });
      const shots = new Set<string>();
      for (let tick = 0; tick < seconds(2); tick += 1) {
        stepGame(game);
        for (const shot of game.projectiles) if (shot.attackerId === ship.id) shots.add(shot.id);
      }
      expect(ship.x).toBeCloseTo(800);
      return shots.size;
    };
    expect(fire(false, 1.05)).toBe(0);
    expect(fire(true, 1.05)).toBeGreaterThan(0);
    expect(fire(true, 1.12)).toBe(0);
  });

  it.each([0, 1])("keeps immediate learn/remove saves canonical after %i prior ticks, without serializing derived caches", priorTicks => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.items = [];
    const leader = game.spawnUnit("player", "raider", 2000, 2000);
    const follower = game.spawnUnit("player", "footman", 2060, 2000);
    run(game, priorTicks);
    learn(game, leader, "veteranMarch");
    expect(follower.speed).toBeCloseTo(UNIT_DEFS.footman.speed * 1.1);
    const learned = createSaveGameRecord(game, room, { id: "learned-before-next-tick" });
    expect(JSON.stringify(learned)).not.toContain('"veteranFrame"');
    expect(JSON.stringify(learned)).not.toContain('"veteranAutocastFrame"');
    const restored = restoreGameFromSave(learned);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    expect(restored.veteranAutocastFrame).toBeUndefined();
    removeUnit(game, leader.id);
    removeUnit(restored, leader.id);
    expect(follower.speed).toBe(UNIT_DEFS.footman.speed);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    const removed = createSaveGameRecord(game, room, { id: "removed-before-next-tick" });
    const reread = restoreGameFromSave(removed);
    expect(checksumGame(reread)).toBe(checksumGame(game));
    for (let tick = 0; tick < 25; tick += 1) {
      stepGame(game); stepGame(restored); stepGame(reread);
      expect(checksumGame(restored)).toBe(checksumGame(game));
      expect(checksumGame(reread)).toBe(checksumGame(game));
    }
  });

  it("migrates an older three-star save without rerolling or healing and remains deterministic after learning", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.items = [];
    const unit = game.spawnUnit("player", "footman", 2000, 2000);
    const baseDamage = unit.attackDamage;
    unit.level = 3; unit.xp = xpStarThresholds(UNIT_DEFS.footman)[2]!;
    refreshUnitStats(game, unit);
    unit.hp = 57; unit.attackDamage = baseDamage * 2;
    const oldSave = createSaveGameRecord(game, room, { id: "older-veteran-rules" });
    oldSave.runtime.checksumVersion = 7;
    delete oldSave.snapshot.units[0]!.veteranSkillChoices;
    const unchangedInput = JSON.stringify(oldSave);
    const first = restoreGameFromSave(oldSave);
    const second = restoreGameFromSave(JSON.parse(JSON.stringify(oldSave)));
    const upgraded = first.units[0]!;
    expect(upgraded.hp).toBe(57);
    expect(upgraded.attackDamage).toBe(baseDamage);
    expect(new Set(upgraded.veteranSkillChoices).size).toBe(3);
    expect(second.units[0]!.veteranSkillChoices).toEqual(upgraded.veteranSkillChoices);
    expect(JSON.stringify(oldSave)).toBe(unchangedInput);
    const skill = upgraded.veteranSkillChoices![0]!;
    issuePlayerCommand(first, "player", { type: "learnVeteranSkill", unitId: unit.id, skill });
    issuePlayerCommand(second, "player", { type: "learnVeteranSkill", unitId: unit.id, skill });
    const resaved = restoreGameFromSave(createSaveGameRecord(first, room, { id: "migrated-and-learned" }));
    for (let tick = 0; tick < 200; tick += 1) {
      stepGame(first); stepGame(second); stepGame(resaved);
      expect(checksumGame(second)).toBe(checksumGame(first));
      expect(checksumGame(resaved)).toBe(checksumGame(first));
    }
  });

  it("continues mixed veteran combat identically through save restore and recorded replay on every tick", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.items = [];
    const learned: CommandEnvelope[] = [];
    const activeIds = new Map<VeteranSkillId, string>();
    const addVeteran = (kind: Unit["kind"], skill: VeteranSkillId, x: number, y: number) => {
      const unit = game.spawnUnit("player", kind, x, y);
      unit.level = 3; unit.xp = xpStarThresholds(UNIT_DEFS[kind])[2]!;
      unit.veteranSkillChoices = ["veteranResilience", "veteranMobility", skill];
      refreshUnitStats(game, unit);
      if (kind === "priest") unit.autocast = { heal: false };
      unit.order = { type: "hold", x, y };
      learned.push({ playerId: "player", command: { type: "learnVeteranSkill", unitId: unit.id, skill } });
      activeIds.set(skill, unit.id);
      return unit;
    };
    const doomed = addVeteran("raider", "veteranMarch", 1700, 1900); doomed.hp = 1;
    const attacker = game.spawnUnit("enemy", "footman", 1724, 1900);
    attacker.order = { type: "attack", targetId: doomed.id };
    const runner = game.spawnUnit("player", "footman", 1650, 1900);
    runner.order = { type: "move", x: 1450, y: 1900 };
    addVeteran("footman", "veteranCommand", 2020, 2000);
    addVeteran("footman", "veteranPhalanx", 2020, 2040);
    addVeteran("priest", "veteranRenewal", 1970, 2020);
    addVeteran("footman", "veteranRally", 2020, 2080);
    addVeteran("priest", "veteranHealingWave", 1970, 2060);
    addVeteran("priest", "veteranInnerFire", 1970, 2100);
    for (let index = 0; index < 9; index += 1) {
      const x = 2080 - (index % 3) * 25, y = 1990 + Math.floor(index / 3) * 42;
      const ally = game.spawnUnit("player", index % 3 === 0 ? "archer" : "footman", x, y);
      ally.hp -= 60;
      ally.order = { type: "hold", x, y };
      const enemy = game.spawnUnit("enemy", index % 3 === 0 ? "archer" : "footman", 2160 + (index % 3) * 25, y);
      enemy.order = { type: "attackMove", x: 1960, y };
    }
    const initialSave = createSaveGameRecord(game, room, { id: "veteran-replay-start" });
    const trace = createDebugReplayTrace({ id: "veteran-replay", initialSave });
    const frames: CommandFrame[] = [
      { roomId: room.id, tick: 0, sequence: 0, commands: learned },
      { roomId: room.id, tick: 40, sequence: 1, commands: [{ playerId: "player", command: { type: "move", unitIds: [runner.id], x: 1990, y: 1920 } }] },
      { roomId: room.id, tick: 160, sequence: 2, commands: [{ playerId: "player", command: { type: "move", unitIds: [runner.id], x: 1800, y: 1800 } }] },
    ];
    for (const frame of frames) recordReplayFrame(trace, { source: "test-harness", frame });
    const observed = new Set<VeteranSkillId>();
    const observeCasts = () => {
      for (const [skill, id] of activeIds) {
        const unit = game.units.find(candidate => candidate.id === id);
        if (unit?.abilityCooldowns && Object.hasOwn(unit.abilityCooldowns, skill)) observed.add(skill);
      }
    };
    for (let tick = 0; tick < 100; tick += 1) {
      advanceCommandFrameTick(game, frames.filter(frame => frame.tick === game.tick));
      observeCasts();
    }
    expect(game.units.some(unit => unit.id === doomed.id)).toBe(false);
    expect([...observed].sort()).toEqual(["veteranHealingWave", "veteranInnerFire", "veteranRally"]);
    const midSave = createSaveGameRecord(game, room, { id: "veteran-middle" });
    const saved = restoreGameFromSave(midSave);
    const replayed = replayTraceToTick(trace, game.tick);
    expect(checksumGame(saved)).toBe(checksumGame(game));
    expect(checksumGame(replayed)).toBe(checksumGame(game));
    for (let tick = 0; tick < 300; tick += 1) {
      const currentFrames = frames.filter(frame => frame.tick === game.tick);
      advanceCommandFrameTick(game, currentFrames);
      advanceCommandFrameTick(saved, currentFrames);
      advanceCommandFrameTick(replayed, currentFrames);
      expect(checksumGame(saved), `save continuation at tick ${game.tick}`).toBe(checksumGame(game));
      expect(checksumGame(replayed), `replay continuation at tick ${game.tick}`).toBe(checksumGame(game));
    }
    expect(game.tick).toBe(400);
    expect(checksumGame(replayTraceToTick(trace, 400))).toBe(checksumGame(game));
    expect(JSON.stringify(createSaveGameRecord(game, room, { id: "veteran-end" }))).not.toContain('"veteranAutocastFrame"');
  });
});
