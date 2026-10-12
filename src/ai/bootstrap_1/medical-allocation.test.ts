import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { ABILITY_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const healAmount = (ABILITY_DEFS.heal as Extract<typeof ABILITY_DEFS.heal, { behavior: 'heal' }>).healAmount;

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version distributes its ready $race healers across critical soldiers (mirror=$mirror)', ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('simultaneous-critical-care').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400);
    for (let index = 0; index < 3; index++) {
      scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(2000 + index * 32), 1500,
        { id: `patient-${index}`, hp: 20, order: { type: 'hold', x: x(2000 + index * 32), y: 1500 } })
        .unit('us', 'priest', x(2000), 1300 + index * 32, { id: `medic-${index}` });
    }
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patients = game.units.filter(unit => unit.id.startsWith('patient-'));
    const medics = game.units.filter(unit => unit.id.startsWith('medic-'));
    const before = patients.reduce((total, unit) => total + unit.hp, 0);
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
    issueCommandFrame(game, entries);
    stepGame(game);
    const after = patients.reduce((total, unit) => total + unit.hp, 0);
    expect(after - before, JSON.stringify({ entries, patients: patients.map(unit => ({ id: unit.id, hp: unit.hp })) }))
      .toBe(3 * healAmount);
    expect(patients.every(unit => unit.hp === 20 + healAmount)).toBe(true);
    expect(medics.every(unit => abilityCooldown(unit, 'heal') > 0)).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
