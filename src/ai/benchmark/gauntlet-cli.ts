import { AI_GAUNTLET_V2, type AiGauntletCatalog, type AiGauntletMatch } from "./gauntlet";

export type GauntletPlaytestReplay = {
  args: string[];
  command: string;
};

export function gauntletPlaytestReplay(match: AiGauntletMatch, catalog: Pick<AiGauntletCatalog, "selection" | "selectedRichScoreMapIds">): GauntletPlaytestReplay {
  const args = [
    "new",
    "--file",
    `.playtests/gauntlet-${slug(match.name)}.json`,
    "--from-gauntlet",
    match.name,
    "--gauntlet-seed",
    catalog.selection.seed,
    ...(catalog.selection.mode === "full" ? ["--gauntlet-full"] : ["--gauntlet-map-count", String(catalog.selectedRichScoreMapIds.length)]),
    "--you",
    AI_GAUNTLET_V2,
    "--assist-you",
  ];
  return {
    args,
    command: `npm run play:ai -- ${args.map(shellArg).join(" ")}`,
  };
}

function slug(value: string) {
  return value
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
