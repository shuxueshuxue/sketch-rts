import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { casualtyContactFacts } from './casualty-contact';

function frame() {
  const snapshot = snapshotGame(sketchScene('contact-casualty-facts').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .unit('us', 'footman', 1000, 1000).unit('us', 'archer', 1000, 1200)
    .unit('foe', 'archer', 1100, 1000).build().createGame());
  return { snapshot, units: snapshot.units.filter(unit => unit.owner === 'us'),
    opponents: snapshot.units.filter(unit => unit.owner === 'foe'), posture: 'present-contact' as const };
}

describe('pre-battle contact facts', () => {
  it('keeps a future unprojected pose unknown instead of using distant zero fire', () => {
    expect(casualtyContactFacts({ ...frame(), posture: 'unprojected-future' })).toEqual({
      status: 'unknown', reason: 'battle-posture-not-projected', reactionTicks: 15,
    });
  });

  it('orders current targeting before geometric proximity, without consulting HP or later hits', () => {
    const input = frame(); input.opponents[0]!.order = { type: 'attack', targetId: input.units[1]!.id };
    const a = casualtyContactFacts(input);
    expect(a.status).toBe('known');
    if (a.status !== 'known') throw new Error('missing facts');
    expect(a.engagementOrder[0]).toBe(input.units[1]!.id);
    input.units[0]!.hp = 1;
    expect(casualtyContactFacts(input)).toEqual(a);
  });

  it('uses real cooldown and damage protection once, while an in-flight shot retains its profile', () => {
    const input = frame(), patient = input.units[0]!, enemy = input.opponents[0]!;
    enemy.cooldown = 16;
    const cooling = casualtyContactFacts(input);
    if (cooling.status !== 'known') throw new Error('missing facts');
    expect(cooling.rows.every(row => row.weapons.every(weapon => weapon.attacks === 0) && row.burstDamage === 0)).toBe(true);
    expect(cooling.rows.some(row => row.pursuitDamagePerTick > 0)).toBe(true);
    input.snapshot.projectiles.push({ id: 'shot', owner: 'foe', attackerId: enemy.id, targetId: patient.id,
      fromX: enemy.x, fromY: enemy.y, toX: patient.x, toY: patient.y, damage: 10,
      damageProfile: { school: 'physical', delivery: 'ranged', origin: 'unit' }, remaining: 5, duration: 10 });
    const result = casualtyContactFacts(input);
    if (result.status !== 'known') throw new Error('missing facts');
    expect(result.rows.find(row => row.unitId === patient.id)!.projectileDamage).toBe(10);
    expect(result.burstByUnit[patient.id]).toBe(10);
    enemy.cooldown = 0;
    const ready = casualtyContactFacts(input);
    if (ready.status !== 'known') throw new Error('missing facts');
    expect(ready.rows.find(row => row.unitId === patient.id)!.weapons[0]!.attacks).toBe(1);
  });

  it('is deterministic under ordering, cold clones and unchanged numeric input', () => {
    const input = frame(), before = JSON.stringify(input), expected = casualtyContactFacts(input);
    expect(casualtyContactFacts({ ...input, units: [...input.units].reverse(), opponents: [...input.opponents].reverse() })).toEqual(expected);
    expect(casualtyContactFacts(JSON.parse(JSON.stringify(input)))).toEqual(expected);
    expect(JSON.stringify(input)).toBe(before);
  });
});
