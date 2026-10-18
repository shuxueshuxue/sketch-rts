import type { Building, BuildingJob, TrainingJob, UpgradeJob } from "./types";

// @@@building-upgrade - A building's queue holds its work in order: units in training and upgrades into another kind.
// Readers of training (supply, production, the AIs' busy checks of what is being trained) read it through trainingJobs,
// so another kind of job never needs every one of them changed.
export function isTrainingJob(job: BuildingJob): job is TrainingJob {
  return !("kind" in job);
}
export function trainingJobs(building: Pick<Building, "queue">): TrainingJob[] {
  return building.queue.filter(isTrainingJob);
}
export function upgradeJob(building: Pick<Building, "queue">): UpgradeJob | undefined {
  return building.queue.find((job): job is UpgradeJob => !isTrainingJob(job));
}
