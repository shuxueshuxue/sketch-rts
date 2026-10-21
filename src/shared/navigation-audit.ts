/** Diagnostic-only native routing boundary. The observer may throw in tests;
 * ordinary simulation has no observer and never gains a new failure path. */
export type NavigationAuditEvent = Readonly<{ operation: string; phase: 'strategy-planning' | 'incumbent' | null;
  authorization: Readonly<{ kind: 'fact-work' | 'published-fact'; throughWork?: number }> | null }>;
let observer: ((event: NavigationAuditEvent) => void) | undefined;
let phase: NavigationAuditEvent['phase'] = null;
let authorization: NavigationAuditEvent['authorization'] = null;
export function navigationAuditActive() { return observer !== undefined; }
export function withNavigationAudit<T>(observe: (event: NavigationAuditEvent) => void, run: () => T): T {
  const previous = observer; observer = observe;
  try { return run(); } finally { observer = previous; }
}
export function withNavigationPhase<T>(value: NavigationAuditEvent['phase'], run: () => T): T {
  const previous = phase; phase = value;
  try { return run(); } finally { phase = previous; }
}
export function withFactNavigation<T>(value: NonNullable<NavigationAuditEvent['authorization']>, run: () => T): T {
  const previous = authorization; authorization = value;
  try { return run(); } finally { authorization = previous; }
}
export function recordNativeRouting(operation: string): void {
  observer?.({ operation, phase, authorization });
}
