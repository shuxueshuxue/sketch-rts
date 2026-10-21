import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { cancelFerry } from '../policy/naval';
import { bindIncumbentCommands, incumbentCommandActor, inheritIncumbentCommand } from './incumbent-command-source';
import { navalFerryActor } from './incumbent-actors';

describe('actual incumbent command producers', () => {
  it('keeps origin outside command bytes and propagates it only to an admitted subset of that proposal', () => {
    const command: GameCommand = { type: 'move', unitIds: ['one', 'two'], x: 10, y: 20 }, before = JSON.stringify(command);
    const actor = { source: 'landExpansion', taskId: 'expansion:mine:10' };
    expect(bindIncumbentCommands([command], actor)).toEqual([command]);
    expect(JSON.stringify(command)).toBe(before);
    expect(incumbentCommandActor(inheritIncumbentCommand(command, { ...command, unitIds: ['two'] }))).toEqual(actor);
    expect(incumbentCommandActor({ ...command })).toBeUndefined();
  });

  it('tags the real ringwater ferry branch with its actual mission, including its passenger orders', () => {
    const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
      new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Nd-ringwater-enemy-14010'];
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const ship = frame.snapshot.units.find(unit => unit.id === 'unit-enemy-transport-2302')!;
    const mission = frame.memory.naval!.ferries![ship.id]!;
    const commands = cancelFerry(frame.snapshot, ship, mission, { memory: frame.memory }, 'higher-priority-preemption');
    const marked = commands.filter(command => incumbentCommandActor(command)?.source === 'naval.ferries');
    expect(marked.length).toBeGreaterThan(0);
    for (const command of marked) {
      const actor = incumbentCommandActor(command)!;
      expect(Object.entries(frame.memory.naval!.ferries!).some(([shipId, task]) => {
        const source = navalFerryActor(shipId, task.sinceTick);
        return source.source === actor.source && source.taskId === actor.taskId;
      })).toBe(true);
    }
  });
});
