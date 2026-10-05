import { createGame, stepGame, issuePlayerCommand } from '../src/shared/sim';
import { createAiRuntime, planPresetAiRuntimeCommands } from '../src/ai/runtime';
import { writeFileSync } from 'node:fs';
import type { MapId, AiScriptVersion } from '../src/shared/types';
const reports = [];
for (const map of ['pineshade', 'gullIsland', 'elderwood', 'twoShores'] as MapId[])
    for (const version of ['v5', 'v7', 'v8'] as AiScriptVersion[]) {
        const players = map === 'elderwood' || map === 'twoShores' ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
        const game = createGame(map, { players, aiPlayers: players, races: Object.fromEntries(players.map((p, i) => [p, i % 2 ? 'ember' : 'grove'])) });
        const runtime = createAiRuntime(players, { version });
        const errors: Record<string, number> = {};
        const frames = [];
        for (let i = 0; i < 10000 && !game.match.winner; i++) {
            for (const e of planPresetAiRuntimeCommands(game, runtime).commands) {
                try {
                    issuePlayerCommand(game, e.playerId, e.command);
                }
                catch (error) {
                    const key = e.scriptId + ':' + String(error);
                    errors[key] = (errors[key] ?? 0) + 1;
                }
            }
            stepGame(game);
            if (i % 1200 === 1199)
                frames.push({ tick: game.tick, players: players.map(owner => ({ owner, gold: game.players[owner]!.gold, spent: game.match.stats.goldSpent[owner], workers: game.units.filter(u => u.owner === owner && u.kind === 'worker').map(u => u.order.type), plans: game.units.filter(u => u.owner === owner && u.order.type === 'build').map(u => u.order), buildings: game.buildings.filter(b => b.owner === owner).map(b => [b.kind, b.complete]) })) });
        }
        const report = { map, version, winner: game.match.winner, tick: game.tick, errors, frames };
        reports.push(report);
        console.log(JSON.stringify({ map, version, winner: game.match.winner, tick: game.tick, errors, latest: frames.at(-1) }));
        writeFileSync(process.argv[2] ?? '/workspace/scratch/skirmish-audit.json', JSON.stringify(reports, null, 2));
    }
