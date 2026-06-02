import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyInteractivePlaytestCommand, createInteractivePlaytestSession, restoreInteractivePlaytestSession, serializeInteractivePlaytestSession, summarizeInteractivePlaytestSession, type InteractivePlaytestCommand, type InteractiveUnitSelector, type SerializedInteractivePlaytestSession } from "../src/sdk/playtest";
import { createAiInteractivePlaytestRuntime, stepAiInteractivePlaytestSession } from "../src/ai/playtest";
import type { AiRuntimeState } from "../src/ai/runtime";
import type { AiScriptVersion, BuildingKind, GameCommand, MapId, PlayerId, TrainableUnitKind, UpgradeKind } from "../src/shared/types";

type AiPlaytestFile = {
  session: SerializedInteractivePlaytestSession;
  runtime: AiRuntimeState;
};

const [verb, ...args] = process.argv.slice(2);
if (!verb || verb === "help" || verb === "--help") {
  printHelp();
  process.exit(verb ? 0 : 1);
}

if (verb === "new") {
  const file = requiredFlag(args, "file");
  const mapId = (flag(args, "map") ?? "bareDuel") as MapId;
  const controlledPlayer = flag(args, "you") ?? "v2";
  const enemy = flag(args, "enemy") ?? "v1a";
  const enemyVersion = (flag(args, "enemy-version") ?? "v1") as AiScriptVersion;
  const thinkInterval = numberFlag(args, "think-interval", 45);
  const session = createInteractivePlaytestSession({
    id: flag(args, "id") ?? `interactive-${mapId}-${Date.now()}`,
    mapId,
    controlledPlayer,
    scriptedPlayers: [enemy],
    options: {
      players: [controlledPlayer, enemy],
      teams: { [controlledPlayer]: "north", [enemy]: "south" },
    },
  });
  const runtime = createAiInteractivePlaytestRuntime(session, { version: enemyVersion, thinkInterval });
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime });
  printJson(summarizeInteractivePlaytestSession(session));
  process.exit(0);
}

const file = requiredFlag(args, "file");
const loaded = loadPlaytestFile(file);
const session = restoreInteractivePlaytestSession(loaded.session);

if (verb === "status") {
  printJson(summarizeInteractivePlaytestSession(session));
  process.exit(0);
}

if (verb === "step") {
  stepAiInteractivePlaytestSession(session, loaded.runtime, numberFlag(args, "ticks", 45));
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
  printJson(summarizeInteractivePlaytestSession(session));
  process.exit(0);
}

const command = commandFromArgs(verb, args);
applyInteractivePlaytestCommand(session, command);
savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
printJson(summarizeInteractivePlaytestSession(session));

function commandFromArgs(verb: string, args: string[]): InteractivePlaytestCommand {
  if (verb === "raw") return { type: "raw", owner: flag(args, "owner"), command: JSON.parse(requiredFlag(args, "json")) as GameCommand };
  if (verb === "move") return { type: "move", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "gather") return { type: "gatherArmy", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "attack-move") return { type: "attackMove", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "focus") return { type: "focusFire", unitIds: unitSelector(args), targetId: requiredFlag(args, "target") };
  if (verb === "retreat") return { type: "retreat", unitIds: unitSelector(args), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) };
  if (verb === "mine") return { type: "mine", unitIds: unitSelector(args), ...(flag(args, "resource") ? { resourceId: requiredFlag(args, "resource") } : {}) };
  if (verb === "repair") return { type: "repair", unitIds: unitSelector(args), buildingId: requiredFlag(args, "building") };
  if (verb === "build") return { type: "build", unitId: flag(args, "unit"), buildingKind: requiredFlag(args, "kind") as BuildingKind, x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "train") return { type: "train", buildingId: flag(args, "building"), unitKind: requiredFlag(args, "unit-kind") as TrainableUnitKind };
  if (verb === "research") return { type: "research", buildingId: flag(args, "building"), upgradeKind: requiredFlag(args, "upgrade") as UpgradeKind };
  if (verb === "hire") return { type: "hire", campId: requiredFlag(args, "camp") };
  if (verb === "use-item") return { type: "useItem", unitId: flag(args, "unit"), itemId: requiredFlag(args, "item"), ...(flag(args, "target") ? { targetId: requiredFlag(args, "target") } : {}), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) };
  throw new Error(`Unknown ai playtest command ${verb}`);
}

function loadPlaytestFile(file: string): AiPlaytestFile {
  return JSON.parse(readFileSync(file, "utf8")) as AiPlaytestFile;
}

function savePlaytestFile(file: string, value: AiPlaytestFile) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function unitSelector(args: string[]): InteractiveUnitSelector | undefined {
  const raw = flag(args, "units");
  if (!raw) return undefined;
  if (raw === "all" || raw === "combat" || raw === "workers") return raw;
  return raw.split(",").filter(Boolean);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function numberFlag(args: string[], name: string, value: number): number {
  const raw = flag(args, name);
  if (raw === undefined) return value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number`);
  return parsed;
}

function requiredNumberFlag(args: string[], name: string): number {
  requiredFlag(args, name);
  return numberFlag(args, name, Number.NaN);
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage:
  npm run play:ai -- new --file .playtests/duel.json --map bareDuel --you v2 --enemy v1a
  npm run play:ai -- status --file .playtests/duel.json
  npm run play:ai -- step --file .playtests/duel.json --ticks 45
  npm run play:ai -- attack-move --file .playtests/duel.json --units combat --x 2048 --y 2048
  npm run play:ai -- focus --file .playtests/duel.json --target unit-v1a-worker-1
  npm run play:ai -- raw --file .playtests/duel.json --json '{"type":"move","unitIds":["unit-v2-worker-1"],"x":500,"y":500}'`);
}
