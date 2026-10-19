import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { setBuildingBodies, sameGround } from '../../shared/terrain';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyUnitClaimKind, NavalPlanMemory } from '../memory';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext } from './policy';
import quarterHour from './fixtures/naval-reinforcements-sapphire-25m.json';
import { planBootstrapEconomy, rankBootstrapGoals } from './economy';

const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
it.each(versions)('%s funds a dedicated home-army ferry in the actual 25-minute scene while keeping the settlers aboard their mission', version => {
  const game = createGame('bareDuel', { players: Object.keys(quarterHour.snapshot.players), aiPlayers: [] });
  restoreSnapshotIntoGame(game, structuredClone(quarterHour.snapshot) as unknown as GameSnapshot, 500000);
  const owners = ['player', 'enemy2', 'player-5'];
  let homeArmy = 0, idle = 0, abroad = 0;
  for (const owner of owners) {
    const hall = game.buildings.find(building => building.owner === owner && building.kind === 'townHall')!;
    for (const unit of game.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
      && !unit.deck && unit.expiresTick === undefined)) {
      if (sameGround(game.map, unit, hall)) { homeArmy++; if (unit.order.type === 'idle') idle++; } else abroad++;
    }
  }
  expect({ homeArmy, idle, abroad }).toEqual({ homeArmy: 40, idle: 38, abroad: 20 });
  const memory = createAiPolicyMemory();
  memory.naval = { ferries: structuredClone(quarterHour.ferries.player) as NonNullable<NavalPlanMemory['ferries']> };
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'player', version, { memory, teams: game.teams });
  planBootstrapNaval(snapshot, 'player', options);
  const mission = memory.naval.ferries!['unit-player-transport-11025']!;
  expect(mission.purpose).toBe('settle');
  const goal = rankBootstrapGoals(snapshot, 'player', options).find(goal => goal.id === 'naval:reinforcementTransport');
  expect(goal).toMatchObject({ cost: UNIT_DEFS.transport.cost, save: true });
  // The real frame has 124.67 gold. Separately prove normal purchase admission
  // once mining supplies the ordinary 240-gold hull price.
  game.players.player!.gold = UNIT_DEFS.transport.cost;
  const funded = snapshotGame(game), context = bootstrapPolicyContext(funded, 'player', version, { memory, teams: game.teams });
  const commands = planBootstrapEconomy(funded, 'player', context);
  expect(commands.some(command => command.type === 'train' && command.unitKind === 'transport')).toBe(true);
  issueCommandFrame(game, commands.map(command => ({ playerId: 'player', scriptId: 'v6Economy', command })));
  expect(game.players.player!.gold).toBe(0);
});
function convoy(count = 18) {
  let scene = sketchScene('continuous-front-reinforcement').map('bareDuel').replaceDefaults()
    .player('us', { race: 'ember', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 640, 1800, { id: 'home' }).townHall('foe', 3400, 3500)
    .townHall('us', 3300, 1800, { id: 'front' }).goldMine('front-mine', 3300, 2150, 9000)
    .unit('us', 'transport', 1424, 1800, { id: 'ferry' });
  for (let i = 0; i < count; i++) scene = scene.unit('us', 'emberRavager', 900 + i % 6 * 30, 1650 + Math.floor(i / 6) * 35, { id: `troop-${i}` });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = i % 128;
    return col < 40 || col >= 88 ? '.' : col === 40 || col === 87 ? ',' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  const boat = game.units.find(unit => unit.id === 'ferry')!;
  boat.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const memory = createAiPolicyMemory();
  return { game, boat, memory };
}
it.each(versions)('%s repeatedly delivers idle home troops and returns the empty boat to load again', version => {
  const { game, memory } = convoy();
  const history: unknown[] = []; let previous = '';
  for (let tick = 0; tick < 7200; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, planBootstrapNaval(snapshot, 'us', options).map(command => ({ playerId: 'us', scriptId: 'naval', command })));
      const mission = memory.naval?.ferries?.ferry;
      const state = `${mission?.phase}/${memory.naval?.ferryDecisions?.ferry?.reason}/${mission?.deliveries?.length}`;
      if (state !== previous) { history.push({ tick: game.tick, state, mission: structuredClone(mission) }); previous = state; }
      if ((mission?.deliveries?.length ?? 0) >= 2) break;
    }
    stepGame(game);
  }
  const mission = memory.naval?.ferries?.ferry;
  const diagnostic = JSON.stringify({ mission, history, decision: memory.naval?.ferryDecisions?.ferry, home: game.units.filter(unit => unit.owner === 'us' && !unit.deck && sameGround(game.map, unit, { x: 640, y: 1800 })).length, boats: game.units.filter(unit => unit.id === 'ferry') });
  expect(mission?.purpose, diagnostic).toBe('reinforce');
  expect(mission!.deliveries!.length, diagnostic).toBeGreaterThanOrEqual(2);
  expect(mission!.returnTrips, diagnostic).toBeGreaterThanOrEqual(1);
  const delivered = new Set(mission!.deliveries!.flatMap(delivery => delivery.unitIds));
  expect(delivered.size).toBeGreaterThan(6);
  for (const id of delivered) {
    const unit = game.units.find(unit => unit.id === id)!;
    expect(unit.deck).toBeUndefined();
    expect(sameGround(game.map, unit, { x: 3300, y: 1800 })).toBe(true);
  }
}, 30000);
it.each(versions)('%s retains a loaded settler mission instead of stealing its boat', version => {
  const { game, boat, memory } = convoy();
  const worker = game.spawnUnit('us', 'worker', 1120, 1800);
  expect(boardUnit(boat, worker, game.units)).toBe(true);
  memory.naval = { ferries: { ferry: { purpose: 'settle', targetId: 'front-mine', from: { x: 1296, y: 1800 },
    to: { x: 2784, y: 1800 }, phase: 'loading', crewIds: [worker.id], sinceTick: 0 } } };
  const snapshot = snapshotGame(game);
  planBootstrapNaval(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
  expect(memory.naval.ferries!.ferry!.purpose).toBe('settle');
});
it.each(versions)('%s calls its home army while the empty reinforcement ferry approaches shore', version => {
  const { game, boat, memory } = convoy();
  boat.x = 2200;
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
  const commands = planBootstrapNaval(snapshot, 'us', options);
  expect(memory.naval?.ferries?.ferry?.purpose).toBe('reinforce');
  expect(commands.some(command => command.type === 'board' && command.transportId === boat.id)).toBe(true);
  expect(commands.some(command => command.type === 'move' && command.unitIds.includes(boat.id))).toBe(true);
});
it.each(versions)('%s leaves defense squads, active recovery and mounted tasks out of a reinforcement payload', version => {
  const { game, memory } = convoy();
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
  const protectedKinds = ['mineRally', 'mineLeash', 'mineGuard', 'workerSafety', 'expansionGarrison', 'harassSquad', 'retreat'];
  for (const [i, kind] of protectedKinds.entries()) memory.unitClaims[`troop-${i}`] = {
    kind: kind as AiPolicyUnitClaimKind, targetId: kind === 'retreat' ? 'retreat' : 'home', x: 640, y: 1800, sinceTick: 0, expiresTick: 3600,
  };
  memory.mounted = [{ unitIds: ['troop-7'], objective: { kind: 'raid',
    hallId: game.buildings.find(building => building.owner === 'foe')!.id, owner: 'foe' } }];
  const boarders: string[] = [];
  for (let tick = 0; tick < 180 && !boarders.length; tick++) {
    if (tick % 15 === 0) {
      const commands = planBootstrapNaval(snapshotGame(game), 'us', options);
      boarders.push(...commands.flatMap(command => command.type === 'board' ? command.unitIds : []));
      issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'naval', command })));
    }
    stepGame(game);
  }
  expect(boarders.length).toBeGreaterThan(0);
  for (let i = 0; i < 8; i++) expect(boarders).not.toContain(`troop-${i}`);
});
it.each(versions)('%s starts no reinforcement stream with six idle soldiers or a home intrusion', version => {
  for (const threat of [false, true]) {
    const { game, memory } = convoy(threat ? 18 : 6);
    if (threat) game.spawnUnit('foe', 'emberRavager', 850, 1800);
    const snapshot = snapshotGame(game);
    planBootstrapNaval(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    expect(Object.values(memory.naval?.ferries ?? {}).some(mission => mission.purpose === 'reinforce')).toBe(false);
  }
});
