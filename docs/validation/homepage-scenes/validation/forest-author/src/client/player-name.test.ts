import { describe, expect, it } from "vitest";
import { playerDisplayName } from "./player-name";

describe("player display names", () => {
  const slots = [
    { playerId: "player", name: "Host" },
    { playerId: "enemy", name: "Alice" },
    { playerId: "enemy2", name: "AI 1" },
    { playerId: "player-6", name: "AI 4" },
  ];

  it("uses real names even when internal enemy ids belong to humans or AI numbering differs", () => {
    expect(playerDisplayName("enemy", slots, "Player")).toBe("Alice");
    expect(playerDisplayName("enemy2", slots, "Player")).toBe("AI 1");
    expect(playerDisplayName("player-6", [slots[3]!, slots[0]!], "Player")).toBe("AI 4");
  });

  it("does not expose internal ids when the roster is missing or incomplete", () => {
    expect(playerDisplayName("enemy2", [], "玩家")).toBe("玩家");
    expect(playerDisplayName("player-8", slots, "Player")).toBe("Player");
  });
});
