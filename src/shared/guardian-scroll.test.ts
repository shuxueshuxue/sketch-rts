import { describe, expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issueCommand, issuePlayerCommand, stepGame, strikeUnit, type Game } from './sim';
import { resolveUnitDamage } from './damage';
import { DAMAGE_PROFILES } from './damage-types';
import { GUARDIAN_SCROLL } from './item-rules';
import { SHOP_GOODS } from './shop';
import { seconds } from './time';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
import { RULES_VERSION, assertCurrentRulesVersion, savedRulesVersion } from './rules-version';

const center = { x: 1500, y: 1500 };
const directions = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [.6, .8], [-.6, .8], [.6, -.8], [-.6, -.8],
] as const;

function scene() {
  return sketchScene('guardian-area-boundary').map('bareDuel').replaceDefaults()
    .player('player', { team: 'friends' }).player('ally', { team: 'friends' })
    .player('enemy', { team: 'opponents' })
    .unit('player', 'worker', center.x, center.y, { id: 'carrier' })
    .item('scroll', 'guardianScroll', 0, 0, { carrierId: 'carrier' });
}

function cast(game: Game) {
  issueCommand(game, { type: 'useItem', unitId: 'carrier', itemId: 'scroll' });
}

describe('guardian scroll area balance', () => {
  it.each(['melee', 'spell'] as const)('takes 60% of %s damage during protection and full damage after expiry', style => {
    const game = scene().unit('player', 'golem', 1580, 1500, { id: 'target', order: { type: 'hold', x: 1580, y: 1500 } })
      .unit('enemy', 'footman', 2500, 1500, { id: 'attacker', order: { type: 'hold', x: 2500, y: 1500 } }).build().createGame();
    game.scriptedVictory = true;
    const target = game.units.find(unit => unit.id === 'target')!, attacker = game.units.find(unit => unit.id === 'attacker')!;
    cast(game);
    const initialHp = target.hp;
    strikeUnit(game, attacker, target, 100, style);
    expect(initialHp - target.hp).toBeCloseTo(60);
    for (let tick = 0; tick < GUARDIAN_SCROLL.duration; tick++) stepGame(game);
    expect(target.effects.some(effect => effect.type === 'guardian')).toBe(false);
    const expiredHp = target.hp;
    strikeUnit(game, attacker, target, 100, style);
    expect(expiredHp - target.hp).toBeCloseTo(100);
  });

  it('shares the strongest ward layer and multiplies with separate aura protection', () => {
    const game = scene().unit('player', 'footman', 1580, 1500, { id: 'target' }).build().createGame();
    const target = game.units.find(unit => unit.id === 'target')!;
    cast(game);
    target.effects.push({ type: 'protection', remaining: seconds(10), damageReduction: .35, protectionGroup: 'ward' });
    expect(resolveUnitDamage(game, target, 100, DAMAGE_PROFILES.MELEE_CUT).damage).toBeCloseTo(60);
    expect(resolveUnitDamage(game, target, 100, DAMAGE_PROFILES.POISON, [{ group: 'aura', amount: .2 }]).damage).toBeCloseTo(48);
    target.effects.push({ type: 'protection', remaining: seconds(1), damageReduction: .5, protectionGroup: 'ward' });
    expect(resolveUnitDamage(game, target, 100, DAMAGE_PROFILES.MELEE_CUT).damage).toBeCloseTo(50);
    target.effects.find(effect => effect.damageReduction === .5)!.remaining = 0;
    expect(resolveUnitDamage(game, target, 100, DAMAGE_PROFILES.MELEE_CUT).damage).toBeCloseTo(60);
    target.effects.find(effect => effect.type === 'guardian')!.remaining = 0;
    expect(resolveUnitDamage(game, target, 100, DAMAGE_PROFILES.MELEE_CUT).damage).toBeCloseTo(65);
  });

  it('reduces damage without blocking on-hit poison', () => {
    const game = scene().unit('player', 'footman', 1580, 1500, { id: 'target' })
      .unit('neutral', 'venomSpider', 1620, 1500, { id: 'attacker' }).build().createGame();
    const target = game.units.find(unit => unit.id === 'target')!;
    cast(game);
    const hp = target.hp;
    strikeUnit(game, game.units.find(unit => unit.id === 'attacker')!, target, 10, 'melee');
    expect(hp - target.hp).toBeCloseTo(6);
    expect(target.effects.some(effect => effect.type === 'poison')).toBe(true);
  });

  it.each(directions.flatMap(([dx, dy]) => [
    { dx, dy, reach: 179.99, receives: true },
    { dx, dy, reach: 180, receives: true },
    { dx, dy, reach: 180.01, receives: false },
    { dx, dy, reach: 250, receives: false },
  ]))('selects centers at $reach along ($dx, $dy): $receives', ({ dx, dy, reach, receives }) => {
    const game = scene().unit('player', 'footman', center.x + dx * reach, center.y + dy * reach, { id: 'target' })
      .build().createGame();
    const target = game.units.find(unit => unit.id === 'target')!;
    expect(Math.hypot(target.x - center.x, target.y - center.y)).toBeCloseTo(reach, 9);
    cast(game);
    expect(target.effects.some(effect => effect.type === 'guardian')).toBe(receives);
    expect(game.units.find(unit => unit.id === 'carrier')!.effects).toContainEqual({ type: 'guardian', remaining: seconds(7), damageReduction: .4, protectionGroup: 'ward' });
    expect(game.effects.find(effect => effect.type === 'guardianField')).toMatchObject({
      x: center.x, y: center.y, radius: 180, duration: seconds(7), remaining: seconds(7),
    });
    expect(game.items).toHaveLength(0);
  });

  it('retains team eligibility and protects mechanical allies, without protecting enemies or creeps', () => {
    const game = scene()
      .unit('ally', 'footman', 1580, 1500, { id: 'team-ally' })
      .unit('player', 'golem', 1440, 1560, { id: 'mechanical' })
      .unit('enemy', 'footman', 1440, 1440, { id: 'enemy' })
      .unit('neutral', 'wildling', 1560, 1440, { id: 'creep' })
      .build().createGame();
    cast(game);
    const recipients = game.units.filter(unit => unit.effects.some(effect => effect.type === 'guardian')).map(unit => unit.id).sort();
    expect(recipients).toEqual(['carrier', 'mechanical', 'team-ally']);
    expect(GUARDIAN_SCROLL.duration).toBe(seconds(7));
    expect(SHOP_GOODS.find(item => item.kind === 'guardianScroll')?.cost).toBe(200);
  });

  it.each([{ reach: 179.99, protected: true }, { reach: 180.01, protected: false }])
   ('actual enemy arrows respect the $reach cast boundary (protected=$protected)', ({ reach, protected: guarded }) => {
      const game = scene().unit('player', 'footman', center.x + reach, center.y, { id: 'target', order: { type: 'hold', x: center.x + reach, y: center.y } })
        .unit('enemy', 'archer', 1880, 1500, { id: 'attacker' }).build().createGame();
      game.scriptedVictory = true;
      const target = game.units.find(unit => unit.id === 'target')!, attacker = game.units.find(unit => unit.id === 'attacker')!;
      cast(game);
      issuePlayerCommand(game, 'enemy', { type: 'attack', unitIds: [attacker.id], targetId: target.id });
      const initialHp = target.hp;
      let fired = false;
      for (let tick = 0; tick < 100 && target.hp === initialHp; tick++) { stepGame(game); fired ||= attacker.cooldown > 0; }
      expect(fired).toBe(true);
      expect(initialHp - target.hp).toBeCloseTo(attacker.attackDamage * (guarded ? .6 : 1));
      expect(target.effects.some(effect => effect.type === 'guardian')).toBe(guarded);
    });

  it('still rejects a neutral carrier without consuming the item', () => {
    const game = sketchScene('neutral-guardian').map('bareDuel').replaceDefaults().player('player')
      .unit('neutral', 'wildling', 1500, 1500, { id: 'carrier' })
      .item('scroll', 'guardianScroll', 0, 0, { carrierId: 'carrier' }).build().createGame();
    expect(() => cast(game)).toThrow('Unknown player item carrier carrier');
    expect(game.items.map(item => item.id)).toEqual(['scroll']);
    expect(game.effects.some(effect => effect.type === 'guardianField')).toBe(false);
    expect(game.units[0]!.effects).toEqual([]);
  });

  it('remains a cast-time selection: recipients keep their buff after leaving, and later arrivals do not acquire it', () => {
    const game = scene().unit('player', 'footman', 1580, 1500, { id: 'recipient' })
      .unit('player', 'footman', 1750, 1500, { id: 'late-arrival' }).build().createGame();
    game.scriptedVictory = true;
    cast(game);
    const recipient = game.units.find(unit => unit.id === 'recipient')!, arrival = game.units.find(unit => unit.id === 'late-arrival')!;
    recipient.x = 1850; arrival.x = 1580;
    stepGame(game);
    expect(recipient.effects).toContainEqual({ type: 'guardian', remaining: seconds(7) - 1, damageReduction: .4, protectionGroup: 'ward' });
    expect(arrival.effects.some(effect => effect.type === 'guardian')).toBe(false);
    expect(game.effects.find(effect => effect.type === 'guardianField')).toMatchObject(center);
  });
});

describe('guardian balance rules boundary', () => {
  it('identifies current rules and refuses replay/network simulation of rules 4', () => {
    expect(RULES_VERSION).toBe(8);
    expect(GUARDIAN_SCROLL.radius).toBe(180);
    expect(() => assertCurrentRulesVersion(4, 'Old replay')).toThrow('Cross-version simulation is not supported');
    expect(() => assertCurrentRulesVersion(RULES_VERSION, 'Current replay')).not.toThrow();
    expect([undefined, 1, 2, 3, 4, 5, 6, 7, RULES_VERSION].map(savedRulesVersion)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each([2, 4])('imports a canonical rules-%s snapshot without recasting existing buffs or changing recorded field radius', rulesVersion => {
    const game = scene().unit('player', 'footman', 1720, 1500, { id: 'old-recipient' }).build().createGame();
    const target = game.units.find(unit => unit.id === 'old-recipient')!;
    target.effects.push({ type: 'guardian', remaining: 73 });
    game.effects.push({ id: 'old-field', type: 'guardianField', ...center, radius: 280, duration: seconds(7), remaining: 73 });
    const room = { ...createRoom({ id: 'old-snapshot', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
    const save = createSaveGameRecord(game, room, { id: 'old-snapshot' });
    save.rulesVersion = rulesVersion;
    const bytes = JSON.stringify(save);
    const imported = restoreGameFromSave(save);
    expect(imported.units.find(unit => unit.id === target.id)!.effects).toEqual(target.effects);
    expect(imported.effects.find(effect => effect.id === 'old-field')).toMatchObject({ radius: 280, remaining: 73 });
    expect(JSON.stringify(save)).toBe(bytes);
    const savedAgain = createSaveGameRecord(imported, room, { id: 'new-snapshot' });
    expect(savedAgain.rulesVersion).toBe(RULES_VERSION);
    // Only future casts use the new range. Snapshot import is not old-command replay.
    cast(imported);
    expect(imported.units.find(unit => unit.id === target.id)!.effects).toEqual(target.effects);
    expect(imported.effects.filter(effect => effect.type === 'guardianField').map(effect => effect.radius)).toEqual([280, 180]);
  });
});
