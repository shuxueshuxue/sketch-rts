import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })))) (
  '$version brings its wounded independent rider to an existing home-ground medic (mirror=$mirror)', ({ version, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('wounded-sortie-medic-rendezvous').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400)
      .townHall('foe', x(3500), 1200, { id: 'raid-hall' }).worker('foe', x(3400), 1200, { id: 'raid-worker' })
      .unit('us', 'horseArcher', x(2400), 1400, { id: 'patient', hp: 25 })
      .unit('us', 'priest', x(1000), 2600, { id: 'medic' }).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const memory = createAiPolicyMemory(), patient = game.units.find(unit => unit.id === 'patient')!;
    memory.mounted = [{ unitIds: [patient.id], objective: { kind: 'raid', hallId: 'raid-hall', owner: 'foe' } }];
    let firstCare = -1, returnedToSortie = false;
    for (let tick = 0; tick < 600 && patient.hp < patient.maxHp * V7_WOUNDED_SHARE; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        if (entries.some(entry => entry.scriptId === 'mobileCare' && entry.command.type === 'follow' && entry.command.unitIds.includes(patient.id))) {
          if (firstCare < 0) firstCare = game.tick;
        }
        expect(entries.some(entry => entry.scriptId === 'mountedTasks' && 'unitIds' in entry.command
          && entry.command.unitIds.includes(patient.id))).toBe(false);
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(firstCare).toBe(0);
    expect(game.units).toContain(patient);
    expect(patient.hp).toBeGreaterThanOrEqual(patient.maxHp * V7_WOUNDED_SHARE);
    const next = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
    returnedToSortie = next.some(entry => entry.scriptId === 'mountedTasks' && 'unitIds' in entry.command && entry.command.unitIds.includes(patient.id));
    expect(returnedToSortie).toBe(true);
    issueCommandFrame(game, next);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
