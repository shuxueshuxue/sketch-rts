import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

const carrierId = 'unit-p0-carrier-25442', transportId = 'unit-p0-transport-157929';
const crewIds = ['unit-p0-priest-3174', 'unit-p0-priest-32497'];
function actual(tick: number) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/ground-evacuation-${tick}.json.gz`, import.meta.url))).toString());
}

it.each(BOOTSTRAP_VERSIONS)('%s does not create a ground evacuation pickup for healthy embarked priests', version => {
  const saved = actual(279885), snapshot = saved.snapshot, before = JSON.stringify(saved);
  const memories = structuredClone(saved.memories);
  expect(memories.p0.naval.ferries).toEqual({});
  for (const id of crewIds) {
    expect(snapshot.units.find((unit: { id: string }) => unit.id === id)).toMatchObject({
      hp: 90, maxHp: 90, deck: { shipId: 'unit-p0-warship-33582' },
    });
  }
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, source: 'external-agent' }, {
    teams: snapshot.teams, memoryProvider: createAiMemoryProvider(memories),
  });
  expect(memories.p0.naval.ferries[carrierId]?.purpose).not.toBe('evacuate');
  expect(entries.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes(carrierId)
    && entry.command.x === 5973.267490678202 && entry.command.y === 7937.418812846293)).toBe(false);
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.unitIds.some(id => crewIds.includes(id)))).toBe(false);
  expect(memories.p1).toEqual(saved.memories.p1);
  expect(memories.p2).toEqual(saved.memories.p2);
  expect(JSON.stringify(saved)).toBe(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s does not dispatch another empty ferry to already embarked priests', version => {
  const saved = actual(281190), snapshot = saved.snapshot, before = JSON.stringify(saved);
  const memories = structuredClone(saved.memories), inherited = structuredClone(memories.p0.naval.ferries[carrierId]);
  expect(inherited).toMatchObject({ purpose: 'evacuate', phase: 'loading', crewIds: [], sinceTick: 279885 });
  planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, source: 'external-agent' }, {
    teams: snapshot.teams, memoryProvider: createAiMemoryProvider(memories),
  });
  expect(memories.p0.naval.ferries[transportId]?.purpose).not.toBe('evacuate');
  // This candidate admission change preserves the real input's already stored
  // mission; it does not claim to repair historical ferry memory.
  expect(memories.p0.naval.ferries[carrierId]).toEqual(inherited);
  expect(memories.p1).toEqual(saved.memories.p1);
  expect(memories.p2).toEqual(saved.memories.p2);
  expect(JSON.stringify(saved)).toBe(before);
});
