import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBenchmarkMatch, type BenchmarkTracker } from '../src/sdk/benchmark/core';
import { snapshotGame } from '../src/shared/sim';
import { SIM_TICKS_PER_SECOND } from '../src/shared/time';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import type { RoomAiVersion } from '../src/shared/types';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { AiGameAgent } from '../src/ai/game-runner';
import { createNavalRoomInput, type NavalRoomMatch } from '../src/ai/benchmark/naval-room';
import { navalObservedPlanner } from '../src/ai/benchmark/naval-room-worker';
import { createNavalMetricsTracker } from '../src/ai/benchmark/naval-metrics';
import { csvFlag, flag, requiredFlag } from './benchmark-cli';

const args = process.argv.slice(2);
const rival = requiredFlag(args, 'rival');
if (rival !== 'v8' && rival !== 'v9') throw new Error('--rival must be v8 or v9');
const subject = requiredFlag(args, 'subject') as RoomAiVersion;
if (!ROOM_AI_VERSIONS.includes(subject)) throw new Error(`Unknown subject ${subject}`);
const name = requiredFlag(args, 'match');
const owner = flag(args, 'owner');
const seconds = csvFlag(args, 'seconds').map(Number);
if (!seconds.every(second => Number.isInteger(second) && second > 0)) throw new Error('--seconds must be positive whole seconds');
const outDir = resolve(requiredFlag(args, 'out-dir'));
mkdirSync(outDir, { recursive: true });
const input = createNavalRoomInput({ rival, subjects: [subject], maps: [name.split(' ')[0]!], maxTicks: Math.max(...seconds) * SIM_TICKS_PER_SECOND });
const match = input.evaluations[0]!.matches.find(match => match.name === name) as NavalRoomMatch | undefined;
if (!match) throw new Error(`Unknown match ${name}`);
const memories: Record<string, AiPolicyMemory> = {};
const commands: unknown[] = [];
const trace: BenchmarkTracker<AiGameAgent> = {
  id: 'navalTrace',
  onCommand(_state, { tick, owner: who, scriptId, command }) {
    if ((!owner || owner === who) && (scriptId === 'naval' || ['board', 'unload', 'train', 'buyShipEquipment', 'build'].includes(command.type))) commands.push({ second: tick / SIM_TICKS_PER_SECOND, owner: who, scriptId, command });
  },
  afterStep(_state, { game }) {
    if (!seconds.includes(game.tick / SIM_TICKS_PER_SECOND)) return;
    writeFileSync(join(outDir, `${game.tick / SIM_TICKS_PER_SECOND}.json`), JSON.stringify({ name, snapshot: snapshotGame(game), memories: structuredClone(memories), commands }));
  },
  finish: () => ({ commands }),
};
const report = runBenchmarkMatch({ ...match, commandPlanner: navalObservedPlanner(memories) }, [trace, createNavalMetricsTracker({ memory: who => memories[who], sampleSeconds: 10 }) as never]);
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report));
console.log(JSON.stringify({ name, seconds: report.result.gameSecond, winnerTeam: report.result.winnerTeam, outDir }));
