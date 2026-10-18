import { describe, expect, it } from "vitest";
import { allCommandCards, cardKeys, commandCardFor, commandKey, COMMAND_KEYS, GLOBAL_KEYS, KEYLESS } from "./command-keys";

const name = (card: ReturnType<typeof allCommandCards>[number]) => JSON.stringify(card);

describe("command keys (see @@@command-keys)", () => {
  it("never puts two buttons on one key on any card", () => {
    const clashes = allCommandCards().flatMap(card => {
      const byKey = new Map<string, string[]>();
      for (const { id, key } of cardKeys(card)) byKey.set(key, [...byKey.get(key) ?? [], id]);
      return [...byKey].filter(([, ids]) => ids.length > 1).map(([key, ids]) => `${name(card)} ${key}: ${ids.join(", ")}`);
    });
    expect(clashes).toEqual([]);
  });

  it("gives every listed button a letter of its own or Esc, never a global key", () => {
    for (const entry of COMMAND_KEYS) {
      expect(entry.key, entry.id).toMatch(/^([a-z]|escape)$/);
      expect(GLOBAL_KEYS.has(entry.key), entry.id).toBe(false);
    }
    expect(Object.keys(KEYLESS).every(id => !COMMAND_KEYS.some(entry => entry.id === id))).toBe(true);
    expect(() => commandKey("noSuchButton")).toThrow();
  });

  it("fixes the shipyard's purchases in their own sub-card, away from its training keys", () => {
    const yard = cardKeys({ page: "building", kind: "shipyard", race: "grove" });
    expect(yard.find(entry => entry.id === "buy")?.key).toBe("u");
    expect(yard.some(entry => entry.id.startsWith("dock:"))).toBe(false);
    expect(cardKeys({ page: "palette", palette: "buy", race: "grove" }).map(entry => entry.key).sort()).toEqual(["e", "escape", "o", "q", "w"]);
  });

  it("shows only the focused group's card in a mixed selection, so attack-move and unload never meet a building's keys", () => {
    const hall = commandCardFor({ focused: { type: "building", kind: "townHall" }, race: "grove" })!;
    const range = commandCardFor({ focused: { type: "building", kind: "archeryRange" }, race: "grove" })!;
    for (const card of [hall, range]) expect(cardKeys(card).some(entry => entry.id === "attackMove" || entry.id === "unload")).toBe(false);
    expect(cardKeys(range).find(entry => entry.id === "train:archer")?.key).toBe("a");
    expect(cardKeys(hall).find(entry => entry.id === "research:buildingDurability")?.key).toBe("d");
    const footman = commandCardFor({ focused: { type: "unit", kind: "footman" }, race: "grove" })!;
    expect(cardKeys(footman).map(entry => entry.id)).toEqual(expect.arrayContaining(["attackMove", "unload"]));
  });

  it("lets an open sub-card or a selected site take the dock before the focused group", () => {
    const focused = { type: "unit", kind: "worker" } as const;
    expect(commandCardFor({ palette: "build", focused, race: "ember" })).toEqual({ page: "palette", palette: "build", race: "ember" });
    expect(commandCardFor({ shop: true, focused, race: "grove" })).toEqual({ page: "shop" });
    expect(commandCardFor({ camp: true, race: "grove" })).toEqual({ page: "camp" });
    expect(commandCardFor({ race: "grove" })).toBeUndefined();
  });
});
