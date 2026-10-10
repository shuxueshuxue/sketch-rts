import { describe, expect, it } from "vitest";
import { resolveVariant } from "../catalog";
import { createGame, removeUnit, snapshotGame, stepGame, strikeUnit } from "../sim";
import { createRoom } from "../rooms";
import { createSaveGameRecord, restoreGameFromSave } from "../savegame";
import { createDebugReplayTrace, recordReplayFrame, replayTraceToTick } from "../replay";
import { checksumGame } from "./checksum";
import { checkCommandLegality, commandValidationError } from "./command-validation";
import { CommandFrameRuntime } from "./command-frame-runtime";
import type { GameCommand } from "../types";

function veteranGame() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  const veteran = game.spawnUnit("player", "priest", 900, 900);
  veteran.level = 3;
  veteran.veteranSkillChoices = ["veteranResilience", "veteranHealingWave", "veteranInnerFire"];
  const command: Extract<GameCommand, { type: "learnVeteranSkill" }> = { type: "learnVeteranSkill", unitId: veteran.id, skill: "veteranHealingWave" };
  return { game, veteran, command };
}

describe("veteran command boundary", () => {
  it("requires a living own permanent non-hero three-star unit and one of its saved offers", () => {
    const { game, veteran, command } = veteranGame();
    const legal = () => commandValidationError(game, "player", command);
    expect(legal()).toBeUndefined();
    expect(commandValidationError(game, "enemy", command)).toMatch(/Unknown living enemy/);
    expect(commandValidationError(game, "player", { ...command, skill: "veteranRally" })).toMatch(/three veteran choices/);
    veteran.level = 2;
    expect(legal()).toMatch(/three-star/);
    veteran.level = 3;
    veteran.hp = 0;
    expect(legal()).toMatch(/Unknown living/);
    veteran.hp = veteran.maxHp;
    veteran.expiresTick = 1000;
    expect(legal()).toMatch(/permanent/);
    delete veteran.expiresTick;
    game.variants = { hero: resolveVariant({ base: "priest", heroic: true }) };
    veteran.variant = "hero";
    expect(legal()).toMatch(/non-hero/);
    delete veteran.variant;
    veteran.veteranSkillChoices = ["veteranHealingWave", "veteranHealingWave", "veteranInnerFire"];
    expect(legal()).toMatch(/three veteran choices/);
  });

  it("learns once through normal frames and safely ignores duplicate or stale choices", () => {
    const { game, veteran, command } = veteranGame();
    const originalChoices = [...veteran.veteranSkillChoices!];
    const runtime = new CommandFrameRuntime({ game, roomId: "veterans", rejectionLabel: "Rejected" });
    runtime.completeAndApply([
      { playerId: "player", command },
      { playerId: "player", command: { ...command, skill: "veteranInnerFire" } },
    ], { includeAi: false });
    expect(veteran.veteranSkill).toBe("veteranHealingWave");
    expect(veteran.veteranSkillChoices).toEqual(originalChoices);
    expect(checkCommandLegality(game, "player", command)).toEqual({ message: "Veteran skill already learned", transient: true });
    expect(() => runtime.admit([{ playerId: "player", command }])).toThrow(/already learned/);
    expect(() => runtime.completeAndApply([{ playerId: "player", command }], { includeAi: false })).not.toThrow();
    veteran.hp = 0;
    expect(() => runtime.completeAndApply([{ playerId: "player", command }], { includeAi: false })).not.toThrow();
  });

  it("admits learned self-centered active skills and their autocast toggle, but rejects stunned casting", () => {
    const { game, veteran, command } = veteranGame();
    const runtime = new CommandFrameRuntime({ game, roomId: "veterans", rejectionLabel: "Rejected" });
    const cast: GameCommand = { type: "cast", unitId: veteran.id, ability: "veteranHealingWave" };
    expect(commandValidationError(game, "player", cast)).toMatch(/cannot cast/);
    runtime.completeAndApply([{ playerId: "player", command }], { includeAi: false });
    expect(commandValidationError(game, "player", cast)).toBeUndefined();
    expect(commandValidationError(game, "player", { type: "setAutocast", unitIds: [veteran.id], ability: "veteranHealingWave", enabled: false })).toBeUndefined();
    veteran.effects.push({ type: "stun", remaining: 10 });
    expect(checkCommandLegality(game, "player", cast)).toEqual({ message: "priest is stunned", transient: true });
  });

  it("preserves pending offers, learned choices and cooldowns across saves and replay", () => {
    const { game, veteran, command } = veteranGame();
    const room = { ...createRoom({ id: "veteran-save", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const initialSave = createSaveGameRecord(game, room, { id: "pending-choice" });
    const restoredPending = restoreGameFromSave(initialSave);
    const restoredVeteran = restoredPending.units.find(unit => unit.id === veteran.id)!;
    expect(restoredVeteran.veteranSkillChoices).toEqual(veteran.veteranSkillChoices);
    expect(restoredVeteran.veteranSkillChoices).not.toBe(initialSave.snapshot.units.find(unit => unit.id === veteran.id)!.veteranSkillChoices);
    expect(checksumGame(restoredPending)).toBe(checksumGame(game));
    const trace = createDebugReplayTrace({ id: "learn-veteran", initialSave });
    const runtime = new CommandFrameRuntime({ game, roomId: room.id, rejectionLabel: "Rejected" });
    const frame = runtime.completeAndApply([{ playerId: "player", command }], { includeAi: false })!;
    recordReplayFrame(trace, { source: "test-harness", frame });
    stepGame(game);
    const replayed = replayTraceToTick(trace, game.tick);
    expect(checksumGame(replayed)).toBe(checksumGame(game));
    expect(replayed.units.find(unit => unit.id === veteran.id)?.veteranSkill).toBe("veteranHealingWave");
    veteran.abilityCooldowns = { veteranHealingWave: 120 };
    veteran.autocast = { veteranHealingWave: false };
    const learnedSave = createSaveGameRecord(game, room, { id: "learned-choice" });
    const learnedRestore = restoreGameFromSave(learnedSave);
    expect(checksumGame(learnedRestore)).toBe(checksumGame(game));
    expect(learnedRestore.units.find(unit => unit.id === veteran.id)).toMatchObject({ veteranSkill: "veteranHealingWave", abilityCooldowns: { veteranHealingWave: 120 }, autocast: { veteranHealingWave: false } });
    const snapshot = snapshotGame(game);
    expect(snapshot.units.find(unit => unit.id === veteran.id)!.veteranSkillChoices).not.toBe(veteran.veteranSkillChoices);
  });

  it("restores the same first hit and subsequent ticks after a unit walks outside an aura", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const leader = game.spawnUnit("player", "knight", 1000, 1000);
    leader.veteranSkill = "veteranMarch";
    const follower = game.spawnUnit("player", "footman", 1159, 1000);
    follower.order = { type: "move", x: 1300, y: 1000 };
    const source = game.spawnUnit("enemy", "footman", 1800, 1000);
    stepGame(game);
    expect(Math.hypot(follower.x - leader.x, follower.y - leader.y)).toBeGreaterThan(160);
    const room = { ...createRoom({ id: "aura-exit", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const save = createSaveGameRecord(game, room, { id: "aura-exit" });
    expect(save.snapshot).not.toHaveProperty("veteranFrame");
    expect(save.snapshot).not.toHaveProperty("unitSpatial");
    const restored = restoreGameFromSave(save);
    const copiedFollower = restored.units.find(unit => unit.id === follower.id)!;
    const copiedSource = restored.units.find(unit => unit.id === source.id)!;
    expect(checksumGame(restored)).toBe(checksumGame(game));
    strikeUnit(game, source, follower, 20, "spell");
    strikeUnit(restored, copiedSource, copiedFollower, 20, "spell");
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for (let tick = 0; tick < 8; tick++) {
      stepGame(game);
      stepGame(restored);
      expect(copiedFollower.speed).toBe(follower.speed);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
  });

  it("restores protection before the first post-load command inside a live aura", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const leader = game.spawnUnit("player", "footman", 1000, 1000);
    leader.veteranSkill = "veteranVigilance";
    const follower = game.spawnUnit("player", "footman", 1050, 1000);
    const source = game.spawnUnit("enemy", "footman", 1800, 1000);
    stepGame(game);
    const room = { ...createRoom({ id: "aura-hit", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const restored = restoreGameFromSave(createSaveGameRecord(game, room, { id: "aura-hit" }));
    const copiedFollower = restored.units.find(unit => unit.id === follower.id)!;
    const hp = follower.hp;
    strikeUnit(game, source, follower, 20, "spell");
    strikeUnit(restored, restored.units.find(unit => unit.id === source.id)!, copiedFollower, 20, "spell");
    expect(hp - follower.hp).toBeCloseTo(16.4);
    expect(copiedFollower.hp).toBe(follower.hp);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    stepGame(game);
    stepGame(restored);
    expect(checksumGame(restored)).toBe(checksumGame(game));
  });

  it.each(["death", "removal"] as const)("does not retain a saved aura after its source's %s", mode => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const leader = game.spawnUnit("player", "knight", 1000, 1000);
    leader.veteranSkill = "veteranMarch";
    const follower = game.spawnUnit("player", "footman", 1100, 1000);
    const source = game.spawnUnit("enemy", "archer", 1800, 1000);
    const ordinarySpeed = follower.speed;
    stepGame(game);
    expect(follower.speed).toBeGreaterThan(ordinarySpeed);
    if (mode === "death") {
      game.projectiles.push({ id: "kill-aura-source", owner: source.owner, attackerId: source.id, targetId: leader.id,
        fromX: source.x, fromY: source.y, toX: leader.x, toY: leader.y, damage: 10000, remaining: 1, duration: 1 });
    } else removeUnit(game, leader.id);
    stepGame(game);
    expect(game.units.some(unit => unit.id === leader.id)).toBe(false);
    expect(follower.speed).toBe(ordinarySpeed);
    const room = { ...createRoom({ id: "aura-gone", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const restored = restoreGameFromSave(createSaveGameRecord(game, room, { id: "aura-gone" }));
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for (let tick = 0; tick < 4; tick++) {
      stepGame(game);
      stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
  });

  it("still autocasts a learned ward when a blocked summon point prevents the innate spell", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.items = []; game.buildings = []; game.resources = [];
    game.scriptedVictory = true;
    const cells = Array<string>(64 * 64).fill(".");
    cells[31 * 64 + 33] = "#";
    game.map.terrain = { cell: 32, cols: 64, rows: 64, cells: cells.join("") };
    const caster = game.spawnUnit("player", "summoner", 1000, 1000);
    caster.veteranSkill = "veteranInnerFire";
    caster.order = { type: "hold", x: caster.x, y: caster.y };
    const enemy = game.spawnUnit("enemy", "archer", 1200, 1000);
    enemy.order = { type: "attack", targetId: caster.id };
    for (let tick = 0; tick < 12; tick++) stepGame(game);
    expect(game.units.some(unit => unit.kind === "spirit")).toBe(false);
    expect(caster.abilityCooldowns?.summon ?? 0).toBe(0);
    expect(caster.abilityCooldowns?.veteranInnerFire).toBeGreaterThan(0);
    expect(caster.effects).toEqual(expect.arrayContaining([expect.objectContaining({ type: "protection", damageReduction: .35 })]));
  });
});
