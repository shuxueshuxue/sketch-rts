import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, resolveVariant, unitRules } from '../../shared/catalog';
import { createGame } from '../../shared/sim';
import { seconds } from '../../shared/time';
import { Stage } from '../../story/stage';
import { instant } from '../../story/time';
import { enlist } from '../../story/cast';
import { World } from '../../story/world';
import { CAST } from './cast';
import { fireFlask } from './powers';

describe('shared campaign caster bases', () => {
  it.each([
    [CAST.pyremancer, 140, 12, 280, 56, 17],
    [CAST.oru, 1100, 22, 300, 60, 20],
  ] as const)('uses shared summoner rules and preserves authored character stats', (member, hp, attackDamage, attackRange, speed, radius) => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    enlist(game, CAST);
    const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
    const unit = world.spawn(member, 'player', { x: 1000, y: 1000 });
    expect(unit).toMatchObject({ kind: 'summoner', variant: member.id, hp, maxHp: hp, attackDamage, attackRange, speed, radius });
    expect(unitRules(game, unit)).toEqual(resolveVariant(member.rules));
    expect(unitRules(game, unit)).toMatchObject({
      abilities: ['summon'], aimSpeed: UNIT_DEFS.summoner.aimSpeed,
      cost: UNIT_DEFS.summoner.cost, trainTime: UNIT_DEFS.summoner.trainTime,
      attackCooldown: seconds(1.9), supplyUsed: 0,
    });
    expect(member.model.remains).toBeDefined();
  });

  it('uses the shared projectile source while preserving the real fire-flask release', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    enlist(game, CAST);
    const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
    const caster = world.spawn(CAST.ig, 'player', { x: 1000, y: 1000 });
    fireFlask(() => 1).cast(caster, { x: 1200, y: 1000 }, world).next();
    expect(game.effects.find(effect => effect.type === 'projectile')).toMatchObject({ sourceKind: 'summoner', attackKind: 'fire', owner: caster.owner });
    expect(world.stage.view().unitActions).toEqual([{ unitId: caster.id, tick: game.tick, mode: 'cast', fromX: caster.x, fromY: caster.y, toX:1200, toY:1000 }]);
  });
});
