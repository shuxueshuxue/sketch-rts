import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS } from './catalog';
import type { GameSnapshot } from './types';
import { UNIT_NAMES } from './unit-name-migration';

const ABILITY_NAMES: Readonly<Record<string, string>> = { cinderSoul: 'summon', emberMend: 'heal' };
// Missing paidGold in these old queues must keep the old purchase price, not
// acquire the canonical unit's price during restoreSnapshotIntoGame.
const PREVIOUS_TRAINING_COST: Readonly<Record<string, number>> = { pyreCaller: 174, emberAcolyte: 130 };
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** One-time import only. No retired kind exists in the live catalog or runtime.
 * Walk semantic fields rather than replacing strings globally: ids, labels and
 * scenario descriptions may legitimately contain a retired name.
 */
export function canonicalizeSavedUnits(snapshot: GameSnapshot): { snapshot: GameSnapshot; changedUnitIds: Set<string> } {
  const copy: unknown = JSON.parse(JSON.stringify(snapshot));
  const changedUnitIds = new Set<string>();
  function visit(value: unknown, container = ''): void {
    if (Array.isArray(value)) { for (const child of value) visit(child, container); return; }
    if (!record(value)) return;
    if (['units', 'cargo', 'addUnits'].includes(container) && typeof value.kind === 'string' && own(UNIT_NAMES, value.kind) && typeof value.id === 'string') changedUnitIds.add(value.id);
    if (typeof value.unitKind === 'string' && value.paidGold === undefined && own(PREVIOUS_TRAINING_COST, value.unitKind)) value.paidGold = PREVIOUS_TRAINING_COST[value.unitKind];
    for (const field of ['kind', 'unitKind', 'sourceKind', 'targetKind', 'weaponKind', 'base']) {
      const name = value[field];
      if (typeof name === 'string' && own(UNIT_NAMES, name)) value[field] = UNIT_NAMES[name];
    }
    if (typeof value.ability === 'string' && own(ABILITY_NAMES, value.ability)) value.ability = ABILITY_NAMES[value.ability];
    if (Array.isArray(value.abilities)) value.abilities = [...new Set(value.abilities.map(name => typeof name === 'string' && own(ABILITY_NAMES, name) ? ABILITY_NAMES[name] : name))];
    if (record(value.abilityCooldowns)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const [name, ticks] of Object.entries(value.abilityCooldowns)) {
        const key = own(ABILITY_NAMES, name) ? ABILITY_NAMES[name]! : name;
        // If an imported record contains both names, never shorten a cooldown.
        result[key] = typeof ticks === 'number' && typeof result[key] === 'number' ? Math.max(ticks, result[key] as number) : ticks;
      }
      value.abilityCooldowns = result;
    }
    if (record(value.autocast)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const [name, enabled] of Object.entries(value.autocast)) {
        const key = own(ABILITY_NAMES, name) ? ABILITY_NAMES[name]! : name;
        // Explicitly disabled automation remains disabled on a key collision.
        result[key] = result[key] === false || enabled === false ? false : enabled;
      }
      value.autocast = result;
    }
    if (typeof value.base === 'string') { delete value.trainedAt; delete value.race; }
    for (const [key, child] of Object.entries(value)) visit(child, key);
  }
  visit(copy);
  const canonical = copy as GameSnapshot;
  assertCanonicalSavedKinds(canonical);
  return { snapshot: canonical, changedUnitIds };
}

/** Reject unknown/future names at the import boundary, before catalog indexing.
 * This deliberately does not reinterpret names on a current-version record.
 */
export function assertCanonicalSavedKinds(snapshot: GameSnapshot): void {
  function unitName(name: unknown, field: string): void {
    if (typeof name !== 'string' || !own(UNIT_DEFS, name)) throw new Error(`Unknown saved ${field}: ${String(name)}`);
  }
  function abilityName(name: unknown): void {
    if (typeof name !== 'string' || !own(ABILITY_DEFS, name)) throw new Error(`Unknown saved ability: ${String(name)}`);
  }
  function visit(value: unknown, container = ''): void {
    if (Array.isArray(value)) { for (const child of value) visit(child, container); return; }
    if (!record(value)) return;
    if (['units', 'cargo', 'corpses', 'addUnits'].includes(container)) unitName(value.kind, 'unit kind');
    for (const key of ['unitKind', 'targetKind', 'weaponKind', 'base']) if (value[key] !== undefined) unitName(value[key], key);
    if (value.sourceKind !== undefined && !(typeof value.sourceKind === 'string' && own(BUILDING_DEFS, value.sourceKind))) unitName(value.sourceKind, 'sourceKind');
    if (value.ability !== undefined) abilityName(value.ability);
    if (Array.isArray(value.abilities)) for (const name of value.abilities) abilityName(name);
    for (const key of ['abilityCooldowns', 'autocast']) if (record(value[key])) for (const name of Object.keys(value[key])) abilityName(name);
    for (const [key, child] of Object.entries(value)) visit(child, key);
  }
  visit(snapshot);
}
