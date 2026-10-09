import { describe, expect, it } from "vitest";
import { isCommandEnvelope, isGameCommand } from "./command-schema";

describe("shared command payload schema", () => {
  it("accepts veteran choices and rejects unknown or malformed skill identifiers", () => {
    expect(isGameCommand({ type: "learnVeteranSkill", unitId: "veteran", skill: "veteranResilience" })).toBe(true);
    for (const skill of ["unknown", "toString", "__proto__", 1, undefined]) {
      expect(isGameCommand({ type: "learnVeteranSkill", unitId: "veteran", skill })).toBe(false);
    }
    expect(isGameCommand({ type: "learnVeteranSkill", skill: "veteranResilience" })).toBe(false);
  });
  it('accepts an explicit withdrawal and rejects malformed reaction flags',()=>{
    for(const type of ['move','unload']){
      expect(isGameCommand({type,unitIds:['ship'],x:10,y:20,avoidCombat:true})).toBe(true);
      expect(isGameCommand({type,unitIds:['ship'],x:10,y:20,avoidCombat:'false'})).toBe(false);
    }
  });
  it("accepts typed game commands used by REST and WebSocket ingress", () => {
    expect(isGameCommand({ type: "move", unitIds: ["worker"], x: 10, y: 20 })).toBe(true);
    expect(isGameCommand({ type: "unloadPassenger", transportId: "ferry", passengerId: "worker" })).toBe(true);
    expect(isGameCommand({ type: "build", unitId: "worker", buildingKind: "farm", x: 10, y: 20 })).toBe(true);
    expect(isGameCommand({ type: "cast", unitId: "priest", ability: "heal", targetId: "ally" })).toBe(true);
    expect(isGameCommand({ type: "cast", unitId: "ember-acolyte", ability: "emberMend", targetId: "ally" })).toBe(true);
    expect(isGameCommand({ type: "cast", unitId: "pyre-caller", ability: "cinderSoul", x: 10, y: 20 })).toBe(true);
    expect(isGameCommand({ type: "cast", unitId: "ash-hexer", ability: "ashCurse", targetId: "enemy" })).toBe(true);
    expect(isCommandEnvelope({ playerId: "player", clientSeq: 3, command: { type: "attackMove", unitIds: ["footman"], x: 100, y: 120 } })).toBe(true);
  });

  it("rejects malformed commands before gameplay legality runs", () => {
    expect(isGameCommand({ type: "move" })).toBe(false);
    expect(isGameCommand({ type: "unloadPassenger", transportId: "ferry" })).toBe(false);
    expect(isGameCommand({ type: "unloadPassenger", transportId: "ferry", passengerId: 2 })).toBe(false);
    expect(isGameCommand({ type: "build", unitId: "worker", buildingKind: "unknown", x: 10, y: 20 })).toBe(false);
    expect(isGameCommand({ type: "cast", unitId: "priest", ability: "blink", targetId: "enemy" })).toBe(false);
    expect(isCommandEnvelope({ playerId: "player with spaces", command: { type: "move", unitIds: ["worker"], x: 10, y: 20 } })).toBe(false);
  });

  it('admits boarding approaches and immediate cancellations at both command ingress surfaces', () => {
    for (const command of [
      { type: 'boardShip', unitIds: ['source'], targetId: 'target' },
      { type: 'boardShip', unitIds: ['source'], targetId: 'target', queued: true },
      { type: 'cancelBoardShip', unitIds: ['source'] },
    ]) {
      expect(isGameCommand(command)).toBe(true);
      expect(isCommandEnvelope({ playerId: 'player', clientSeq: 12, command })).toBe(true);
    }
    for (const command of [
      { type: 'boardShip', unitIds: ['source'] },
      { type: 'boardShip', unitIds: ['source'], targetId: 1 },
      { type: 'boardShip', unitIds: [1], targetId: 'target' },
      { type: 'boardShip', unitIds: ['source'], targetId: 'target', queued: 'true' },
      { type: 'cancelBoardShip', unitIds: ['source'], queued: true },
    ]) expect(isGameCommand(command)).toBe(false);
  });
});
