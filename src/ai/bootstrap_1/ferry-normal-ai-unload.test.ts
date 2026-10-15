import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { currentBerthLandings, passengerLandingSpot } from '../../shared/naval';
import { shipPassengers } from '../../shared/ship-geometry';
import { sameGround } from '../../shared/terrain';
import { planAiOwnerCommandEntries } from '../planner-context';

it('lands the actual sailing assault from the normal-AI 103935 trigger with exact JSON command and output restoration', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ferry-normal-ai-trigger-103935.json.gz', import.meta.url))).toString());
  expect(saved.provenance.classification).toContain('Normal full-AI changed-code continuation');
  expect(saved.provenance.rulesVersion).toBe(2);
  const load = () => {
    const checkpoint = JSON.parse(JSON.stringify(saved));
    const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, checkpoint.snapshot, checkpoint.nextId);
    return { game, memories: checkpoint.memories };
  };
  const branches = [load(), load()], id = 'unit-p0-carrier-3777';
  const originalMission = structuredClone(saved.memories.p0.naval.ferries[id]);
  expect(originalMission).toMatchObject({ purpose: 'assault', phase: 'sailing',
    targetId: 'building-p1-shipyard-1016', to: { x: 2192, y: 6096 } });
  const outputs = [];
  for (const { game, memories } of branches) {
    const boat = game.units.find(unit => unit.id === id)!, originalOrder = structuredClone(boat.order);
    expect(originalOrder).toEqual({ type: 'unload', ...originalMission.to });
    const before = JSON.stringify(snapshotGame(game)), snapshot = snapshotGame(game);
    const landings = currentBerthLandings(snapshot.map, snapshot.units.find(unit => unit.id === id)!, originalMission.to, snapshot.units);
    expect(landings).toHaveLength(14);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory: memories.p0 }, { teams: game.teams });
    // The benchmark runner adds this provenance tag after the planner;
    // compare every planner entry field and command against the real trace.
    expect(entries).toEqual(saved.expectedEntries.map((entry: Record<string, unknown>) => {
      const { source, ...planned } = entry; expect(source).toBe('external-agent'); return planned;
    }));
    expect(memories.p0).toEqual(saved.expectedMemoryAfter);
    expect(memories.p1).toEqual(saved.memories.p1);
    expect(JSON.stringify(snapshotGame(game))).toBe(before);
    const portraits = entries.filter(entry => entry.command.type === 'unloadPassenger');
    expect(portraits).toHaveLength(14);
    expect(portraits.map(entry => entry.command.type === 'unloadPassenger' && entry.command.passengerId))
      .toEqual(landings.map(landing => landing.passengerId));
    const initialHp = new Map(shipPassengers(game.units, boat).map(unit => [unit.id, unit.hp]));
    for (const entry of entries) {
      if (entry.command.type === 'unloadPassenger') {
        const command = entry.command, expected = landings.find(landing => landing.passengerId === command.passengerId)!;
        expect(command.transportId).toBe(id);
        expect(passengerLandingSpot(game.map, boat, command.passengerId, game.units)).toEqual(expected.point);
        issuePlayerCommand(game, 'p0', command);
        const passenger = game.units.find(unit => unit.id === command.passengerId)!;
        expect(passenger.deck).toBeUndefined(); expect(passenger.cabin).toBeUndefined();
        expect({ x: passenger.x, y: passenger.y }).toEqual(expected.point);
        expect(passenger.hp).toBe(initialHp.get(passenger.id));
        expect(sameGround(game.map, originalMission.to, passenger)).toBe(true);
        expect(boat.order).toEqual(originalOrder);
      } else issuePlayerCommand(game, 'p0', entry.command);
    }
    expect(shipPassengers(game.units, boat)).toHaveLength(0);
    expect(memories.p0.naval.ferries[id]).toMatchObject({ phase: 'sailing',
      from: originalMission.from, to: originalMission.to, targetId: originalMission.targetId });
    outputs.push({ snapshot: snapshotGame(game), nextId: game.nextId, memories });
  }
  expect(outputs[1]).toEqual(outputs[0]);
  // Both complete public command outputs continue through the same native tick.
  for (const branch of branches) stepGame(branch.game);
  expect(snapshotGame(branches[1]!.game)).toEqual(snapshotGame(branches[0]!.game));
  expect(branches[1]!.game.nextId).toBe(branches[0]!.game.nextId);
});
