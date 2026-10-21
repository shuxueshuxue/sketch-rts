import { expect, it } from 'vitest';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { snapshotGame } from '../../../shared/sim';
import { createExecution } from './goal-planner-execution';
import { puzzleBuilder, terrainWorld, PUZZLE_OWNER, PUZZLE_OPPONENT } from './world';

it('execution adapter contract: normal owner goals retain actual grants and issue a public SDK attack (not a public puzzle score)', () => {
  const game = terrainWorld(puzzleBuilder(0).townHall(PUZZLE_OWNER, 700, 1000)
    .townHall(PUZZLE_OPPONENT, 1050, 1000, { hp: 20 }).unit(PUZZLE_OWNER, 'footman', 1000, 1000),
  [{ left: 128, top: 128, right: 2048, bottom: 2048 }]);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const target = game.buildings.find(building => building.owner === PUZZLE_OPPONENT)!;
  const fighter = game.units.find(unit => unit.owner === PUZZLE_OWNER)!;
  const session = createExecution();
  const entries = session.commandPlanner({ game, snapshot, owner: PUZZLE_OWNER,
    agent: { controller: 'internal-ai', version: 'v9_knight', team: PUZZLE_OWNER },
    source: 'internal-ai', plannerOrigin: 'local-command-planner',
    teams: { [PUZZLE_OWNER]: PUZZLE_OWNER, [PUZZLE_OPPONENT]: PUZZLE_OPPONENT } });
  expect(entries.some(entry => entry.scriptId === 'goal.destroy-target'
    && entry.command.type === 'attack' && entry.command.targetId === target.id)).toBe(true);
  expect(session.statistics()).toMatchObject({ plannedThinks: 1, observedThinks: 1, formalCommandCount: 1 });
  const observation = session.observations()[0]!;
  expect(observation.output.readyActions.some(row => row.action.declaration.kind === 'destroy-target')).toBe(true);
  expect(observation.allocation.commandAdmissions?.some(row => row.status === 'accepted'
    && row.source === 'executor' && row.executor === 'goal.destroy-target' && row.action !== null)).toBe(true);
  expect(session.observations().length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(snapshot)).toBe(before);
  issueCommandFrame(game, entries);
  expect(fighter.order).toEqual({ type: 'attack', targetId: target.id });
});
