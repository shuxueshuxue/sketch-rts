import { UNIT_DEFS } from "../shared/catalog";
import type { Building, TrainableUnitKind } from "../shared/types";

export type TrainingProgressButton = {
  buildingId: string;
  unitKind: TrainableUnitKind;
  remaining: number;
  duration: number;
  progress: number;
  status: "training" | "queued";
};

export function trainingQueueCountText(queueLength: number) {
  return queueLength > 1 ? `x${queueLength}` : "";
}

export function trainingProgressButtonsForSelection(buildings: Building[]): TrainingProgressButton[] {
  return buildings.flatMap((building) =>
    building.queue.flatMap((job, index) => {
      const duration = UNIT_DEFS[job.unitKind].trainTime;
      if (duration <= 0) return [];
      return [{
        buildingId: building.id,
        unitKind: job.unitKind,
        remaining: job.remaining,
        duration,
        progress: index === 0 ? Math.max(0, Math.min(1, 1 - job.remaining / duration)) : 0,
        status: index === 0 ? "training" : "queued",
      }];
    }),
  );
}
