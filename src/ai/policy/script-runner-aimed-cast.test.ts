import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { sketchScene } from '../../sdk/scene';
import { ABILITY_DEFS, resolveVariant } from '../../shared/catalog';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { checkCommandLegality } from '../../shared/sim/command-validation';
import type { GameCommand, UnitKind } from '../../shared/types';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { battlefieldUnitIds } from './battlefield';
import { runAiCommandEntriesFromScripts } from './script-runner';
import type { AiScript } from './types';

function scene(kind: UnitKind = 'ballista', targetX = 900) {
  return sketchScene('aimed-cast-order-owner').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' })
    .townHall('us', 400, 400).townHall('foe', 3400, 3400)
    .unit('us', kind, 600, 600, { id: 'caster' })
    .unit('us', 'footman', 600, 700, { id: 'free' })
    .unit('us', 'footman', targetX, 700, { id: 'patient', hp: 40 })
    .unit('foe', 'footman', targetX, 600, { id: 'target' })
    .build().createGame();
}

function scripts(cast: Extract<GameCommand, { type: 'cast' }>, physical: GameCommand): AiScript[] {
  return [{ id: 'abilities', phase: 'tactics', run: () => cast },
    { id: 'physical', phase: 'tactics', run: () => physical }];
}

describe('native sustained cast order ownership', () => {
  it.each(['move', 'attackMove', 'attack', 'holdPosition', 'aim'] as const)(
    'keeps an in-range aimed weapon cast ahead of a later mixed %s command', type => {
      const game = scene();
      const cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' } as const;
      const physical: GameCommand = type === 'attack' ? { type, unitIds: ['caster', 'free'], targetId: 'target' }
        : type === 'holdPosition' ? { type, unitIds: ['caster', 'free'] }
          : { type, unitIds: ['caster', 'free'], x: 1200, y: 600 };
      const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast, physical));
      for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
      expect(entries[1]!.command).toEqual({ ...physical, unitIds: ['free'] });
      expect(game.units.find(unit => unit.id === 'caster')!.order).toEqual({ type: 'cast', ability: 'pinningBolt', targetId: 'target' });
      expect(game.projectiles).toHaveLength(0); // Native aim has not advanced a tick.
    });

  it('reserves a native ship weapon cast that turns through a mounted weapon', () => {
    const game = scene('fireShip', 760);
    const cast = { type: 'cast', unitId: 'caster', ability: 'incendiaryFlume', x: 760, y: 600 } as const;
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast,
      { type: 'move', unitIds: ['caster', 'free'], x: 1200, y: 600 }));
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries[1]!.command).toEqual({ type: 'move', unitIds: ['free'], x: 1200, y: 600 });
    expect(game.units.find(unit => unit.id === 'caster')!.order.type).toBe('cast');
  });

  it.each([false, true])('respects an existing silent assignment, including the weapon script itself (same owner=%s)', sameOwner => {
    const game = scene(), caster = game.units.find(unit => unit.id === 'caster')!;
    caster.order = { type: 'move', x: 600, y: 900, avoidCombat: true };
    const assignments: AiScript[] = [
      { id: 'navalRecovery', phase: 'tactics', claimsUnits: () => new Set(sameOwner ? [] : ['caster']), run: () => [] },
      { id: 'abilities', phase: 'tactics', claimsUnits: () => new Set(sameOwner ? ['caster'] : []),
        run: () => ({ type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' }) },
    ];
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', assignments);
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries.map(entry => entry.scriptId)).toEqual(sameOwner ? ['abilities'] : []);
    expect(caster.order.type).toBe(sameOwner ? 'cast' : 'move');
  });

  it('allows an immediate heal under another assignment without taking its physical order', () => {
    const game = scene('priest', 750), caster = game.units.find(unit => unit.id === 'caster')!;
    caster.order = { type: 'move', x: 600, y: 900, avoidCombat: true };
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [
      { id: 'navalRecovery', phase: 'tactics', claimsUnits: () => new Set(['caster']), run: () => [] },
      { id: 'abilities', phase: 'tactics', run: () => ({ type: 'cast', unitId: 'caster', ability: 'heal', targetId: 'patient' }) },
    ]);
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries.map(entry => entry.scriptId)).toEqual(['abilities']);
    expect(caster.order).toEqual({ type: 'move', x: 600, y: 900, avoidCombat: true });
    expect(game.units.find(unit => unit.id === 'patient')!.hp).toBeGreaterThan(40);
  });

  it('lets the admitted unclaimed aimed cast complete across native ticks', () => {
    const game = scene(), cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' } as const;
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast,
      { type: 'move', unitIds: ['caster', 'free'], x: 1200, y: 600 }));
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    const caster = game.units.find(unit => unit.id === 'caster')!;
    for (let ticks = 0; ticks < 100 && !caster.abilityCooldowns?.pinningBolt; ticks++) stepGame(game);
    expect(caster.abilityCooldowns?.pinningBolt).toBeGreaterThan(0);
    expect(game.projectiles.some(shot => shot.attackerId === 'caster' && shot.targetId === 'target')).toBe(true);
  });

  it('keeps a queued aimed cast after the existing order against a later nonqueued mixed move', () => {
    const game = scene(), caster = game.units.find(unit => unit.id === 'caster')!;
    caster.order = { type: 'move', x: 600, y: 900 };
    const cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target', queued: true } as const;
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast,
      { type: 'move', unitIds: ['caster', 'free'], x: 1200, y: 600 }));
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(caster.order).toEqual({ type: 'move', x: 600, y: 900 });
    expect(caster.orderQueue).toEqual([{ type: 'cast', ability: 'pinningBolt', targetId: 'target' }]);
    expect(entries[1]!.command).toEqual({ type: 'move', unitIds: ['free'], x: 1200, y: 600 });
  });

  it('preserves a same-script cast and explicitly queued move sequence', () => {
    const game = scene(), cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' } as const;
    const move: GameCommand = { type: 'move', unitIds: ['caster'], x: 1200, y: 600, queued: true };
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [{ id: 'abilities', phase: 'tactics', run: () => [cast, move] }]);
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries.map(entry => entry.command)).toEqual([cast, move]);
    expect(game.units.find(unit => unit.id === 'caster')!.order.type).toBe('cast');
    expect(game.units.find(unit => unit.id === 'caster')!.orderQueue).toEqual([{ type: 'move', x: 1200, y: 600 }]);
  });

  it('uses the same native variant rules when a weapon cast is genuinely immediate', () => {
    const game = scene();
    // Explicit campaign-style counterfactual, not an altered ordinary-game fixture.
    game.variants = { shortWeapon: resolveVariant({ base: 'ballista', attackRange: 64 }) };
    const caster = game.units.find(unit => unit.id === 'caster')!;
    caster.variant = 'shortWeapon';
    const cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' } as const;
    const move: GameCommand = { type: 'move', unitIds: ['caster'], x: 1200, y: 600 };
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast, move));
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries.map(entry => entry.command)).toEqual([cast, move]);
    expect(game.projectiles.some(shot => shot.attackerId === 'caster')).toBe(true);
    expect(caster.order.type).toBe('move');
  });

  it.each(['queued', 'far'] as const)('still gives a non-aiming weapon its native %s cast order under task claims', mode => {
    const game = scene('ballista', mode === 'far' ? 1300 : 900), caster = game.units.find(unit => unit.id === 'caster')!;
    game.variants = { shortWeapon: resolveVariant({ base: 'ballista', attackRange: 64 }) };
    caster.variant = 'shortWeapon';
    caster.order = { type: 'move', x: 600, y: 900 };
    const cast: GameCommand = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target',
      ...(mode === 'queued' ? { queued: true } : {}) };
    const unclaimed = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast,
      { type: 'move', unitIds: ['caster'], x: 1200, y: 600 }));
    expect(unclaimed.map(entry => entry.command)).toEqual([cast]);
    const claimed = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [
      { id: 'navalRecovery', phase: 'tactics', claimsUnits: () => new Set(['caster']), run: () => [] },
      { id: 'abilities', phase: 'tactics', run: () => cast },
    ]);
    expect(claimed).toEqual([]);
    for (const entry of unclaimed) issuePlayerCommand(game, 'us', entry.command);
    if (mode === 'queued') expect(caster.orderQueue).toEqual([{ type: 'cast', ability: 'pinningBolt', targetId: 'target' }]);
    else expect(caster.order.type).toBe('cast');
  });

  it.each([
    ['priest', 'heal', 750, true], ['witch', 'curse', 750, true], ['summoner', 'summon', 750, true],
    ['priest', 'heal', 1300, false], ['witch', 'curse', 1300, false], ['summoner', 'summon', 1300, false],
  ] as const)('keeps %s %s at %d immediate=%s consistent with native cast order creation', (kind, ability, x, instant) => {
    const game = scene(kind, x), caster = game.units.find(unit => unit.id === 'caster')!;
    const cast: Extract<GameCommand, { type: 'cast' }> = { type: 'cast', unitId: 'caster', ability,
      ...(ability === 'summon' ? { x, y: 600 } : { targetId: ability === 'heal' ? 'patient' : 'target' }) };
    const move: GameCommand = { type: 'move', unitIds: ['caster'], x: 1200, y: 600 };
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast, move));
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(entries.map(entry => entry.command)).toEqual(instant ? [cast, move] : [cast]);
    expect(caster.order.type).toBe(instant ? 'move' : 'cast');
    if (instant) expect(caster.abilityCooldowns?.[ability]).toBe(ABILITY_DEFS[ability].cooldown);
  });

  it('keeps the existing charge reservation', () => {
    const game = scene('knight', 900);
    const cast = { type: 'cast', unitId: 'caster', ability: 'charge', targetId: 'target' } as const;
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast,
      { type: 'move', unitIds: ['caster'], x: 1200, y: 600 }));
    expect(entries.map(entry => entry.command)).toEqual([cast]);
  });

  it('preserves an explicitly authorized conflict bypass', () => {
    const game = scene(), cast = { type: 'cast', unitId: 'caster', ability: 'pinningBolt', targetId: 'target' } as const;
    const move: GameCommand = { type: 'move', unitIds: ['caster'], x: 1200, y: 600 };
    expect(runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts(cast, move), {}, {
      commandConflictBypassScriptIds: new Set(['physical']),
    }).map(entry => entry.command)).toEqual([cast, move]);
  });

  it.each([37410, 37455])('respects the actual%d full-P0 cast or existing engagement owner through its public frame', tick => {
    const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/aimed-weapon-knight-${tick}.json.gz`, import.meta.url))).toString());
    const original = JSON.parse(readFileSync(new URL(`./fixtures/aimed-weapon-knight-${tick}-original-p0.json`, import.meta.url), 'utf8'));
    const game = createGame('bareDuel');
    restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
    const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
    const input = snapshotGame(game), before = structuredClone(input), gunId = 'unit-p0-ballista-27366';
    const entries = planAiOwnerCommandEntries(input, { playerId: 'p0', version: 'v9_knight', source: 'external-agent' },
      { teams: saved.snapshot.teams, memoryProvider });
    expect(input).toEqual(before);
    const battlefieldOwned = battlefieldUnitIds(input, 'p0', bootstrapPolicyContext(input, 'p0', 'v9_knight', {
      memory: structuredClone(saved.memories.p0), teams: saved.snapshot.teams,
    })).has(gunId);
    expect(battlefieldOwned).toBe(tick === 37455);
    const actor = (entry: { command: GameCommand }) => 'unitId' in entry.command ? entry.command.unitId === gunId
      : 'unitIds' in entry.command && entry.command.unitIds.includes(gunId);
    const withoutGun = (list: typeof entries) => list.flatMap(entry => {
      if ('unitId' in entry.command && entry.command.unitId === gunId) return [];
      if ('unitIds' in entry.command && entry.command.unitIds.includes(gunId)) {
        const unitIds = entry.command.unitIds.filter(id => id !== gunId);
        return unitIds.length ? [{ ...entry, command: { ...entry.command, unitIds } }] : [];
      }
      return [entry];
    });
    expect(withoutGun(entries)).toEqual(withoutGun(original));
    const trace: unknown[] = [];
    issueCommandFrame(game, entries, {
      beforeIssue: entry => { if (actor(entry)) trace.push({ phase: 'before', entry, legality: checkCommandLegality(game, 'p0', entry.command) ?? null,
        gun: structuredClone(game.units.find(unit => unit.id === gunId)) }); },
      afterIssue: entry => { if (actor(entry)) trace.push({ phase: 'after', entry,
        gun: structuredClone(game.units.find(unit => unit.id === gunId)) }); },
    });
    const finalGun = structuredClone(game.units.find(unit => unit.id === gunId)), nextIdAfterPublic = game.nextId;
    if (process.env.BOOTSTRAP_CAST_OWNER_EVIDENCE) writeFileSync(`${process.env.BOOTSTRAP_CAST_OWNER_EVIDENCE}/${tick}.json`,
      JSON.stringify({ tick, inputStage: saved.checkpointStage, battlefieldOwned, originalEntries: original, entries, trace,
        nextIdAfterPublic, finalGun,
        scope: 'Public ownership contract only. The real movingtarget completion negative is retained externally; normal3AI360 must separately prove actual output.' }, null, 2));
    expect(entries.filter(actor).map(entry => entry.command)).toEqual(battlefieldOwned
      ? [{ type: 'attack', unitIds: [gunId], targetId: 'unit-p1-emberRavager-26400' }]
      : [{ type: 'cast', unitId: gunId, ability: 'pinningBolt', targetId: 'unit-p2-witch-6336' }]);
    expect(finalGun!.order).toEqual(battlefieldOwned
      ? { type: 'attack', targetId: 'unit-p1-emberRavager-26400' }
      : { type: 'cast', ability: 'pinningBolt', targetId: 'unit-p2-witch-6336' });
  });
});
