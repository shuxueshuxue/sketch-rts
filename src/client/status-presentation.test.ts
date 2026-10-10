import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, removeUnit, snapshotGame, stepGame, strikeUnit } from '../shared/sim';
import { checksumGame } from '../shared/sim/checksum';
import { buildVeteranFrame } from '../shared/veteran-runtime';
import { VETERAN_SKILLS } from '../shared/veteran-skills';
import { seconds } from '../shared/time';
import { effectiveUnitStatusEffects, presentUnitStatuses, statusDurationBadge, unitStatusIcon, unitStatusPolarity } from './status-presentation';
import type { Unit, UnitStatusEffect } from '../shared/types';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.resources = [];
  game.scriptedVictory = true; delete game.map.terrain;
  return game;
}
function advance(game: ReturnType<typeof scene>, ticks: number) { for (let i = 0; i < ticks; i++) stepGame(game); }
function statuses(game: ReturnType<typeof scene>, unit: Unit) { return presentUnitStatuses(snapshotGame(game), unit); }

describe('focused unit status presentation', () => {
  it('follows a real veteran cast until expiry while leaving its longer cooldown in the command card', () => {
    const game = scene(), caster = game.spawnUnit('player', 'footman', 800, 800), target = game.spawnUnit('player', 'archer', 850, 800);
    caster.level = 3; caster.veteranSkillChoices = ['veteranRally', 'veteranMobility', 'veteranResilience'];
    issuePlayerCommand(game, 'player', { type: 'learnVeteranSkill', unitId: caster.id, skill: 'veteranRally' });
    caster.order = { type: 'hold', x: caster.x, y: caster.y };
    target.order = { type: 'hold', x: target.x, y: target.y };
    issuePlayerCommand(game, 'player', { type: 'cast', unitId: caster.id, ability: 'veteranRally' });
    const before = checksumGame(game);
    expect(statuses(game, target)).toMatchObject([{ type: 'veteranBuff', polarity: 'buff', icon: 'veteranRally', badge: '8s', remainingTicks: seconds(8) }]);
    expect(statuses(game, target)[0]?.description).toContain('60%');
    expect(checksumGame(game)).toBe(before);
    advance(game, seconds(2));
    expect(statuses(game, target)[0]?.badge).toBe('6s');
    advance(game, seconds(6));
    expect(statuses(game, target)).toEqual([]);
    expect(caster.abilityCooldowns?.veteranRally).toBeGreaterThan(0);
  });

  it('shows actual neutral bite and net debuffs and removes each when the simulation expires it', () => {
    const game = scene(), target = game.spawnUnit('player', 'footman', 800, 800);
    const hunter = game.spawnUnit('neutral', 'murlocHunter', 850, 800), spider = game.spawnUnit('neutral', 'venomSpider', 900, 800);
    strikeUnit(game, hunter, target, 1, 'ranged'); strikeUnit(game, spider, target, 1, 'melee');
    removeUnit(game, hunter.id); removeUnit(game, spider.id); target.order = { type: 'hold', x: target.x, y: target.y };
    expect(statuses(game, target)).toMatchObject([{ type: 'slow', polarity: 'debuff', badge: '3s' }, { type: 'poison', polarity: 'debuff', badge: '4s' }]);
    advance(game, seconds(3));
    expect(statuses(game, target).map(status => status.type)).toEqual(['poison']);
    advance(game, seconds(1));
    expect(statuses(game, target)).toEqual([]);
  });

  it('uses the actual strongest short ward and resumes an underlying longer ward after expiry', () => {
    const game = scene(), unit = game.spawnUnit('player', 'footman', 800, 800);
    unit.order = { type: 'hold', x: unit.x, y: unit.y };
    unit.effects = [{ type: 'protection', remaining: 60, damageReduction: .1, sourceId: 'long' }, { type: 'protection', remaining: 20, damageReduction: .2, sourceId: 'short' }];
    expect(statuses(game, unit)).toMatchObject([{ type: 'protection', remainingTicks: 20, badge: '1s', sourceIds: ['short'] }]);
    advance(game, 20);
    expect(statuses(game, unit)).toMatchObject([{ type: 'protection', remainingTicks: 40, sourceIds: ['long'] }]);
    expect(statuses(game, unit)[0]?.description).toContain('10%');
    expect(unit.effects).toHaveLength(1);
  });

  it('does not invent stacks for bloodlust and a weaker veteran rally sharing one attack speed layer', () => {
    const game = scene(), unit = game.spawnUnit('player', 'footman', 800, 800);
    unit.effects = [{ type: 'veteranBuff', remaining: 60, attackSpeedMultiplier: 1.2 }, { type: 'bloodlust', remaining: 20 }];
    expect(effectiveUnitStatusEffects(unit).map(effect => effect.type)).toEqual(['bloodlust']);
    expect(statuses(game, unit)[0]?.badge).toBe('1s');
    unit.effects[1]!.remaining = 0;
    expect(effectiveUnitStatusEffects(unit).map(effect => effect.type)).toEqual(['veteranBuff']);
  });

  it('matches real strongest aura protection, ally teams, cabin boundaries and death', () => {
    const game = scene(); game.teams = { player: 'north', enemy: 'north', enemy2: 'south' };
    const target = game.spawnUnit('player', 'footman', 800, 800);
    const weak = game.spawnUnit('player', 'footman', 850, 800), strong = game.spawnUnit('enemy', 'footman', 800, 850), foe = game.spawnUnit('enemy2', 'footman', 780, 800);
    weak.veteranSkill = 'veteranVigilance'; strong.veteranSkill = foe.veteranSkill = 'veteranPhalanx';
    expect(buildVeteranFrame(snapshotGame(game)).get(target.id)?.reductions).toEqual([{ group: 'aura', amount: .25 }]);
    expect(statuses(game, target)).toMatchObject([{ key: 'aura:veteranPhalanx', badge: '∞', sourceIds: [strong.id] }]);
    strong.deck = { shipId: 'ship', x: 0, y: 0 }; strong.cabin = { shipId: 'ship' };
    expect(buildVeteranFrame(snapshotGame(game)).get(target.id)?.reductions).toEqual([{ group: 'aura', amount: .18 }]);
    expect(statuses(game, target)).toMatchObject([{ key: 'aura:veteranVigilance', sourceIds: [weak.id] }]);
    weak.hp = 0;
    expect(statuses(game, target)).toEqual([]);
  });

  it('honors medical aura target filters and does not repeat permanent learned abilities or cooldowns', () => {
    const game = scene(), healer = game.spawnUnit('player', 'priest', 800, 800), hull = game.spawnUnit('player', 'warship', 850, 800), soldier = game.spawnUnit('player', 'footman', 810, 800);
    healer.veteranSkill = 'veteranRenewal'; soldier.veteranSkill = 'veteranResilience'; soldier.abilityCooldowns = { veteranRally: 200 };
    expect(statuses(game, hull)).toEqual([]);
    expect(statuses(game, soldier).map(status => status.key)).toEqual(['aura:veteranRenewal']);
    healer.x += VETERAN_SKILLS.veteranRenewal.effect.type === 'aura' ? VETERAN_SKILLS.veteranRenewal.effect.radius + 30 : 300;
    expect(statuses(game, soldier)).toEqual([]);
  });

  it('uses snapshot tick for the real summon lifetime rather than the summoning animation', () => {
    const game = scene(), caster = game.spawnUnit('player', 'summoner', 800, 800);
    issuePlayerCommand(game, 'player', { type: 'cast', unitId: caster.id, ability: 'summon', x: 850, y: 800 });
    const summon = game.units.find(unit => unit.kind === 'spirit')!;
    expect(statuses(game, summon)).toMatchObject([{ type: 'lifetime', polarity: 'neutral', badge: '1:00' }]);
    game.tick += seconds(20);
    expect(statuses(game, summon)[0]?.badge).toBe('40s');
  });

  it('keeps last-tick crowd control visible, excludes expired statuses and gives every existing status a pictorial icon', () => {
    expect(statusDurationBadge(1)).toBe('0.1s'); expect(statusDurationBadge(0)).toBe('');
    const types: UnitStatusEffect['type'][] = ['curse', 'guardian', 'scorch', 'slow', 'stun', 'root', 'poison', 'bloodlust', 'protection', 'veteranBuff'];
    for (const type of types) {
      const effect: UnitStatusEffect = { type, remaining: 1 };
      expect(unitStatusIcon(effect)).toBeTruthy();
      expect(['buff', 'debuff']).toContain(unitStatusPolarity(effect));
    }
  });
});
