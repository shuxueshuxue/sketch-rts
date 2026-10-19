// Capture each game sequentially from the pre-change main source. Do not regenerate goldens on the candidate.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: capture-ai.mts <main-a2cff607-source-root> <output-directory>');
const root = resolve(process.argv[2]);
const outputDirectory = resolve(process.argv[3]);
const load = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { createRoom, roomToGameSetup } = await load('src/shared/rooms.ts');
const { runAiGameLoop } = await load('src/ai/game-runner.ts');
const { checksumGame } = await load('src/shared/sim/checksum.ts');
mkdirSync(outputDirectory, { recursive: true });
for (const [subject, rival, race] of [['v9_archer', 'v8', 'grove'], ['v9_summoner', 'v9', 'ember'], ['v9_knight', 'v8', 'grove']]) {
  const room = createRoom({ id: 'guard-proof', host: { id: 'host', name: 'Proof' }, mapId: 'bareDuel', humanCount: 1, aiCount: 1,
    seatSetup: [{ controller: 'ai', team: 'a', race, aiVersion: subject }, { controller: 'ai', team: 'b', race: 'ember', aiVersion: rival }] });
  const setup = roomToGameSetup(room);
  setup.options.scenario = { addUnits: setup.playerSlots.flatMap((slot: any, side: number) =>
    Array.from({ length: 4 }, (_, i) => ({ id: `contact-${side}-${i}`, owner: slot.playerId,
      kind: i % 2 ? 'archer' : 'footman', x: 1500 + side * 210, y: 1450 + i * 50 }))) };
  const agents = Object.fromEntries(setup.playerSlots.map((s: any) => [s.playerId, { controller: 'internal-ai', team: setup.options.teams[s.playerId], race: s.race,
    version: s.playerId === setup.playerSlots[0].playerId ? subject : rival }]));
  const commands: any[] = [], checksums: string[] = [];
  let automaticTicks = 0;
  runAiGameLoop({ name: `guard-${subject}`, mapId: setup.mapId, options: setup.options, agents, maxTicks: 2400, thinkInterval: 15 }, {
    beforeLoop({game}: any) { checksums.push(checksumGame(game)); },
    onCommand({tick, owner, command}: any) { commands.push({ tick, owner, command }); },
    onStep({game}: any) { checksums.push(checksumGame(game)); automaticTicks += Number(game.units.some((u: any) => u.owner !== 'neutral' && u.order.type === 'attack' && u.order.leashX !== undefined)); },
  });
  const output = { base: 'a2cff607', name: subject, mapId: setup.mapId, options: setup.options, agents, automaticTicks, commands, checksums };
  writeFileSync(`${outputDirectory}/guard-ai-${subject}.json`, JSON.stringify(output) + '\n');
  console.log(JSON.stringify({ subject, ticks: checksums.length - 1, commands: commands.length, automaticTicks }));
}
