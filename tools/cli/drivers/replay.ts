// Runs inside a copy of the repo (`sketch replay` starts it there), so a commit is probed with its own code.
// One argument: a JSON object. It plays one room-gauntlet game and prints one JSON line per sample:
//   { tick, views: { army?, general?, orders?, losses? } }
// With `save` it stops at that tick and writes the game and every AI's memory to a file; with `load` it starts from such
// a file instead of the game's start. That is how `sketch replay --fork` plays one moment on two commits.
import { readFileSync, writeFileSync } from "node:fs";
import { roomGauntlet } from "../../../src/ai/benchmark/room-gauntlet";
import { createSubjectGauntletInput } from "../../../src/ai/benchmark/subject-gauntlet";
import { runAiGameLoop, type AiGameAgent } from "../../../src/ai/game-runner";
import type { SdkGameCommandPlanner, SdkGameLoopHooks } from "../../../src/sdk/game-runner";
import type { AiPolicyMemory } from "../../../src/ai/memory";
import { createAiMemoryProvider, planAiOwnerCommandEntries } from "../../../src/ai/planner-context";
import { UNIT_DEFS } from "../../../src/shared/catalog";
import { createGame, restoreSnapshotIntoGame, snapshotGame, type Game } from "../../../src/shared/sim";
import type { GameSnapshot, PlayerId, Unit } from "../../../src/shared/types";

type Options = {
  subject: string; rival: string; seed: string; match: string;
  from: number; to: number; every: number; show: string[];
  save?: { at: number; file: string }; load?: string;
};
type SavedMoment = { tick: number; snapshot: GameSnapshot; nextId: number; activePlayers: PlayerId[]; memories: Record<PlayerId, AiPolicyMemory> };

const options = JSON.parse(process.argv[2]!) as Options;
const { input } = createSubjectGauntletInput(roomGauntlet(options.subject as never, [options.rival as never]), { seed: options.seed, mapCount: 50 });
const match = input.evaluations[0]!.matches.find((candidate) => candidate.name === options.match);
if (!match) throw new Error(`No game "${options.match}" for ${options.subject} against ${options.rival} on ${options.seed}; the names look like "ladder-11 ${options.subject} grove"`);

const memories: Record<PlayerId, AiPolicyMemory> = {};
let game: Game | undefined;
if (options.load) {
  const saved = JSON.parse(readFileSync(options.load, "utf8")) as SavedMoment;
  game = createGame(saved.snapshot.map.id, { ...(match.options ?? {}), players: saved.activePlayers, aiPlayers: saved.activePlayers, teams: saved.snapshot.teams as Record<PlayerId, string>,
    races: Object.fromEntries(saved.activePlayers.map((owner) => [owner, saved.snapshot.players[owner]!.race])) });
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  Object.assign(memories, saved.memories);
}

const memoryProvider = createAiMemoryProvider(memories);
const issued: { tick: number; owner: string; scriptId: string; type: string; units: number }[] = [];
const fighter = (unit: Unit) => unit.owner !== "neutral" && unit.kind !== "worker" && unit.attackDamage > 0 && !unit.deck;
const side = (owner: string) => owner === options.subject ? "room" : "rival";
let alive = new Map<string, { side: string; cost: number }>();
let lost: Record<string, number> = { room: 0, rival: 0 };
const round = Math.round;

function views(snapshot: GameSnapshot) {
  const out: Record<string, unknown> = {};
  if (options.show.includes("army")) {
    const fighters = snapshot.units.filter(fighter);
    out.army = Object.fromEntries(["room", "rival"].map((name) => {
      const own = fighters.filter((unit) => side(unit.owner) === name), foes = fighters.filter((unit) => side(unit.owner) !== name);
      if (own.length === 0) return [name, { units: 0 }];
      const cx = own.reduce((sum, unit) => sum + unit.x, 0) / own.length, cy = own.reduce((sum, unit) => sum + unit.y, 0) / own.length;
      const orders: Record<string, number> = {};
      for (const unit of own) orders[unit.order.type] = (orders[unit.order.type] ?? 0) + 1;
      return [name, {
        units: own.length, center: [round(cx), round(cy)],
        spread: own.filter((unit) => Math.hypot(unit.x - cx, unit.y - cy) > 500).length,
        inContact: own.filter((unit) => foes.some((foe) => Math.hypot(unit.x - foe.x, unit.y - foe.y) < 350)).length,
        hp: round(100 * own.reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0) / own.length), orders,
      }];
    }));
  }
  if (options.show.includes("general")) {
    const memory = memories[options.subject]?.v6;
    out.general = { mode: memory?.general?.mode, target: memory?.general?.target && [round(memory.general.target.x), round(memory.general.target.y)],
      leash: memory?.general?.leash, stage: memory?.general?.stage, creep: memory?.creep?.stage };
  }
  if (options.show.includes("orders")) {
    const counts: Record<string, number> = {};
    for (const command of issued.splice(0)) if (side(command.owner) === "room") counts[`${command.scriptId} ${command.type}`] = (counts[`${command.scriptId} ${command.type}`] ?? 0) + command.units;
    out.orders = counts;
  }
  if (options.show.includes("losses")) { out.losses = lost; lost = { room: 0, rival: 0 }; }
  return out;
}

const commandPlanner: SdkGameCommandPlanner<AiGameAgent> = ({ snapshot, owner, agent, source, teams }) => {
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, source, version: agent.policyVersion ?? agent.version, ...(agent.scripts ? { scripts: agent.scripts } : {}) }, { teams, memoryProvider });
  if (snapshot.tick >= options.from) for (const { command, scriptId } of entries) {
    const units = "unitIds" in command ? command.unitIds.length : "unitId" in command ? 1 : 0;
    issued.push({ tick: snapshot.tick, owner, scriptId: String(scriptId ?? "?"), type: command.type, units });
  }
  return entries;
};
const hooks: SdkGameLoopHooks = {
  beforeStep: ({ game: live }) => {
    if (live.tick < options.from || live.tick % options.every !== 0) return;
    const now = new Map<string, { side: string; cost: number }>();
    for (const unit of live.units) if (fighter(unit) && unit.expiresTick === undefined) now.set(unit.id, { side: side(unit.owner), cost: UNIT_DEFS[unit.kind].cost });
    for (const [unitId, unit] of alive) if (!now.has(unitId)) lost[unit.side] = (lost[unit.side] ?? 0) + unit.cost;
    alive = now;
    process.stdout.write(`${JSON.stringify({ tick: live.tick, views: views(snapshotGame(live)) })}\n`);
  },
};
const result = runAiGameLoop({ ...match, ...(game ? { game } : {}), maxTicks: options.save ? options.save.at : options.to, commandPlanner }, hooks);
if (options.save) {
  const live = result.game;
  const moment: SavedMoment = { tick: live.tick, snapshot: snapshotGame(live), nextId: live.nextId, activePlayers: [...live.activePlayers], memories };
  writeFileSync(options.save.file, JSON.stringify(moment));
}
