export type GameplayKeyContext = {
  controlGroups: Set<number>;
  // The digits whose carrying slot holds an item (see @@@item-slots).
  inventoryDigits: ReadonlySet<number>;
  commandHotkeys?: Set<string>;
};

export type GameplayKeyIntent =
  | { type: "controlGroupReplace"; slot: number }
  | { type: "controlGroupRecall"; slot: number }
  | { type: "inventoryUse"; digit: number }
  | { type: "commandHotkey"; hotkey: string }
  | { type: "none" };

export function gameplayKeyIntent(event: KeyboardEvent, context: GameplayKeyContext): GameplayKeyIntent {
  const digit = digitSlot(event);
  if (event.metaKey || event.altKey) return { type: "none" };
  if (digit && event.shiftKey && !event.ctrlKey) return { type: "controlGroupReplace", slot: digit };
  if (event.ctrlKey && event.shiftKey) return { type: "none" };
  if (event.ctrlKey || event.shiftKey) return { type: "none" };
  if (digit && context.controlGroups.has(digit)) return { type: "controlGroupRecall", slot: digit };
  // Digit n uses the item in slot n (see @@@item-slots), unless a control group holds the digit.
  if (digit && context.inventoryDigits.has(digit)) return { type: "inventoryUse", digit };
  const hotkey = event.key.toLowerCase();
  if (context.commandHotkeys?.has(hotkey)) return { type: "commandHotkey", hotkey };
  return { type: "none" };
}

function digitSlot(event: KeyboardEvent) {
  const codeMatch = /^Digit([1-9])$/.exec(event.code);
  if (codeMatch) return Number(codeMatch[1]);
  return /^[1-9]$/.test(event.key) ? Number(event.key) : undefined;
}
