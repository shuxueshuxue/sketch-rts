import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiCommandEntry } from '../policy/types';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import { preserveLateCrewCharge } from './deck-recovery';

const raider = 'unit-p0-raider-2245', knight = 'unit-p0-knight-2183', hull = 'unit-p0-warship-1962';
function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/deck-camp-0f5bf-35595.json.gz', import.meta.url))).toString());
  return saved.snapshot as GameSnapshot;
}
const hold = (ids = [knight, raider], queued = false): AiCommandEntry => ({ scriptId: 'naval',
  command: { type: 'holdPosition', unitIds: ids, ...(queued ? { queued: true } : {}) } });
const enable = (ids = [raider]): AiCommandEntry => ({ scriptId: 'explicitLateChargeSwitch',
  command: { type: 'setAutocast', unitIds: ids, ability: 'charge', enabled: true } });

it('splits only the actual35595 mixed naval crew hold for its accepted later charge owner', () => {
  const snapshot = actual(), original = hold(), switchEntry = enable(), entries = [original, switchEntry];
  const before = JSON.stringify({ snapshot, entries });
  expect(snapshot.units.find(unit => unit.id === raider)!.deck?.shipId).toBe(hull);
  expect(preserveLateCrewCharge(snapshot, 'p0', entries)).toEqual([hold([knight]), switchEntry]);
  expect(JSON.stringify({ snapshot, entries })).toBe(before);
});

it('retains an explicitly queued transfer hold for the same crew', () => {
  const snapshot = actual(), entries = [hold([raider], true), enable()];
  expect(preserveLateCrewCharge(snapshot, 'p0', entries)).toBe(entries);
});

it('retains a hull hold while releasing only the announced crew member', () => {
  const snapshot = actual(), switchEntry = enable();
  expect(preserveLateCrewCharge(snapshot, 'p0', [hold([hull, raider]), switchEntry])).toEqual([hold([hull]), switchEntry]);
});

it('leaves another physical owner authoritative over its own hold', () => {
  const snapshot = actual(), entries = [{ ...hold([raider]), scriptId: 'frontRecovery' }, enable()];
  expect(preserveLateCrewCharge(snapshot, 'p0', entries)).toBe(entries);
});

it.each(['earlier', 'disabled', 'heal'] as const)('does not remove a coastal hold for an %s setting', change => {
  const snapshot = actual(), switchEntry = enable();
  if (switchEntry.command.type !== 'setAutocast') throw Error('wrong setting command');
  if (change === 'disabled') switchEntry.command.enabled = false;
  if (change === 'heal') switchEntry.command.ability = 'heal';
  const entries = change === 'earlier' ? [switchEntry, hold()] : [hold(), switchEntry];
  expect(preserveLateCrewCharge(snapshot, 'p0', entries)).toBe(entries);
});

it('does not let a mixed setting silently release a unit that lacks charge', () => {
  const snapshot = actual(), worker = 'unit-p0-worker-1586', switchEntry = enable([raider, worker]);
  const command: GameCommand = { type: 'holdPosition', unitIds: [raider, worker, knight] };
  expect(preserveLateCrewCharge(snapshot, 'p0', [{ scriptId: 'naval', command }, switchEntry]))
    .toEqual([hold([worker, knight]), switchEntry]);
});
