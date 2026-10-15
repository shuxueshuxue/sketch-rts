import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { sameGround, walkingDistance } from '../../shared/terrain';
import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

function checkpoint(tick: number) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/archer-landed-before-think-${tick}.json.gz`, import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  expect(snapshotGame(game)).toEqual(saved.snapshot);
  expect(saved.memories.p1).toBeDefined();
  return { game, saved };
}

it.each(BOOTSTRAP_VERSIONS)('%s gives the landed army local focus orders through its naval owner', version => {
  const { game, saved } = checkpoint(100650), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: structuredClone(saved.memories.p0) }, { teams: game.teams });
  const archerIds = new Set(snapshot.units.filter(unit => unit.owner === 'p0' && !unit.deck && unit.kind === 'archer').map(unit => unit.id));
  expect(entries.some(({ scriptId, command }) => scriptId === 'naval' && command.type === 'attack'
    && command.unitIds.some(id => archerIds.has(id)))).toBe(true);
  for (const { command } of entries) if (command.type === 'attack') {
    expect(command.unitIds.every(id => !UNIT_DEFS[snapshot.units.find(unit => unit.id === id)!.kind].abilities
      .some(ability => ABILITY_DEFS[ability].behavior === 'heal'))).toBe(true);
  }
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s keeps landed tactical moves on an actual ground road', version => {
  const { game, saved } = checkpoint(100800), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const hall = snapshot.buildings.find(building => building.id === 'building-p1-townhall')!;
  const landed = new Set(snapshot.units.filter(unit => unit.owner === 'p0' && !unit.deck && sameGround(snapshot.map, unit, hall)).map(unit => unit.id));
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: structuredClone(saved.memories.p0) }, { teams: game.teams });
  for (const { scriptId, command } of entries) if (scriptId === 'naval' && command.type === 'move') {
    for (const id of command.unitIds.filter(id => landed.has(id))) {
      const unit = snapshot.units.find(unit => unit.id === id)!;
      expect(sameGround(snapshot.map, unit, command)).toBe(true);
      expect(walkingDistance(snapshot.map, unit, command, 'land')).toBeDefined();
    }
  }
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s keeps the real wounded pair and their medics out of local focus', version => {
  const { game, saved } = checkpoint(100650), snapshot = snapshotGame(game);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: structuredClone(saved.memories.p0) }, { teams: game.teams });
  for (const id of ['unit-p0-archer-2384', 'unit-p0-archer-2849']) {
    expect(entries.some(({ scriptId, command }) => scriptId === 'naval' && command.type === 'move'
      && command.avoidCombat && command.unitIds.includes(id))).toBe(true);
    expect(entries.some(({ command }) => command.type === 'attack' && command.unitIds.includes(id))).toBe(false);
  }
  for (const id of ['unit-p0-priest-2370', 'unit-p0-priest-7778']) {
    expect(entries.some(({ scriptId, command }) => scriptId === 'naval' && command.type === 'holdPosition'
      && command.unitIds.includes(id))).toBe(true);
  }
});

it.each(BOOTSTRAP_VERSIONS)('%s screens the real landed priests locally before they have a care assignment', version => {
  const { game, saved } = checkpoint(100410), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: structuredClone(saved.memories.p0) }, { teams: game.teams });
  for (const id of ['unit-p0-priest-2370', 'unit-p0-priest-7778']) {
    const step = entries.find(({ scriptId, command }) => scriptId === 'naval' && command.type === 'move' && command.unitIds.includes(id))?.command;
    expect(step?.type).toBe('move');
    if (step?.type !== 'move') throw Error('Missing local backline move');
    const unit = snapshot.units.find(unit => unit.id === id)!;
    expect(sameGround(snapshot.map, unit, step)).toBe(true);
    expect(walkingDistance(snapshot.map, unit, step, 'land')).toBeDefined();
    expect(entries.some(({ command }) => command.type === 'attack' && command.unitIds.includes(id))).toBe(false);
  }
  expect(JSON.stringify(snapshot)).toBe(before);
});
