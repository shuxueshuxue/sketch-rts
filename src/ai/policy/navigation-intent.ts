import type { GameCommand } from '../../shared/types';

export type AiNavigationIntent = Readonly<{ arrivalRange: number; station: boolean; parentMethodId?: string }>;
const intents = new WeakMap<GameCommand, AiNavigationIntent>();

/** Execution metadata belongs to the accepted AI entry, not the sim command. */
export function withNavigationIntent<T extends GameCommand>(command: T, intent: AiNavigationIntent): T {
  intents.set(command, intent);
  return command;
}

export function navigationIntent(command: GameCommand) { return intents.get(command); }

/** Unit filtering copies orders; retain the executor's declared acceptance. */
export function copyNavigationIntent<T extends GameCommand>(from: GameCommand, to: T): T {
  const intent = intents.get(from);
  if (intent) intents.set(to, intent);
  return to;
}
