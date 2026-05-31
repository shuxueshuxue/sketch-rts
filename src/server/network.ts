export function bindHostFromEnv(env: { HOST?: string }) {
  return env.HOST?.trim() || "127.0.0.1";
}

export function publicListenUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

export function viteHmrPort(appPort: number) {
  return appPort + 20_000;
}
