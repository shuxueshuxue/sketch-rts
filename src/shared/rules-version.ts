/** Simulation rules identity, separate from JSON format and checksum algorithms.
 * 1: separate Grove/Ember support casters (also all records without a version).
 * 2: canonical shared priest/summoner and race-specific production relations.
 * 3: guardian scroll cast radius reduced from 280 to 180 world units.
 * 4: stronger ship hulls, shipyard shipbuilding, ships excluded from barracks attack/health research.
 * 5: guardian scroll uses 40% ward damage reduction instead of immunity.
 */
export const RULES_VERSION = 5;
export const PREVIOUS_RULES_VERSION = 1;

export function savedRulesVersion(version: unknown): number {
  if (version === undefined) return PREVIOUS_RULES_VERSION;
  if (version !== PREVIOUS_RULES_VERSION && version !== 2 && version !== 3 && version !== 4 && version !== RULES_VERSION) throw new Error(`Unsupported rules version ${String(version)}`);
  return version;
}

export function assertCurrentRulesVersion(version: unknown, context: string): void {
  if (version !== RULES_VERSION) throw new Error(`${context} uses rules version ${String(version ?? PREVIOUS_RULES_VERSION)}; this runtime requires ${RULES_VERSION}. Cross-version simulation is not supported.`);
}
