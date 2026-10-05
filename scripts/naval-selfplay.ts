import { createGame, stepGame, issuePlayerCommand, snapshotGame } from '../src/shared/sim';
import { createAiRuntime, planPresetAiRuntimeCommands } from '../src/ai/runtime';
import { UNIT_DEFS, unitMover } from '../src/shared/catalog';
import { sameGround } from '../src/shared/terrain';
import { writeFileSync } from 'node:fs';
import type { MapId, AiScriptVersion, GeneratedLayoutOptions } from '../src/shared/types';
const cases: {
    map: MapId;
    players: number;
    versions: AiScriptVersion[];
    layout?: GeneratedLayoutOptions;
}[] = [
    { map: 'brokenSea', players: 4, versions: ['v5', 'v7', 'v8', 'v7'] },
    { map: 'ladder', players: 2, versions: ['v8', 'v5'], layout: { seed: 'unseen-ferry-a', idea: 'islandStarts', size: 5120 } },
    { map: 'ladder', players: 4, versions: ['v8', 'v7', 'v5', 'v8'], layout: { seed: 'unseen-ferry-b', idea: 'islandStarts', size: 7168 } },
    { map: 'gullIsland', players: 2, versions: ['v7', 'v5'] },
    { map: 'twoShores', players: 4, versions: ['v8', 'v5', 'v7', 'v8'] },
];
const reports = [];
for (const c of cases.slice(Number(process.env.SELFPLAY_START ?? 0), Number(process.env.SELFPLAY_CASES ?? cases.length))) {
    const players = Array.from({ length: c.players }, (_, i) => 'p' + (i + 1));
    const game = createGame(c.map, { players, aiPlayers: players, races: Object.fromEntries(players.map((p, i) => [p, i % 2 ? 'ember' : 'grove'])), ...(c.layout ? { layout: c.layout } : {}) });
    const origins = Object.fromEntries(game.buildings.map(h => [h.owner, { x: h.x, y: h.y }]));
    const runtime = createAiRuntime(players, { versions: Object.fromEntries(players.map((p, i) => [p, c.versions[i]!])) });
    const commands: Record<string, number> = {}, errors: Record<string, number> = {}, born: Record<string, number> = {}, seen = new Set<string>();
    const landed = new Set<string>(), ships = new Set<string>();
    const frames = [];
    for (let i = 0; i < Number(process.env.SELFPLAY_TICKS ?? 36000) && !game.match.winner; i++) {
        for (const e of planPresetAiRuntimeCommands(game, runtime).commands) {
            try {
                issuePlayerCommand(game, e.playerId, e.command);
                const k = e.command.type + (e.command.type === 'train' ? ':' + e.command.unitKind : e.command.type === 'cast' ? ':' + e.command.ability : '');
                commands[k] = (commands[k] ?? 0) + 1;
            }
            catch (error) {
                const key = e.scriptId + ':' + String(error);
                errors[key] = (errors[key] ?? 0) + 1;
            }
        }
        stepGame(game);
        for (const u of game.units) {
            if (!seen.has(u.id)) {
                seen.add(u.id);
                born[u.kind] = (born[u.kind] ?? 0) + 1;
            }
            if (unitMover(u.kind) === 'sea')
                ships.add(u.id);
            else if (u.owner !== 'neutral' && origins[u.owner] && !sameGround(game.map, u, origins[u.owner]!))
                landed.add(u.id);
        }
        if (i % 2400 === 2399) {
            const frame = { tick: game.tick, players: players.map(owner => ({ owner, gold: game.players[owner]!.gold, spent: game.match.stats.goldSpent[owner], miners: game.units.filter(u => u.owner === owner && u.kind === 'worker' && u.order.type === 'mine').length, halls: game.buildings.filter(b => b.owner === owner && b.kind === 'townHall').map(b => ({ x: Math.round(b.x), y: Math.round(b.y), complete: b.complete })), fleet: game.units.filter(u => u.owner === owner && unitMover(u.kind) === 'sea').map(u => ({ id: u.id, kind: u.kind, x: Math.round(u.x), y: Math.round(u.y), order: u.order, cargo: u.cargo?.map(c => c.kind) })), army: game.units.filter(u => u.owner === owner && u.kind !== 'worker' && unitMover(u.kind) === 'land').length })), landed: landed.size };
            frames.push(frame);
            console.log(JSON.stringify({ map: c.map, seed: c.layout?.seed, ...frame }));
        }
    }
    reports.push({ ...c, final: snapshotGame(game), tick: game.tick, winner: game.match.winner, errors, born, commands, landed: landed.size, frames, memories: runtime.memories });
    writeFileSync(process.argv[2] ?? '/workspace/scratch/naval-selfplay.json', JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ DONE: c, tick: game.tick, winner: game.match.winner, errors, born, commands, landed: landed.size }));
}
