import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version builds at the free land mine while its $race teammate long-hauls the closer mine (mirror=$mirror)', ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('allied-land-mine').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('ally', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('ally', x(700), 3000).townHall('foe', x(3500), 3500)
      .goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 6000)
      .goldMine('allied', x(1550), 1100, 6000).goldMine('free', x(2200), 1800, 6000)
      .worker('ally', x(1550), 1100, { id: 'ally-miner',
        order: { type: 'mine', resourceId: 'allied', phase: 'toMine', timer: 0 } })
      .unit('foe', 'knight', x(3420), 3370, { order: { type: 'hold', x: x(3420), y: 3370 } })
      .unit('foe', 'knight', x(3480), 3370, { order: { type: 'hold', x: x(3480), y: 3370 } })
      .farms('us', 6, x(500), 2800);
    for (let index = 0; index < 3; index++) scene = scene.worker('us', x(580), 470 + index * 30, { id: `worker-${index}` });
    for (let index = 0; index < 6; index++) scene = scene.unit('us', heavy, x(1900 + index % 3 * 50),
      1600 + Math.floor(index / 3) * 50, { id: `front-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    const free = game.resources.find(mine => mine.id === 'free')!, allied = game.resources.find(mine => mine.id === 'allied')!;
    const sites: { x: number; y: number }[] = [];
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        // Exercise the ownership and construction contract independently of army purchase quotas.
        options.doctrines = [{ id: 'claim-aware-expansion', race, weight: 1, raids: [], standIn: heavy,
          phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
        options.armyWants = [];
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us',
          [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy, miningAssignments], options)
          .map(entry => ({ ...entry, playerId: 'us' }));
        for (const { command } of entries) if (command.type === 'build' && command.buildingKind === 'townHall') sites.push(command);
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    const diagnostic = JSON.stringify({sites,gold:game.players.us!.gold, buildings:game.buildings.filter(b=>b.owner==='us').map(b=>({id:b.id,kind:b.kind,x:b.x,y:b.y,complete:b.complete})),workers:game.units.filter(u=>u.owner==='us'&&u.kind==='worker').map(u=>({id:u.id,x:u.x,y:u.y,order:u.order}))});
    expect(sites.length, diagnostic).toBeGreaterThan(0);
    expect(sites.every(point => Math.hypot(point.x - allied.x, point.y - allied.y) > GOLD_MINE_RULES.baseRange)).toBe(true);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.complete
      && Math.hypot(building.x - free.x, building.y - free.y) <= GOLD_MINE_RULES.baseRange), diagnostic).toBe(true);
    expect(game.units.find(unit => unit.id === 'ally-miner')!.order).toMatchObject({ type: 'mine', resourceId: 'allied' });
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
