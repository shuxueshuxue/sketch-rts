export function normalizePublicBasePath(value: unknown): string {
  if (value === undefined || value === "") return "/";
  if (typeof value !== "string") throw new Error(`Deployment base path must be a string, got ${typeof value}`);
  const trimmed = value.trim();
  if (trimmed === "") return "/";
  if (trimmed.includes("://") || trimmed.startsWith("//")) throw new Error("Deployment base path must be a URL path, not a full URL");

  const parsed = new URL(trimmed, "http://localhost");
  if (parsed.search || parsed.hash) throw new Error("Deployment base path must not include query or hash");
  const normalized = parsed.pathname.replace(/\/+/g, "/");
  if (normalized === "/") return "/";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function joinPublicPath(basePath: string, pathname: string): string {
  const base = normalizePublicBasePath(basePath);
  const suffix = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (suffix.length === 0) return base;
  return base === "/" ? `/${suffix}` : `${base}${suffix}`;
}

export function expressMountPath(basePath: string): string {
  const base = normalizePublicBasePath(basePath);
  return base === "/" ? "/" : base.slice(0, -1);
}

export function publicBasePathFromEnv(env: { SKETCH_RTS_BASE_PATH?: unknown; VITE_SKETCH_RTS_BASE_PATH?: unknown }): string {
  return normalizePublicBasePath(env.SKETCH_RTS_BASE_PATH ?? env.VITE_SKETCH_RTS_BASE_PATH);
}
