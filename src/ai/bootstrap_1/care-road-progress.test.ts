import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mobileCare } from './mobile-care';
import { medicalRecovery } from './medical-recovery';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })))) (
  '$version takes its wounded rider around a U-shaped wall to real treatment (mirror=$mirror)', ({ version, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('care-road-u-corridor').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400)
      .unit('us', 'horseArcher', x(2100), 2200, { id: 'patient', hp: 30 })
      .unit('us', 'priest', x(2000), 1700, { id: 'medic' })
      .unit('foe', 'footman', x(2100), 2100, { id: 'pursuer',
        order: { type: 'attack', targetId: 'patient', leashX: x(2100), leashY: 2100 } })
      .build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const col = mirror ? 127 - index % 128 : index % 128, row = Math.floor(index / 128);
      return (col === 59 || col === 69) && row >= 56 && row <= 76 || row === 56 && col >= 59 && col <= 69 ? 'T' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patient = game.units.find(unit => unit.id === 'patient')!, memory = createAiPolicyMemory();
    let careOrders = 0;
    for (let tick = 0; tick < 2400 && game.units.includes(patient) && patient.hp < patient.maxHp * V7_WOUNDED_SHARE; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [mobileCare, medicalRecovery], options)
          .map(entry => ({ ...entry, playerId: 'us' }));
        careOrders += entries.filter(entry => entry.scriptId === 'mobileCare').length;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(game.units, JSON.stringify({ tick: game.tick, careOrders, hp: patient.hp, order: patient.order })).toContain(patient);
    expect(patient.hp).toBeGreaterThanOrEqual(patient.maxHp * V7_WOUNDED_SHARE);
    expect(careOrders).toBeGreaterThan(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
