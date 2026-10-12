import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { planBootstrapEconomy, rankBootstrapGoals } from './economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'keeps the $race armor intent through a busy lab and researches it before weapons II (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('research-intent-busy-lab').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 10000)
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400)
      .building('us', race === 'grove' ? 'barracks' : 'emberForge', x(600), 850, { id: 'lab' }).farms('us', 9, x(500), 1500);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', x(550), 530 + index * 20,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const options: AiPolicyContext = { version: 'v2', requestedVersion: 'v9', memory, teams: game.teams, armyWants: [],
      doctrines: [{ id: 'balanced-technology', race, weight: 1, standIn: race === 'grove' ? 'footman' : 'emberRavager', raids: [],
        phases: [{ wants: [{ upgrade: 'weaponTraining', level: 3, priority: 59 }, { upgrade: 'reinforcedPlating', level: 3, priority: 58 }], advanceShare: 1, advanceSupply: 1000 }] }] };
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'v6Economy', command: { type: 'research', buildingId: 'lab', upgradeKind: 'weaponTraining' } }]);
    const research = ['weaponTraining'];
    for (let tick = 0; tick < 2300; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), goals = rankBootstrapGoals(snapshot, 'us', options);
        if (tick === 300) {
          const armor = goals.find(goal => goal.id === 'upgrade:reinforcedPlating')!;
          expect(armor).toBeDefined();
          expect(armor.save).toBe(false);
          expect(armor.issue(new Set())).toBeUndefined();
          expect(memory.v6!.goalAges!['upgrade:reinforcedPlating']!.since).toBe(0);
        }
        const commands = planBootstrapEconomy(snapshot, 'us', options);
        research.push(...commands.filter(command => command.type === 'research').map(command => command.upgradeKind));
        issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6Economy', command })));
      }
      stepGame(game);
    }
    expect(research.slice(0, 2)).toEqual(['weaponTraining', 'reinforcedPlating']);
    expect(game.players.us!.upgrades.reinforcedPlating).toBeGreaterThanOrEqual(1);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us! + carried).toBe(500 + 10000 - game.resources[0]!.amount);
  });
