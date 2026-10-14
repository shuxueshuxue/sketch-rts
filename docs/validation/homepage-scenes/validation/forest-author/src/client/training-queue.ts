import { UNIT_DEFS } from "../shared/catalog";
import type { Building, TrainableUnitKind } from "../shared/types";
import type { createI18n } from "./i18n";

export type TrainingProgressButton = {
  buildingId: string;
  jobId?: string | undefined;
  unitKind: TrainableUnitKind;
  remaining: number;
  duration: number;
  progress: number;
  status: "training" | "queued" | "awaitingLaunch";
};

export function trainingProgressText(progress: TrainingProgressButton, i18n: ReturnType<typeof createI18n>) {
  const percent = Math.floor(progress.progress * 100);
  return {
    label: i18n.t(progress.status === "awaitingLaunch" ? "hud.trainingAwaitingLaunch" : progress.status === "training" ? "hud.trainingTraining" : "hud.trainingQueued", { label: i18n.label(progress.unitKind) }),
    badge: progress.status === "awaitingLaunch" ? i18n.t("hud.trainingAwaitingLaunchBadge") : progress.status === "training" ? `${percent}%` : i18n.t("hud.productionQueueBadge"),
    hint: progress.status === "awaitingLaunch" ? i18n.t("hud.trainingAwaitingLaunchHint") : undefined,
  };
}

export function trainingQueueCountText(queueLength: number) {
  return queueLength > 1 ? `x${queueLength}` : "";
}

/** A completed head job remains in the simulation queue until the hull can launch. */
export function isAwaitingShipLaunch(building: Pick<Building, "complete" | "queue">) {
  const job = building.queue[0];
  return Boolean(building.complete && job && UNIT_DEFS[job.unitKind].naval && job.remaining <= 0);
}

export function trainingProgressButtonsForSelection(buildings: Building[]): TrainingProgressButton[] {
  return buildings.flatMap((building) =>
    building.queue.flatMap((job, index) => {
      const duration = UNIT_DEFS[job.unitKind].trainTime;
      if (duration <= 0) return [];
      return [{
        buildingId: building.id,
        jobId: job.id,
        unitKind: job.unitKind,
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
