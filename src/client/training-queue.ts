import { isTrainingJob } from "../shared/building-jobs";
import { BUILDING_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { Building, BuildingJob, BuildingKind, TrainableUnitKind } from "../shared/types";
import type { createI18n } from "./i18n";

/** One job of a building's work queue: a unit in training, or the building's own upgrade (see @@@building-upgrade). */
export type TrainingProgressButton = ({ product: "unit"; unitKind: TrainableUnitKind } | { product: "upgrade"; upgradeTo: BuildingKind }) & {
  buildingId: string;
  jobId?: string | undefined;
  remaining: number;
  duration: number;
  progress: number;
  status: "training" | "queued" | "awaitingLaunch";
};

export function trainingProgressText(progress: TrainingProgressButton, i18n: ReturnType<typeof createI18n>) {
  const percent = Math.floor(progress.progress * 100);
  return {
    label: i18n.t(progress.status === "awaitingLaunch" ? "hud.trainingAwaitingLaunch" : progress.status === "training" ? "hud.trainingTraining" : "hud.trainingQueued", { label: i18n.label(progressKind(progress)) }),
    badge: progress.status === "awaitingLaunch" ? i18n.t("hud.trainingAwaitingLaunchBadge") : progress.status === "training" ? `${percent}%` : i18n.t("hud.productionQueueBadge"),
    hint: progress.status === "awaitingLaunch" ? i18n.t("hud.trainingAwaitingLaunchHint") : undefined,
  };
}

export function progressKind(progress: TrainingProgressButton) {
  return progress.product === "unit" ? progress.unitKind : progress.upgradeTo;
}

export function jobDuration(job: BuildingJob) {
  return isTrainingJob(job) ? UNIT_DEFS[job.unitKind].trainTime : BUILDING_DEFS[job.to].buildTime;
}

export function trainingQueueCountText(queueLength: number) {
  return queueLength > 1 ? `x${queueLength}` : "";
}

/** A completed head job remains in the simulation queue until the hull can launch. */
export function isAwaitingShipLaunch(building: Pick<Building, "complete" | "queue">) {
  const job = building.queue[0];
  return Boolean(building.complete && job && isTrainingJob(job) && UNIT_DEFS[job.unitKind].naval && job.remaining <= 0);
}

export function trainingProgressButtonsForSelection(buildings: Building[]): TrainingProgressButton[] {
  return buildings.flatMap((building) =>
    building.queue.flatMap((job, index) => {
      const duration = jobDuration(job);
      if (duration <= 0) return [];
      return [{
        ...(isTrainingJob(job) ? { product: "unit" as const, unitKind: job.unitKind } : { product: "upgrade" as const, upgradeTo: job.to }),
        buildingId: building.id,
        jobId: job.id,
        remaining: job.remaining,
        duration,
        progress: index === 0 ? Math.max(0, Math.min(1, 1 - job.remaining / duration)) : 0,
        // The simulation keeps a completed ship at the head until it can launch.
        // Read that result directly; the UI must not repeat the berth search.
        status: index === 0 ? isAwaitingShipLaunch(building) ? "awaitingLaunch" : "training" : "queued",
      }];
    }),
  );
}
