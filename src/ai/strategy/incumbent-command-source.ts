import type { GameCommand } from '../../shared/types';

export type IncumbentCommandActor = Readonly<{ source: string; taskId: string }>;
const sources = new WeakMap<GameCommand, IncumbentCommandActor>();

/** The producer marks the actual proposal. This sidecar neither mutates native
 * commands nor fabricates a receipt for a filtered or merely remembered order. */
export function bindIncumbentCommands<T extends readonly GameCommand[]>(commands: T, actor: IncumbentCommandActor): T {
  if (commands.length) {
    const source = Object.freeze({ source: actor.source, taskId: actor.taskId });
    for (const command of commands) sources.set(command, source);
  }
  return commands;
}
export function incumbentCommandActor(command: GameCommand): IncumbentCommandActor | undefined { return sources.get(command); }
export function inheritIncumbentCommand<T extends GameCommand>(original: GameCommand, filtered: T): T {
  const actor = sources.get(original);
  if (actor) sources.set(filtered, actor);
  return filtered;
}
