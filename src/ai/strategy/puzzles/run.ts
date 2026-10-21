import { createAiGameCommandPlanner, runAiGameLoop, type AiGameAgent } from '../../game-runner';
import type { AiScriptVersion } from '../../policy';
import type { SdkGameCommandPlanner, SdkGameLoopHooks } from '../../../sdk/game-runner';
import { snapshotGame } from '../../../shared/sim';
import { trackPuzzle } from './execution';
import type { PublicPuzzleCase } from './scenes';
import { createPuzzleWitness } from './witness';

/** Same SDK scheduling and command delay as live rooms; no future spawn or teleport. */
export function runPublicPuzzle(puzzle: PublicPuzzleCase, mode: 'witness' | AiScriptVersion,
  options: { maxTicks?: number; planner?: SdkGameCommandPlanner<AiGameAgent>; onCommand?: SdkGameLoopHooks['onCommand'] } = {}) {
  const world = puzzle.create(), initial = snapshotGame(world.game), tracker = trackPuzzle(puzzle, world);
  const planner = options.planner ?? (mode === 'witness' ? createPuzzleWitness(puzzle, world) : createAiGameCommandPlanner());
  const invasionShips = world.game.units.filter(unit => unit.owner === world.opponent && unit.kind === 'transport');
  let pressureSent = world.attackers.every(unit => unit.deck || unit.cabin || unit.order.type === 'attackMove')
    && invasionShips.every(unit => unit.order.type === 'unload');
  try {
    const result = runAiGameLoop({ name: `public-puzzle:${puzzle.key}:${puzzle.variant}:${mode}`, game: world.game,
      maxTicks: world.game.tick + (options.maxTicks ?? puzzle.maxTicks), thinkInterval: 15,
      agents: {
        [world.owner]: { controller: 'internal-ai', team: world.owner, race: 'grove', version: mode === 'witness' ? 'v9_knight' : mode },
        [world.opponent]: { controller: 'external-agent', team: world.opponent, race: 'ember', version: 'v9_knight' },
      },
      commandPlanner(context) {
        if (context.owner === world.owner) return planner(context);
        if (pressureSent || !world.attackers.length) return [];
        pressureSent = true;
        const target = world.islandHall ?? world.home;
        const entries: ReturnType<SdkGameCommandPlanner> = [{ playerId: world.opponent, source: context.source, scriptId: 'native-incoming-army',
          command: { type: 'attackMove', unitIds: world.attackers.filter(u => !u.deck).map(u => u.id), x: target.x, y: target.y } }];
        for (const ship of world.game.units.filter(u => u.owner === world.opponent && u.kind === 'transport')) entries.push({
          playerId: world.opponent, source: context.source, scriptId: 'native-incoming-landing',
          command: { type: 'unload', unitIds: [ship.id], x: target.x, y: target.y },
        });
        return entries;
      },
    }, { ...(options.onCommand ? { onCommand: options.onCommand } : {}), onStep() { tracker.sample(); } });
    return { puzzle: `${puzzle.key}/${puzzle.variant}`, mode, initial, final: result.snapshot,
      elapsedMs: result.elapsedMs, cpuMs: result.cpuMs, execution: tracker.finish() };
  } finally { tracker.dispose(); }
}
