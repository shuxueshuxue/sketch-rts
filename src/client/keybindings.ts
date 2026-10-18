export type GameplayKeyContext = {
  controlGroups: Set<number>;
  // The digits whose carrying slot holds an item (see @@@item-slots); Alt+digit uses it.
  inventoryDigits: ReadonlySet<number>;
  commandHotkeys?: Set<string>;
};

export type GameplayKeyIntent =
  | { type: "controlGroupReplace"; slot: number }
  | { type: "controlGroupRecall"; slot: number }
  | { type: "inventoryUse"; digit: number }
  | { type: "commandHotkey"; hotkey: string }
  | { type: "none" };

// @@@hotkeys - Digits belong to control groups and Alt+digit to the carried items, so neither ever takes the other's
// key; a letter belongs to the command card, with or without Shift (Shift queues the order the button starts). See
// docs/engineering/hotkeys.zh.md.
export function gameplayKeyIntent(event: KeyboardEvent, context: GameplayKeyContext): GameplayKeyIntent {
  const digit = digitSlot(event);
  if (event.metaKey) return { type: "none" };
  if (event.altKey) return digit && !event.ctrlKey && !event.shiftKey && context.inventoryDigits.has(digit) ? { type: "inventoryUse", digit } : { type: "none" };
  if (digit && event.shiftKey && !event.ctrlKey) return { type: "controlGroupReplace", slot: digit };
  if (event.ctrlKey) return { type: "none" };
  if (digit) return !event.shiftKey && context.controlGroups.has(digit) ? { type: "controlGroupRecall", slot: digit } : { type: "none" };
  const hotkey = event.key.toLowerCase();
  if (context.commandHotkeys?.has(hotkey)) return { type: "commandHotkey", hotkey };
  return { type: "none" };
}

function digitSlot(event: KeyboardEvent) {
  const codeMatch = /^Digit([1-9])$/.exec(event.code);
  if (codeMatch) return Number(codeMatch[1]);
  return /^[1-9]$/.test(event.key) ? Number(event.key) : undefined;
}
