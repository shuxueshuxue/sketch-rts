export type GauntletMapSelection<TMapId extends string> = {
  mode: "sample" | "full";
  seed: string;
  mapIds: TMapId[];
};

export type GauntletSelectionEnv = Partial<Record<"AI_GAUNTLET_FULL" | "AI_GAUNTLET_MAP_COUNT" | "AI_GAUNTLET_SEED", string>>;

const DEFAULT_SAMPLE_SIZE = 10;

export function selectGauntletRichScoreMaps<TMapId extends string>(mapIds: readonly TMapId[], env: GauntletSelectionEnv = {}): GauntletMapSelection<TMapId> {
  const seed = env.AI_GAUNTLET_SEED ?? String(Date.now());
  if (env.AI_GAUNTLET_FULL === "1") return { mode: "full", seed, mapIds: [...mapIds] };

  const sampleSize = Math.min(parseSampleSize(env.AI_GAUNTLET_MAP_COUNT), mapIds.length);
  return { mode: "sample", seed, mapIds: shuffledBySeed(mapIds, seed).slice(0, sampleSize) };
}

function parseSampleSize(value: string | undefined) {
  if (!value) return DEFAULT_SAMPLE_SIZE;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_SIZE;
}

function shuffledBySeed<T>(items: readonly T[], seed: string) {
  const result = [...items];
  let state = hashSeed(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = nextRandomState(state);
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandomState(state: number) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}
