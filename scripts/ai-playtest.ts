import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInteractivePlaytestSession, restoreInteractivePlaytestSession, serializeInteractivePlaytestSession, type InteractivePlaytestCommand, type InteractivePlaytestCondition, type InteractivePlaytestUnitInspectionOwner, type InteractiveUnitSelector, type SerializedInteractivePlaytestSession } from "../src/sdk/playtest";
import { applyAiInteractivePlaytestCommand, createAiInteractivePlaytestRuntime, inspectAiInteractivePlaytestUnits, stepAiInteractivePlaytestSession, stepAiInteractivePlaytestUntil, summarizeAiInteractivePlaytestSession } from "../src/ai/playtest";
import { createCombatScenarioSetup, type CombatScenarioLabel } from "../src/sdk/scenarios/combat";
import type { AiRuntimeState } from "../src/ai/runtime";
import type { SdkWinnerMode } from "../src/sdk/winner-mode";
import type { AiScriptVersion, BuildingKind, GameCommand, GameSetupOptions, MapId, PlayerId, TrainableUnitKind, UpgradeKind } from "../src/shared/types";

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
  const controlledPlayer = flag(args, "you") ?? "v2";
  const enemy = flag(args, "enemy") ?? "v1a";
  const setup = playtestSetupFromArgs(args, controlledPlayer, enemy);
  const controlledVersion = (flag(args, "you-version") ?? "v2") as AiScriptVersion;
  const enemyVersion = (flag(args, "enemy-version") ?? "v1") as AiScriptVersion;
  const thinkInterval = numberFlag(args, "think-interval", 45);
  const assistControlled = boolFlag(args, "assist-you");
  const session = createInteractivePlaytestSession({
    id: flag(args, "id") ?? `interactive-${setup.mapId}-${Date.now()}`,
    mapId: setup.mapId,
    controlledPlayer,
    scriptedPlayers: [enemy],
    winnerMode: setup.winnerMode,
    options: setup.options,
  });
  const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled, thinkInterval, versions: { [controlledPlayer]: controlledVersion, [enemy]: enemyVersion }, ...(setup.policyMode ? { policyMode: setup.policyMode } : {}) });
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime });
  printJson(summarizeAiInteractivePlaytestSession(session, runtime));
  process.exit(0);
}

const file = requiredFlag(args, "file");
const loaded = loadPlaytestFile(file);
const session = restoreInteractivePlaytestSession(loaded.session);

if (verb === "status") {
  printJson(summarizeAiInteractivePlaytestSession(session, loaded.runtime));
  process.exit(0);
}

if (verb === "memory") {
  printJson(loaded.runtime.memories);
  process.exit(0);
}

if (verb === "inspect-units") {
  printJson(inspectAiInteractivePlaytestUnits(session, loaded.runtime, { owner: unitInspectionOwnerFlag(args) }));
  process.exit(0);
}

if (verb === "step") {
  stepAiInteractivePlaytestSession(session, loaded.runtime, numberFlag(args, "ticks", 45));
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
  printJson(summarizeAiInteractivePlaytestSession(session, loaded.runtime));
  process.exit(0);
}

if (verb === "step-until") {
  const result = stepAiInteractivePlaytestUntil(session, loaded.runtime, conditionFromArgs(args), { maxTicks: numberFlag(args, "max-ticks", 240) });
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
  printJson({ result, summary: summarizeAiInteractivePlaytestSession(session, loaded.runtime) });
  process.exit(result.conditionMet ? 0 : 1);
}

const command = commandFromArgs(verb, args);
applyAiInteractivePlaytestCommand(session, loaded.runtime, command);
savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
printJson(summarizeAiInteractivePlaytestSession(session, loaded.runtime));

function commandFromArgs(verb: string, args: string[]): InteractivePlaytestCommand {
  if (verb === "raw") return { type: "raw", owner: flag(args, "owner"), command: JSON.parse(requiredFlag(args, "json")) as GameCommand };
  if (verb === "move") return { type: "move", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "gather") return { type: "gatherArmy", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "attack-move") return { type: "attackMove", unitIds: unitSelector(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "focus") return { type: "focusFire", unitIds: unitSelector(args), targetId: requiredFlag(args, "target") };
  if (verb === "focus-near") return { type: "focusFireNear", unitIds: unitSelector(args), targetId: requiredFlag(args, "target"), ...(flag(args, "join-range") ? { joinRange: requiredNumberFlag(args, "join-range") } : {}) };
  if (verb === "retreat") return { type: "retreat", unitIds: unitSelector(args), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) };
  if (verb === "retreat-wounded") return { type: "retreatWounded", unitIds: unitSelector(args), hpRatio: numberFlag(args, "hp-ratio", 0.5), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) };
  if (verb === "mine") return { type: "mine", unitIds: unitSelector(args), ...(flag(args, "resource") ? { resourceId: requiredFlag(args, "resource") } : {}) };
  if (verb === "repair") return { type: "repair", unitIds: unitSelector(args), buildingId: requiredFlag(args, "building") };
  if (verb === "expand") return { type: "expand", unitId: flag(args, "unit"), ...(flag(args, "resource") ? { resourceId: requiredFlag(args, "resource") } : {}) };
  if (verb === "creep-camp") return { type: "creepCamp", campId: flag(args, "camp"), unitIds: unitSelector(args) };
  if (verb === "build") return { type: "build", unitId: flag(args, "unit"), buildingKind: requiredFlag(args, "kind") as BuildingKind, x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") };
  if (verb === "train") return { type: "train", buildingId: flag(args, "building"), unitKind: requiredFlag(args, "unit-kind") as TrainableUnitKind };
  if (verb === "research") return { type: "research", buildingId: flag(args, "building"), upgradeKind: requiredFlag(args, "upgrade") as UpgradeKind };
  if (verb === "hire") return { type: "hire", campId: requiredFlag(args, "camp") };
  if (verb === "use-item") return { type: "useItem", unitId: flag(args, "unit"), itemId: requiredFlag(args, "item"), ...(flag(args, "target") ? { targetId: requiredFlag(args, "target") } : {}), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) };
  throw new Error(`Unknown ai playtest command ${verb}`);
}

function playtestSetupFromArgs(args: string[], controlledPlayer: PlayerId, enemy: PlayerId): { mapId: MapId; options: GameSetupOptions; policyMode?: "melee" | "combat"; winnerMode?: SdkWinnerMode } {
  const setup = flag(args, "setup");
  if (setup === undefined) {
    return {
      mapId: (flag(args, "map") ?? "bareDuel") as MapId,
      options: {
        players: [controlledPlayer, enemy],
        teams: { [controlledPlayer]: "north", [enemy]: "south" },
      },
    };
  }
  if (setup === "combat-15v20" || setup === "combat-10v12") {
    const combat = createCombatScenarioSetup({
      label: setup.replace("combat-", "") as CombatScenarioLabel,
      recipeSlug: flag(args, "recipe") ?? "early-mixed",
      v2Owner: controlledPlayer,
      v1Owner: enemy,
    });
    return { mapId: combat.mapId, options: combat.options, policyMode: "combat", winnerMode: "combatElimination" };
  }
  throw new Error(`Unknown ai playtest setup ${setup}`);
}

function conditionFromArgs(args: string[]): InteractivePlaytestCondition {
  const condition = requiredFlag(args, "condition");
  if (condition === "first-fight") return { type: "firstFight" };
  if (condition === "winner") return { type: "winner" };
  if (condition === "tick") return { type: "tick", tick: requiredNumberFlag(args, "tick") };
  if (condition === "enemy-nearby") return { type: "enemyNearby", ...(flag(args, "range") ? { range: requiredNumberFlag(args, "range") } : {}) };
  throw new Error(`Unknown step-until condition ${condition}`);
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

function unitInspectionOwnerFlag(args: string[]): InteractivePlaytestUnitInspectionOwner {
  const owner = flag(args, "owner") ?? "all";
  if (owner === "all" || owner === "neutral") return owner;
  return owner as PlayerId;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
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
  npm run play:ai -- new --file .playtests/duel.json --map bareDuel --you v2 --you-version v2 --enemy v1a --enemy-version v1 --assist-you
  npm run play:ai -- new --file .playtests/combat.json --setup combat-15v20 --recipe early-mixed --you v2 --enemy v1a
  npm run play:ai -- status --file .playtests/duel.json
  npm run play:ai -- memory --file .playtests/duel.json
  npm run play:ai -- inspect-units --file .playtests/duel.json --owner all
  npm run play:ai -- step --file .playtests/duel.json --ticks 45
  npm run play:ai -- step-until --file .playtests/duel.json --condition first-fight --max-ticks 240
  npm run play:ai -- attack-move --file .playtests/duel.json --units combat --x 2048 --y 2048
  npm run play:ai -- retreat-wounded --file .playtests/duel.json --hp-ratio 0.5
  npm run play:ai -- expand --file .playtests/duel.json --resource gold-natural
  npm run play:ai -- creep-camp --file .playtests/duel.json --camp merc-camp-crossroad --units combat
  npm run play:ai -- focus --file .playtests/duel.json --target unit-v1a-worker-1
  npm run play:ai -- focus-near --file .playtests/duel.json --target unit-v1a-footman-1 --join-range 95
  npm run play:ai -- raw --file .playtests/duel.json --json '{"type":"move","unitIds":["unit-v2-worker-1"],"x":500,"y":500}'`);
}
