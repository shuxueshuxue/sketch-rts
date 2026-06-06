import { describe, expect, it } from "vitest";
import { isCommandEnvelope, isGameCommand } from "./command-schema";

describe("shared command payload schema", () => {
  it("accepts typed game commands used by REST and WebSocket ingress", () => {
    expect(isGameCommand({ type: "move", unitIds: ["worker"], x: 10, y: 20 })).toBe(true);
    expect(isGameCommand({ type: "build", unitId: "worker", buildingKind: "farm", x: 10, y: 20 })).toBe(true);
    expect(isGameCommand({ type: "cast", unitId: "priest", ability: "heal", targetId: "ally" })).toBe(true);
    expect(isCommandEnvelope({ playerId: "player", clientSeq: 3, command: { type: "attackMove", unitIds: ["footman"], x: 100, y: 120 } })).toBe(true);
  });

  it("rejects malformed commands before gameplay legality runs", () => {
    expect(isGameCommand({ type: "move" })).toBe(false);
    expect(isGameCommand({ type: "build", unitId: "worker", buildingKind: "unknown", x: 10, y: 20 })).toBe(false);
    expect(isGameCommand({ type: "cast", unitId: "priest", ability: "blink", targetId: "enemy" })).toBe(false);
    expect(isCommandEnvelope({ playerId: "player with spaces", command: { type: "move", unitIds: ["worker"], x: 10, y: 20 } })).toBe(false);
  });
});
