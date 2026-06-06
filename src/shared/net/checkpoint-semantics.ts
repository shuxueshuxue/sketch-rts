import type { CheckpointRequestClass, CheckpointRequestReason } from "./types";

export function checkpointRequestClass(reason: CheckpointRequestReason): CheckpointRequestClass {
  switch (reason) {
    case "initial-sync":
      return "initial";
    case "late-catchup":
      return "catchup";
    case "manual":
      return "manual";
    case "frame-apply-error":
    case "server-desync":
    case "message-error":
      return "recovery";
    default:
      return exhaustive(reason);
  }
}

function exhaustive(value: never): never {
  throw new Error(`Unknown checkpoint request reason ${String(value)}`);
}
