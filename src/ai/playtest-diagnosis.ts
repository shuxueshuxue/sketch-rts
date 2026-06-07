import { restoreInteractivePlaytestSession, serializeInteractivePlaytestSession, type InteractivePlaytestCondition, type InteractivePlaytestUnitInspectionOwner } from "../sdk/playtest";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { PlayerId } from "../shared/types";
import { inspectAiInteractivePlaytestUnits, stepAiInteractivePlaytestUntil, summarizeAiInteractivePlaytestSession, type AiInteractivePlaytestSummary, type AiInteractivePlaytestUnitInspection } from "./playtest";
import { planAiRuntimeCommandEntries, type AiRuntimeIssuedCommand } from "./runtime";
import { createAiPlaytestFileFromArgs, type AiPlaytestFile } from "./playtest-session-file";

export type AiPlaytestDiagnosisCheckpoint =
  | { type: "initial" }
  | { type: "tick"; tick: number; maxTicks?: number }
  | { type: "gameSecond"; seconds: number; maxTicks?: number }
  | { type: "firstFight"; maxTicks?: number }
  | { type: "winner"; maxTicks?: number };

export type AiPlaytestDiagnosisPlan = {
  owner: PlayerId | "all";
  entries: AiRuntimeIssuedCommand[];
};

export type AiPlaytestDiagnosisSample = {
  label: string;
  tick: number;
  gameSecond: number;
  summary: AiInteractivePlaytestSummary;
  plans: Partial<Record<PlayerId | "all", AiPlaytestDiagnosisPlan>>;
  inspections: Partial<Record<InteractivePlaytestUnitInspectionOwner, AiInteractivePlaytestUnitInspection>>;
};

export type AiPlaytestDiagnosis = {
  file: AiPlaytestFile;
  samples: AiPlaytestDiagnosisSample[];
  finalSummary: AiInteractivePlaytestSummary;
};

export function runAiPlaytestDiagnosis(input: { args: string[]; checkpoints?: AiPlaytestDiagnosisCheckpoint[]; planOwners?: PlayerId[]; inspectOwner?: InteractivePlaytestUnitInspectionOwner }): AiPlaytestDiagnosis {
  const initial = createAiPlaytestFileFromArgs(input.args);
  const session = restoreInteractivePlaytestSession(initial.session);
  const runtime = clone(initial.runtime);
  const checkpoints = input.checkpoints ?? [{ type: "initial" }];
  const samples: AiPlaytestDiagnosisSample[] = [];

  for (const checkpoint of checkpoints) {
    if (checkpoint.type !== "initial") {
      stepAiInteractivePlaytestUntil(session, runtime, conditionForCheckpoint(checkpoint), { maxTicks: maxTicksForCheckpoint(session.game.tick, checkpoint) });
    }
    samples.push(sampleDiagnosis(checkpointLabel(checkpoint), input.planOwners, input.inspectOwner, session, runtime));
  }

  return {
    file: { session: serializeInteractivePlaytestSession(session), runtime },
    samples,
    finalSummary: summarizeAiInteractivePlaytestSession(session, runtime),
  };
}

function sampleDiagnosis(label: string, planOwners: PlayerId[] | undefined, inspectOwner: InteractivePlaytestUnitInspectionOwner | undefined, session: ReturnType<typeof restoreInteractivePlaytestSession>, runtime: AiPlaytestFile["runtime"]): AiPlaytestDiagnosisSample {
  const plans: AiPlaytestDiagnosisSample["plans"] = {};
  if (planOwners && planOwners.length > 0) {
    for (const owner of planOwners) {
      plans[owner] = { owner, entries: planAiRuntimeCommandEntries(session.game, clone(runtime), [owner]) };
    }
  } else {
    plans.all = { owner: "all", entries: planAiRuntimeCommandEntries(session.game, clone(runtime)) };
  }
  const inspections: AiPlaytestDiagnosisSample["inspections"] = {};
  if (inspectOwner) inspections[inspectOwner] = inspectAiInteractivePlaytestUnits(session, runtime, { owner: inspectOwner });
  return {
    label,
    tick: session.game.tick,
    gameSecond: session.game.tick / SIM_TICKS_PER_SECOND,
    summary: summarizeAiInteractivePlaytestSession(session, runtime),
    plans,
    inspections,
  };
}

function conditionForCheckpoint(checkpoint: Exclude<AiPlaytestDiagnosisCheckpoint, { type: "initial" }>): InteractivePlaytestCondition {
  if (checkpoint.type === "tick") return { type: "tick", tick: checkpoint.tick };
  if (checkpoint.type === "gameSecond") return { type: "gameSecond", seconds: checkpoint.seconds };
  if (checkpoint.type === "firstFight") return { type: "firstFight" };
  return { type: "winner" };
}

function maxTicksForCheckpoint(currentTick: number, checkpoint: Exclude<AiPlaytestDiagnosisCheckpoint, { type: "initial" }>) {
  if (checkpoint.maxTicks !== undefined) return checkpoint.maxTicks;
  if (checkpoint.type === "tick") return Math.max(240, checkpoint.tick - currentTick);
  if (checkpoint.type === "gameSecond") return Math.max(240, Math.ceil(checkpoint.seconds * SIM_TICKS_PER_SECOND) - currentTick);
  return 1200;
}

function checkpointLabel(checkpoint: AiPlaytestDiagnosisCheckpoint) {
  if (checkpoint.type === "tick") return `tick:${checkpoint.tick}`;
  if (checkpoint.type === "gameSecond") return `time:${checkpoint.seconds}`;
  return checkpoint.type;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
