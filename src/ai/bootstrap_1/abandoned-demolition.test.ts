import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { ABILITY_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { strengthOf } from '../policy/v6/strength';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  '$race clears abandoned buildings within one normal summon cooldown (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const kind = race === 'grove' ? 'summoner' : 'pyreCaller';
    const ability = race === 'grove' ? 'summon' : 'cinderSoul';
    let scene = sketchScene('unopposed-host-cleanup').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('other', { team: 'b' })
      .playerState('us', { gold: 0 }).townHall('us', x(500), 500).tower('us', x(2400), 2200)
      .farms('us', 8, x(400), 1800).townHall('foe', x(3400), 3400, { id: 'empty-hall' })
      .building('other', 'farm', x(3800), 3900, { id: 'last-farm' });
    for (let index = 0; index < 12; index++) scene = scene.unit('us', kind,
      x(2500 + index % 4 * 35), 2500 + Math.floor(index / 4) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    for (const caster of game.units.filter(unit => unit.kind === kind)) issuePlayerCommand(game, 'us', {
      type: 'cast', unitId: caster.id, ability, x: caster.x + (mirrored ? -180 : 180), y: caster.y + 180,
    });
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.kind === 'spirit')).toHaveLength(12);
    const roster = game.units.filter(unit => unit.owner === 'us'), hall = game.buildings.find(building => building.id === 'empty-hall')!;
    memory.v6 = { general: { mode: 'attack', target: { x: hall.x, y: hall.y }, targetHallId: hall.id,
      stage: 'gather', stageSince: game.tick, group: roster.map(unit => unit.id), groupStart: strengthOf(roster) } };
    let hostDamage = 0, casterDamage = 0;
    game.observer = { hit(source, target, damage) {
      if (target.kind === kind) hostDamage += damage;
      if (source.kind === kind) casterDamage += damage;
    } };
    for (let tick = 0; tick < ABILITY_DEFS[ability].cooldown && !game.match.winner; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(game.match.winner).toBe('us');
    expect(game.buildings.every(building => building.owner === 'us')).toBe(true);
    expect(game.units.filter(unit => unit.kind === kind)).toHaveLength(12);
    expect(hostDamage).toBe(0);
    expect(casterDamage).toBeGreaterThan(0);
    expect(game.players.us!.gold).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
