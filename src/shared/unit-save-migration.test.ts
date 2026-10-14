import { describe, expect, it } from 'vitest';
import { canonicalizeSavedUnits, assertCanonicalSavedKinds } from './unit-save-migration';
import { createGame } from './sim';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
import { createDebugReplayTrace, recordReplayCheckpoint, replayTraceToTick, extractReplayFrameSave } from './replay';
import { UNIT_DEFS } from './catalog';
import { RULES_VERSION } from './rules-version';
import type { GameSnapshot } from './types';

function fixture() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  const unit = game.spawnUnit('player', 'summoner', 900, 900);
  unit.hp = 31;
  unit.abilityCooldowns = { summon: 77 };
  unit.autocast = { summon: false };
  unit.veteranSkillChoices = ['veteranMobility', 'veteranPhalanx', 'veteranEndurance'];
  const room = { ...createRoom({ id: 'migration', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
  return { game, unit, room, save: createSaveGameRecord(game, room, { id: 'migration' }) };
}

describe('canonical save import', () => {
  it('migrates nested semantic fields while preserving paid prices, queue time and authored text', () => {
    const input = {
      units: [{ id: 'pyreCaller', kind: 'pyreCaller', hp: 31, abilityCooldowns: { cinderSoul: 77, summon: 4 }, autocast: { cinderSoul: false, summon: true }, order: { ability: 'cinderSoul' }, cargo: [{ id: 'cargo', kind: 'emberAcolyte', abilityCooldowns: { emberMend: 8 } }] }],
      buildings: [{ queue: [{ unitKind: 'pyreCaller', remaining: 17 }, { unitKind: 'emberAcolyte', remaining: 6, paidGold: 89 }] }],
      corpses: [{ kind: 'pyreCaller' }], projectiles: [{ sourceKind: 'emberAcolyte', weaponKind: 'pyreCaller' }],
      effects: [{ sourceKind: 'pyreCaller', targetKind: 'emberAcolyte' }],
      variants: { authored: { base: 'pyreCaller', abilities: ['cinderSoul'], hp: 513, race: 'ember', trainedAt: 'cinderRift' } },
      map: { scenario: { addUnits: [{ kind: 'emberAcolyte' }] }, description: 'pyreCaller' },
    };
    const before = JSON.stringify(input);
    const result = canonicalizeSavedUnits(input as unknown as GameSnapshot);
    const output = result.snapshot as unknown as typeof input;
    expect(output.units[0]).toMatchObject({ id: 'pyreCaller', kind: 'summoner', hp: 31, abilityCooldowns: { summon: 77 }, autocast: { summon: false }, order: { ability: 'summon' }, cargo: [{ kind: 'priest', abilityCooldowns: { heal: 8 } }] });
    expect(output.buildings[0]!.queue).toEqual([{ unitKind: 'summoner', remaining: 17, paidGold: 174 }, { unitKind: 'priest', remaining: 6, paidGold: 89 }]);
    expect(output.variants.authored).toEqual({ base: 'summoner', abilities: ['summon'], hp: 513 });
    expect(output.map).toEqual({ scenario: { addUnits: [{ kind: 'priest' }] }, description: 'pyreCaller' });
    expect(output.corpses[0]!.kind).toBe('summoner');
    expect(output.effects[0]).toEqual({ sourceKind: 'summoner', targetKind: 'priest' });
    expect(output.projectiles[0]).toEqual({ sourceKind: 'priest', weaponKind: 'summoner' });
    expect(result.changedUnitIds).toEqual(new Set(['pyreCaller', 'cargo']));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('restores old kinds once without healing, resetting cooldowns or rerolling choices', () => {
    const { save, unit, room } = fixture();
    delete save.rulesVersion;
    const old = save.snapshot.units.find(candidate => candidate.id === unit.id)!;
    Object.assign(old, { kind: 'pyreCaller', abilityCooldowns: { cinderSoul: 77 }, autocast: { cinderSoul: false } });
    const before = JSON.stringify(save);
    const restored = restoreGameFromSave(save);
    const actual = restored.units.find(candidate => candidate.id === unit.id)!;
    expect(actual).toMatchObject({ kind: 'summoner', hp: 31, abilityCooldowns: { summon: 77 }, autocast: { summon: false }, veteranSkillChoices: unit.veteranSkillChoices });
    const again = createSaveGameRecord(restored, room, { id: 'canonical' });
    expect(again.rulesVersion).toBe(RULES_VERSION);
    expect(restoreGameFromSave(again).units).toEqual(restored.units);
    expect(JSON.stringify(save)).toBe(before);
  });

  it('refreshes a renamed neutral body without healing or resetting its attack timer', () => {
    const { save, unit } = fixture();
    delete save.rulesVersion;
    const old = save.snapshot.units.find(candidate => candidate.id === unit.id)!;
    Object.assign(old, { owner: 'neutral', kind: 'pyreCaller', maxHp: 88, speed: 59, cooldown: 23 });
    const actual = restoreGameFromSave(save).units.find(candidate => candidate.id === unit.id)!;
    expect(actual).toMatchObject({ kind: 'summoner', hp: 31, maxHp: UNIT_DEFS.summoner.hp, speed: UNIT_DEFS.summoner.speed, cooldown: 23 });
  });

  it.each(['unknownUnit', '__proto__', 'constructor'])('rejects unknown names including %s', name => {
    expect(() => canonicalizeSavedUnits({ units: [{ kind: name }] } as unknown as GameSnapshot)).toThrow('Unknown saved');
    for (const field of ['abilityCooldowns', 'autocast']) {
      const source = JSON.parse(`{"units":[{"kind":"summoner","${field}":{"${name}":1}}]}`);
      expect(() => canonicalizeSavedUnits(source)).toThrow('Unknown saved ability');
    }
  });

  it.each([2, RULES_VERSION])('rejects retired kinds stamped rules %s and unknown rules versions', rulesVersion => {
    const { save, unit } = fixture();
    save.rulesVersion = rulesVersion;
    Object.assign(save.snapshot.units.find(candidate => candidate.id === unit.id)!, { kind: 'pyreCaller' });
    expect(() => assertCanonicalSavedKinds(save.snapshot)).toThrow('Unknown saved');
    expect(() => restoreGameFromSave(save)).toThrow('Unknown saved');
    save.rulesVersion = 99;
    expect(() => restoreGameFromSave(save)).toThrow('Unsupported rules version');
  });
});

describe('replay rules boundary', () => {
  it.each([undefined, 1, 2, 99])('rejects trace rules %s before choosing an otherwise valid checkpoint', version => {
    const { save, game } = fixture();
    const trace = createDebugReplayTrace({ id: 'replay', initialSave: save });
    recordReplayCheckpoint(trace, game);
    if (version === undefined) delete trace.rulesVersion;
    else trace.rulesVersion = version;
    expect(() => replayTraceToTick(trace, game.tick)).toThrow('rules version');
    trace.rulesVersion = RULES_VERSION;
    if (version === undefined) delete trace.initialSave.rulesVersion;
    else trace.initialSave.rulesVersion = version;
    expect(() => replayTraceToTick(trace, game.tick)).toThrow('rules version');
  });

  it('extracts current-rule frame saves and refuses starting a replay from old rules', () => {
    const { save } = fixture();
    const trace = createDebugReplayTrace({ id: 'replay', initialSave: save });
    expect(extractReplayFrameSave(trace, 0, { id: 'frame' }).rulesVersion).toBe(RULES_VERSION);
    delete save.rulesVersion;
    expect(() => createDebugReplayTrace({ id: 'old', initialSave: save })).toThrow('rules version');
  });
});
