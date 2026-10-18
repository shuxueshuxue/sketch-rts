import { describe, expect, it } from "vitest";
import { gameplayKeyIntent } from "./keybindings";

describe("gameplay keybindings", () => {
  it("gives digits to control groups and Alt+digit to the carried items, so neither takes the other's key (see @@@hotkeys)", () => {
    expect(gameplayKeyIntent(key("!", "Digit1", { shiftKey: true }), context())).toEqual({ type: "controlGroupReplace", slot: 1 });
    expect(gameplayKeyIntent(key("1", "Digit1", { ctrlKey: true }), context())).toEqual({ type: "none" });
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ controlGroups: new Set([1]), inventoryDigits: new Set([1]) }))).toEqual({ type: "controlGroupRecall", slot: 1 });
    // A bare digit never uses an item, even with no group on it.
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ inventoryDigits: new Set([1]) }))).toEqual({ type: "none" });
    // Alt+digit uses the item whatever groups exist; on a Mac Alt changes the character, so the code decides.
    expect(gameplayKeyIntent(key("¡", "Digit1", { altKey: true }), context({ controlGroups: new Set([1]), inventoryDigits: new Set([1, 2]) }))).toEqual({ type: "inventoryUse", digit: 1 });
    expect(gameplayKeyIntent(key("3", "Digit3", { altKey: true }), context({ inventoryDigits: new Set([1, 2]) }))).toEqual({ type: "none" });
    expect(gameplayKeyIntent(key("5", "Digit5"), context({ inventoryDigits: new Set([1, 2, 3, 4]) }))).toEqual({ type: "none" });
  });

  it("routes command-card letters through the same resolver, with Shift too (it queues the order)", () => {
    expect(gameplayKeyIntent(key("A", "KeyA"), context({ commandHotkeys: new Set(["a", "b"]) }))).toEqual({ type: "commandHotkey", hotkey: "a" });
    expect(gameplayKeyIntent(key("A", "KeyA", { shiftKey: true }), context({ commandHotkeys: new Set(["a"]) }))).toEqual({ type: "commandHotkey", hotkey: "a" });
    expect(gameplayKeyIntent(key("a", "KeyA", { ctrlKey: true }), context({ commandHotkeys: new Set(["a"]) }))).toEqual({ type: "none" });
    expect(gameplayKeyIntent(key("å", "KeyA", { altKey: true }), context({ commandHotkeys: new Set(["a"]) }))).toEqual({ type: "none" });
  });

  it("does not use command-number on macOS because browsers own it", () => {
    expect(gameplayKeyIntent(key("1", "Digit1", { metaKey: true }), context())).toEqual({ type: "none" });
  });
});

function context(overrides: Partial<Parameters<typeof gameplayKeyIntent>[1]> = {}) {
  return { controlGroups: new Set<number>(), inventoryDigits: new Set<number>(), ...overrides };
}

function key(keyValue: string, code: string, overrides: Partial<KeyboardEvent> = {}) {
  return {
    key: keyValue,
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}
