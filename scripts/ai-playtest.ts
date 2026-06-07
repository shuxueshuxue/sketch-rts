import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInteractivePlaytestSession, restoreInteractivePlaytestSession, serializeInteractivePlaytestSession, type InteractivePlaytestCondition, type InteractivePlaytestUnitInspectionOwner, type SerializedInteractivePlaytestSession } from "../src/sdk/playtest";
import { applyAiInteractivePlaytestCommand, createAiInteractivePlaytestRuntime, inspectAiInteractivePlaytestUnits, stepAiInteractivePlaytestSession, stepAiInteractivePlaytestUntil, summarizeAiInteractivePlaytestSession } from "../src/ai/playtest";
import { AI_PLAYTEST_COMMAND_MANIFEST as SHARED_AI_PLAYTEST_COMMAND_MANIFEST, commandFromPlaytestArgs } from "../src/ai/playtest-command-manifest";
import { createAiPlaytestSetupFromArgs } from "../src/ai/playtest-session-setup";
import { DEFAULT_AI_THINK_INTERVAL, planAiRuntimeCommandEntries } from "../src/ai/runtime";
import type { AiRuntimeState } from "../src/ai/runtime";
import { AI_SCRIPT_LIBRARY } from "../src/ai/policy";
import { SIM_TICKS_PER_SECOND } from "../src/shared/time";
import type { AiScriptVersion, PlayerId } from "../src/shared/types";

type AiPlaytestFile = {
  session: SerializedInteractivePlaytestSession;
  runtime: AiRuntimeState;
};

const [verb, ...args] = process.argv.slice(2);
if (!verb || verb === "help" || verb === "--help") {
  printHelp();
  process.exit(verb ? 0 : 1);
}

if (verb === "commands") {
  printJson({ version: 1, commands: SHARED_AI_PLAYTEST_COMMAND_MANIFEST.map(({ buildCommand: _buildCommand, ...command }) => command) });
  process.exit(0);
}

if (verb === "new") {
  const file = requiredFlag(args, "file");
  const controlledPlayer = flag(args, "you") ?? "v2";
  const enemy = flag(args, "enemy") ?? "v1a";
  const setup = createAiPlaytestSetupFromArgs(args, controlledPlayer, enemy);
  const controlledVersion = setup.versions?.[controlledPlayer] ?? ((flag(args, "you-version") ?? "v2") as AiScriptVersion);
  const enemyVersion = setup.versions?.[enemy] ?? ((flag(args, "enemy-version") ?? "v1") as AiScriptVersion);
  const thinkInterval = numberFlag(args, "think-interval", DEFAULT_AI_THINK_INTERVAL);
  const assistControlled = boolFlag(args, "assist-you");
  const scriptedPlayers = setup.scriptedPlayers ?? [enemy];
  const versions = { ...Object.fromEntries(scriptedPlayers.map((owner) => [owner, setup.versions?.[owner] ?? enemyVersion])), [controlledPlayer]: controlledVersion } as Partial<Record<PlayerId, AiScriptVersion>>;
  const scriptIdsByPlayer = scriptIdsByPlayerFromArgs(args, controlledPlayer, scriptedPlayers, assistControlled);
  const session = createInteractivePlaytestSession({
    id: flag(args, "id") ?? setup.id ?? `interactive-${setup.mapId}-${Date.now()}`,
    mapId: setup.mapId,
    controlledPlayer,
    scriptedPlayers,
    winnerMode: setup.winnerMode,
    options: setup.options,
  });
  const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled, thinkInterval, versions, ...(Object.keys(scriptIdsByPlayer).length > 0 ? { scriptIdsByPlayer } : {}), ...(setup.policyMode ? { policyMode: setup.policyMode } : {}), ...(setup.disabledBehaviorsByPlayer ? { disabledBehaviorsByPlayer: setup.disabledBehaviorsByPlayer } : {}) });
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

if (verb === "plan") {
  const owner = flag(args, "owner") as PlayerId | undefined;
  if (owner && !session.game.players[owner]) throw new Error(`Unknown player ${owner}`);
  const runtime = clone(loaded.runtime);
  printJson({
    tick: session.game.tick,
    gameSecond: session.game.tick / SIM_TICKS_PER_SECOND,
    owner: owner ?? "all",
    entries: planAiRuntimeCommandEntries(session.game, runtime, owner ? [owner] : undefined),
  });
  process.exit(0);
}

if (verb === "step") {
  stepAiInteractivePlaytestSession(session, loaded.runtime, numberFlag(args, "ticks", 45));
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
  printJson(summarizeAiInteractivePlaytestSession(session, loaded.runtime));
  process.exit(0);
}

if (verb === "step-until") {
  const condition = conditionFromArgs(args);
  const result = stepAiInteractivePlaytestUntil(session, loaded.runtime, condition, { maxTicks: numberFlag(args, "max-ticks", defaultStepUntilMaxTicks(session, condition)) });
  savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
  printJson({ result, summary: summarizeAiInteractivePlaytestSession(session, loaded.runtime) });
  process.exit(result.conditionMet ? 0 : 1);
}

const command = commandFromPlaytestArgs(verb, args);
applyAiInteractivePlaytestCommand(session, loaded.runtime, command);
savePlaytestFile(file, { session: serializeInteractivePlaytestSession(session), runtime: loaded.runtime });
printJson(summarizeAiInteractivePlaytestSession(session, loaded.runtime));

function conditionFromArgs(args: string[]): InteractivePlaytestCondition {
  const condition = requiredFlag(args, "condition");
  if (condition === "first-fight") return { type: "firstFight" };
  if (condition === "winner") return { type: "winner" };
  if (condition === "tick") return { type: "tick", tick: requiredNumberFlag(args, "tick") };
  if (condition === "time") return { type: "gameSecond", seconds: requiredNumberFlag(args, "seconds") };
  if (condition === "enemy-nearby") return { type: "enemyNearby", ...(flag(args, "range") ? { range: requiredNumberFlag(args, "range") } : {}) };
  throw new Error(`Unknown step-until condition ${condition}`);
}

function defaultStepUntilMaxTicks(session: ReturnType<typeof restoreInteractivePlaytestSession>, condition: InteractivePlaytestCondition) {
  if (condition.type === "tick") return Math.max(240, condition.tick - session.game.tick);
  if (condition.type === "gameSecond") return Math.max(240, Math.ceil(condition.seconds * SIM_TICKS_PER_SECOND) - session.game.tick);
  return 240;
}

function loadPlaytestFile(file: string): AiPlaytestFile {
  return JSON.parse(readFileSync(file, "utf8")) as AiPlaytestFile;
}

function savePlaytestFile(file: string, value: AiPlaytestFile) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function unitInspectionOwnerFlag(args: string[]): InteractivePlaytestUnitInspectionOwner {
  const owner = flag(args, "owner") ?? "all";
  if (owner === "all" || owner === "neutral") return owner;
  return owner as PlayerId;
}

function scriptIdsByPlayerFromArgs(args: string[], controlledPlayer: PlayerId, scriptedPlayers: PlayerId[], assistControlled: boolean): Partial<Record<PlayerId, string[]>> {
  const youScripts = scriptIdsFlag(args, "you-scripts");
  const enemyScripts = scriptIdsFlag(args, "enemy-scripts");
  if (youScripts && !assistControlled) throw new Error("--you-scripts requires --assist-you");
  return {
    ...(youScripts ? { [controlledPlayer]: youScripts } : {}),
    ...(enemyScripts ? Object.fromEntries(scriptedPlayers.map((owner) => [owner, enemyScripts])) : {}),
  };
}

function scriptIdsFlag(args: string[], name: string): string[] | undefined {
  const raw = flag(args, name);
  if (raw === undefined) return undefined;
  const scriptIds = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (scriptIds.length === 0) throw new Error(`--${name} must include at least one script id`);
  for (const scriptId of scriptIds) {
    if (!(scriptId in AI_SCRIPT_LIBRARY)) throw new Error(`Unknown AI script id ${scriptId}`);
  }
  return scriptIds;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function printHelp() {
  const lines = ["Usage:", ...SHARED_AI_PLAYTEST_COMMAND_MANIFEST.map((command) => `  ${command.example}`), "", "Machine-readable command manifest:", "  npm run play:ai -- commands"];
  console.log(lines.join("\n"));
}
