export type DeploymentMode = "server" | "static";

export function parseDeploymentMode(value: unknown): DeploymentMode {
  if (value === undefined || value === "") return "server";
  if (value === "server" || value === "static") return value;
  throw new Error(`Unknown deployment mode ${String(value)}`);
}

export function deploymentModeFromEnv(env: { VITE_SKETCH_RTS_DEPLOYMENT?: unknown }): DeploymentMode {
  return parseDeploymentMode(env.VITE_SKETCH_RTS_DEPLOYMENT);
}
