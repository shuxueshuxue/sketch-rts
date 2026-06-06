export type ChatKeyState = {
  hasActiveChat: boolean;
  inputFocused: boolean;
  inputVisible: boolean;
  menuOpen: boolean;
};

export type ChatKeyIntent = "capture" | "close" | "focus" | "open" | "pass" | "submit";

export function chatKeyIntent(event: Pick<KeyboardEvent, "key" | "repeat">, state: ChatKeyState): ChatKeyIntent {
  const key = event.key.toLowerCase();
  if (state.inputVisible) {
    if (key === "escape") return "close";
    if (key === "enter") return state.inputFocused ? "submit" : "focus";
    return state.inputFocused ? "capture" : "focus";
  }
  if (state.menuOpen || event.repeat || !state.hasActiveChat) return "pass";
  return key === "enter" ? "open" : "pass";
}

export function normalizeChatText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
