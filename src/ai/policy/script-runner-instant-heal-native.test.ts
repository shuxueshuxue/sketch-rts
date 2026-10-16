import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, issuePlayerCommand } from '../../shared/sim';
import { ABILITY_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';

it.each([30660,30705])('native actual%i ready heal increases HP immediately and preserves the preceding hold', tick => {
  const C = new URL('../../../', import.meta.url);
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`src/ai/bootstrap_1/fixtures/medical-ready-heal-${tick}.json.gz`, C))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  expect(snapshotGame(game)).toEqual(saved.snapshot); expect(game.nextId).toBe(saved.nextId);
  const id = tick === 30660 ? 'unit-p0-fieldMedic-1602' : 'unit-p0-fieldMedic-1418';
  const targetId = tick === 30660 ? 'unit-p0-priest-15352' : 'unit-p0-fieldMedic-1602';
  const caster = game.units.find(unit => unit.id === id)!, target = game.units.find(unit => unit.id === targetId)!;
  const definition = ABILITY_DEFS.heal;
  if (definition.behavior !== 'heal') throw Error('heal definition changed');
  const beforeHP = target.hp, beforeTick = game.tick;
  issuePlayerCommand(game, 'p0', { type: 'holdPosition', unitIds: [id] });
  const held = structuredClone({ order: caster.order, orderQueue: caster.orderQueue,
    x: caster.x, y: caster.y, deck: caster.deck, cabin: caster.cabin, gangway: caster.gangway });
  expect(held.order.type).toBe('hold'); expect(abilityCooldown(caster, 'heal')).toBe(0);
  issuePlayerCommand(game, 'p0', { type: 'cast', unitId: id, ability: 'heal', targetId });
  expect(target.hp).toBe(Math.min(target.maxHp, beforeHP + definition.healAmount));
  expect(target.hp).toBeGreaterThan(beforeHP);
  expect(abilityCooldown(caster, 'heal')).toBe(definition.cooldown);
  expect({ order: caster.order, orderQueue: caster.orderQueue, x: caster.x, y: caster.y,
    deck: caster.deck, cabin: caster.cabin, gangway: caster.gangway }).toEqual(held);
  expect(game.tick).toBe(beforeTick);
});
