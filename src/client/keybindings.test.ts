import { describe, expect, it } from "vitest";
import { gameplayKeyIntent } from "./keybindings";

describe("gameplay keybindings", () => {
  it("uses classic control group bindings without stealing unassigned inventory digits", () => {
    expect(gameplayKeyIntent(key("!", "Digit1", { shiftKey: true }), context())).toEqual({ type: "controlGroupReplace", slot: 1 });
    expect(gameplayKeyIntent(key("1", "Digit1", { ctrlKey: true }), context())).toEqual({ type: "none" });
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ controlGroups: new Set([1]), inventoryDigits: new Set([1]) }))).toEqual({ type: "controlGroupRecall", slot: 1 });
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ inventoryDigits: new Set([1]) }))).toEqual({ type: "inventoryUse", digit: 1 });
    // Slot n answers to digit n whatever groups exist (see @@@item-slots): a group only takes its own digit.
    expect(gameplayKeyIntent(key("2", "Digit2"), context({ controlGroups: new Set([1, 3]), inventoryDigits: new Set([1, 2, 3, 4]) }))).toEqual({ type: "inventoryUse", digit: 2 });
    expect(gameplayKeyIntent(key("3", "Digit3"), context({ controlGroups: new Set([1, 3]), inventoryDigits: new Set([1, 2, 3, 4]) }))).toEqual({ type: "controlGroupRecall", slot: 3 });
    expect(gameplayKeyIntent(key("4", "Digit4"), context({ controlGroups: new Set([1, 3]), inventoryDigits: new Set([1, 2, 3, 4]) }))).toEqual({ type: "inventoryUse", digit: 4 });
    expect(gameplayKeyIntent(key("5", "Digit5"), context({ inventoryDigits: new Set([1, 2, 3, 4]) }))).toEqual({ type: "none" });
    // An empty slot has no button and its digit does nothing.
    expect(gameplayKeyIntent(key("2", "Digit2"), context({ inventoryDigits: new Set([1, 3]) }))).toEqual({ type: "none" });
  });

  it("routes ordinary command-card hotkeys through the same resolver", () => {
    expect(gameplayKeyIntent(key("A", "KeyA"), context({ commandHotkeys: new Set(["a", "b"]) }))).toEqual({ type: "commandHotkey", hotkey: "a" });
    expect(gameplayKeyIntent(key("A", "KeyA", { ctrlKey: true }), context({ commandHotkeys: new Set(["a"]) }))).toEqual({ type: "none" });
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
