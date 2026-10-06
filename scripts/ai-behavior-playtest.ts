import { writeFileSync } from "node:fs";
import { createAiRuntime, planPresetAiRuntimeCommands } from "../src/ai/runtime";
import { unitMover } from "../src/shared/catalog";
import { createGame, issuePlayerCommand, stepGame } from "../src/shared/sim";
import { sameGround } from "../src/shared/terrain";
import type { AiScriptVersion, GeneratedLayoutOptions, MapId } from "../src/shared/types";

// Development observations, never inputs to a policy. No rank, win rate, or opponent-specific tuning objective.
const cases: { name: string; map: MapId; versions: AiScriptVersion[]; teams?: string[]; layout?: GeneratedLayoutOptions }[] = [
  { name: "land-duel", map: "pineshade", versions: ["v5", "v7"] },
  { name: "mixed-teams", map: "elderwood", versions: ["v8", "v5", "v7", "v8"], teams: ["a", "a", "b", "b"] },
  { name: "unseen-land", map: "ladder", versions: ["v7", "v8", "v5"] , layout: { seed: "humanize-generalization-2026-10-05", size: 5120 } },
  { name: "naval-ffa", map: "brokenSea", versions: ["v5", "v7", "v8", "v7"] },
  { name: "unseen-islands", map: "ladder", versions: ["v8", "v5"], layout: { seed: "humanize-ferry-2026-10-05", idea: "islandStarts", size: 5120 } },
];
const arg = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const limit = Number(arg("ticks", "24000"));
const selected = arg("case", "all");
const reports = [];
for (const c of cases.filter(c => selected === "all" || c.name === selected)) {
  const players = c.versions.map((_, i) => `p${i + 1}`);
  const game = createGame(c.map, {
    players, aiPlayers: players,
    races: Object.fromEntries(players.map((owner, i) => [owner, i % 2 ? "ember" : "grove"])),
    ...(c.teams ? { teams: Object.fromEntries(players.map((owner, i) => [owner, c.teams![i]!])) } : {}),
    ...(c.layout ? { layout: c.layout } : {}),
  });
  const runtime = createAiRuntime(players, { versions: Object.fromEntries(players.map((owner, i) => [owner, c.versions[i]!])) });
  const commands: Record<string, number> = {}, errors: Record<string, number> = {}, modes: Record<string, number> = {};
  const frames = [];
  const unitKinds: Record<string, number> = {};
  const seenUnits = new Set<string>();
  const errorExamples: unknown[] = [];
  const origins = Object.fromEntries(game.buildings.filter(base => base.kind === "townHall").map(base => [base.owner, base]));
  const landed = new Set<string>();
  for (let tick = 0; tick < limit && !game.match.winner; tick++) {
    for (const entry of planPresetAiRuntimeCommands(game, runtime).commands) {
      const key = `${entry.scriptId}:${entry.command.type}${entry.command.type === "cast" ? `:${entry.command.ability}` : ""}`;
      commands[key] = (commands[key] ?? 0) + 1;
      try { issuePlayerCommand(game, entry.playerId, entry.command); }
      catch (error) { const key = `${entry.scriptId}:${String(error)}`; errors[key] = (errors[key] ?? 0) + 1; if (errorExamples.length < 10) errorExamples.push({ tick: game.tick, owner: entry.playerId, gold: game.players[entry.playerId]!.gold, command: entry.command, error: String(error) }); }
    }
    stepGame(game);
    for (const unit of game.units) if (unit.owner !== "neutral" && !seenUnits.has(unit.id)) {
      seenUnits.add(unit.id);
      const key = `${unit.owner}:${unit.kind}`;
      unitKinds[key] = (unitKinds[key] ?? 0) + 1;
    }
    if (tick % 600 !== 599) continue;
    for (const unit of game.units) if (unit.owner !== "neutral" && unitMover(unit.kind) === "land" && origins[unit.owner] && !sameGround(game.map, unit, origins[unit.owner]!)) landed.add(unit.id);
    const observations = players.map(owner => {
      const memory = runtime.memories[owner]!;
      const mode = memory.support ? "support" : memory.v6?.general?.mode ?? "shared";
      modes[`${owner}:${mode}`] = (modes[`${owner}:${mode}`] ?? 0) + 1;
      const army = game.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land");
      return { owner, gold: Math.round(game.players[owner]!.gold), army: army.length, kinds: Object.fromEntries([...new Set(army.map(unit => unit.kind))].map(kind => [kind, army.filter(unit => unit.kind === kind).length])), fighting: army.filter(unit => unit.order.type === "attack" || unit.order.type === "charge").length, idle: army.filter(unit => unit.order.type === "idle" || unit.order.type === "hold").length, mode,
        halls: game.buildings.filter(base => base.owner === owner && base.kind === "townHall").length,
        support: memory.support?.baseId,
        ferries: Object.values(memory.naval?.ferries ?? {}).map(ferry => `${ferry.purpose}:${ferry.phase}`),
        fleet: game.units.filter(unit => unit.owner === owner && unitMover(unit.kind) === "sea").map(unit => ({ kind: unit.kind, order: unit.order, cargo: unit.cargo?.map(passenger => passenger.kind) })),
        cargo: game.units.filter(unit => unit.owner === owner).reduce((n, unit) => n + (unit.cargo?.length ?? 0), 0) };
    });
    frames.push({ tick: game.tick, players: observations });
  }
  const report = { ...c, tick: game.tick, ended: Boolean(game.match.winner), commands, errors, errorExamples, unitKinds, modes, landed: landed.size, frames, stats: game.match.stats };
  reports.push(report);
  writeFileSync(arg("output", "/tmp/ai-behavior-playtest.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ name: c.name, tick: game.tick, ended: report.ended, errors, unitKinds, modes, landed: landed.size, commands }));
}
if (!reports.length) throw new Error(`Unknown playtest case: ${selected}`);
if (reports.some(report => Object.keys(report.errors).length)) process.exitCode = 1;
