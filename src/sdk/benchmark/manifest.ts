import type { BenchmarkInput, BenchmarkMatchInput } from "./core";
import { traceSourceFor, type SdkGameAgent, type SdkPlannerOrigin } from "../game-runner";
import type { PlayerId } from "../../shared/types";

export type BenchmarkInputManifest = {
  name: string;
  evaluationCount: number;
  matchCount: number;
  evaluations: BenchmarkEvaluationManifest[];
};

export type BenchmarkEvaluationManifest = {
  name: string;
  tag?: string;
  matchCount: number;
  matches: BenchmarkMatchManifest[];
};

export type BenchmarkMatchManifest = {
  name: string;
  mapId?: string;
  maxTicks: number;
  thinkInterval: number;
  commandPlanner: "present" | "absent";
  hasPrebuiltGame: boolean;
  winnerMode?: BenchmarkMatchInput["winnerMode"];
  scenario?: BenchmarkScenarioManifest;
  agents: Record<PlayerId, BenchmarkAgentManifest>;
};

export type BenchmarkScenarioManifest = {
  units: number;
  buildings: number;
  resources: number;
  mercenaryCamps: number;
  items: number;
  landmarks: number;
};

export type BenchmarkAgentManifest = {
  controller: SdkGameAgent["controller"];
  plannerOrigin: SdkPlannerOrigin;
  traceSource: NonNullable<SdkGameAgent["traceSource"]>;
  team: string;
  race?: string;
  aiVersion: string;
  policyVersion?: string;
  policyMode?: string;
  disabledBehaviors?: readonly string[];
  scriptIds?: readonly string[];
};

type RichBenchmarkAgent = SdkGameAgent & {
  policyVersion?: string;
  policyMode?: string;
  disabledBehaviors?: readonly string[];
  scriptIds?: readonly string[];
};

export function describeBenchmarkInput<TAgent extends SdkGameAgent>(input: BenchmarkInput<TAgent>): BenchmarkInputManifest {
  return {
    name: input.name,
    evaluationCount: input.evaluations.length,
    matchCount: input.evaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0),
    evaluations: input.evaluations.map((evaluation) => ({
      name: evaluation.name,
      ...(evaluation.tag ? { tag: evaluation.tag } : {}),
      matchCount: evaluation.matches.length,
      matches: evaluation.matches.map(describeBenchmarkMatch),
    })),
  };
}

function describeBenchmarkMatch<TAgent extends SdkGameAgent>(match: BenchmarkMatchInput<TAgent>): BenchmarkMatchManifest {
  return {
    name: match.name,
    ...(match.mapId ? { mapId: match.mapId } : {}),
    maxTicks: match.maxTicks,
    thinkInterval: match.thinkInterval,
    commandPlanner: match.commandPlanner ? "present" : "absent",
    hasPrebuiltGame: Boolean(match.game),
    ...(match.winnerMode ? { winnerMode: match.winnerMode } : {}),
    ...(match.options?.scenario ? { scenario: describeScenario(match.options.scenario) } : {}),
    agents: Object.fromEntries(Object.entries(match.agents).map(([owner, agent]) => [owner, describeBenchmarkAgent(agent, match.commandPlanner ? "local-command-planner" : "none")])) as Record<PlayerId, BenchmarkAgentManifest>,
  };
}

function describeBenchmarkAgent(agent: SdkGameAgent, plannerOrigin: SdkPlannerOrigin): BenchmarkAgentManifest {
  const rich = agent as RichBenchmarkAgent;
  return {
    controller: agent.controller,
    plannerOrigin,
    traceSource: traceSourceFor(agent),
    team: agent.team,
    ...(agent.race ? { race: agent.race } : {}),
    aiVersion: agent.versionLabel ?? "unknown",
    ...(rich.policyVersion ? { policyVersion: rich.policyVersion } : {}),
    ...(rich.policyMode ? { policyMode: rich.policyMode } : {}),
    ...(rich.disabledBehaviors ? { disabledBehaviors: [...rich.disabledBehaviors] } : {}),
    ...(rich.scriptIds ? { scriptIds: [...rich.scriptIds] } : {}),
  };
}

function describeScenario(scenario: NonNullable<BenchmarkMatchInput["options"]>["scenario"]): BenchmarkScenarioManifest {
  return {
    units: scenario?.addUnits?.length ?? 0,
    buildings: scenario?.addBuildings?.length ?? 0,
    resources: scenario?.addResources?.length ?? 0,
    mercenaryCamps: scenario?.addMercenaryCamps?.length ?? 0,
    items: scenario?.addItems?.length ?? 0,
    landmarks: scenario?.addLandmarks?.length ?? 0,
  };
}
