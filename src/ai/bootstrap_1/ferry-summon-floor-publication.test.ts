import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapAbilities } from './weapon-targets';

const shipId = 'unit-p0-carrier-25442', hexerId = 'unit-p0-ashHexer-4268';
const shipCasterIds = ['unit-p0-summoner-38054', 'unit-p0-summoner-40241', 'unit-p0-summoner-41089', 'unit-p0-summoner-44159'];
const saved = (tick: number) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/carrier-${tick}-actual-before-p0.json.gz`, import.meta.url))).toString());
const originalEntries = (tick: number) => JSON.parse(readFileSync(new URL(`./fixtures/carrier-${tick}-actual-entries.json`, import.meta.url), 'utf8'));
const conflicting = (entry: any) => entry.command.type === 'cast' && shipCasterIds.includes(entry.command.unitId);
const shipSummons = (commands: any[]) => commands.filter(command => command.type === 'cast' && command.ability === 'summon' && shipCasterIds.includes(command.unitId));

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s full publisher keeps its requested shore crew floor before later summons', version => {
  const data = saved(329130), memory = structuredClone(data.memories.p0), before = JSON.stringify(data.snapshot);
  // This reuses the actual source-bound world across policy routes as a contract, not three normal matches.
  const entries = planAiOwnerCommandEntries(data.snapshot, { playerId: 'p0', source: 'external-agent', version, memory }, { teams: data.snapshot.teams });
  expect(JSON.stringify(data.snapshot)).toBe(before);
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.transportId === shipId && entry.command.unitIds.includes(hexerId))).toBe(true);
  expect(memory.naval!.ferries![shipId]!.crewIds).toContain(hexerId);
  expect(shipSummons(entries.map(entry => entry.command))).toEqual([]);
  const retained = originalEntries(329130).filter((entry: any) => !conflicting(entry));
  if (version === 'v9_summoner') expect(entries).toEqual(retained);
  else {
    // Different family scripts may publish other work, but the captured physical request and unrelated spells keep their order.
    const keys = new Set(retained.map((entry: any) => JSON.stringify(entry.command)));
    expect(entries.filter(entry => keys.has(JSON.stringify(entry.command))).map(entry => entry.command)).toEqual(retained.map((entry: any) => entry.command));
  }
});
it('keeps the original loaded-ship summons when no permanent passenger is pending', () => {
  const data = saved(329130), memory = structuredClone(data.memories.p0), before = JSON.stringify(data.snapshot);
  const options = bootstrapPolicyContext(data.snapshot, 'p0', 'v9_summoner', { memory, teams: data.snapshot.teams });
  // Before the naval script requests4268, all existing mission crew are already aboard.
  expect(memory.naval!.ferries![shipId]!.crewIds).not.toContain(hexerId);
  const commands = planBootstrapAbilities(data.snapshot, 'p0', options);
  expect(commands).toEqual(originalEntries(329130).filter((entry: any) => entry.scriptId === 'abilities').map((entry: any) => entry.command));
  expect(shipSummons(commands)).toHaveLength(4);
  expect(JSON.stringify(data.snapshot)).toBe(before);
});
it('recognizes the true native board order from the zero-step counterframe even without a new mission memory request', () => {
  const data = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/carrier-329130-native-counterframe5-after.json.gz', import.meta.url))).toString());
  const memory = structuredClone(data.memories.p0), before = JSON.stringify(data.snapshot);
  const hexer = data.snapshot.units.find((unit: any) => unit.id === hexerId);
  expect(hexer.order.type).toBe('board'); expect(hexer.deck).toBeUndefined();
  expect(memory.naval.ferries[shipId].crewIds).not.toContain(hexerId);
  const commands = planBootstrapAbilities(data.snapshot, 'p0', bootstrapPolicyContext(data.snapshot, 'p0', 'v9_summoner', { memory, teams: data.snapshot.teams }));
  expect(shipSummons(commands)).toEqual([]);
  expect(JSON.stringify(data.snapshot)).toBe(before);
});
it('preserves the original failed summon attempts on329400 when the already full floor cannot admit a pending shore crew', () => {
  const data = saved(329400), memory = structuredClone(data.memories.p0), before = JSON.stringify(data.snapshot);
  const commands = planBootstrapAbilities(data.snapshot, 'p0', bootstrapPolicyContext(data.snapshot, 'p0', 'v9_summoner', { memory, teams: data.snapshot.teams }));
  expect(commands).toEqual(originalEntries(329400).filter((entry: any) => entry.scriptId === 'abilities').map((entry: any) => entry.command));
  expect(JSON.stringify(data.snapshot)).toBe(before);
});
