// Comparing two room benches (base and ref): wins per subject and rival, the games whose winner changed, and each
// metric (see src/ai/benchmark/metrics.ts) for the subject and its rival. Pure, fed the bench's per-seed results.

export type RoomResult = {
  subject: string;
  seed: string;
  wins: number;
  rawMatches: number;
  byMap: { mapId: string; grove: { winner: string | null }; ember: { winner: string | null } }[];
  metrics?: Record<string, Record<string, Record<string, number | null>>>;
};

export type Cell = { subject: string; rival: string; base: { wins: number; games: number }; ref: { wins: number; games: number }; flips: string[] };

export function cells(base: Map<string, RoomResult[]>, ref: Map<string, RoomResult[]>): Cell[] {
  return [...ref.keys()].map((key) => {
    const [subject, rival] = key.split("|") as [string, string];
    const sum = (results: RoomResult[] = []) => ({ wins: results.reduce((total, r) => total + r.wins, 0), games: results.reduce((total, r) => total + r.rawMatches, 0) });
    const winners = (results: RoomResult[] = []) => new Map(results.flatMap((r) => r.byMap.flatMap((map) => (["grove", "ember"] as const)
      .map((race) => [`${r.seed} ${map.mapId} ${race}`, map[race].winner] as const))));
    const before = winners(base.get(key)), after = winners(ref.get(key));
    const flips = [...after].filter(([game, winner]) => before.has(game) && before.get(game) !== winner)
      .map(([game, winner]) => `${game}: ${before.get(game) ?? "draw"} -> ${winner ?? "draw"}`);
    return { subject, rival, base: sum(base.get(key)), ref: sum(ref.get(key)), flips };
  });
}

/** One subject's metric over all its games: a mean (minutes, counts, gold), or for trade the rival's losses over its own. */
export function metricSummary(results: RoomResult[], subject: string, metric: string) {
  const own: number[] = [], rival: number[] = [];
  let missing = 0;
  for (const result of results) for (const game of Object.values(result.metrics ?? {})) {
    const values = game[metric];
    if (!values) continue;
    const mine = values[subject] ?? null;
    const theirs = Object.entries(values).filter(([owner]) => owner !== subject).map(([, value]) => value);
    if (mine === null) missing++; else own.push(mine);
    for (const value of theirs) if (value !== null) rival.push(value);
  }
  if (own.length === 0 && missing === 0) return undefined;
  const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
  const mean = (values: number[]) => values.length ? total(values) / values.length : null;
  if (metric.startsWith("trade@")) return { own: total(rival) / Math.max(1, total(own)), rival: total(own) / Math.max(1, total(rival)), missing };
  return { own: mean(own), rival: mean(rival), missing };
}
