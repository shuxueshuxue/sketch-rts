export function trainingQueueCountText(queueLength: number) {
  return queueLength > 1 ? `x${queueLength}` : "";
}
