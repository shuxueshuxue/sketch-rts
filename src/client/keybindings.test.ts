import { describe, expect, it } from "vitest";
import { gameplayKeyIntent } from "./keybindings";

describe("gameplay keybindings", () => {
  it("uses classic control group bindings without stealing unassigned inventory digits", () => {
    expect(gameplayKeyIntent(key("1", "Digit1", { ctrlKey: true }), context())).toEqual({ type: "controlGroupReplace", slot: 1 });
    expect(gameplayKeyIntent(key("!", "Digit1", { shiftKey: true }), context())).toEqual({ type: "controlGroupAdd", slot: 1 });
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ controlGroups: new Set([1]), inventorySlots: 1 }))).toEqual({ type: "controlGroupRecall", slot: 1 });
    expect(gameplayKeyIntent(key("1", "Digit1"), context({ inventorySlots: 1 }))).toEqual({ type: "inventoryUse", index: 0 });
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
  return { controlGroups: new Set<number>(), inventorySlots: 0, ...overrides };
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
