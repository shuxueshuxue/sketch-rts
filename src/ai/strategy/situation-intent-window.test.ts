import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame } from '../../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalPlannerInput } from './goal-planner-types';

function scene(seconds: number, declared: boolean) {
  const game = sketchScene('observed-intent-window').replaceDefaults().player('us').player('foe')
    .townHall('us', 640, 768, { id: 'home' }).unit('us', 'footman', 800, 768)
    .unit('foe', 'footman', 1200, 768, { id: 'intruder' }).build().createGame();
  const intruder = game.units.find(unit => unit.id === 'intruder')!;
  game.map = { ...game.map, width: 640 + intruder.speed * 700 + 1000, height: 2048 };
  delete game.map.terrain;
  intruder.x = 640 + intruder.speed * seconds;
  if (declared) issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: [intruder.id], x: 640, y: 768 });
  return snapshotGame(game);
}
function observe(seconds: number, declared = true) {
  const snapshot = scene(seconds, declared), before = JSON.stringify(snapshot);
  let memory = createAiPolicyMemory(), last: Pick<GoalPlannerInput, 'context' | 'goals'> | undefined;
  for (let sequence = 0; sequence < 3; sequence++) {
    withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory }, input => {
        last = { context: input.context, goals: input.goals };
      })));
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(JSON.stringify(snapshot)).toBe(before);
  const threat = last!.context.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === 'home')!;
  return { ...last!, threat, snapshot };
}

it.each([90, 360])('retains a real attackMove arriving in %s seconds and makes its actual ETA the goal deadline', seconds => {
  const { threat, goals, snapshot } = observe(seconds);
  const attacker = threat.attackers.find(attacker => attacker.unitId === 'intruder')!;
  expect(attacker.intent).toMatchObject({ kind: 'actual-intrusion', basis: 'native-destination' });
  expect(attacker.arrival.status).toBe('reachable');
  if (!('ticks' in attacker.arrival)) throw Error('Expected published real route');
  expect(attacker.arrival.ticks).toBeGreaterThan((seconds - 5) * SIM_TICKS_PER_SECOND);
  expect(attacker.arrival.ticks).toBeLessThanOrEqual(seconds * SIM_TICKS_PER_SECOND);
  expect(threat.horizonTicks).toBeGreaterThanOrEqual(attacker.arrival.ticks);
  expect(goals.find(goal => goal.id === 'DefendSite:us:home')?.deadlineTick).toBe(snapshot.tick + attacker.arrival.ticks);
});

it('keeps speculative observation at 120 seconds and bounds declared attacks to the ten-minute plan span', () => {
  expect(observe(90, false).threat.attackers.some(attacker => attacker.unitId === 'intruder')).toBe(true);
  expect(observe(360, false).threat.attackers).toEqual([]);
  expect(observe(620).threat.attackers).toEqual([]);
});
