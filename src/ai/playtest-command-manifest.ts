import type { InteractivePlaytestCommand, InteractiveUnitSelector } from "../sdk/playtest";
import type { BuildingKind, GameCommand, TrainableUnitKind, UpgradeKind } from "../shared/types";

export type AiPlaytestCommandCategory = "session" | "inspection" | "planning" | "stepping" | "tactical";

export type AiPlaytestCommandSpec = {
  name: string;
  category: AiPlaytestCommandCategory;
  summary: string;
  requiredFlags: string[];
  optionalFlags: string[];
  example: string;
  buildCommand?: (args: string[]) => InteractivePlaytestCommand;
};

export const AI_PLAYTEST_COMMAND_MANIFEST: AiPlaytestCommandSpec[] = [
  {
    name: "new",
    category: "session",
    summary: "Create a persistent exact AI playtest session from a map, combat setup, or benchmark match.",
    requiredFlags: ["file"],
    optionalFlags: ["id", "map", "setup", "recipe", "from-benchmark", "benchmark-seed", "benchmark-map-count", "benchmark-full", "from-control-benchmark", "control-seed", "control-map-count", "control-worker-harassment", "control-full", "from-cross-race-benchmark", "cross-race-seed", "cross-race-map-count", "cross-race-full", "from-gauntlet", "gauntlet-seed", "gauntlet-map-count", "gauntlet-full", "you", "enemy", "you-version", "enemy-version", "you-team", "enemy-team", "you-race", "enemy-race", "assist-you", "think-interval", "you-scripts", "enemy-scripts"],
    example: "npm run play:ai -- new --file .playtests/duel.json --map bareDuel --you v2 --enemy v1a --assist-you",
  },
  {
    name: "status",
    category: "inspection",
    summary: "Print the current session summary, score facts, and AI memory claims.",
    requiredFlags: ["file"],
    optionalFlags: [],
    example: "npm run play:ai -- status --file .playtests/duel.json",
  },
  {
    name: "memory",
    category: "inspection",
    summary: "Print raw persisted AI runtime memories for every controlled player.",
    requiredFlags: ["file"],
    optionalFlags: [],
    example: "npm run play:ai -- memory --file .playtests/duel.json",
  },
  {
    name: "inspect-units",
    category: "inspection",
    summary: "Print units with orders, carried items, and memory claims for diagnosis.",
    requiredFlags: ["file"],
    optionalFlags: ["owner"],
    example: "npm run play:ai -- inspect-units --file .playtests/duel.json --owner all",
  },
  {
    name: "plan",
    category: "planning",
    summary: "Print planned AI command entries without mutating the playtest file.",
    requiredFlags: ["file"],
    optionalFlags: ["owner"],
    example: "npm run play:ai -- plan --file .playtests/duel.json --owner v2",
  },
  {
    name: "diagnose",
    category: "planning",
    summary: "Create a fresh playtest, sample tactical checkpoints, and print planned AI entries.",
    requiredFlags: ["file"],
    optionalFlags: ["id", "map", "setup", "recipe", "from-benchmark", "benchmark-seed", "benchmark-map-count", "benchmark-full", "from-control-benchmark", "control-seed", "control-map-count", "control-worker-harassment", "control-full", "from-cross-race-benchmark", "cross-race-seed", "cross-race-map-count", "cross-race-full", "from-gauntlet", "gauntlet-seed", "gauntlet-map-count", "gauntlet-full", "you", "enemy", "you-version", "enemy-version", "you-team", "enemy-team", "you-race", "enemy-race", "assist-you", "think-interval", "you-scripts", "enemy-scripts", "checkpoint-ticks", "checkpoint-seconds", "plan-owner"],
    example: "npm run play:ai -- diagnose --file .playtests/duel.json --setup combat-10v12 --recipe early-mixed --checkpoint-ticks 45,90 --plan-owner v2",
  },
  {
    name: "step",
    category: "stepping",
    summary: "Advance the session by a fixed number of ticks.",
    requiredFlags: ["file"],
    optionalFlags: ["ticks"],
    example: "npm run play:ai -- step --file .playtests/duel.json --ticks 45",
  },
  {
    name: "step-until",
    category: "stepping",
    summary: "Advance until a reusable tactical checkpoint condition is met.",
    requiredFlags: ["file", "condition"],
    optionalFlags: ["tick", "seconds", "range", "max-ticks"],
    example: "npm run play:ai -- step-until --file .playtests/duel.json --condition first-fight --max-ticks 240",
  },
  {
    name: "raw",
    category: "tactical",
    summary: "Apply one raw GameCommand JSON payload through the playtest command path.",
    requiredFlags: ["file", "json"],
    optionalFlags: ["owner"],
    example: "npm run play:ai -- raw --file .playtests/duel.json --json '{\"type\":\"move\",\"unitIds\":[\"unit-v2-worker-1\"],\"x\":500,\"y\":500}'",
    buildCommand: (args) => ({ type: "raw", ...optional("owner", flag(args, "owner")), command: JSON.parse(requiredFlag(args, "json")) as GameCommand }),
  },
  {
    name: "move",
    category: "tactical",
    summary: "Move selected units to a map point.",
    requiredFlags: ["file", "x", "y"],
    optionalFlags: ["units"],
    example: "npm run play:ai -- move --file .playtests/duel.json --units workers --x 500 --y 500",
    buildCommand: (args) => ({ type: "move", ...optionalUnitIds(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") }),
  },
  {
    name: "gather",
    category: "tactical",
    summary: "Gather selected army units to a map point.",
    requiredFlags: ["file", "x", "y"],
    optionalFlags: ["units"],
    example: "npm run play:ai -- gather --file .playtests/duel.json --units combat --x 1200 --y 1200",
    buildCommand: (args) => ({ type: "gatherArmy", ...optionalUnitIds(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") }),
  },
  {
    name: "attack-move",
    category: "tactical",
    summary: "Send selected units on an attack-move while recording durable attack memory.",
    requiredFlags: ["file", "x", "y"],
    optionalFlags: ["units"],
    example: "npm run play:ai -- attack-move --file .playtests/duel.json --units combat --x 2048 --y 2048",
    buildCommand: (args) => ({ type: "attackMove", ...optionalUnitIds(args), x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") }),
  },
  {
    name: "focus",
    category: "tactical",
    summary: "Focus-fire a specific target with selected units.",
    requiredFlags: ["file", "target"],
    optionalFlags: ["units"],
    example: "npm run play:ai -- focus --file .playtests/duel.json --target unit-v1a-worker-1",
    buildCommand: (args) => ({ type: "focusFire", ...optionalUnitIds(args), targetId: requiredFlag(args, "target") }),
  },
  {
    name: "focus-near",
    category: "tactical",
    summary: "Focus-fire a target with nearby attackers only.",
    requiredFlags: ["file", "target"],
    optionalFlags: ["units", "join-range"],
    example: "npm run play:ai -- focus-near --file .playtests/duel.json --target unit-v1a-footman-1 --join-range 95",
    buildCommand: (args) => ({ type: "focusFireNear", ...optionalUnitIds(args), targetId: requiredFlag(args, "target"), ...(flag(args, "join-range") ? { joinRange: requiredNumberFlag(args, "join-range") } : {}) }),
  },
  {
    name: "retreat",
    category: "tactical",
    summary: "Retreat selected units to the AI recovery point or an explicit point.",
    requiredFlags: ["file"],
    optionalFlags: ["units", "x", "y"],
    example: "npm run play:ai -- retreat --file .playtests/duel.json --units combat",
    buildCommand: (args) => ({ type: "retreat", ...optionalUnitIds(args), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) }),
  },
  {
    name: "retreat-wounded",
    category: "tactical",
    summary: "Retreat wounded units through the memory-backed tactical command path.",
    requiredFlags: ["file"],
    optionalFlags: ["units", "hp-ratio", "x", "y"],
    example: "npm run play:ai -- retreat-wounded --file .playtests/duel.json --hp-ratio 0.5",
    buildCommand: (args) => ({ type: "retreatWounded", ...optionalUnitIds(args), hpRatio: numberFlag(args, "hp-ratio", 0.5), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) }),
  },
  {
    name: "mine",
    category: "tactical",
    summary: "Send workers to mine the nearest or specified resource.",
    requiredFlags: ["file"],
    optionalFlags: ["units", "resource"],
    example: "npm run play:ai -- mine --file .playtests/duel.json --units workers --resource gold-player-main",
    buildCommand: (args) => ({ type: "mine", ...optionalUnitIds(args), ...(flag(args, "resource") ? { resourceId: requiredFlag(args, "resource") } : {}) }),
  },
  {
    name: "repair",
    category: "tactical",
    summary: "Send workers to repair a building.",
    requiredFlags: ["file", "building"],
    optionalFlags: ["units"],
    example: "npm run play:ai -- repair --file .playtests/duel.json --building building-v2-townhall",
    buildCommand: (args) => ({ type: "repair", ...optionalUnitIds(args), buildingId: requiredFlag(args, "building") }),
  },
  {
    name: "expand",
    category: "tactical",
    summary: "Ask the AI to expand at a chosen or inferred resource node.",
    requiredFlags: ["file"],
    optionalFlags: ["unit", "resource"],
    example: "npm run play:ai -- expand --file .playtests/duel.json --resource gold-natural",
    buildCommand: (args) => ({ type: "expand", ...optional("unitId", flag(args, "unit")), ...(flag(args, "resource") ? { resourceId: requiredFlag(args, "resource") } : {}) }),
  },
  {
    name: "creep-camp",
    category: "tactical",
    summary: "Send combat units to creep a neutral camp.",
    requiredFlags: ["file"],
    optionalFlags: ["camp", "units"],
    example: "npm run play:ai -- creep-camp --file .playtests/duel.json --camp merc-camp-crossroad --units combat",
    buildCommand: (args) => ({ type: "creepCamp", ...optional("campId", flag(args, "camp")), ...optionalUnitIds(args) }),
  },
  {
    name: "build",
    category: "tactical",
    summary: "Order a worker to build a structure at a point.",
    requiredFlags: ["file", "kind", "x", "y"],
    optionalFlags: ["unit"],
    example: "npm run play:ai -- build --file .playtests/duel.json --kind barracks --x 420 --y 380",
    buildCommand: (args) => ({ type: "build", ...optional("unitId", flag(args, "unit")), buildingKind: requiredFlag(args, "kind") as BuildingKind, x: requiredNumberFlag(args, "x"), y: requiredNumberFlag(args, "y") }),
  },
  {
    name: "train",
    category: "tactical",
    summary: "Train a unit from a chosen or inferred production building.",
    requiredFlags: ["file", "unit-kind"],
    optionalFlags: ["building"],
    example: "npm run play:ai -- train --file .playtests/duel.json --unit-kind footman",
    buildCommand: (args) => ({ type: "train", ...optional("buildingId", flag(args, "building")), unitKind: requiredFlag(args, "unit-kind") as TrainableUnitKind }),
  },
  {
    name: "research",
    category: "tactical",
    summary: "Research an upgrade from a chosen or inferred building.",
    requiredFlags: ["file", "upgrade"],
    optionalFlags: ["building"],
    example: "npm run play:ai -- research --file .playtests/duel.json --upgrade meleeWeapons",
    buildCommand: (args) => ({ type: "research", ...optional("buildingId", flag(args, "building")), upgradeKind: requiredFlag(args, "upgrade") as UpgradeKind }),
  },
  {
    name: "hire",
    category: "tactical",
    summary: "Hire a mercenary from a camp.",
    requiredFlags: ["file", "camp"],
    optionalFlags: [],
    example: "npm run play:ai -- hire --file .playtests/duel.json --camp merc-camp-crossroad",
    buildCommand: (args) => ({ type: "hire", campId: requiredFlag(args, "camp") }),
  },
  {
    name: "pickup-item",
    category: "tactical",
    summary: "Pick up a nearby item through the reusable SDK item intent.",
    requiredFlags: ["file", "item"],
    optionalFlags: ["unit"],
    example: "npm run play:ai -- pickup-item --file .playtests/duel.json --item treasure-center-lightning",
    buildCommand: (args) => ({ type: "pickupItem", ...optional("unitId", flag(args, "unit")), itemId: requiredFlag(args, "item") }),
  },
  {
    name: "use-item",
    category: "tactical",
    summary: "Use an item, optionally against a target or point.",
    requiredFlags: ["file", "item"],
    optionalFlags: ["unit", "target", "x", "y"],
    example: "npm run play:ai -- use-item --file .playtests/duel.json --item potion-v2-1 --unit unit-v2-footman-1",
    buildCommand: (args) => ({ type: "useItem", ...optional("unitId", flag(args, "unit")), itemId: requiredFlag(args, "item"), ...(flag(args, "target") ? { targetId: requiredFlag(args, "target") } : {}), ...(flag(args, "x") ? { x: requiredNumberFlag(args, "x") } : {}), ...(flag(args, "y") ? { y: requiredNumberFlag(args, "y") } : {}) }),
  },
];

export function commandFromPlaytestArgs(verb: string, args: string[]): InteractivePlaytestCommand {
  const command = AI_PLAYTEST_COMMAND_MANIFEST.find((candidate) => candidate.name === verb);
  if (command?.buildCommand) return command.buildCommand(args);
  throw new Error(`Unknown ai playtest command ${verb}`);
}

function unitSelector(args: string[]): InteractiveUnitSelector | undefined {
  const raw = flag(args, "units");
  if (!raw) return undefined;
  if (raw === "all" || raw === "combat" || raw === "workers") return raw;
  return raw.split(",").filter(Boolean);
}

function optionalUnitIds(args: string[]): { unitIds?: InteractiveUnitSelector } {
  return optional("unitIds", unitSelector(args));
}

function optional<K extends string, V>(key: K, value: V | undefined): { [Property in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [Property in K]?: V });
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
