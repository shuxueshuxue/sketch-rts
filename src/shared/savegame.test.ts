import { describe, expect, it } from "vitest";
import { createRoom } from "./rooms";
import { assertSaveGameInput, createSaveGameRecord, parseSaveGameInput, restoreGameFromSave } from "./savegame";
import { hullFits, planShipRoute } from "./ship-navigation";
import { CHECKSUM_VERSION, checksumGame } from "./sim/checksum";
import { createGame, issuePlayerCommand, refreshUnitStats, stepGame } from "./sim";

describe("savegame runtime sync metadata", () => {
  it.each([11, 12])("replans a version-%s coastal voyage without changing its order or physical pose", version => {
    const game=createGame("bareDuel",{aiPlayers:[]});
    game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
    game.map={...game.map,width:960,height:768,terrain:{cols:30,rows:24,cell:32,cells:Array.from({length:720},(_,i)=>{
      const x=i%30,y=Math.floor(i/30);return x===0||y===0||x===29||y===23||(x>=12&&x<=15&&y>=5&&y<=13)?'.':'~';
    }).join('')}};
    const ship=game.spawnUnit('player','transport',176,336),goal={x:784,y:336};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    const planned=planShipRoute(game.map,ship,goal);
    ship.sailing!.route={goalX:goal.x,goalY:goal.y,...planned,end:goal,cruise:true,startX:ship.x,startY:ship.y,startHeading:0};
    const room={...createRoom({id:'old-voyage',host:{id:'host',name:'Host'},mapId:'bareDuel'}),status:'inMatch' as const};
    const save=createSaveGameRecord(game,room,{id:'old-voyage'});save.runtime.checksumVersion=version;
    const original=JSON.stringify(save),restored=restoreGameFromSave(save),boat=restored.units.find(unit=>unit.id===ship.id)!;
    expect(boat).toMatchObject({x:ship.x,y:ship.y,order:ship.order,sailing:{heading:ship.sailing!.heading,speed:ship.sailing!.speed}});
    expect(boat.sailing!.route).toBeUndefined();expect(JSON.stringify(save)).toBe(original);
    for(let tick=0;tick<1000 && boat.order.type==='move';tick++){stepGame(restored);expect(hullFits(restored.map,boat)).toBe(true);}
    expect(boat.order.type).toBe('idle');expect(Math.hypot(boat.x-goal.x,boat.y-goal.y)).toBeLessThan(1);
  });

  it.each([false, true])("repairs only incompatible mechanical skill offers from a version-eight save (learned=%s)", learned => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const mechanical = game.spawnUnit("player", "golem", 900, 900);
    const living = game.spawnUnit("player", "footman", 1100, 900);
    for (const unit of [mechanical, living]) {
      unit.level = 3;
      refreshUnitStats(game, unit);
      unit.hp = 42;
      unit.veteranSkillChoices = ["veteranMobility", "veteranPhalanx", "veteranEndurance"];
      if (learned) unit.veteranSkill = "veteranEndurance";
    }
    const room = { ...createRoom({ id: "class-upgrade", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const save = createSaveGameRecord(game, room, { id: "class-upgrade" });
    save.runtime.checksumVersion = 8;
    const original = JSON.stringify(save);
    const restored = restoreGameFromSave(save);
    const machine = restored.units.find(unit => unit.id === mechanical.id)!;
    expect(machine.hp).toBe(42);
    expect(machine.veteranSkill).toBeUndefined();
    expect(machine.veteranSkillChoices).toEqual(["veteranMobility", "veteranPhalanx", "veteranMarch"]);
    const soldier = restored.units.find(unit => unit.id === living.id)!;
    expect(soldier.veteranSkillChoices).toEqual(living.veteranSkillChoices);
    expect(soldier.veteranSkill).toBe(living.veteranSkill);
    expect(JSON.stringify(save)).toBe(original);
    issuePlayerCommand(restored, "player", { type: "learnVeteranSkill", unitId: machine.id, skill: "veteranMarch" });
    expect(machine.veteranSkill).toBe("veteranMarch");
    const again = restoreGameFromSave(createSaveGameRecord(restored, room, { id: "class-upgraded" }));
    for (let tick = 0; tick < 30; tick++) {
      stepGame(restored);
      stepGame(again);
      expect(checksumGame(again)).toBe(checksumGame(restored));
    }
  });

  it("upgrades older star growth without healing and grants a stable skill offer", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const unit = game.spawnUnit("player", "footman", 900, 900);
    const unstarredAttack = unit.attackDamage;
    unit.level = 3;
    refreshUnitStats(game, unit);
    unit.hp = 91;
    unit.attackDamage = unstarredAttack * 2;
    const room = { ...createRoom({ id: "old-stars", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const save = createSaveGameRecord(game, room, { id: "old-stars" });
    save.runtime.checksumVersion = 7;
    const before = JSON.stringify(save);
    const restored = restoreGameFromSave(save);
    const veteran = restored.units.find(candidate => candidate.id === unit.id)!;
    expect(veteran.hp).toBe(91);
    expect(veteran.maxHp).toBe(unit.maxHp);
    expect(veteran.attackDamage).toBe(unstarredAttack);
    expect(new Set(veteran.veteranSkillChoices).size).toBe(3);
    expect(restoreGameFromSave(save).units.find(candidate => candidate.id === unit.id)!.veteranSkillChoices).toEqual(veteran.veteranSkillChoices);
    expect(JSON.stringify(save)).toBe(before);
    const skill = veteran.veteranSkillChoices![0]!;
    issuePlayerCommand(restored, "player", { type: "learnVeteranSkill", unitId: veteran.id, skill });
    expect(veteran.veteranSkill).toBe(skill);
    const savedAgain = createSaveGameRecord(restored, room, { id: "new-stars" });
    const loadedAgain = restoreGameFromSave(savedAgain);
    expect(checksumGame(loadedAgain)).toBe(checksumGame(restored));
    expect(loadedAgain.units.find(candidate => candidate.id === unit.id)!.veteranSkill).toBe(skill);
  });

  it("stores the deterministic checksum with runtime checkpoint metadata", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    stepGame(game);
    game.projectiles.push({
      id: "projectile-save-sync",
      owner: "player",
      attackerId: "unit-player-archer",
      targetId: "unit-enemy-footman",
      fromX: 900,
      fromY: 900,
      toX: 1100,
      toY: 900,
      damage: 13,
      remaining: 12,
      duration: 24,
    });
    const room = {
      ...createRoom({ id: "save-room", host: { id: "host", name: "Host" }, mapId: "bareDuel" }),
      status: "inMatch" as const,
    };

    const save = createSaveGameRecord(game, room, { id: "save-checksum" }, new Date("2026-06-02T00:00:00.000Z"), []);
    const restored = restoreGameFromSave(save);

    expect(save.runtime.checksum).toBe(checksumGame(game));
    expect(save.runtime.checksumVersion).toBe(CHECKSUM_VERSION);
    expect(restored.projectiles).toEqual(game.projectiles);
    expect(checksumGame(restored)).toBe(save.runtime.checksum);
  });

  it("normalizes save and debug replay payloads through one shared runtime schema", () => {
    expect(parseSaveGameInput({ id: "save-1", label: "opening", ignored: true })).toEqual({ id: "save-1", label: "opening" });
    expect(parseSaveGameInput({ id: "save-1" })).toEqual({ id: "save-1" });
    expect(parseSaveGameInput({ id: "" })).toBeUndefined();
    expect(parseSaveGameInput({ id: "save-1", label: 12 })).toBeUndefined();
    expect(parseSaveGameInput(undefined)).toBeUndefined();
    expect(assertSaveGameInput({ id: "trace-1", label: "" }, "debug replay input")).toEqual({ id: "trace-1", label: "" });
    expect(() => assertSaveGameInput({ label: "missing id" }, "debug replay input")).toThrow("Malformed debug replay input");
  });
});
