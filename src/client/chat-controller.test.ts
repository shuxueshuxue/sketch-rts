import { describe, expect, it } from "vitest";
import { chatKeyIntent, normalizeChatText } from "./chat-controller";

describe("chat controller", () => {
  it("opens public chat with Enter only during a live match", () => {
    expect(chatKeyIntent(key("Enter"), state({ hasActiveChat: true }))).toBe("open");
    expect(chatKeyIntent(key("Enter"), state({ hasActiveChat: true, menuOpen: true }))).toBe("pass");
    expect(chatKeyIntent(key("Enter"), state({ hasActiveChat: false }))).toBe("pass");
  });

  it("submits or closes the visible input before gameplay hotkeys can run", () => {
    expect(chatKeyIntent(key("Enter"), state({ inputVisible: true, inputFocused: true }))).toBe("submit");
    expect(chatKeyIntent(key("Escape"), state({ inputVisible: true, inputFocused: true }))).toBe("close");
    expect(chatKeyIntent(key("A"), state({ inputVisible: true, inputFocused: true }))).toBe("capture");
  });

  it("keeps visible but blurred chat isolated from gameplay keys", () => {
    expect(chatKeyIntent(key("A"), state({ inputVisible: true, inputFocused: false }))).toBe("focus");
    expect(chatKeyIntent(key("Enter"), state({ inputVisible: true, inputFocused: false }))).toBe("focus");
  });

  it("normalizes submitted chat text", () => {
    expect(normalizeChatText(" push mid ")).toBe("push mid");
    expect(normalizeChatText("   ")).toBeUndefined();
  });
});

function state(overrides: Partial<Parameters<typeof chatKeyIntent>[1]> = {}) {
  return { hasActiveChat: false, inputFocused: false, inputVisible: false, menuOpen: false, ...overrides };
}

function key(keyValue: string, repeat = false) {
  return { key: keyValue, repeat } as KeyboardEvent;
}
